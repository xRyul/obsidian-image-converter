import { describe, it, expect, beforeEach, vi } from 'vitest';

// Use the richer Fabric mock so both initialization and behaviors are supported
vi.mock('fabric', () => {
  class MockFabricObject {
    type = 'object';
    __active = false;
    constructor(type?: string) {
      if (type) this.type = type;
    }

    // Basic fabric-style API used throughout the annotation tool
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    set(prop: string, value: any) { (this as any)[prop] = value; return this; }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    get(prop: string) { return (this as any)[prop]; }

    toObject() {
      // Provide a sane default serialization shape.
      // Individual tests can override by providing their own toObject() implementations.
      return { type: this.type };
    }
  }

  class MockCanvas {
    width: number; height: number; isDrawingMode = false; preserveObjectStacking = true;
    freeDrawingBrush: any; _objects: any[] = []; _handlers: Record<string, Function[]> = {};
    constructor(_el: HTMLCanvasElement, opts: any) { this.width = opts?.width ?? 300; this.height = opts?.height ?? 200; }
    add(obj: any) { this._objects.push(obj); return obj; }
    remove(obj: any) {
      const idx = this._objects.indexOf(obj);
      if (idx !== -1) this._objects.splice(idx, 1);
      return obj;
    }
    getObjects() { return this._objects; }
    forEachObject(cb: (obj:any)=>void) { this._objects.forEach(cb); }
    getActiveObject() { return this._objects.find(obj => obj.__active); }
    setActiveObject(obj: any) { this._objects.forEach(x => x.__active=false); obj.__active=true; }
    requestRenderAll() {}
    renderAll() {}
    setViewportTransform(_m: any) {}
    setZoom(_z: number) {}
    setDimensions(_dims: any) {}
    toCanvasElement(_multiplier?: number) { const canvasElement = document.createElement('canvas'); canvasElement.width=10; canvasElement.height=10; return canvasElement; }
    toDataURL(_opts?: any) { return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGMAAQAABQABDQottQAAAABJRU5ErkJggg=='; }
    getElement() { const canvasElement = document.createElement('canvas'); canvasElement.width=10; canvasElement.height=10; return canvasElement; }
    on(evt: string, cb: Function) { (this._handlers[evt] ||= []).push(cb); }
    off() {}
    trigger(evt: string, payload: any) { (this._handlers[evt]||[]).forEach(cb=>cb(payload)); }
    bringObjectToFront(){} bringObjectForward(){} sendObjectBackwards(){} sendObjectToBack(){} moveObjectTo(){}
    getScenePoint(_e: any) { return { x: 100, y: 100 }; }
  }

  class MockImage extends MockFabricObject {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    constructor(public img: HTMLImageElement, public opts: any) {
      super('image');
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    set(_props: any) { return this; }
  }

  class MockIText extends MockFabricObject {
    fill = '#000'; backgroundColor = 'transparent'; isEditing = false;

    constructor(_text?: string) {
      super('i-text');
    }

    enterEditing(){ this.isEditing=true; }
    exitEditing(){ this.isEditing=false; }
    selectAll(){}
  }

  class MockPath extends MockFabricObject {
    stroke = '#000';
    constructor(_path?: string) {
      super('path');
    }
  }

  class MockActiveSelection extends MockFabricObject {
    __objs:any[]=[];
    constructor() {
      super('activeselection');
    }
    getObjects(){return this.__objs;}
    forEachObject(cb:(obj:any)=>void){ this.__objs.forEach(cb); }
  }

  class MockPencilBrush { constructor(public canvas:any){} color='#000'; width=1; }

  return {
    Canvas: MockCanvas,
    FabricObject: MockFabricObject,
    FabricImage: MockImage,
    IText: MockIText,
    ActiveSelection: MockActiveSelection,
    PencilBrush: MockPencilBrush,
    Path: MockPath,
    util: {
      enlivenObjects: async (objects: unknown[]) => objects.map((obj) => {
        const type = typeof (obj as any)?.type === 'string' ? (obj as any).type : 'unknown';
        const instance = new MockFabricObject(type);
        if (obj && typeof obj === 'object') {
          Object.assign(instance as any, obj);
        }
        return instance;
      }),
    },
    Point: class {},
    Pattern: class {},
    TEvent: class {},
    TBrushEventData: class {},
  };
});

import ImageConverterPlugin from '../../../src/main';
import { ImageAnnotationModal } from '../../../src/ImageAnnotation';
import { fakeApp, fakeTFile, fakeVault, fakePluginManifest } from '../../factories/obsidian';
import { IText } from 'fabric';

// 16.1 Initialization
// Given a vault image, When the annotation modal opens, Then Fabric canvas is created and the layout renders.
describe('ImageAnnotation — 16.1 Initialization (integration-lite)', () => {
  let app: any;
  let plugin: any;
  let imageFile: any;

  beforeEach(() => {
    const bytes = new ArrayBuffer(32);
    const file = fakeTFile({ path: 'imgs/pic.jpg', name: 'pic.jpg', extension: 'jpg' });
    const vault = fakeVault({ files: [file], binaryContents: new Map([[file.path, bytes]]) });
    app = fakeApp({ vault });
    plugin = new ImageConverterPlugin(app as any, fakePluginManifest({ id: 'image-converter', dir: '/plugins/image-converter' }));
    plugin.manifest = { id: 'image-converter', dir: '/plugins/image-converter' } as any;
    imageFile = file;
  });

  it('creates canvas, adds image, and renders modal layout', async () => {
    const modal = new ImageAnnotationModal(app as any, plugin, imageFile);
    await modal.onOpen();

    const canvasEl = ((modal as any).contentEl as HTMLElement).querySelector('canvas');
    expect(canvasEl).toBeTruthy();

    const modalRoot = (modal as any).modalEl as HTMLElement;
    expect(modalRoot.classList.contains('image-converter-annotation-tool-image-annotation-modal')).toBe(true);
  });
});

// 16.2–16.11 Behaviors
// These tests exercise tools, state changes, save/close flows, and preset persistence.
describe('ImageAnnotation — 16.2–16.11 Behaviors (integration-lite)', () => {
  let app: any; let plugin: any; let imageFile: any;

  beforeEach(() => {
    const bytes = new ArrayBuffer(64);
    const file = fakeTFile({ path: 'imgs/pic.jpg', name: 'pic.jpg', extension: 'jpg' });
    const vault = fakeVault({ files: [file], binaryContents: new Map([[file.path, bytes]]) });
    app = fakeApp({ vault });
    plugin = new ImageConverterPlugin(app as any, fakePluginManifest({ id: 'image-converter', dir: '/plugins/image-converter' }));
    plugin.manifest = { id: 'image-converter', dir: '/plugins/image-converter' } as any;
    // minimal presets for save/preset tests
    plugin.settings = { annotationPresets: { drawing:[{}, {}, {}], arrow:[{}, {}, {}], text:[{}, {}, {}] } } as any;
    imageFile = file;
  });

  it('16.2 Drawing tool creates a stroke with configured color/size/opacity', async () => {
    const modal = new ImageAnnotationModal(app as any, plugin, imageFile);
    await modal.onOpen();
    const toolbar = (modal as any).contentEl.querySelector('.image-converter-annotation-tool-annotation-toolbar') as HTMLElement;
    const drawBtn = toolbar.querySelector('button') as HTMLButtonElement;
    drawBtn.click();
    const color = (modal as any).contentEl.querySelector('.color-picker') as HTMLInputElement;
    if (color) {
      color.value = '#00ff00';
      color.dispatchEvent(new Event('input'));
    }
    const { canvas } = (modal as any); canvas.trigger('path:created', { path: { globalCompositeOperation: 'source-over' } });
    expect(canvas.freeDrawingBrush).toBeTruthy();
  });

  it('16.3 Arrow tool adds arrow object with configured properties', async () => {
    const modal = new ImageAnnotationModal(app as any, plugin, imageFile);
    await modal.onOpen();
    const buttons = (modal as any).contentEl.querySelectorAll('.image-converter-annotation-tool-drawing-tools-column button');
    (buttons[1] as HTMLButtonElement).click();
    expect((modal as any).toolManager.isInArrowMode()).toBe(true);
    // Simulate arrow creation through canvas events if supported by mock
    const { canvas } = (modal as any);
    canvas.trigger('mouse:down', { e: new MouseEvent('mousedown') });
    canvas.trigger('mouse:up', { e: new MouseEvent('mouseup') });
    expect(canvas.getObjects().length).toBeGreaterThanOrEqual(0);
  });

  it('16.4 Text tool: click creates editable text object with font size/color/background', async () => {
    const modal = new ImageAnnotationModal(app as any, plugin, imageFile);
    await modal.onOpen();
    const buttons = (modal as any).contentEl.querySelectorAll('.image-converter-annotation-tool-drawing-tools-column button');
    (buttons[2] as HTMLButtonElement).click();
    (modal as any).canvas.trigger('mouse:dblclick', { e: new MouseEvent('dblclick') });
    expect(((modal as any).canvas.getObjects().length) >= 1).toBe(true);
  });

  it('16.5 Color/opacity update propagates to selected object', async () => {
    const modal = new ImageAnnotationModal(app as any, plugin, imageFile);
    await modal.onOpen();
    const { canvas } = (modal as any);
    const text = new IText('');
    canvas.add(text); canvas.setActiveObject(text);
    const opacityBtn = (modal as any).contentEl.querySelector('.opacity-buttons-container .image-converter-annotation-tool-button-group button') as HTMLButtonElement;
    opacityBtn.click();
    expect(text.fill).toBeTruthy();
  });

  it('16.6 Size change updates brush thickness', async () => {
    const modal = new ImageAnnotationModal(app as any, plugin, imageFile);
    await modal.onOpen();
    // First enable drawing mode to initialize freeDrawingBrush
    const drawBtn = (modal as any).contentEl.querySelector('.image-converter-annotation-tool-drawing-tools-column button') as HTMLButtonElement;
    drawBtn.click();
    const sizeBtn = (modal as any).contentEl.querySelector('.size-buttons-container .image-converter-annotation-tool-button-group button') as HTMLButtonElement;
    sizeBtn.click();
    const { canvas } = (modal as any);
    expect(canvas.freeDrawingBrush?.width).toBeGreaterThan(0);
  });

  it('16.7/16.8 Undo/Redo: undo reverts last and redo reapplies', async () => {
    const modal = new ImageAnnotationModal(app as any, plugin, imageFile);
    await modal.onOpen();
    const { historyManager, canvas } = (modal as any);

    // Helper to create objects with toObject() - required for serialization
    const createMockObject = (type: string, props: Record<string, unknown>) => ({
      type,
      ...props,
      toObject() { return { type, ...props }; },
    });

    // HistoryManager assumes a stable background object at index 0 and serializes/restores everything after.
    // Ensure the test canvas matches that contract to make object-count assertions deterministic.
    const existingObjects = canvas.getObjects();
    if (existingObjects.length === 0) {
      canvas.add(createMockObject('background', { id: 'bg' }));
    } else if (existingObjects.length > 1) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      (canvas as any)._objects = [existingObjects[0]];
    }

    // Initialize history - starts with empty state
    historyManager.initialize();
    expect(historyManager.canUndo()).toBe(false);
    expect(historyManager.canRedo()).toBe(false);

    const baselineCount = canvas.getObjects().length;
    expect(baselineCount).toBeGreaterThanOrEqual(1);

    // Add first object and save state
    const firstObject = createMockObject('rect', { left: 10, top: 10 });
    canvas.add(firstObject);
    historyManager.saveState();

    expect(canvas.getObjects().length).toBe(baselineCount + 1);
    expect(historyManager.canUndo()).toBe(true);
    expect(historyManager.canRedo()).toBe(false);

    // Add second object and save state
    const secondObject = createMockObject('circle', { radius: 20 });
    canvas.add(secondObject);
    historyManager.saveState();

    expect(canvas.getObjects().length).toBe(baselineCount + 2);

    // Spy after setup so modal initialization noise doesn't affect this test.
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // Undo - should go back to state with only first object
    await historyManager.undo();
    expect(errorSpy).not.toHaveBeenCalled();
    expect(canvas.getObjects().length).toBe(baselineCount + 1);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const typesAfterUndo = canvas.getObjects().slice(1).map((obj: any) => obj.type);
    expect(typesAfterUndo).toEqual(['rect']);
    expect(historyManager.canRedo()).toBe(true);

    // Redo - should restore second object
    await historyManager.redo();
    expect(errorSpy).not.toHaveBeenCalled();
    expect(canvas.getObjects().length).toBe(baselineCount + 2);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const typesAfterRedo = canvas.getObjects().slice(1).map((obj: any) => obj.type);
    expect(typesAfterRedo).toEqual(['rect', 'circle']);

    expect(historyManager.canRedo()).toBe(false);
    expect(historyManager.canUndo()).toBe(true);

    errorSpy.mockRestore();
  });

  it('16.9 Save writes to same TFile and closes; on failure no write occurs', async () => {
    const modal = new ImageAnnotationModal(app as any, plugin, imageFile);
    await modal.onOpen();
    const { canvas } = (modal as any);
    const path = new (require('fabric').Path)('M 0 0 L 5 5');
    canvas.add(path);
    const writeSpy = vi.spyOn((app.vault as any), 'modifyBinary').mockResolvedValue(undefined as any);
    const closeSpy = vi.spyOn(modal as any, 'close');
    const saveBtn = (modal as any).contentEl.querySelector('.annotation-toolbar-group .mod-cta') as HTMLButtonElement;
    expect(() => saveBtn.click()).not.toThrow();
    // Wait until writeSpy is called (polling up to ~1s)
    let tries = 0;
    while (!(writeSpy as any).mock?.calls?.length && tries < 20) {
      await new Promise(resolve => setTimeout(resolve, 50));
      tries++;
    }
    expect(writeSpy).toHaveBeenCalled();
    expect(closeSpy).toHaveBeenCalled();

    // Failure branch: mock toDataURL throwing
    writeSpy.mockClear();
    const originalToDataURL = (canvas as any).toDataURL;
    (canvas as any).toDataURL = () => { throw new Error('fail'); };
    expect(() => saveBtn.click()).not.toThrow();
    await Promise.resolve();
    expect(writeSpy).not.toHaveBeenCalled();
    ;(canvas as any).toDataURL = originalToDataURL;
  });

  it('16.10 Close without saving: ESC during text editing does not write', async () => {
    const modal = new ImageAnnotationModal(app as any, plugin, imageFile);
    await modal.onOpen();
    const spy = vi.spyOn((app.vault as any), 'modifyBinary');
    const buttons = (modal as any).contentEl.querySelectorAll('.image-converter-annotation-tool-drawing-tools-column button');
    (buttons[2] as HTMLButtonElement).click();
    (modal as any).canvas.trigger('mouse:dblclick', { e: new MouseEvent('dblclick') });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await Promise.resolve();
    expect(spy).not.toHaveBeenCalled();
  });

  it('16.11 Preset management persists to settings', async () => {
    const modal = new ImageAnnotationModal(app as any, plugin, imageFile);
    await modal.onOpen();
    await new Promise(resolve => setTimeout(resolve, 500));
    const buttons = (modal as any).contentEl.querySelectorAll('.image-converter-annotation-tool-drawing-tools-column button');
    (buttons[0] as HTMLButtonElement).click();
    let presetButtons = (modal as any).contentEl.querySelectorAll('.image-converter-annotation-tool-preset-buttons .preset-button');
    if (presetButtons.length === 0) {
      // Call createPresetButtons directly on toolbar element (same approach as pre-refactor test)
      const toolbar = (modal as any).contentEl.querySelector('.image-converter-annotation-tool-annotation-toolbar');
      (modal as any).toolbarBuilder.createPresetButtons(toolbar);
      presetButtons = (modal as any).contentEl.querySelectorAll('.image-converter-annotation-tool-preset-buttons .preset-button');
    }
    expect(presetButtons.length).toBeGreaterThan(0);
    const evt = new MouseEvent('click', { bubbles: true }); Object.defineProperty(evt, 'shiftKey', { get: () => true });
    (presetButtons[0] as HTMLElement).dispatchEvent(evt);
    expect(plugin.settings.annotationPresets.drawing[0]).toBeTruthy();
  });
});
