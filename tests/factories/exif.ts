/**
 * Builds real EXIF blocks (TIFF header + IFDs) for tests.
 */

export const TAG = {
  make: 271,
  model: 272,
  orientation: 274,
  software: 305,
  exifIfdPointer: 34665,
  gpsIfdPointer: 34853,
  isoSpeedRatings: 34855,
  dateTimeOriginal: 36867,
  userComment: 37510,
  pixelXDimension: 40962,
  pixelYDimension: 40963,
  gpsLatitudeRef: 1,
  gpsLatitude: 2,
} as const;

const TYPE_ASCII = 2;
const TYPE_SHORT = 3;
const TYPE_LONG = 4;
const TYPE_RATIONAL = 5;

export interface ExifSpec {
  orientation?: number;
  make?: string;
  model?: string;
  software?: string;
  dateTimeOriginal?: string;
  isoSpeedRatings?: number;
  userComment?: string;
  gpsLatitudeRef?: string;
  gpsLatitude?: [number, number][];
  bigEndian?: boolean;
  /** Extra IFD0 tags as SHORT values, for example TIFF structural tags. */
  extraIfd0Shorts?: Record<number, number>;
}

interface Entry {
  tag: number;
  type: number;
  count: number;
  value: Uint8Array;
}

/** Builds an EXIF block containing whichever fields the spec supplies. */
export function exifBlockFrom(spec: ExifSpec = {}): Uint8Array {
  const bigEndian = spec.bigEndian ?? false;
  const little = !bigEndian;

  const ifd0: Entry[] = [];
  const exif: Entry[] = [];
  const gps: Entry[] = [];

  if (spec.make !== undefined) ifd0.push(asciiEntry(TAG.make, spec.make));
  if (spec.model !== undefined) ifd0.push(asciiEntry(TAG.model, spec.model));
  if (spec.orientation !== undefined) ifd0.push(shortEntry(TAG.orientation, spec.orientation, little));
  if (spec.software !== undefined) ifd0.push(asciiEntry(TAG.software, spec.software));

  for (const [tag, value] of Object.entries(spec.extraIfd0Shorts ?? {})) {
    ifd0.push(shortEntry(Number(tag), value, little));
  }

  if (spec.dateTimeOriginal !== undefined) exif.push(asciiEntry(TAG.dateTimeOriginal, spec.dateTimeOriginal));
  if (spec.isoSpeedRatings !== undefined) exif.push(shortEntry(TAG.isoSpeedRatings, spec.isoSpeedRatings, little));
  if (spec.userComment !== undefined) exif.push(asciiEntry(TAG.userComment, spec.userComment));

  if (spec.gpsLatitudeRef !== undefined) gps.push(asciiEntry(TAG.gpsLatitudeRef, spec.gpsLatitudeRef));
  if (spec.gpsLatitude !== undefined) gps.push(rationalEntry(TAG.gpsLatitude, spec.gpsLatitude, little));

  // Reserve pointer entries so sizes are known before offsets are assigned.
  if (exif.length > 0) ifd0.push(longEntry(TAG.exifIfdPointer, 0, little));
  if (gps.length > 0) ifd0.push(longEntry(TAG.gpsIfdPointer, 0, little));

  ifd0.sort((left, right) => left.tag - right.tag);
  exif.sort((left, right) => left.tag - right.tag);
  gps.sort((left, right) => left.tag - right.tag);

  const ifd0Offset = 8;
  const ifd0Size = ifdSize(ifd0);
  const exifOffset = ifd0Offset + ifd0Size;
  const exifSize = exif.length > 0 ? ifdSize(exif) : 0;
  const gpsOffset = exifOffset + exifSize;
  const gpsSize = gps.length > 0 ? ifdSize(gps) : 0;

  setLong(ifd0, TAG.exifIfdPointer, exifOffset, little);
  setLong(ifd0, TAG.gpsIfdPointer, gpsOffset, little);

  const total = ifd0Offset + ifd0Size + exifSize + gpsSize;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);

  out[0] = bigEndian ? 0x4d : 0x49;
  out[1] = out[0];
  view.setUint16(2, 42, little);
  view.setUint32(4, ifd0Offset, little);

  writeIfd(out, view, ifd0, ifd0Offset, little);
  if (exif.length > 0) writeIfd(out, view, exif, exifOffset, little);
  if (gps.length > 0) writeIfd(out, view, gps, gpsOffset, little);

  return out;
}

/** Size of an IFD, plus the value data stored outside its entries. */
function ifdSize(entries: Entry[]): number {
  let size = 2 + entries.length * 12 + 4;
  for (const entry of entries) {
    if (entry.value.length > 4) {
      size += entry.value.length + (entry.value.length % 2);
    }
  }
  return size;
}

function writeIfd(
  out: Uint8Array,
  view: DataView,
  entries: Entry[],
  offset: number,
  little: boolean
): void {
  view.setUint16(offset, entries.length, little);

  let entryOffset = offset + 2;
  let dataOffset = offset + 2 + entries.length * 12 + 4;

  for (const entry of entries) {
    view.setUint16(entryOffset, entry.tag, little);
    view.setUint16(entryOffset + 2, entry.type, little);
    view.setUint32(entryOffset + 4, entry.count, little);

    if (entry.value.length <= 4) {
      out.set(entry.value, entryOffset + 8);
    } else {
      view.setUint32(entryOffset + 8, dataOffset, little);
      out.set(entry.value, dataOffset);
      dataOffset += entry.value.length + (entry.value.length % 2);
    }

    entryOffset += 12;
  }

  view.setUint32(entryOffset, 0, little); // no next IFD
}

function setLong(entries: Entry[], tag: number, value: number, little: boolean): void {
  const entry = entries.find((candidate) => candidate.tag === tag);
  if (entry) {
    new DataView(entry.value.buffer).setUint32(0, value, little);
  }
}

function asciiEntry(tag: number, text: string): Entry {
  const bytes = new Uint8Array(text.length + 1); // NUL-terminated
  for (let i = 0; i < text.length; i++) {
    bytes[i] = text.charCodeAt(i) & 0xff;
  }
  return { tag, type: TYPE_ASCII, count: bytes.length, value: bytes };
}

function shortEntry(tag: number, value: number, little: boolean): Entry {
  const bytes = new Uint8Array(2);
  new DataView(bytes.buffer).setUint16(0, value, little);
  return { tag, type: TYPE_SHORT, count: 1, value: bytes };
}

function longEntry(tag: number, value: number, little: boolean): Entry {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, little);
  return { tag, type: TYPE_LONG, count: 1, value: bytes };
}

function rationalEntry(tag: number, values: [number, number][], little: boolean): Entry {
  const bytes = new Uint8Array(values.length * 8);
  const view = new DataView(bytes.buffer);
  values.forEach(([numerator, denominator], index) => {
    view.setUint32(index * 8, numerator, little);
    view.setUint32(index * 8 + 4, denominator, little);
  });
  return { tag, type: TYPE_RATIONAL, count: values.length, value: bytes };
}

// --- Entry value decoders, for assertions -----------------------------------

/** Decodes an ASCII entry value, dropping the NUL terminator. */
export function asciiValue(bytes: Uint8Array): string {
  return String.fromCharCode(...bytes).replace(/\0+$/, '');
}

/** Decodes a SHORT entry value. */
export function shortValue(bytes: Uint8Array, bigEndian = false): number {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(0, !bigEndian);
}

/** Decodes a LONG entry value. */
export function longValue(bytes: Uint8Array, bigEndian = false): number {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, !bigEndian);
}
