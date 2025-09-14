/**
 * Factory functions for creating mock Obsidian API objects
 * Provides test doubles for Obsidian-specific functionality
 */

import { vi } from 'vitest';
import { Notice, TFile, TFolder, Vault, App, MetadataCache, Workspace } from 'obsidian';

/**
 * Create a mock Notice object
 * @param message - Optional message to capture
 * @returns Mock Notice with spy
 */
export function fakeNotice(): typeof Notice {
  const NoticeMock = vi.fn().mockImplementation((message: string, timeout?: number) => {
    return {
      message,
      timeout,
      noticeEl: document.createElement('div'),
      hide: vi.fn()
    };
  });
  
  return NoticeMock as any;
}

/**
 * Create a mock TFile object
 * @param options - Configuration for the file
 * @returns Mock TFile
 */
export function fakeTFile(options: {
  path?: string;
  name?: string;
  basename?: string;
  extension?: string;
  parent?: TFolder | null;
  stat?: { mtime: number; ctime: number; size: number };
} = {}): TFile {
  const fullPath = options.path ?? 'test-folder/test-file.md';
  const name = options.name ?? fullPath.split('/').pop() ?? 'test-file.md';
  const basename = options.basename ?? name.replace(/\.[^.]+$/, '');
  const extension = options.extension ?? (name.includes('.') ? name.split('.').pop()! : 'md');

  const instance = new (TFile as any)() as TFile;
  (instance as any).path = fullPath;
  (instance as any).name = name;
  (instance as any).basename = basename;
  (instance as any).extension = extension;
  (instance as any).parent = options.parent ?? fakeTFolder({ path: fullPath.includes('/') ? fullPath.substring(0, fullPath.lastIndexOf('/')) : '' });
  (instance as any).vault = undefined as any;
  (instance as any).stat = options.stat ?? {
    mtime: Date.now(),
    ctime: Date.now(),
    size: 1024
  };
  return instance;
}

/**
 * Create a mock TFolder object
 * @param options - Configuration for the folder
 * @returns Mock TFolder
 */
export function fakeTFolder(options: {
  path?: string;
  name?: string;
  parent?: TFolder | null;
  children?: (TFile | TFolder)[];
} = {}): TFolder {
  const path = options.path ?? 'test-folder';
  const name = options.name ?? path.split('/').pop() ?? 'test-folder';
  
  return {
    path,
    name,
    parent: options.parent ?? null,
    children: options.children ?? [],
    vault: undefined as any,
    isRoot: () => path === '/'
  } as TFolder;
}

/**
 * Create a mock Vault object with common methods
 * @param options - Configuration for vault behavior
 * @returns Mock Vault
 */
export function fakeVault(options: {
  files?: TFile[];
  folders?: TFolder[];
  fileContents?: Map<string, string>;
  binaryContents?: Map<string, ArrayBuffer>;
  vaultName?: string;
  attachmentFolderPath?: string; // for getConfig('attachmentFolderPath')
} = {}): Partial<Vault> {
  const files = options.files ?? [];
  const folders = options.folders ?? [];
  const fileContents = options.fileContents ?? new Map();
  const binaryContents = options.binaryContents ?? new Map();
  const vaultName = options.vaultName ?? 'TestVault';
  const attachmentFolderPath = options.attachmentFolderPath ?? 'attachments';
  const rootFolder = fakeTFolder({ path: '/', name: '/' });
  
  return {
    // File operations
    getAbstractFileByPath: vi.fn((path: string) => {
      if (path === '/' || path === '') return rootFolder;
      return files.find(f => f.path === path) || folders.find(f => f.path === path) || null;
    }),
    
    read: vi.fn(async (file: TFile) => {
      return fileContents.get(file.path) ?? '';
    }),
    
    readBinary: vi.fn(async (file: TFile) => {
      return binaryContents.get(file.path) ?? new ArrayBuffer(0);
    }),
    
    modify: vi.fn(async (file: TFile, content: string) => {
      fileContents.set(file.path, content);
    }),
    
    modifyBinary: vi.fn(async (file: TFile, content: ArrayBuffer) => {
      binaryContents.set(file.path, content);
    }),
    
    create: vi.fn(async (path: string, content: string) => {
      const file = fakeTFile({ path });
      files.push(file);
      fileContents.set(path, content);
      return file;
    }),
    
    createBinary: vi.fn(async (path: string, content: ArrayBuffer) => {
      const file = fakeTFile({ path });
      files.push(file);
      binaryContents.set(path, content);
      return file;
    }),
    
    createFolder: vi.fn(async (path: string) => {
      if (!folders.find(f => f.path === path)) {
        const folder = fakeTFolder({ path });
        folders.push(folder);
        return folder;
      }
      return folders.find(f => f.path === path) as TFolder;
    }),
    
    rename: vi.fn(async (file: TFile, newPath: string) => {
      const content = fileContents.get(file.path) || binaryContents.get(file.path);
      fileContents.delete(file.path);
      binaryContents.delete(file.path);
      
      file.path = newPath;
      file.name = newPath.split('/').pop() ?? '';
      file.basename = file.name.replace(/\.[^.]+$/, '');
      
      if (content instanceof ArrayBuffer) {
        binaryContents.set(newPath, content);
      } else if (content) {
        fileContents.set(newPath, content as string);
      }
    }),
    
    delete: vi.fn(async (file: TFile | TFolder, force?: boolean) => {
      if (file instanceof TFile) {
        const index = files.indexOf(file);
        if (index > -1) files.splice(index, 1);
        fileContents.delete(file.path);
        binaryContents.delete(file.path);
      } else {
        const index = folders.indexOf(file);
        if (index > -1) folders.splice(index, 1);
      }
    }),
    
    // Adapter operations
    adapter: {
      exists: vi.fn(async (path: string) => {
        if (path === '/' || path === '') return true;
        return files.some(f => f.path === path) || folders.some(f => f.path === path);
      }),
      
      stat: vi.fn(async (path: string) => {
        const file = files.find(f => f.path === path);
        if (file) {
          return file.stat ?? { mtime: Date.now(), ctime: Date.now(), size: 1024 };
        }
        return null;
      }),
      
      list: vi.fn(async (path: string) => {
        const folder = path === '/' ? rootFolder : folders.find(f => f.path === path);
        if (!folder) return { files: [], folders: [] };
        
        const folderFiles = files.filter(f => f.parent?.path === path);
        const subFolders = folders.filter(f => f.parent?.path === path);
        
        return {
          files: folderFiles.map(f => f.name),
          folders: subFolders.map(f => f.name)
        };
      }),
      
      read: vi.fn(async (path: string) => {
        return fileContents.get(path) ?? '';
      }),
      
      readBinary: vi.fn(async (path: string) => {
        return binaryContents.get(path) ?? new ArrayBuffer(0);
      }),
      
      write: vi.fn(async (path: string, content: string) => {
        fileContents.set(path, content);
      }),
      
      writeBinary: vi.fn(async (path: string, content: ArrayBuffer) => {
        binaryContents.set(path, content);
      }),
      
      mkdir: vi.fn(async (path: string) => {
        if (!folders.find(f => f.path === path)) {
          folders.push(fakeTFolder({ path }));
        }
      }),
      
      rmdir: vi.fn(async (path: string, recursive?: boolean) => {
        const index = folders.findIndex(f => f.path === path);
        if (index > -1) folders.splice(index, 1);
      }),
      
      remove: vi.fn(async (path: string) => {
        const fileIndex = files.findIndex(f => f.path === path);
        if (fileIndex > -1) {
          files.splice(fileIndex, 1);
          fileContents.delete(path);
          binaryContents.delete(path);
        }
        const folderIndex = folders.findIndex(f => f.path === path);
        if (folderIndex > -1) {
          folders.splice(folderIndex, 1);
        }
      })
    },
    
    // Additional helpers used by code under test
    getRoot: vi.fn(() => rootFolder as TFolder),
    getName: vi.fn(() => vaultName),
    getFiles: vi.fn(() => files),
    getAllLoadedFiles: vi.fn(() => [...files, ...folders, rootFolder]),
    getMarkdownFiles: vi.fn(() => files.filter(f => f.extension === 'md')),
    // Obsidian config API used by FolderAndFilenameManagement
    getConfig: vi.fn((key: string) => {
      if (key === 'attachmentFolderPath') return attachmentFolderPath;
      return '';
    }),
    
    // Config
    configDir: '/.obsidian',
    
    // Events (simplified)
    on: vi.fn(),
    off: vi.fn(),
    trigger: vi.fn(),
    tryTrigger: vi.fn()
  } as Partial<Vault>;
}

/**
 * Create a mock MetadataCache
 * @param options - Configuration for cache behavior
 * @returns Mock MetadataCache
 */
export function fakeMetadataCache(options: {
  resolvedLinks?: Map<string, Record<string, number>>;
  fileCache?: Map<string, any>;
} = {}): Partial<MetadataCache> {
  const resolvedLinks = options.resolvedLinks ?? new Map();
  const fileCache = options.fileCache ?? new Map();
  
  return {
    getFileCache: vi.fn((file: TFile) => {
      return fileCache.get(file.path);
    }),
    
    getCache: vi.fn((path: string) => {
      return fileCache.get(path);
    }),
    
    resolvedLinks: Object.fromEntries(resolvedLinks),
    
    getFirstLinkpathDest: vi.fn((linkpath: string, sourcePath: string) => {
      // Simplified link resolution
      return null;
    }),
    
    on: vi.fn(),
    off: vi.fn(),
    trigger: vi.fn(),
    tryTrigger: vi.fn()
  } as Partial<MetadataCache>;
}

/**
 * Create a mock Workspace
 * @param options - Configuration for workspace behavior
 * @returns Mock Workspace
 */
export function fakeWorkspace(options: {
  activeFile?: TFile | null;
  activeLeaf?: any;
} = {}): Partial<Workspace> {
  return {
    getActiveFile: vi.fn(() => options.activeFile ?? null),
    
    getLeaf: vi.fn((newLeaf?: boolean | 'tab' | 'split' | 'window') => {
      return options.activeLeaf ?? {
        view: {
          file: options.activeFile
        },
        openFile: vi.fn()
      };
    }),
    
    on: vi.fn(),
    off: vi.fn(),
    trigger: vi.fn(),
    tryTrigger: vi.fn()
  } as Partial<Workspace>;
}

/**
 * Create a mock App object
 * @param options - Configuration for app behavior
 * @returns Mock App
 */
export function fakeApp(options: {
  vault?: Partial<Vault>;
  metadataCache?: Partial<MetadataCache>;
  workspace?: Partial<Workspace>;
  fileManager?: any;
} = {}): Partial<App> {
  return {
    vault: (options.vault ?? fakeVault()) as Vault,
    metadataCache: (options.metadataCache ?? fakeMetadataCache()) as MetadataCache,
    workspace: (options.workspace ?? fakeWorkspace()) as Workspace,
    fileManager: options.fileManager ?? {
      getNewFileParent: vi.fn((sourcePath?: string) => {
        return fakeTFolder({ path: 'attachments' });
      }),
      generateMarkdownLink: vi.fn((file: TFile, sourcePath: string) => {
        return `[[${file.basename}]]`;
      })
    },
    
    // Utility
    loadLocalStorage: vi.fn((key: string) => null),
    saveLocalStorage: vi.fn(),
    
    on: vi.fn(),
    off: vi.fn(),
    trigger: vi.fn(),
    tryTrigger: vi.fn()
  } as Partial<App>;
}