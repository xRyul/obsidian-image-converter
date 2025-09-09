/**
 * Factories for creating realistic, deterministic mocks used in tests.
 *
 * Includes helpers to create TFile/TFolder, Vault/App, MarkdownView, and full image
 * processing scenarios with seeded data. These keep tests clear (Arrange-Act-Assert)
 * while avoiding shared mutable state.
 */
import { faker } from '@faker-js/faker';
import { TFile, TFolder, Vault, App, MarkdownView } from 'obsidian';
import { vi } from 'vitest';

/**
 * Factory for creating properly mocked TFile instances
 * Uses the actual Obsidian mock classes for consistency
 */
export function createMockTFile(overrides: Partial<{
  path: string;
  name: string;
  extension: string;
  basename: string;
  parent: TFolder | null;
  stat: { ctime: number; mtime: number; size: number };
}> = {}): TFile {
  const file = new TFile();

  // Deterministic defaults to keep tests stable
  // Resolve extension/basename/name/path in a consistent order
  const { extension: extensionOverride, basename: basenameOverride, name: nameOverride } = overrides;
  let extension = extensionOverride;
  let basename = basenameOverride;
  let name = nameOverride;

  if (!name) {
    // Create defaults if name is not provided
    extension = extension ?? faker.helpers.arrayElement(['png', 'jpg', 'jpeg', 'webp', 'gif']);
    basename = basename ?? `image-${faker.string.alphanumeric(6)}`;
    name = `${basename}.${extension}`;
  } else {
    // Derive basename/extension from provided name when not explicitly overridden
    const lastDot = name.lastIndexOf('.');
    const derivedExt = lastDot >= 0 ? name.slice(lastDot + 1) : '';
    const derivedBase = lastDot >= 0 ? name.slice(0, lastDot) : name;
    extension = extension ?? derivedExt;
    basename = basename ?? derivedBase;
  }

  const path = overrides.path ?? `images/${name}`;

  file.path = path;
  file.name = name;
  file.extension = extension ?? '';
  file.basename = basename ?? name;
  file.parent = overrides.parent ?? null;
  file.stat = overrides.stat ?? {
    ctime: Date.now() - 86_400_000, // 1 day ago
    mtime: Date.now() - 3_600_000,  // 1 hour ago
    size: 128_000,                  // 125KB deterministic default
  };

  return file;
}

/**
 * Factory for creating image-specific TFile instances
 * Specialized for your image converter plugin
 */
export function createMockImageFile(format: 'png' | 'jpg' | 'jpeg' | 'webp' | 'gif' | 'heic' | 'tif' = 'png', overrides: Partial<{
  path: string;
  name: string;
  basename: string;
  sizeBytes: number;
}> = {}): TFile {
  const basename = overrides.basename ?? `image-${faker.string.alphanumeric(6)}`;
  const name = overrides.name ?? `${basename}.${format}`;
  const path = overrides.path ?? `attachments/${name}`;
  
  return createMockTFile({
    path,
    name,
    extension: format,
    basename,
    stat: {
      ctime: Date.now() - 86400000, // 1 day ago
      mtime: Date.now() - 3600000,  // 1 hour ago
      size: overrides.sizeBytes ?? 200_000, // deterministic default: 200KB
    },
  });
}

/**
 * Factory for creating markdown note TFile instances
 */
export function createMockMarkdownFile(overrides: Partial<{
  path: string;
  basename: string;
  content?: string;
}> = {}): TFile {
  const basename = overrides.basename ?? faker.lorem.words(2).replace(/\s+/g, '-');
  const name = `${basename}.md`;
  const path = overrides.path ?? `notes/${name}`;
  
  return createMockTFile({
    path,
    name,
    extension: 'md',
    basename,
    stat: {
      ctime: Date.now() - 86400000,
      mtime: Date.now() - 1800000, // 30 minutes ago
      size: overrides.content?.length ?? 2048,
    },
  });
}

/**
 * Factory for creating properly configured Vault mocks
 * Enhances the existing Obsidian mock with test-specific behaviors
 */
export function createMockVault(config: {
  files?: TFile[];
  folders?: TFolder[];
  fileContents?: Map<string, string>;
  binaryContents?: Map<string, ArrayBuffer>;
} = {}): Vault {
  const vault = new Vault();
  
  // Configure file system mock
  const allFiles = config.files ?? [];
  const allFolders = config.folders ?? [];
  const { fileContents, binaryContents } = config;
  
  // Mock file retrieval with spies
  vault.getFiles = vi.fn(() => allFiles);
  vault.getMarkdownFiles = vi.fn(() => allFiles.filter(file => file.extension === 'md'));
  vault.getAllLoadedFiles = vi.fn(() => [...allFiles, ...allFolders]);
  
  // Mock file lookup
  vault.getAbstractFileByPath = vi.fn((path: string) => {
    const fileCandidate = allFiles.find(file => file.path === path);
    if (fileCandidate) return fileCandidate;
    const folderCandidate = allFolders.find(folder => folder.path === path);
    return folderCandidate ?? null;
  });
  
  // Mock file reading
  if (fileContents) {
    vault.read = vi.fn((file: TFile) => Promise.resolve(fileContents.get(file.path) ?? ''));
  }
  
  if (binaryContents) {
    vault.readBinary = vi.fn((file: TFile) => Promise.resolve(binaryContents.get(file.path) ?? new ArrayBuffer(0)));
  }
  
  // Mock adapter methods for your plugin's file operations
  vault.adapter.exists = vi.fn((path: string) =>
    Promise.resolve(allFiles.some(file => file.path === path) || allFolders.some(folder => folder.path === path))
  );
  
  // Return Stat | null with required 'type' property to satisfy Obsidian types
  vault.adapter.stat = vi.fn(async (path: string) => {
    const fileItem = allFiles.find(file => file.path === path);
    if (fileItem) {
      return {
        ctime: fileItem.stat.ctime,
        mtime: fileItem.stat.mtime,
        size: fileItem.stat.size,
        type: 'file' as const,
      };
    }
    const folderItem = allFolders.find(folder => folder.path === path);
    if (folderItem) {
      return {
        ctime: Date.now(),
        mtime: Date.now(),
        size: 0,
        type: 'folder' as const,
      };
    }
    return null;
  });
  
  return vault;
}

/**
 * Factory for creating a complete App mock with realistic file system
 * Perfect for integration testing
 */
export function createMockApp(config: {
  activeFile?: TFile | null;
  files?: TFile[];
  folders?: TFolder[];
  fileContents?: Map<string, string>;
  binaryContents?: Map<string, ArrayBuffer>;
} = {}): App {
  const app = new App();
  
  // Configure vault
  app.vault = createMockVault({
    files: config.files,
    folders: config.folders,
    fileContents: config.fileContents,
    binaryContents: config.binaryContents,
  });
  
  // Configure workspace
  if (config.activeFile !== undefined) {
    app.workspace.getActiveFile = vi.fn(() => config.activeFile ?? null);
  }
  
  return app;
}

/**
 * Factory for creating MarkdownView mocks
 */
export function createMockMarkdownView(file?: TFile): MarkdownView {
  // Satisfy real Obsidian type signature while still using our mock implementation
  const view = new (MarkdownView as unknown as new (...args: any[]) => MarkdownView)({} as any);
  if (file) {
    (view as any).file = file;
  }
  return view;
}

/**
 * Utility function to create a complete test scenario for image processing
 */
export function createImageProcessingScenario(config: {
  imageCount?: number;
  formats?: ('png' | 'jpg' | 'jpeg' | 'webp' | 'gif')[];
  activeNote?: string;
  activeNoteContent?: string;
  includeImageData?: boolean;
} = {}) {
  const formats = config.formats ?? ['png', 'jpg', 'webp'];
  const imageCount = config.imageCount ?? 5;
  const activeNote = config.activeNote ?? 'My Note';
  
  // Create image files
  const imageFiles: TFile[] = [];
  const binaryContents = new Map<string, ArrayBuffer>();
  
  for (let i = 0; i < imageCount; i++) {
    const format = formats[i % formats.length];
    const file = createMockImageFile(format, {
      basename: `test-image-${i}`,
    });
    imageFiles.push(file);
    
    if (config.includeImageData) {
      // Create realistic image data with proper magic bytes
      const buffer = new ArrayBuffer(file.stat.size);
      const view = new Uint8Array(buffer);
      
      // Add format-specific magic bytes (simplified)
      switch (format) {
        case 'png':
          view[0] = 0x89; view[1] = 0x50; view[2] = 0x4E; view[3] = 0x47;
          break;
        case 'jpg':
        case 'jpeg':
          view[0] = 0xFF; view[1] = 0xD8; view[2] = 0xFF;
          break;
        case 'webp':
          view[0] = 0x52; view[1] = 0x49; view[2] = 0x46; view[3] = 0x46;
          break;
      }
      
      binaryContents.set(file.path, buffer);
    }
  }
  
  // Create active note
  const activeFile = createMockMarkdownFile({ basename: activeNote });
  const allFiles = [...imageFiles, activeFile];

  // Optionally seed file contents for active note
  const fileContents = new Map<string, string>();
  if (config.activeNoteContent != null) {
    fileContents.set(activeFile.path, config.activeNoteContent);
  }
  
  // Create app with complete setup
  const app = createMockApp({
    activeFile,
    files: allFiles,
    binaryContents: config.includeImageData ? binaryContents : undefined,
    fileContents: fileContents.size ? fileContents : undefined,
  });
  
  return {
    app,
    activeFile,
    imageFiles,
    binaryContents,
    allFiles,
    fileContents,
  };
}

