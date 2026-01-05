import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Crop } from '../../../src/Crop';
import { fakeApp, fakeTFile, fakeVault } from '../../factories/obsidian';

function setRect(el: Element, rect: Partial<DOMRect>) {
  (el as any).getBoundingClientRect = () => ({
    x: rect.left ?? 0,
    y: rect.top ?? 0,
    left: rect.left ?? 0,
    top: rect.top ?? 0,
    right: (rect.left ?? 0) + (rect.width ?? 0),
    bottom: (rect.top ?? 0) + (rect.height ?? 0),
    width: rect.width ?? 0,
    height: rect.height ?? 0,
    toJSON: () => {}
  } as DOMRect);
}

function openCropWithImage(bytesLen = 32) {
  const bytes = new ArrayBuffer(bytesLen);
  const files = [fakeTFile({ path: 'imgs/pic.jpg', name: 'pic.jpg', extension: 'jpg' })];
  const vault = fakeVault({ files, binaryContents: new Map([[files[0].path, bytes]]) });
  const app = fakeApp({ vault });
  const crop = new Crop(app as any, files[0]);
  return { crop, app };
}

describe('Crop integration behaviors (21.1–21.14)', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('21.1 Selection drawing: drag creates a selection rect with expected bounds', async () => {
    // Arrange
    const { crop } = openCropWithImage(16);

    // Act
    // Do not await onOpen; allow image load microtask to resolve
    crop.onOpen();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const root = (crop as any).contentEl as HTMLElement;
    const cropContainer = root.querySelector('.crop-container') as HTMLDivElement;
    const originalImg = root.querySelector('.crop-original-image') as HTMLImageElement;
    const selection = root.querySelector('.selection-area') as HTMLDivElement;

    // Provide sizes for bounding client rects
    setRect(cropContainer, { left: 0, top: 0, width: 600, height: 400 });
    setRect(originalImg, { left: 0, top: 0, width: 600, height: 400 });

    // Start draw on original image
    originalImg.dispatchEvent(new MouseEvent('mousedown', { clientX: 100, clientY: 100, bubbles: true }));
    cropContainer.dispatchEvent(new MouseEvent('mousemove', { clientX: 220, clientY: 160, bubbles: true }));
    cropContainer.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));

    // Assert
    expect(cropContainer).toBeTruthy();
    expect(originalImg).toBeTruthy();
    expect(selection).toBeTruthy();
    expect(selection.style.display).toBe('block');
    expect(parseInt(selection.style.left || '0', 10)).toBe(100);
    expect(parseInt(selection.style.top || '0', 10)).toBe(100);
    expect(parseInt(selection.style.width || '0', 10)).toBe(120);
    expect(parseInt(selection.style.height || '0', 10)).toBe(60);
  });

  it('21.2 Move and bounds: selection moves within container', async () => {
    const { crop } = openCropWithImage();
    // Do not await onOpen; allow image load microtask to resolve
    crop.onOpen();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const root = (crop as any).contentEl as HTMLElement;
    const container = root.querySelector('.crop-container') as HTMLDivElement;
    const originalImg = root.querySelector('.crop-original-image') as HTMLImageElement;

    setRect(container, { left: 0, top: 0, width: 600, height: 400 });
    setRect(originalImg, { left: 0, top: 0, width: 600, height: 400 });

    // draw
    originalImg.dispatchEvent(new MouseEvent('mousedown', { clientX: 100, clientY: 100, bubbles: true }));
    container.dispatchEvent(new MouseEvent('mousemove', { clientX: 300, clientY: 200, bubbles: true }));
    container.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const selection = root.querySelector('.selection-area') as HTMLDivElement;
    // drag selection
    selection.dispatchEvent(new MouseEvent('mousedown', { clientX: 150, clientY: 150, bubbles: true }));
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 1000, clientY: 1000, bubbles: true }));
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));

    // should be clamped within container
    const left = parseInt(selection.style.left || '0', 10);
    const top = parseInt(selection.style.top || '0', 10);
    expect(left).toBeGreaterThanOrEqual(0);
    expect(top).toBeGreaterThanOrEqual(0);
  }, 20000);

  it('21.3 Resize handles with aspect ratio preserved and orthogonal adjustment', async () => {
    const { crop } = openCropWithImage();
    crop.onOpen();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const root = (crop as any).contentEl as HTMLElement;
    const container = root.querySelector('.crop-container') as HTMLDivElement;
    const originalImg = root.querySelector('.crop-original-image') as HTMLImageElement;

    setRect(container, { left: 0, top: 0, width: 600, height: 400 });
    setRect(originalImg, { left: 0, top: 0, width: 600, height: 400 });

    // draw
    originalImg.dispatchEvent(new MouseEvent('mousedown', { clientX: 100, clientY: 100, bubbles: true }));
    container.dispatchEvent(new MouseEvent('mousemove', { clientX: 200, clientY: 200, bubbles: true }));
    container.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));

    // set 1:1 aspect
    const button = root.querySelector('.aspect-ratio-button:nth-child(2)') as HTMLButtonElement; // free, 1:1, 16:9, 4:3
    button.click();

    const selection = root.querySelector('.selection-area') as HTMLDivElement;
    const seHandle = selection.querySelector('.se-resize') as HTMLDivElement;
    seHandle.dispatchEvent(new MouseEvent('mousedown', { clientX: 200, clientY: 200, bubbles: true }));
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 250, clientY: 260, bubbles: true }));
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const selWidth = parseInt(selection.style.width || '0', 10);
    const selHeight = parseInt(selection.style.height || '0', 10);
    expect(Math.abs(selWidth - selHeight) <= 2).toBe(true);
  }, 20000);

  it('21.4/21.5 Aspect ratio presets and custom ratio adjust existing selection', async () => {
    const { crop } = openCropWithImage();
    crop.onOpen();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const root = (crop as any).contentEl as HTMLElement;
    const container = root.querySelector('.crop-container') as HTMLDivElement;
    const originalImg = root.querySelector('.crop-original-image') as HTMLImageElement;

    setRect(container, { left: 0, top: 0, width: 600, height: 400 });
    setRect(originalImg, { left: 0, top: 0, width: 600, height: 400 });

    // draw
    originalImg.dispatchEvent(new MouseEvent('mousedown', { clientX: 100, clientY: 100, bubbles: true }));
    container.dispatchEvent(new MouseEvent('mousemove', { clientX: 240, clientY: 200, bubbles: true }));
    container.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    // preset 16:9
    const buttons = root.querySelectorAll('.aspect-ratio-button');
    (buttons[2] as HTMLButtonElement).click();
    const selection = root.querySelector('.selection-area') as HTMLDivElement;
    const w1 = parseInt(selection.style.width || '0', 10);
    const h1 = parseInt(selection.style.height || '0', 10);
    expect(Math.abs(w1 / Math.max(h1,1) - 16/9) < 0.2).toBe(true);

    // custom 4:3 via inputs
    const inputs = root.querySelectorAll('.custom-ratio-input');
    (inputs[0] as HTMLInputElement).value = '4';
    (inputs[1] as HTMLInputElement).value = '3';
    (inputs[0] as HTMLInputElement).dispatchEvent(new Event('input', { bubbles: true }));
    (inputs[1] as HTMLInputElement).dispatchEvent(new Event('input', { bubbles: true }));

    const w2 = parseInt(selection.style.width || '0', 10);
    const h2 = parseInt(selection.style.height || '0', 10);
    expect(Math.abs(w2 / Math.max(h2,1) - 4/3) < 0.2).toBe(true);
  }, 20000);

  it('21.6 Rotate: Given a selection and 90° rotation, When saving, Then output uses the rotated selection bounding box dimensions', async () => {
    // Arrange
    const { crop, app } = openCropWithImage();
    crop.onOpen();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const root = (crop as any).contentEl as HTMLElement;
    const container = root.querySelector('.crop-container') as HTMLDivElement;
    const originalImg = root.querySelector('.crop-original-image') as HTMLImageElement;

    // Use a 1:1 scale between DOM and natural pixels for easy math
    Object.defineProperty(originalImg, 'naturalWidth', { value: 1000, configurable: true });
    Object.defineProperty(originalImg, 'naturalHeight', { value: 500, configurable: true });

    setRect(container, { left: 0, top: 0, width: 1000, height: 500 });
    setRect(originalImg, { left: 0, top: 0, width: 1000, height: 500 });

    // Draw a 100x50 selection
    originalImg.dispatchEvent(new MouseEvent('mousedown', { clientX: 100, clientY: 100, bubbles: true }));
    container.dispatchEvent(new MouseEvent('mousemove', { clientX: 200, clientY: 150, bubbles: true }));
    container.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));

    const selection = root.querySelector('.selection-area') as HTMLDivElement;
    setRect(selection, { left: 100, top: 100, width: 100, height: 50 });
    Object.defineProperty(selection, 'offsetWidth', { value: 100, configurable: true });
    Object.defineProperty(selection, 'offsetHeight', { value: 50, configurable: true });

    // Rotate 90 degrees clockwise
    (crop as any).currentRotation = 90;

    // Track canvases created during save (original, rotated, final)
    const createdCanvases: HTMLCanvasElement[] = [];
    const realCreateElement = document.createElement.bind(document);
    const createSpy = vi.spyOn(document, 'createElement').mockImplementation((tagName: any) => {
      const el = realCreateElement(tagName);
      if (String(tagName).toLowerCase() === 'canvas') {
        createdCanvases.push(el as HTMLCanvasElement);
      }
      return el;
    });

    const ctxByCanvas = new WeakMap<HTMLCanvasElement, any>();

    // Stub toBlob + getContext for deterministic save
    const realToBlob = (HTMLCanvasElement.prototype as any).toBlob;
    const realGetContext = (HTMLCanvasElement.prototype as any).getContext;

    (HTMLCanvasElement.prototype as any).toBlob = function (cb: any, type?: string) {
      const mime = typeof type === 'string' ? type : 'image/png';
      cb(new Blob([new Uint8Array([1, 2, 3, 4])], { type: mime }));
    };

    (HTMLCanvasElement.prototype as any).getContext = function (_type: string) {
      const ctx = {
        drawImage: vi.fn(),
        translate: vi.fn(),
        rotate: vi.fn(),
        scale: vi.fn(),
        clearRect: vi.fn(),
      };
      ctxByCanvas.set(this as HTMLCanvasElement, ctx);
      return ctx as any;
    };

    try {
      // Act
      await (crop as any).saveImage();

      // Assert
      expect((app.vault as any).modifyBinary).toHaveBeenCalled();
      expect(createdCanvases.length).toBeGreaterThanOrEqual(3);

      const finalCanvas = createdCanvases[2];
      // 100x50 selection rotated 90° should produce a 50x100 bounding box
      expect(finalCanvas.width).toBe(50);
      expect(finalCanvas.height).toBe(100);

      const finalCtx = ctxByCanvas.get(finalCanvas);
      expect(finalCtx?.drawImage).toHaveBeenCalled();
    } finally {
      // Restore stubs
      (HTMLCanvasElement.prototype as any).toBlob = realToBlob;
      (HTMLCanvasElement.prototype as any).getContext = realGetContext;
      createSpy.mockRestore();
    }
  }, 20000);

  it('21.7 Zoom: Given wheel zoom, When zooming, Then UI updates and image transform includes scale, and Save still succeeds', async () => {
    // Arrange
    const { crop, app } = openCropWithImage();
    crop.onOpen();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const root = (crop as any).contentEl as HTMLElement;
    const container = root.querySelector('.crop-container') as HTMLDivElement;
    const originalImg = root.querySelector('.crop-original-image') as HTMLImageElement;

    Object.defineProperty(originalImg, 'naturalWidth', { value: 1000, configurable: true });
    Object.defineProperty(originalImg, 'naturalHeight', { value: 500, configurable: true });

    setRect(container, { left: 0, top: 0, width: 1000, height: 500 });
    setRect(originalImg, { left: 0, top: 0, width: 1000, height: 500 });

    const adjustSpy = vi.spyOn(crop as any, 'adjustModalSize');

    // Act — zoom in one step via wheel
    container.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true }));

    // Assert — UI and transform updated
    const zoomValue = root.querySelector('.zoom-value') as HTMLElement;
    expect(zoomValue?.textContent).toBe('110%');
    expect(originalImg.style.transform).toContain('scale(1.1)');
    expect(adjustSpy).toHaveBeenCalled();

    // And Save still works (no crop selection)
    const realToBlob = (HTMLCanvasElement.prototype as any).toBlob;
    const realGetContext = (HTMLCanvasElement.prototype as any).getContext;

    (HTMLCanvasElement.prototype as any).toBlob = function (cb: any, type?: string) {
      const mime = typeof type === 'string' ? type : 'image/png';
      cb(new Blob([new Uint8Array([9, 8, 7, 6])], { type: mime }));
    };

    (HTMLCanvasElement.prototype as any).getContext = function (_type: string) {
      return {
        drawImage: () => {},
        translate: () => {},
        rotate: () => {},
        scale: () => {},
        clearRect: () => {}
      } as any;
    };

    try {
      await (crop as any).saveImage();
      expect((app.vault as any).modifyBinary).toHaveBeenCalled();
    } finally {
      (HTMLCanvasElement.prototype as any).toBlob = realToBlob;
      (HTMLCanvasElement.prototype as any).getContext = realGetContext;
    }
  }, 20000);

  it('21.8 Apply crop: modifyBinary is called when selection present', async () => {
    const { crop, app } = openCropWithImage();
    // Do not await; simulate image load manually
    crop.onOpen();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const root = (crop as any).contentEl as HTMLElement;
    const container = root.querySelector('.crop-container') as HTMLDivElement;
    const originalImg = root.querySelector('.crop-original-image') as HTMLImageElement;

    setRect(container, { left: 0, top: 0, width: 600, height: 400 });
    setRect(originalImg, { left: 0, top: 0, width: 600, height: 400 });

    // Simulate underlying image load to let onOpen() register listeners
    originalImg.dispatchEvent(new Event('load'));
    await new Promise((resolve) => setTimeout(resolve, 0));

    // draw
    originalImg.dispatchEvent(new MouseEvent('mousedown', { clientX: 100, clientY: 100, bubbles: true }));
    container.dispatchEvent(new MouseEvent('mousemove', { clientX: 200, clientY: 200, bubbles: true }));
    container.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));

    const spy = (app.vault as any).modifyBinary as any;

    // Stub toBlob to complete synchronously for deterministic tests
    const realToBlob = (HTMLCanvasElement.prototype as any).toBlob;
    (HTMLCanvasElement.prototype as any).toBlob = function(cb: any, type?: string) {
      const mime = typeof type === 'string' ? type : 'image/png';
      const blob = new Blob([new Uint8Array([1,2,3,4])], { type: mime });
      cb(blob);
    };

    // Stub getContext to provide a minimal 2D context
    const realGetContext = (HTMLCanvasElement.prototype as any).getContext;
    (HTMLCanvasElement.prototype as any).getContext = function(_type: string) {
      return {
        drawImage: () => {},
        translate: () => {},
        rotate: () => {},
        scale: () => {},
        clearRect: () => {}
      } as any;
    };

    // Directly invoke save to avoid UI wiring races
    await (crop as any).saveImage();

    // Restore stubs
    (HTMLCanvasElement.prototype as any).toBlob = realToBlob;
    (HTMLCanvasElement.prototype as any).getContext = realGetContext;

    expect(spy).toHaveBeenCalled();
  }, 20000);

  it('21.9 No selection: full image saved without cropping', async () => {
    const { crop, app } = openCropWithImage();
    crop.onOpen();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const root = (crop as any).contentEl as HTMLElement;
    const spy = (app.vault as any).modifyBinary as any;

    // Simulate load
    const container = root.querySelector('.crop-container') as HTMLDivElement;
    const originalImg = root.querySelector('.crop-original-image') as HTMLImageElement;
    setRect(container, { left: 0, top: 0, width: 600, height: 400 });
    setRect(originalImg, { left: 0, top: 0, width: 600, height: 400 });
    originalImg.dispatchEvent(new Event('load'));
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Stub toBlob to complete synchronously for deterministic tests
    const realToBlob = (HTMLCanvasElement.prototype as any).toBlob;
    (HTMLCanvasElement.prototype as any).toBlob = function(cb: any, type?: string) {
      const mime = typeof type === 'string' ? type : 'image/png';
      const blob = new Blob([new Uint8Array([9,8,7,6])], { type: mime });
      cb(blob);
    };

    // Stub getContext to provide a minimal 2D context
    const realGetContext = (HTMLCanvasElement.prototype as any).getContext;
    (HTMLCanvasElement.prototype as any).getContext = function(_type: string) {
      return {
        drawImage: () => {},
        translate: () => {},
        rotate: () => {},
        scale: () => {},
        clearRect: () => {}
      } as any;
    };

    // Directly invoke save to avoid UI wiring races
    await (crop as any).saveImage();

    // Restore stubs
    (HTMLCanvasElement.prototype as any).toBlob = realToBlob;
    (HTMLCanvasElement.prototype as any).getContext = realGetContext;

    expect(spy).toHaveBeenCalled();
  });

  it('21.10 Cancel: Given modal open, When Cancel is clicked, Then it closes without writing', async () => {
    // Arrange
    const { crop, app } = openCropWithImage();
    const openPromise = crop.onOpen();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const root = (crop as any).contentEl as HTMLElement;
    const originalImg = root.querySelector('.crop-original-image') as HTMLImageElement;

    // Ensure loadImage() can resolve so onOpen registers button listeners
    Object.defineProperty(originalImg, 'naturalWidth', { value: 10, configurable: true });
    Object.defineProperty(originalImg, 'naturalHeight', { value: 10, configurable: true });
    Object.defineProperty(originalImg, 'clientWidth', { value: 10, configurable: true });
    Object.defineProperty(originalImg, 'clientHeight', { value: 10, configurable: true });

    // Resolve the internal promise
    (originalImg as any).onload?.();
    await openPromise;

    const cancelBtn = root.querySelector('.crop-modal-buttons button:nth-child(2)') as HTMLButtonElement;
    const writeSpy = vi.spyOn(app.vault as any, 'modifyBinary');
    const closeSpy = vi.spyOn(crop as any, 'close');

    // Act
    cancelBtn.click();

    // Assert
    expect(closeSpy).toHaveBeenCalled();
    expect(writeSpy).not.toHaveBeenCalled();
  });

  it('21.10 Reset/escape: Given selection exists, When Escape is pressed, Then selection clears and modal remains open', async () => {
    const { crop } = openCropWithImage();
    // Do not await onOpen; allow image load microtask to resolve
    crop.onOpen();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const root = (crop as any).contentEl as HTMLElement;
    const cropContainer = root.querySelector('.crop-container') as HTMLDivElement;
    const originalImg = root.querySelector('.crop-original-image') as HTMLImageElement;

    setRect(cropContainer, { left: 0, top: 0, width: 600, height: 400 });
    setRect(originalImg, { left: 0, top: 0, width: 600, height: 400 });

    // draw a selection
    originalImg.dispatchEvent(new MouseEvent('mousedown', { clientX: 100, clientY: 100, bubbles: true }));
    cropContainer.dispatchEvent(new MouseEvent('mousemove', { clientX: 220, clientY: 160, bubbles: true }));
    cropContainer.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));

    const selection = root.querySelector('.selection-area') as HTMLDivElement;
    expect(selection.style.display).toBe('block');

    // trigger reset via Escape key (matches onOpen handler)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    // selection cleared (hidden)
    expect(
      selection.style.display === 'none' ||
      selection.style.width === '0' ||
      selection.style.height === '0' ||
      selection.style.width === '' ||
      selection.style.height === ''
    ).toBe(true);
    // modal still present
    expect(root.querySelector('.crop-container')).toBeTruthy();
  });

  it('21.11 MMB panning: Given image loaded, When middle mouse button pressed and dragged, Then image pans via translate transform', async () => {
    // Arrange
    const { crop } = openCropWithImage();
    crop.onOpen();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const root = (crop as any).contentEl as HTMLElement;
    const cropContainer = root.querySelector('.crop-container') as HTMLDivElement;
    const originalImg = root.querySelector('.crop-original-image') as HTMLImageElement;

    setRect(cropContainer, { left: 0, top: 0, width: 600, height: 400 });
    setRect(originalImg, { left: 0, top: 0, width: 600, height: 400 });

    // Act - press MMB (button=1) and drag
    originalImg.dispatchEvent(new MouseEvent('mousedown', { button: 1, clientX: 200, clientY: 200, bubbles: true }));
    cropContainer.dispatchEvent(new MouseEvent('mousemove', { clientX: 250, clientY: 220, bubbles: true }));
    cropContainer.dispatchEvent(new MouseEvent('mouseup', { button: 1, bubbles: true }));

    // Assert - image transform includes translate
    expect(originalImg.style.transform).toContain('translate(50px, 20px)');
    expect((crop as any).currentPanX).toBe(50);
    expect((crop as any).currentPanY).toBe(20);
  });

  it('21.12 LMB draws selection (not pan): Given image loaded, When left mouse button pressed and dragged, Then selection area drawn without panning', async () => {
    // Arrange
    const { crop } = openCropWithImage();
    crop.onOpen();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const root = (crop as any).contentEl as HTMLElement;
    const cropContainer = root.querySelector('.crop-container') as HTMLDivElement;
    const originalImg = root.querySelector('.crop-original-image') as HTMLImageElement;
    const selection = root.querySelector('.selection-area') as HTMLDivElement;

    setRect(cropContainer, { left: 0, top: 0, width: 600, height: 400 });
    setRect(originalImg, { left: 0, top: 0, width: 600, height: 400 });

    // Act - press LMB (button=0) and drag
    originalImg.dispatchEvent(new MouseEvent('mousedown', { button: 0, clientX: 100, clientY: 100, bubbles: true }));
    cropContainer.dispatchEvent(new MouseEvent('mousemove', { clientX: 200, clientY: 150, bubbles: true }));
    cropContainer.dispatchEvent(new MouseEvent('mouseup', { button: 0, bubbles: true }));

    // Assert - selection drawn, no panning
    expect(selection.style.display).toBe('block');
    expect(parseInt(selection.style.width || '0', 10)).toBe(100);
    expect(parseInt(selection.style.height || '0', 10)).toBe(50);
    expect((crop as any).currentPanX).toBe(0);
    expect((crop as any).currentPanY).toBe(0);
    expect(originalImg.style.transform).not.toContain('translate');
  });

  it('21.13 Pan reset on ESC/Reset: Given pan applied and selection exists, When Escape pressed, Then pan resets to 0,0', async () => {
    // Arrange
    const { crop } = openCropWithImage();
    crop.onOpen();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const root = (crop as any).contentEl as HTMLElement;
    const cropContainer = root.querySelector('.crop-container') as HTMLDivElement;
    const originalImg = root.querySelector('.crop-original-image') as HTMLImageElement;

    setRect(cropContainer, { left: 0, top: 0, width: 600, height: 400 });
    setRect(originalImg, { left: 0, top: 0, width: 600, height: 400 });

    // Pan via MMB
    originalImg.dispatchEvent(new MouseEvent('mousedown', { button: 1, clientX: 200, clientY: 200, bubbles: true }));
    cropContainer.dispatchEvent(new MouseEvent('mousemove', { clientX: 300, clientY: 250, bubbles: true }));
    cropContainer.dispatchEvent(new MouseEvent('mouseup', { button: 1, bubbles: true }));

    expect((crop as any).currentPanX).toBe(100);
    expect((crop as any).currentPanY).toBe(50);

    // Draw selection then reset via Escape
    originalImg.dispatchEvent(new MouseEvent('mousedown', { button: 0, clientX: 100, clientY: 100, bubbles: true }));
    cropContainer.dispatchEvent(new MouseEvent('mousemove', { clientX: 150, clientY: 150, bubbles: true }));
    cropContainer.dispatchEvent(new MouseEvent('mouseup', { button: 0, bubbles: true }));

    // Act - press Escape
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    // Assert - pan reset
    expect((crop as any).currentPanX).toBe(0);
    expect((crop as any).currentPanY).toBe(0);
    expect(originalImg.style.transform).not.toContain('translate');
  });

  it('21.14 Panning stops on mouseleave: Given panning in progress, When mouse leaves container, Then panning stops', async () => {
    // Arrange
    const { crop } = openCropWithImage();
    crop.onOpen();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const root = (crop as any).contentEl as HTMLElement;
    const cropContainer = root.querySelector('.crop-container') as HTMLDivElement;
    const originalImg = root.querySelector('.crop-original-image') as HTMLImageElement;

    setRect(cropContainer, { left: 0, top: 0, width: 600, height: 400 });
    setRect(originalImg, { left: 0, top: 0, width: 600, height: 400 });

    // Start panning
    originalImg.dispatchEvent(new MouseEvent('mousedown', { button: 1, clientX: 200, clientY: 200, bubbles: true }));
    cropContainer.dispatchEvent(new MouseEvent('mousemove', { clientX: 250, clientY: 220, bubbles: true }));

    expect((crop as any).isPanning).toBe(true);

    // Act - mouse leaves container
    cropContainer.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));

    // Assert - panning stopped
    expect((crop as any).isPanning).toBe(false);

    // Further mouse moves should not pan
    const panXBefore = (crop as any).currentPanX;
    cropContainer.dispatchEvent(new MouseEvent('mousemove', { clientX: 300, clientY: 300, bubbles: true }));
    expect((crop as any).currentPanX).toBe(panXBefore);
  });
});
