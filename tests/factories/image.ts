/**
 * Factory functions for creating test image data
 * Aligned with SDET testing rules and test checklist requirements
 */

/**
 * Create a minimal PNG buffer with specified dimensions and alpha channel
 * @param options - Configuration for the PNG
 * @returns ArrayBuffer containing PNG data
 */
export function makePngBytes(options: {
  w?: number;
  h?: number;
  alpha?: boolean;
} = {}): ArrayBuffer {
  const width = options.w ?? 100;
  const height = options.h ?? 100;
  const hasAlpha = options.alpha ?? false;
  
  // PNG signature
  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  
  // IHDR chunk (Image Header)
  const ihdrData = new ArrayBuffer(13);
  const ihdrView = new DataView(ihdrData);
  ihdrView.setUint32(0, width, false); // width
  ihdrView.setUint32(4, height, false); // height
  ihdrView.setUint8(8, 8); // bit depth
  ihdrView.setUint8(9, hasAlpha ? 6 : 2); // color type (2=RGB, 6=RGBA)
  ihdrView.setUint8(10, 0); // compression
  ihdrView.setUint8(11, 0); // filter
  ihdrView.setUint8(12, 0); // interlace
  
  const ihdrChunk = createPngChunk('IHDR', new Uint8Array(ihdrData));
  
  // IDAT chunk (minimal compressed image data)
  const idatData = new Uint8Array([0x78, 0x9c, 0x62, 0x00, 0x00, 0x00, 0x02, 0x00, 0x01]);
  const idatChunk = createPngChunk('IDAT', idatData);
  
  // IEND chunk
  const iendChunk = createPngChunk('IEND', new Uint8Array(0));
  
  // Combine all chunks
  const totalLength = signature.length + ihdrChunk.length + idatChunk.length + iendChunk.length;
  const buffer = new ArrayBuffer(totalLength);
  const view = new Uint8Array(buffer);
  
  let offset = 0;
  view.set(signature, offset);
  offset += signature.length;
  view.set(ihdrChunk, offset);
  offset += ihdrChunk.length;
  view.set(idatChunk, offset);
  offset += idatChunk.length;
  view.set(iendChunk, offset);
  
  return buffer;
}

/**
 * Create a minimal JPEG buffer with optional EXIF data
 * @param options - Configuration for the JPEG
 * @returns ArrayBuffer containing JPEG data
 */
export function makeJpegBytes(options: {
  w?: number;
  h?: number;
  exif?: Record<string, any>;
} = {}): ArrayBuffer {
  const width = options.w ?? 100;
  const height = options.h ?? 100;
  
  // Basic JPEG structure with SOI, APP0 (JFIF), and EOI markers
  const soi = new Uint8Array([0xFF, 0xD8]); // Start of Image
  
  // JFIF APP0 marker
  const app0 = new Uint8Array([
    0xFF, 0xE0, // APP0 marker
    0x00, 0x10, // Length (16 bytes)
    0x4A, 0x46, 0x49, 0x46, 0x00, // "JFIF\0"
    0x01, 0x01, // Version 1.1
    0x00, // Units (0 = no units)
    0x00, 0x01, // X density
    0x00, 0x01, // Y density
    0x00, 0x00  // Thumbnail dimensions
  ]);
  
  // SOF0 (Start of Frame) - defines dimensions
  const sof0Data = new ArrayBuffer(17);
  const sof0View = new DataView(sof0Data);
  sof0View.setUint8(0, 0xFF);
  sof0View.setUint8(1, 0xC0); // SOF0 marker
  sof0View.setUint16(2, 17, false); // Length
  sof0View.setUint8(4, 8); // Precision
  sof0View.setUint16(5, height, false); // Height
  sof0View.setUint16(7, width, false); // Width
  sof0View.setUint8(9, 3); // Components (RGB)
  // Component data (simplified)
  sof0View.setUint8(10, 1); // Component ID
  sof0View.setUint8(11, 0x11); // Sampling factors
  sof0View.setUint8(12, 0); // Quantization table
  sof0View.setUint8(13, 2);
  sof0View.setUint8(14, 0x11);
  sof0View.setUint8(15, 1);
  sof0View.setUint8(16, 3);
  
  const sof0 = new Uint8Array(sof0Data);
  
  // Minimal SOS (Start of Scan) and compressed data
  const sos = new Uint8Array([
    0xFF, 0xDA, // SOS marker
    0x00, 0x0C, // Length
    0x03, // Components
    0x01, 0x00, // Component 1
    0x02, 0x11, // Component 2
    0x03, 0x11, // Component 3
    0x00, 0x3F, 0x00 // Start/end spectral selection
  ]);
  
  // Minimal compressed data
  const compressedData = new Uint8Array([0x00, 0x01, 0x02, 0x03]);
  
  const eoi = new Uint8Array([0xFF, 0xD9]); // End of Image
  
  // Calculate total size
  let totalSize = soi.length + app0.length + sof0.length + sos.length + compressedData.length + eoi.length;
  
  // Add EXIF if provided (simplified - in real implementation would use piexif)
  let exifData: Uint8Array | null = null;
  if (options.exif && Object.keys(options.exif).length > 0) {
    // Simplified EXIF APP1 marker
    const exifHeader = new Uint8Array([
      0xFF, 0xE1, // APP1 marker
      0x00, 0x1E, // Length (30 bytes for minimal EXIF)
      0x45, 0x78, 0x69, 0x66, 0x00, 0x00, // "Exif\0\0"
      // Minimal TIFF header
      0x4D, 0x4D, // Big-endian
      0x00, 0x2A, // TIFF magic number
      0x00, 0x00, 0x00, 0x08, // IFD offset
      // Minimal IFD
      0x00, 0x01, // 1 entry
      0x01, 0x0F, // Make tag
      0x00, 0x02, // ASCII type
      0x00, 0x00, 0x00, 0x04, // Count
      0x00, 0x00, 0x00, 0x00  // Value/offset
    ]);
    exifData = exifHeader;
    totalSize += exifData.length;
  }
  
  // Combine all parts
  const buffer = new ArrayBuffer(totalSize);
  const view = new Uint8Array(buffer);
  
  let offset = 0;
  view.set(soi, offset);
  offset += soi.length;
  view.set(app0, offset);
  offset += app0.length;
  
  if (exifData) {
    view.set(exifData, offset);
    offset += exifData.length;
  }
  
  view.set(sof0, offset);
  offset += sof0.length;
  view.set(sos, offset);
  offset += sos.length;
  view.set(compressedData, offset);
  offset += compressedData.length;
  view.set(eoi, offset);
  
  return buffer;
}

/**
 * Create a minimal WEBP buffer with optional alpha channel
 * @param options - Configuration for the WEBP
 * @returns ArrayBuffer containing WEBP data
 */
export function makeWebpBytes(options: {
  w?: number;
  h?: number;
  alpha?: boolean;
} = {}): ArrayBuffer {
  const width = options.w ?? 100;
  const height = options.h ?? 100;
  const hasAlpha = options.alpha ?? false;
  
  // RIFF header
  const riffHeader = new Uint8Array([
    0x52, 0x49, 0x46, 0x46, // "RIFF"
    0x00, 0x00, 0x00, 0x00, // File size (will be updated)
    0x57, 0x45, 0x42, 0x50  // "WEBP"
  ]);
  
  // VP8 or VP8L chunk (simplified)
  const fourcc = hasAlpha ? [0x56, 0x50, 0x38, 0x4C] : [0x56, 0x50, 0x38, 0x20]; // "VP8L" or "VP8 "
  
  // Minimal VP8 bitstream data
  const vp8Data = new ArrayBuffer(30);
  const vp8View = new DataView(vp8Data);
  
  if (hasAlpha) {
    // VP8L format (with alpha)
    vp8View.setUint8(0, 0x2F); // VP8L signature
    // Simplified VP8L data
    vp8View.setUint32(1, width - 1, true);
    vp8View.setUint32(5, height - 1, true);
  } else {
    // VP8 format (no alpha)
    // Frame tag
    vp8View.setUint8(0, 0x9D);
    vp8View.setUint8(1, 0x01);
    vp8View.setUint8(2, 0x2A);
    // Dimensions
    vp8View.setUint16(3, width, true);
    vp8View.setUint16(5, height, true);
  }
  
  const chunkSize = vp8Data.byteLength;
  const chunkHeader = new ArrayBuffer(8);
  const chunkView = new DataView(chunkHeader);
  chunkView.setUint8(0, fourcc[0]);
  chunkView.setUint8(1, fourcc[1]);
  chunkView.setUint8(2, fourcc[2]);
  chunkView.setUint8(3, fourcc[3]);
  chunkView.setUint32(4, chunkSize, true);
  
  // Calculate total size
  const totalSize = riffHeader.length + chunkHeader.byteLength + vp8Data.byteLength;
  const buffer = new ArrayBuffer(totalSize);
  const view = new Uint8Array(buffer);
  const dataView = new DataView(buffer);
  
  // Set RIFF size
  dataView.setUint32(4, totalSize - 8, true);
  
  // Copy data
  view.set(riffHeader, 0);
  view.set(new Uint8Array(chunkHeader), riffHeader.length);
  view.set(new Uint8Array(vp8Data), riffHeader.length + chunkHeader.byteLength);
  
  return buffer;
}

/**
 * Create corrupted/invalid image bytes for error testing
 * @param size - Size of the corrupted data
 * @returns ArrayBuffer containing random/corrupted data
 */
export function corruptedBytes(size: number = 100): ArrayBuffer {
  const buffer = new ArrayBuffer(size);
  const view = new Uint8Array(buffer);
  
  // Fill with random data that doesn't match any image signature
  for (let i = 0; i < size; i++) {
    view[i] = Math.floor(Math.random() * 256);
  }
  
  // Ensure it doesn't accidentally match a valid signature
  if (size > 8) {
    view[0] = 0x00;
    view[1] = 0x00;
  }
  
  return buffer;
}

/**
 * Helper function to create a PNG chunk
 */
function createPngChunk(type: string, data: Uint8Array): Uint8Array {
  const length = data.length;
  const chunk = new Uint8Array(length + 12); // 4 (length) + 4 (type) + data + 4 (CRC)
  const view = new DataView(chunk.buffer);
  
  // Length
  view.setUint32(0, length, false);
  
  // Type
  for (let i = 0; i < 4; i++) {
    chunk[4 + i] = type.charCodeAt(i);
  }
  
  // Data
  chunk.set(data, 8);
  
  // CRC (simplified - not a real CRC32)
  view.setUint32(8 + length, 0x00000000, false);
  
  return chunk;
}

/**
 * Create a Blob from ArrayBuffer with specified MIME type
 */
export function makeImageBlob(bytes: ArrayBuffer, mimeType: string): Blob {
  return new Blob([bytes], { type: mimeType });
}

/**
 * Create a File from ArrayBuffer with specified name and MIME type
 */
export function makeImageFile(bytes: ArrayBuffer, filename: string, mimeType: string): File {
  return new File([bytes], filename, { type: mimeType });
}