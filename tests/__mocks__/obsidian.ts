/**
 * Comprehensive mocks for the Obsidian API used in tests.
 *
 * Provides lightweight test doubles for core Obsidian classes (App, Vault, Workspace,
 * TFile/TFolder, views, settings, etc.) with sensible defaults and Vitest spies. These
 * enable behavior-focused unit/integration tests without the real Obsidian runtime.
 *
 * Notes:
 * - Mirrors naming used by the real API (PascalCase/UPPER_CASE) for fidelity.
 * - Avoids shared state across tests; reset/mutate via test setup as needed.
 */
/* eslint-disable @typescript-eslint/naming-convention */
// This mock mimics the upstream Obsidian API surface, which uses PascalCase and UPPER_CASE
// identifiers in several places (e.g., Platform, ViewState, TYPE_MARKDOWN). We disable the
// naming-convention rule here to preserve API fidelity for tests.
import { vi } from 'vitest';

// Mock Obsidian API classes and interfaces

export class App {
  vault = new Vault();
  workspace = new Workspace();
  metadataCache = new MetadataCache();
  fileManager = new FileManager();
}

export class Vault {
  adapter = {
    path: {
      join: (...parts: string[]) => parts.join('/'),
      dirname: (path: string) => path.split('/').slice(0, -1).join('/'),
      basename: (path: string, ext?: string) => {
        const base = path.split('/').pop() || '';
        return ext ? base.replace(new RegExp(`\\.${ext}$`), '') : base;
      },
      extname: (path: string) => {
        const parts = path.split('.');
        return parts.length > 1 ? `.${parts.pop()}` : '';
      },
    },
    exists: vi.fn().mockResolvedValue(false),
    stat: vi.fn().mockResolvedValue({ ctime: Date.now(), mtime: Date.now(), size: 1024 }),
    list: vi.fn().mockResolvedValue({ files: [], folders: [] }),
    read: vi.fn().mockResolvedValue(''),
    readBinary: vi.fn().mockResolvedValue(new ArrayBuffer(0)),
    write: vi.fn().mockResolvedValue(undefined),
    writeBinary: vi.fn().mockResolvedValue(undefined),
    mkdir: vi.fn().mockResolvedValue(undefined),
    rmdir: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
    rename: vi.fn().mockResolvedValue(undefined),
    copy: vi.fn().mockResolvedValue(undefined),
  };
  
  getFiles = vi.fn().mockReturnValue([]);
  getAbstractFileByPath = vi.fn().mockReturnValue(null);
  getMarkdownFiles = vi.fn().mockReturnValue([]);
  getAllLoadedFiles = vi.fn().mockReturnValue([]);
  create = vi.fn().mockResolvedValue(new TFile());
  createBinary = vi.fn().mockResolvedValue(new TFile());
  createFolder = vi.fn().mockResolvedValue(new TFolder());
  read = vi.fn().mockResolvedValue('');
  readBinary = vi.fn().mockResolvedValue(new ArrayBuffer(0));
  modify = vi.fn().mockResolvedValue(undefined);
  modifyBinary = vi.fn().mockResolvedValue(undefined);
  delete = vi.fn().mockResolvedValue(undefined);
  trash = vi.fn().mockResolvedValue(undefined);
  rename = vi.fn().mockResolvedValue(undefined);
  copy = vi.fn().mockResolvedValue(new TFile());
  getResourcePath = vi.fn().mockReturnValue('');
  
  on = vi.fn();
  off = vi.fn();
  trigger = vi.fn();
  tryTrigger = vi.fn();
}

export class Workspace {
  activeLeaf = null;
  leftSplit = null;
  rightSplit = null;
  rootSplit = null;
  
  getActiveFile = vi.fn().mockReturnValue(null);
  getActiveViewOfType = vi.fn().mockReturnValue(null);
  getLeaf = vi.fn().mockReturnValue(new WorkspaceLeaf());
  getLeavesOfType = vi.fn().mockReturnValue([]);
  openLinkText = vi.fn().mockResolvedValue(undefined);
  
  on = vi.fn();
  off = vi.fn();
  trigger = vi.fn();
}

export class WorkspaceLeaf {
  view = new MarkdownView();
  getViewState = vi.fn().mockReturnValue({});
  setViewState = vi.fn().mockResolvedValue(undefined);
  getEphemeralState = vi.fn().mockReturnValue({});
  setEphemeralState = vi.fn().mockReturnValue(undefined);
  setPinned = vi.fn();
  detach = vi.fn();
}

export class MetadataCache {
  getFileCache = vi.fn().mockReturnValue(null);
  getCache = vi.fn().mockReturnValue(null);
  fileToLinktext = vi.fn().mockReturnValue('');
  
  on = vi.fn();
  off = vi.fn();
  trigger = vi.fn();
}

export class FileManager {
  getNewFileParent = vi.fn().mockReturnValue(null);
  renameFile = vi.fn().mockResolvedValue(undefined);
  generateMarkdownLink = vi.fn().mockReturnValue('');
  processFrontMatter = vi.fn().mockResolvedValue(undefined);
}

export class TFile {
  path = 'test.md';
  name = 'test.md';
  extension = 'md';
  basename = 'test';
  parent = null;
  vault = null;
  stat = { ctime: Date.now(), mtime: Date.now(), size: 1024 };
}

export class TFolder {
  path = 'folder';
  name = 'folder';
  parent = null;
  children = [];
  isRoot = vi.fn().mockReturnValue(false);
}

export class TAbstractFile {
  path = '';
  name = '';
  parent = null;
}

export class MarkdownView {
  file = new TFile();
  editor = new Editor();
  previewMode = null;
  currentMode = null;
  
  getViewData = vi.fn().mockReturnValue('');
  setViewData = vi.fn();
  clear = vi.fn();
  getEphemeralState = vi.fn().mockReturnValue({});
  setEphemeralState = vi.fn();
  getViewType = vi.fn().mockReturnValue('markdown');
  getState = vi.fn().mockReturnValue({});
  setState = vi.fn().mockResolvedValue(undefined);
  
  onload = vi.fn();
  onunload = vi.fn();
}

export class Editor {
  getCursor = vi.fn().mockReturnValue({ line: 0, ch: 0 });
  setCursor = vi.fn();
  getLine = vi.fn().mockReturnValue('');
  setLine = vi.fn();
  getValue = vi.fn().mockReturnValue('');
  setValue = vi.fn();
  getSelection = vi.fn().mockReturnValue('');
  replaceSelection = vi.fn();
  replaceRange = vi.fn();
  getDoc = vi.fn().mockReturnValue({
    getCursor: vi.fn().mockReturnValue({ line: 0, ch: 0 }),
    setCursor: vi.fn(),
  });
  transaction = vi.fn();
  undo = vi.fn();
  redo = vi.fn();
  focus = vi.fn();
  blur = vi.fn();
  hasFocus = vi.fn().mockReturnValue(false);
}

export class Modal {
  app: App;
  containerEl: HTMLElement;
  modalEl: HTMLElement;
  titleEl: HTMLElement;
  contentEl: HTMLElement;
  
  constructor(app: App) {
    this.app = app;
    this.containerEl = document.createElement('div');
    this.modalEl = document.createElement('div');
    this.titleEl = document.createElement('div');
    this.contentEl = document.createElement('div');
    this.modalEl.appendChild(this.titleEl);
    this.modalEl.appendChild(this.contentEl);
    this.containerEl.appendChild(this.modalEl);
  }
  
  open = vi.fn();
  close = vi.fn();
  onOpen = vi.fn();
  onClose = vi.fn();
}

export class Notice {
  setMessage = vi.fn();
  hide = vi.fn();
}

export class Plugin {
  app: App;
  manifest: any;
  
  constructor(app: App, manifest: any) {
    this.app = app;
    this.manifest = manifest;
  }
  
  addCommand = vi.fn();
  addRibbonIcon = vi.fn();
  addStatusBarItem = vi.fn().mockReturnValue(document.createElement('div'));
  addSettingTab = vi.fn();
  registerExtensions = vi.fn();
  registerView = vi.fn();
  registerMarkdownPostProcessor = vi.fn();
  registerMarkdownCodeBlockProcessor = vi.fn();
  registerEditorExtension = vi.fn();
  registerEvent = vi.fn();
  registerInterval = vi.fn();
  registerDomEvent = vi.fn();
  registerObsidianProtocolHandler = vi.fn();
  loadData = vi.fn().mockResolvedValue({});
  saveData = vi.fn().mockResolvedValue(undefined);
  
  onload = vi.fn();
  onunload = vi.fn();
}

export class PluginSettingTab {
  app: App;
  plugin: Plugin;
  containerEl: HTMLElement;
  
  constructor(app: App, plugin: Plugin) {
    this.app = app;
    this.plugin = plugin;
    this.containerEl = document.createElement('div');
  }
  
  display = vi.fn();
  hide = vi.fn();
}

export class Setting {
  settingEl: HTMLElement;
  nameEl: HTMLElement;
  descEl: HTMLElement;
  controlEl: HTMLElement;
  
  constructor(containerEl: HTMLElement) {
    this.settingEl = document.createElement('div');
    this.nameEl = document.createElement('div');
    this.descEl = document.createElement('div');
    this.controlEl = document.createElement('div');
    containerEl.appendChild(this.settingEl);
  }
  
  setName = vi.fn().mockReturnThis();
  setDesc = vi.fn().mockReturnThis();
  setClass = vi.fn().mockReturnThis();
  setTooltip = vi.fn().mockReturnThis();
  setDisabled = vi.fn().mockReturnThis();
  addButton = vi.fn((cb: any) => {
    cb({
      setTooltip: vi.fn().mockReturnThis(),
      setIcon: vi.fn().mockReturnThis(),
      setClass: vi.fn().mockReturnThis(),
      setCta: vi.fn().mockReturnThis(),
      onClick: vi.fn().mockReturnThis(),
      setDisabled: vi.fn().mockReturnThis(),
      setWarning: vi.fn().mockReturnThis(),
    });
    return this;
  });
  addDropdown = vi.fn((cb: any) => {
    cb({
      addOption: vi.fn().mockReturnThis(),
      setValue: vi.fn().mockReturnThis(),
      getValue: vi.fn().mockReturnValue(''),
      onChange: vi.fn().mockReturnThis(),
      setDisabled: vi.fn().mockReturnThis(),
    });
    return this;
  });
  addText = vi.fn((cb: any) => {
    cb({
      setPlaceholder: vi.fn().mockReturnThis(),
      setValue: vi.fn().mockReturnThis(),
      getValue: vi.fn().mockReturnValue(''),
      onChange: vi.fn().mockReturnThis(),
      setDisabled: vi.fn().mockReturnThis(),
      inputEl: document.createElement('input'),
    });
    return this;
  });
  addTextArea = vi.fn((cb: any) => {
    cb({
      setPlaceholder: vi.fn().mockReturnThis(),
      setValue: vi.fn().mockReturnThis(),
      getValue: vi.fn().mockReturnValue(''),
      onChange: vi.fn().mockReturnThis(),
      setDisabled: vi.fn().mockReturnThis(),
      inputEl: document.createElement('textarea'),
    });
    return this;
  });
  addToggle = vi.fn((cb: any) => {
    cb({
      setValue: vi.fn().mockReturnThis(),
      getValue: vi.fn().mockReturnValue(false),
      onChange: vi.fn().mockReturnThis(),
      setDisabled: vi.fn().mockReturnThis(),
      toggleEl: document.createElement('input'),
    });
    return this;
  });
  addSlider = vi.fn((cb: any) => {
    cb({
      setLimits: vi.fn().mockReturnThis(),
      setValue: vi.fn().mockReturnThis(),
      getValue: vi.fn().mockReturnValue(0),
      setDynamicTooltip: vi.fn().mockReturnThis(),
      onChange: vi.fn().mockReturnThis(),
      setDisabled: vi.fn().mockReturnThis(),
      sliderEl: document.createElement('input'),
    });
    return this;
  });
}

// Export additional utilities
export const normalizePath = (path: string) => {
  return path.replace(/\\/g, '/').replace(/\/+/g, '/');
};

export const Platform = {
  isWin: process.platform === 'win32',
  isMacOS: process.platform === 'darwin',
  isLinux: process.platform === 'linux',
  isMobile: false,
  isIosApp: false,
  isAndroidApp: false,
};

export const moment = vi.fn((date?: any) => ({
  format: vi.fn((format: string) => '2024-01-01'),
  toDate: vi.fn(() => new Date('2024-01-01')),
  add: vi.fn().mockReturnThis(),
  subtract: vi.fn().mockReturnThis(),
  startOf: vi.fn().mockReturnThis(),
  endOf: vi.fn().mockReturnThis(),
}));

// Export commonly used enums/constants
export const ViewState = {
  TYPE_MARKDOWN: 'markdown',
  TYPE_EMPTY: 'empty',
};

export const MarkdownPreviewEvents = {
  MARKDOWN_POST_PROCESS: 'markdown-post-process',
};

// Export type guards
export const isTFile = (file: any): file is TFile => {
  return file instanceof TFile;
};

export const isTFolder = (file: any): file is TFolder => {
  return file instanceof TFolder;
};

// Default export for convenience
export default {
  App,
  Vault,
  Workspace,
  WorkspaceLeaf,
  MetadataCache,
  FileManager,
  TFile,
  TFolder,
  TAbstractFile,
  MarkdownView,
  Editor,
  Modal,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  normalizePath,
  Platform,
  moment,
  ViewState,
  MarkdownPreviewEvents,
  isTFile,
  isTFolder,
};
