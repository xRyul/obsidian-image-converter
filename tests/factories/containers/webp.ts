/** Spec-accurate WebP builders, with inspectors that do not use the code under test. */

import { ascii, concat, readFourCc } from '../../../src/metadata/containers/bytes';

function riffChunk(type: string, payload: Uint8Array): Uint8Array {
  const padding = payload.length % 2;
  const chunk = new Uint8Array(8 + payload.length + padding);
  const view = new DataView(chunk.buffer);

  chunk.set(ascii(type), 0);
  view.setUint32(4, payload.length, true);
  chunk.set(payload, 8);

  return chunk;
}

function riff(body: Uint8Array[]): Uint8Array {
  const bodyBytes = concat(body);
  const header = new Uint8Array(12);

  header.set(ascii('RIFF'), 0);
  new DataView(header.buffer).setUint32(4, 4 + bodyBytes.length, true);
  header.set(ascii('WEBP'), 8);

  return concat([header, bodyBytes]);
}

/** A lossy keyframe header: frame tag, start code, then the frame size. */
function vp8Payload(width: number, height: number): Uint8Array {
  const payload = new Uint8Array(20);
  const view = new DataView(payload.buffer);

  payload[0] = 0x10; // 3-byte frame tag: keyframe (low bit clear)
  payload.set([0x9d, 0x01, 0x2a], 3); // start code
  view.setUint16(6, width, true);
  view.setUint16(8, height, true);

  return payload;
}

/** Simple lossy WebP: one `VP8 ` chunk only. Canvas writes this format. */
export function buildWebpLossy(options: { width?: number; height?: number } = {}): Uint8Array {
  return riff([riffChunk('VP8 ', vp8Payload(options.width ?? 100, options.height ?? 80))]);
}

/** Simple lossless WebP: one `VP8L` chunk only. */
export function buildWebpLossless(
  options: { width?: number; height?: number; alpha?: boolean } = {}
): Uint8Array {
  const width = options.width ?? 100;
  const height = options.height ?? 80;

  const payload = new Uint8Array(16);
  payload[0] = 0x2f; // VP8L signature

  const bits = ((width - 1) & 0x3fff)
    | (((height - 1) & 0x3fff) << 14)
    | ((options.alpha ? 1 : 0) << 28);
  new DataView(payload.buffer).setUint32(1, bits >>> 0, true);

  return riff([riffChunk('VP8L', payload)]);
}

/**
 * Extended WebP that already has a VP8X chunk. The ICCP, EXIF and XMP chunks
 * are optional. If `animated` is true, the image is one ANMF frame after an
 * ANIM chunk, and not a `VP8 ` chunk at the top level.
 */
export function buildWebpExtended(
  options: {
    width?: number;
    height?: number;
    exif?: Uint8Array;
    alpha?: boolean;
    iccp?: Uint8Array;
    xmp?: Uint8Array;
    animated?: boolean;
  } = {}
): Uint8Array {
  const width = options.width ?? 100;
  const height = options.height ?? 80;

  const vp8x = new Uint8Array(10);
  vp8x[0] = (options.iccp ? 0x20 : 0)
    | (options.alpha ? 0x10 : 0)
    | (options.exif ? 0x08 : 0)
    | (options.xmp ? 0x04 : 0)
    | (options.animated ? 0x02 : 0);
  writeUint24(vp8x, 4, width - 1);
  writeUint24(vp8x, 7, height - 1);

  const body = [riffChunk('VP8X', vp8x)];

  if (options.iccp) {
    body.push(riffChunk('ICCP', options.iccp));
  }

  const image = riffChunk('VP8 ', vp8Payload(width, height));

  if (options.animated) {
    // ANIM: background colour (4 bytes) and loop count (2 bytes).
    body.push(riffChunk('ANIM', new Uint8Array(6)));

    // ANMF: X and Y offsets, frame width - 1, frame height - 1 and duration
    // (3 bytes each), a flags byte, then the frame image data.
    const frame = new Uint8Array(16 + image.length);
    writeUint24(frame, 6, width - 1);
    writeUint24(frame, 9, height - 1);
    frame.set(image, 16);
    body.push(riffChunk('ANMF', frame));
  } else {
    body.push(image);
  }

  if (options.exif) {
    body.push(riffChunk('EXIF', options.exif));
  }

  if (options.xmp) {
    body.push(riffChunk('XMP ', options.xmp));
  }

  return riff(body);
}

/** WebP chunks in file order, with the offset and size of each payload. */
function webpChunks(bytes: Uint8Array): { type: string; payloadStart: number; size: number }[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunks: { type: string; payloadStart: number; size: number }[] = [];
  let offset = 12;

  while (offset + 8 <= bytes.length) {
    const size = view.getUint32(offset + 4, true);
    chunks.push({ type: readFourCc(bytes, offset), payloadStart: offset + 8, size });
    offset += 8 + size + (size % 2);
  }

  return chunks;
}

/** Returns a copy of the payload of the first chunk of this type, or null if there is none. */
export function webpChunkPayload(bytes: Uint8Array, type: string): Uint8Array | null {
  const chunk = webpChunks(bytes).find((candidate) => candidate.type === type);
  return chunk ? bytes.slice(chunk.payloadStart, chunk.payloadStart + chunk.size) : null;
}

/** Lists the WebP chunk types in file order. */
export function webpChunkTypes(bytes: Uint8Array): string[] {
  return webpChunks(bytes).map((chunk) => chunk.type);
}

/** Reads the VP8X flags byte, or null when the file is not extended. */
export function webpVp8xFlags(bytes: Uint8Array): number | null {
  const vp8x = webpChunks(bytes).find((chunk) => chunk.type === 'VP8X');
  return vp8x ? bytes[vp8x.payloadStart] : null;
}

/** True when the RIFF size field matches the actual file length. */
export function webpRiffSizeValid(bytes: Uint8Array): boolean {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return view.getUint32(4, true) === bytes.length - 8;
}

function writeUint24(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >> 8) & 0xff;
  bytes[offset + 2] = (value >> 16) & 0xff;
}

/** Gives the `VP8 ` chunk a size that goes past the end of the file. */
export function damageWebpImageChunk(bytes: Uint8Array): Uint8Array {
  const out = bytes.slice();
  const vp8 = webpChunks(out).find((chunk) => chunk.type === 'VP8 ');
  if (!vp8) throw new Error('fixture has no VP8 chunk');

  new DataView(out.buffer).setUint32(vp8.payloadStart - 4, 0x7fffffff, true);
  return out;
}

/**
 * Removes the padding byte after an odd-sized final chunk. If
 * `riffCountsPadding` is false, the RIFF size changes to match the new length.
 */
export function removeWebpFinalPadding(bytes: Uint8Array, riffCountsPadding: boolean): Uint8Array {
  if ((bytes.length - 12) % 2 !== 0 || bytes[bytes.length - 1] !== 0) {
    throw new Error('fixture does not end with a padding byte');
  }

  const out = bytes.slice(0, bytes.length - 1);

  if (!riffCountsPadding) {
    new DataView(out.buffer).setUint32(4, out.length - 8, true);
  }

  return out;
}
