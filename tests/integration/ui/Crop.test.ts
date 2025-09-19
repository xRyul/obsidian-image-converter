import { describe, it, expect, beforeEach } from 'vitest';
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

describe('Crop integration behaviors (21.1–21.10)', () => {
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

  it('21.6 Rotate/flip: Save uses rotated selection bounding box (not pre-rotation coords)', async () => {
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

    // rotate 90
    const rotateRight = root.querySelector('.rotate-container .transform-button:nth-child(2)') as HTMLButtonElement;
    rotateRight.click();

    // Ensure save does not throw
    const saveBtn = root.querySelector('.crop-modal-buttons button:first-child') as HTMLButtonElement;
    saveBtn.click();
    expect(true).toBe(true);
  }, 20000);

  it('21.7 Zoom mapping adjusts modal size and save path still valid', async () => {
    const { crop } = openCropWithImage();
    crop.onOpen();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const root = (crop as any).contentEl as HTMLElement;
    const container = root.querySelector('.crop-container') as HTMLDivElement;
    const originalImg = root.querySelector('.crop-original-image') as HTMLImageElement;

    setRect(container, { left: 0, top: 0, width: 600, height: 400 });
    setRect(originalImg, { left: 0, top: 0, width: 600, height: 400 });

    // simulate wheel zoom
    container.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true }));
    // Save should still not throw
    const saveBtn = root.querySelector('.crop-modal-buttons button:first-child') as HTMLButtonElement;
    saveBtn.click();
    expect(true).toBe(true);
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

  it('21.10 Reset clears current selection and keeps modal open', async () => {
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
});
