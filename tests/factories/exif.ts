/**
 * Factory functions for EXIF metadata manipulation
 * Used for testing JPEG metadata handling
 */

// Minimal EXIF factory avoiding dependency on piexif internals
// Tag constants used below
const TAGS = {
  Orientation: 274,
  Make: 271,
  Model: 272,
  DateTime: 306,
  XResolution: 282,
  YResolution: 283,
  Software: 305,
  Artist: 315,
  Copyright: 33432,
};

export type ExifDictLike = {
  '0th': Record<number, any>;
  'Exif': Record<number, any>;
  'GPS': Record<number, any>;
  'Interop': Record<number, any>;
  '1st': Record<number, any>;
  'thumbnail': null | Uint8Array;
};

/**
 * Create EXIF-like metadata object with specified properties
 */
export function exifFrom(properties: {
  Orientation?: number;
  Make?: string;
  Model?: string;
  DateTime?: string;
  XResolution?: [number, number];
  YResolution?: [number, number];
  Software?: string;
  Artist?: string;
  Copyright?: string;
  [key: string]: any;
}): ExifDictLike {
  const exif: ExifDictLike = {
    '0th': {},
    'Exif': {},
    'GPS': {},
    'Interop': {},
    '1st': {},
    'thumbnail': null
  };

  if (properties.Orientation !== undefined) {
    exif['0th'][TAGS.Orientation] = properties.Orientation;
  }
  if (properties.Make !== undefined) {
    exif['0th'][TAGS.Make] = properties.Make;
  }
  if (properties.Model !== undefined) {
    exif['0th'][TAGS.Model] = properties.Model;
  }
  if (properties.DateTime !== undefined) {
    exif['0th'][TAGS.DateTime] = properties.DateTime;
  }
  if (properties.XResolution !== undefined) {
    exif['0th'][TAGS.XResolution] = properties.XResolution;
  }
  if (properties.YResolution !== undefined) {
    exif['0th'][TAGS.YResolution] = properties.YResolution;
  }
  if (properties.Software !== undefined) {
    exif['0th'][TAGS.Software] = properties.Software;
  }
  if (properties.Artist !== undefined) {
    exif['0th'][TAGS.Artist] = properties.Artist;
  }
  if (properties.Copyright !== undefined) {
    exif['0th'][TAGS.Copyright] = properties.Copyright;
  }

  // Add any numeric custom keys directly to 0th IFD
  for (const [key, value] of Object.entries(properties)) {
    if (!(
      key === 'Orientation' || key === 'Make' || key === 'Model' ||
      key === 'DateTime' || key === 'XResolution' || key === 'YResolution' ||
      key === 'Software' || key === 'Artist' || key === 'Copyright'
    )) {
      const num = Number(key);
      if (!Number.isNaN(num)) {
        exif['0th'][num] = value;
      }
    }
  }

  return exif;
}

export function stripOrientation(exif: ExifDictLike): ExifDictLike {
  const cloned: ExifDictLike = {
    '0th': { ...exif['0th'] },
    'Exif': { ...exif['Exif'] },
    'GPS': { ...exif['GPS'] },
    'Interop': { ...exif['Interop'] },
    '1st': { ...exif['1st'] },
    'thumbnail': exif['thumbnail']
  };
  delete cloned['0th'][TAGS.Orientation];
  return cloned;
}

export function exifToBinary(_: ExifDictLike): ArrayBuffer {
  // Not used in depth; return a small buffer placeholder
  return new ArrayBuffer(10);
}
