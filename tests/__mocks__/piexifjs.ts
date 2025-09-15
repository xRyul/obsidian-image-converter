/* eslint-disable @typescript-eslint/naming-convention */
/* eslint-disable prefer-destructuring */
import { vi } from 'vitest';

const piexif = {
  dump: vi.fn((exif) => 'mock-exif-data'),
  load: vi.fn((data) => ({
    '0th': { [274]: 1 }, // Orientation tag
    'Exif': {},
    'GPS': {},
    'Interop': {},
    '1st': {},
    'thumbnail': null
  })),
  insert: vi.fn((exifStr, dataUrl) => dataUrl),
  ImageIFD: { 
    Orientation: 274,
    Make: 271,
    Model: 272,
    Software: 305,
    Artist: 315,
    Copyright: 33432,
    DateTime: 306,
    XResolution: 282,
    YResolution: 283
  },
  ExifIFD: {
    ISOSpeedRatings: 34855,
    FNumber: 33437,
    ExposureTime: 33434,
    FocalLength: 37386
  },
  GPSIFD: {}
};

// Export both as default and named exports
export default piexif;
export const dump = piexif.dump;
export const load = piexif.load;
export const insert = piexif.insert;
export const ImageIFD = piexif.ImageIFD;
export const ExifIFD = piexif.ExifIFD;
export const GPSIFD = piexif.GPSIFD;