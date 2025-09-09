/**
 * Builder utilities for generating test data and settings.
 *
 * Provides fluent builders for image bytes (with correct magic bytes), plugin settings,
 * markdown notes, batches of files, Obsidian TFile objects, and conversion presets.
 * Designed for readability and determinism in unit and integration tests.
 */
import { DEFAULT_SETTINGS, type ImageConverterSettings, type OutputFormat, type ResizeMode, type ConversionPreset } from '../../src/ImageConverterSettings';
import { LinkFormatSettings } from '../../src/LinkFormatSettings';
import { NonDestructiveResizeSettings } from '../../src/NonDestructiveResizeSettings';
import type { TFile } from 'obsidian';

// Builder pattern for creating test image data
export class ImageDataBuilder {
  private width = 100;
  private height = 100;
  private format: 'png' | 'jpeg' | 'webp' | 'gif' = 'png';
  private size = 1024;
  
  withDimensions(width: number, height: number): this {
    if (width <= 0 || height <= 0) {
      throw new Error('Image dimensions must be positive');
    }
    this.width = width;
    this.height = height;
    return this;
  }
  
  withFormat(format: 'png' | 'jpeg' | 'jpg' | 'webp' | 'gif'): this {
    // Normalize jpg to jpeg for magic byte handling
    const normalized = (format === 'jpg' ? 'jpeg' : format) as 'png' | 'jpeg' | 'webp' | 'gif';
    this.format = normalized;
    return this;
  }
  
  withSize(bytes: number): this {
    if (bytes < 20) {
      throw new Error('Image size too small to contain header');
    }
    this.size = bytes;
    return this;
  }
  
  build(): Uint8Array {
    // Create a mock image with correct magic bytes
    const buffer = new Uint8Array(this.size);
    
    // Set magic bytes based on format
    switch (this.format) {
      case 'png':
        buffer[0] = 0x89;
        buffer[1] = 0x50;
        buffer[2] = 0x4e;
        buffer[3] = 0x47;
        buffer[4] = 0x0d;
        buffer[5] = 0x0a;
        buffer[6] = 0x1a;
        buffer[7] = 0x0a;
        break;
      case 'jpeg':
        buffer[0] = 0xff;
        buffer[1] = 0xd8;
        buffer[2] = 0xff;
        buffer[3] = 0xe0;
        break;
      case 'webp':
        buffer[0] = 0x52; // 'R'
        buffer[1] = 0x49; // 'I'
        buffer[2] = 0x46; // 'F'
        buffer[3] = 0x46; // 'F'
        buffer[8] = 0x57; // 'W'
        buffer[9] = 0x45; // 'E'
        buffer[10] = 0x42; // 'B'
        buffer[11] = 0x50; // 'P'
        break;
      case 'gif':
        buffer[0] = 0x47; // 'G'
        buffer[1] = 0x49; // 'I'
        buffer[2] = 0x46; // 'F'
        buffer[3] = 0x38; // '8'
        buffer[4] = 0x39; // '9'
        buffer[5] = 0x61; // 'a'
        break;
    }
    
    // Fill rest with deterministic data (repeatable across runs)
    for (let i = 20; i < this.size; i++) {
      buffer[i] = (i * 31) & 0xff;
    }
    
    return buffer;
  }
}

// Builder for processing settings
export class SettingsBuilder {
  // Start from real defaults to match project behavior and types
  private settings: ImageConverterSettings = {
    ...DEFAULT_SETTINGS,
    // Recreate class instances to preserve prototypes rather than cloning them to plain objects
    linkFormatSettings: new LinkFormatSettings(),
    nonDestructiveResizeSettings: new NonDestructiveResizeSettings(),
  };
  
  withOutputFormat(format: OutputFormat): this {
    this.settings.outputFormat = format;
    return this;
  }
  
  withQuality(quality: number): this {
    if (quality < 0 || quality > 100) {
      throw new Error('Quality must be between 0 and 100');
    }
    this.settings.quality = quality;
    return this;
  }
  
  withResizeMode(mode: ResizeMode): this {
    this.settings.resizeMode = mode;
    return this;
  }
  
  withDimensions(width: number, height: number): this {
    if (width <= 0 || height <= 0) {
      throw new Error('Desired dimensions must be positive');
    }
    this.settings.desiredWidth = width;
    this.settings.desiredHeight = height;
    return this;
  }
  
  withAllowLargerFiles(allow: boolean): this {
    this.settings.allowLargerFiles = allow;
    return this;
  }
  
  withShowPresetModal(folder: boolean, filename: boolean): this {
    this.settings.showPresetModal = { folder, filename };
    return this;
  }
  
  build(): ImageConverterSettings {
    // Return a shallow clone to avoid accidental mutation across tests
    return { ...this.settings };
  }
}

// Builder for markdown notes with images
export class NoteBuilder {
  private content = '';
  private images: Array<{ path: string; type: 'wiki' | 'markdown' | 'embedded' }> = [];
  
  withParagraph(text: string): this {
    this.content += `${text}\n\n`;
    return this;
  }
  
  withWikiImage(path: string, alias?: string): this {
    const link = alias ? `[[${path}|${alias}]]` : `[[${path}]]`;
    this.content += `${link}\n\n`;
    this.images.push({ path, type: 'wiki' });
    return this;
  }
  
  withMarkdownImage(path: string, alt = 'image'): this {
    this.content += `![${alt}](${path})\n\n`;
    this.images.push({ path, type: 'markdown' });
    return this;
  }
  
  withEmbeddedImage(path: string): this {
    this.content += `![[${path}]]\n\n`;
    this.images.push({ path, type: 'embedded' });
    return this;
  }
  
  withCodeBlock(code: string, language = ''): this {
    this.content += `\`\`\`${language}\n${code}\n\`\`\`\n\n`;
    return this;
  }
  
  build(): { content: string; images: typeof this.images } {
    return {
      content: this.content.trim(),
      images: this.images,
    };
  }
}

// Builder for batch processing test scenarios
export class BatchProcessBuilder {
  private files: Array<{ path: string; size: number; format: 'png' | 'jpeg' | 'webp' | 'gif' }> = [];
  private settings: ImageConverterSettings = new SettingsBuilder().build();
  
  withFiles(count: number, format: 'png' | 'jpeg' | 'jpg' | 'webp' | 'gif' = 'png'): this {
    const normalized = (format === 'jpg' ? 'jpeg' : format) as 'png' | 'jpeg' | 'webp' | 'gif';
    for (let i = 0; i < count; i++) {
      this.files.push({
        path: `images/test-${i}.${normalized}`,
        size: 100 + (i * 37),
        format: normalized,
      });
    }
    return this;
  }
  
  withMixedFormats(): this {
    const formats: Array<'png' | 'jpeg' | 'gif' | 'webp'> = ['png', 'jpeg', 'gif', 'webp'];
    for (let i = 0; i < 10; i++) {
      const format = formats[i % formats.length];
      this.files.push({
        path: `images/mixed-${i}.${format}`,
        size: 200 + (i * 43),
        format,
      });
    }
    return this;
  }
  
  withSettings(settings: Partial<ImageConverterSettings>): this {
    this.settings = { ...this.settings, ...settings } as ImageConverterSettings;
    return this;
  }
  
  build(): { files: typeof this.files; settings: ImageConverterSettings } {
    return {
      files: this.files,
      settings: this.settings,
    };
  }
}

// Builder for TFile objects (Obsidian API)
export class TFileBuilder {
  private path = 'test.md';
  private basename = 'test';
  private extension = 'md';
  private size = 1024;
  private mtime = 1700000000000;
  private ctime = 1700000000000;
  
  withPath(path: string): this {
    this.path = path;
    const parts = path.split('/');
    const filename = parts[parts.length - 1];
    const dotIndex = filename.lastIndexOf('.');
    if (dotIndex > 0) {
      this.basename = filename.substring(0, dotIndex);
      this.extension = filename.substring(dotIndex + 1);
    } else {
      this.basename = filename;
      this.extension = '';
    }
    return this;
  }
  
  withImageFormat(format: 'png' | 'jpeg' | 'jpg' | 'webp' | 'gif'): this {
    const ext = format === 'jpeg' ? 'jpg' : format;
    this.withPath(`images/test.${ext}`);
    return this;
  }
  
  withSize(size: number): this {
    if (size < 0) {
      throw new Error('File size cannot be negative');
    }
    this.size = size;
    return this;
  }
  
  withModificationTime(mtime: number): this {
    this.mtime = mtime;
    return this;
  }
  
  withCreationTime(ctime: number): this {
    this.ctime = ctime;
    return this;
  }
  
  build(): TFile {
    const parentPath = this.path.includes('/') ? this.path.substring(0, this.path.lastIndexOf('/')) : '';
    return {
      path: this.path,
      name: this.basename + (this.extension ? `.${this.extension}` : ''),
      basename: this.basename,
      extension: this.extension,
      stat: {
        size: this.size,
        mtime: this.mtime,
        ctime: this.ctime,
      },
      parent: {
        path: parentPath,
      } as any,
      vault: null as any, // Mock vault reference if needed
    } as unknown as TFile;
  }
}

// Builder for conversion presets
export class ConversionPresetBuilder {
  private preset: ConversionPreset = {
    name: 'Test Conversion Preset',
    outputFormat: 'WEBP',
    quality: 75,
    colorDepth: 1,
    resizeMode: 'None',
    desiredWidth: 800,
    desiredHeight: 600,
    desiredLongestEdge: 1000,
    enlargeOrReduce: 'Auto',
    allowLargerFiles: false,
    skipConversionPatterns: '',
    pngquantExecutablePath: '',
    pngquantQuality: '65-80',
    ffmpegExecutablePath: '',
    ffmpegCrf: 23,
    ffmpegPreset: 'medium',
  };
  
  withName(name: string): this {
    this.preset.name = name;
    return this;
  }
  
  withOutputFormat(format: OutputFormat): this {
    this.preset.outputFormat = format;
    return this;
  }
  
  withQuality(quality: number): this {
    if (quality < 0 || quality > 100) {
      throw new Error('Quality must be between 0 and 100');
    }
    this.preset.quality = quality;
    return this;
  }
  
  withResizeMode(mode: ResizeMode): this {
    this.preset.resizeMode = mode;
    return this;
  }
  
  withSkipPatterns(patterns: string): this {
    this.preset.skipConversionPatterns = patterns;
    return this;
  }
  
  build(): ConversionPreset {
    return { ...this.preset };
  }
}

// Export convenience functions
export const anImage = () => new ImageDataBuilder();
export const aCorruptedImage = () => new ImageDataBuilder().withSize(8); // Too small for proper headers
export const aVeryLargeImage = (sizeMB = 50) => new ImageDataBuilder().withSize(sizeMB * 1024 * 1024);
export const zeroByteImage = (): Uint8Array => new Uint8Array(0);
export const aZeroByteImage = () => zeroByteImage();

export const someSettings = () => new SettingsBuilder();
export const defaultSettings = () => new SettingsBuilder(); // Same as someSettings but more explicit
export const minimalSettings = () => new SettingsBuilder()
  .withOutputFormat('NONE')
  .withResizeMode('None')
  .withQuality(100);
export const maximalSettings = () => new SettingsBuilder()
  .withOutputFormat('WEBP')
  .withResizeMode('LongestEdge')
  .withQuality(75)
  .withDimensions(1920, 1080)
  .withAllowLargerFiles(false);
export const webp75NoResizeSettings = () => new SettingsBuilder()
  .withOutputFormat('WEBP')
  .withQuality(75)
  .withResizeMode('None');

export const aNote = () => new NoteBuilder();
export const anEmptyNote = () => new NoteBuilder();
export const aNoteWithManyImages = (count = 10) => {
  const note = new NoteBuilder().withParagraph('Test note with many images');
  for (let i = 0; i < count; i++) {
    note.withWikiImage(`images/test-${i}.png`, `Test Image ${i}`);
  }
  return note;
};

export const aBatchProcess = () => new BatchProcessBuilder();
export const aLargeBatchProcess = (fileCount = 100) => new BatchProcessBuilder().withFiles(fileCount, 'png');

export const aTFile = () => new TFileBuilder();
export const anImageFile = (format: 'png' | 'jpeg' | 'jpg' | 'webp' | 'gif' = 'png') => 
  new TFileBuilder().withImageFormat(format);
export const aLargeImageFile = (sizeMB = 10, format: 'png' | 'jpeg' | 'jpg' | 'webp' | 'gif' = 'png') => 
  new TFileBuilder().withImageFormat(format).withSize(sizeMB * 1024 * 1024);

export const aConversionPreset = () => new ConversionPresetBuilder();
export const aWebpPreset = () => new ConversionPresetBuilder()
  .withName('WebP 75%')
  .withOutputFormat('WEBP')
  .withQuality(75);
export const aPngquantPreset = () => new ConversionPresetBuilder()
  .withName('PngQuant Compression')
  .withOutputFormat('PNGQUANT')
  .withQuality(80);
