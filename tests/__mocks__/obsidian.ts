/**
 * Mock implementation of the Obsidian module
 * Provides test doubles for all Obsidian API imports
 */

// Core classes
export class Notice {
  message: string;
  timeout?: number;
  noticeEl: HTMLElement;
  
  constructor(message: string, timeout?: number) {
    this.message = message;
    this.timeout = timeout;
    this.noticeEl = document.createElement('div');
  }
  
  hide() {}
}

export class Plugin {
  app: App;
  manifest: any;
  
  constructor(app: App, manifest: any) {
    this.app = app;
    this.manifest = manifest;
  }
  
  onload() {}
  onunload() {}
  addCommand(command: any) {}
  addRibbonIcon(icon: string, title: string, callback: () => void) {}
  addSettingTab(tab: any) {}
  registerEvent(event: any) {}
  registerDomEvent(el: HTMLElement, event: string, callback: () => void) {}
  registerInterval(interval: number, callback: () => void): number { return 0; }
  loadData(): Promise<any> { return Promise.resolve({}); }
  saveData(data: any): Promise<void> { return Promise.resolve(); }
}

export class Modal {
  app: App;
  containerEl: HTMLElement;
  modalEl: HTMLElement;
  titleEl: HTMLElement;
  contentEl: HTMLElement;
  
  constructor(app: App) {
    this.app = app;
    this.modalEl = document.createElement('div');
    this.containerEl = document.createElement('div');
    this.titleEl = document.createElement('div');
    this.contentEl = document.createElement('div');
  }
  
  open() {}
  close() {}
  onOpen() {}
  onClose() {}
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
  
  display() {}
  hide() {}
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
  }
  
  setName(name: string): this { return this; }
  setDesc(desc: string): this { return this; }
  addText(cb: (text: any) => void): this { return this; }
  addTextArea(cb: (text: any) => void): this { return this; }
  addToggle(cb: (toggle: any) => void): this { return this; }
  addButton(cb: (button: any) => void): this { return this; }
  addDropdown(cb: (dropdown: any) => void): this { return this; }
  addSlider(cb: (slider: any) => void): this { return this; }
  then(cb: () => void): this { return this; }
}

// UI Components
export class ButtonComponent {
  buttonEl: HTMLButtonElement;
  
  constructor(containerEl: HTMLElement) {
    this.buttonEl = document.createElement('button');
    containerEl.appendChild(this.buttonEl);
  }
  
  setButtonText(text: string): this {
    this.buttonEl.textContent = text;
    return this;
  }
  
  setCta(): this { return this; }
  setWarning(): this { return this; }
  setDisabled(disabled: boolean): this {
    this.buttonEl.disabled = disabled;
    return this;
  }
  onClick(callback: () => void): this {
    this.buttonEl.addEventListener('click', callback);
    return this;
  }
}

export class TextComponent {
  inputEl: HTMLInputElement;
  
  constructor(containerEl: HTMLElement) {
    this.inputEl = document.createElement('input');
    this.inputEl.type = 'text';
    containerEl.appendChild(this.inputEl);
  }
  
  setPlaceholder(placeholder: string): this {
    this.inputEl.placeholder = placeholder;
    return this;
  }
  
  setValue(value: string): this {
    this.inputEl.value = value;
    return this;
  }
  
  getValue(): string {
    return this.inputEl.value;
  }
  
  onChange(callback: (value: string) => void): this {
    this.inputEl.addEventListener('change', (e) => {
      callback((e.target as HTMLInputElement).value);
    });
    return this;
  }
  
  setDisabled(disabled: boolean): this {
    this.inputEl.disabled = disabled;
    return this;
  }
}

// File system types
export interface TAbstractFile {
  vault: Vault;
  path: string;
  name: string;
  parent: TFolder | null;
}

export class TFile implements TAbstractFile {
  vault: Vault = {} as Vault;
  path: string = '';
  name: string = '';
  basename: string = '';
  extension: string = '';
  parent: TFolder | null = null;
  stat: { mtime: number; ctime: number; size: number } = {
    mtime: Date.now(),
    ctime: Date.now(),
    size: 0
  };
}

export class TFolder implements TAbstractFile {
  vault: Vault = {} as Vault;
  path: string = '';
  name: string = '';
  parent: TFolder | null = null;
  children: TAbstractFile[] = [];
  
  isRoot(): boolean { return false; }
}

// Core app interfaces
export interface App {
  vault: Vault;
  metadataCache: MetadataCache;
  workspace: Workspace;
  fileManager: FileManager;
  internalPlugins: any;
  plugins: any;
  
  loadLocalStorage(key: string): string | null;
  saveLocalStorage(key: string, value: string): void;
}

export interface Vault {
  adapter: DataAdapter;
  configDir: string;
  
  getAbstractFileByPath(path: string): TAbstractFile | null;
  getFiles(): TFile[];
  getMarkdownFiles(): TFile[];
  getAllLoadedFiles(): TAbstractFile[];
  
  read(file: TFile): Promise<string>;
  readBinary(file: TFile): Promise<ArrayBuffer>;
  cachedRead(file: TFile): Promise<string>;
  
  modify(file: TFile, data: string): Promise<void>;
  modifyBinary(file: TFile, data: ArrayBuffer): Promise<void>;
  
  create(path: string, data: string): Promise<TFile>;
  createBinary(path: string, data: ArrayBuffer): Promise<TFile>;
  createFolder(path: string): Promise<TFolder>;
  
  rename(file: TAbstractFile, newPath: string): Promise<void>;
  delete(file: TAbstractFile, force?: boolean): Promise<void>;
  trash(file: TAbstractFile, system?: boolean): Promise<void>;
  
  copy(file: TFile, newPath: string): Promise<TFile>;
  
  on(event: string, callback: Function): void;
  off(event: string, callback: Function): void;
  trigger(event: string, ...args: any[]): void;
  tryTrigger(event: string, ...args: any[]): void;
}

export interface DataAdapter {
  exists(path: string): Promise<boolean>;
  stat(path: string): Promise<any>;
  list(path: string): Promise<{ files: string[]; folders: string[] }>;
  
  read(path: string): Promise<string>;
  readBinary(path: string): Promise<ArrayBuffer>;
  
  write(path: string, data: string): Promise<void>;
  writeBinary(path: string, data: ArrayBuffer): Promise<void>;
  append(path: string, data: string): Promise<void>;
  
  mkdir(path: string): Promise<void>;
  rmdir(path: string, recursive?: boolean): Promise<void>;
  remove(path: string): Promise<void>;
  
  rename(oldPath: string, newPath: string): Promise<void>;
  copy(oldPath: string, newPath: string): Promise<void>;
}

export interface MetadataCache {
  resolvedLinks: Record<string, Record<string, number>>;
  unresolvedLinks: Record<string, Record<string, number>>;
  
  getFileCache(file: TFile): any;
  getCache(path: string): any;
  
  getFirstLinkpathDest(linkpath: string, sourcePath: string): TFile | null;
  
  on(event: string, callback: Function): void;
  off(event: string, callback: Function): void;
  trigger(event: string, ...args: any[]): void;
  tryTrigger(event: string, ...args: any[]): void;
}

export interface Workspace {
  getActiveFile(): TFile | null;
  getLeaf(newLeaf?: boolean | 'tab' | 'split' | 'window'): WorkspaceLeaf;
  getLeavesOfType(type: string): WorkspaceLeaf[];
  
  on(event: string, callback: Function): void;
  off(event: string, callback: Function): void;
  trigger(event: string, ...args: any[]): void;
  tryTrigger(event: string, ...args: any[]): void;
}

export interface WorkspaceLeaf {
  view: any;
  
  openFile(file: TFile): Promise<void>;
  setViewState(state: any): Promise<void>;
  getViewState(): any;
}

export interface FileManager {
  getNewFileParent(sourcePath?: string): TFolder;
  generateMarkdownLink(file: TFile, sourcePath: string): string;
  renameFile(file: TAbstractFile, newPath: string): Promise<void>;
}

// Platform utilities
// eslint-disable-next-line @typescript-eslint/naming-convention
export const Platform = {
  isDesktop: true,
  isMobile: false,
  isMobileApp: false,
  isDesktopApp: true,
  isIosApp: false,
  isAndroidApp: false,
  isMacOS: false,
  isWin: true,
  isLinux: false,
  isSafari: false
};

// Utility functions
export function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/$/, '');
}

export function getLinkpath(linktext: string): string {
  return linktext;
}

export function parseLinktext(linktext: string): { path: string; subpath?: string } {
  return { path: linktext };
}

export function setIcon(el: HTMLElement, icon: string): void {
  // Mock implementation
}

export function getIcon(name: string): string | null {
  return null;
}

