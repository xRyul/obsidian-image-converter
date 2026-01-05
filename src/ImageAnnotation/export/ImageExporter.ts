import { App, Notice, TFile, MarkdownView } from 'obsidian';
import { Canvas, FabricImage, ImageFormat } from 'fabric';
import { ExtendedImageFormat } from '../types';
import mime from '../../mime.min.js';

function dataUrlToArrayBuffer(dataUrl: string): ArrayBuffer {
    try {
        const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
        const binaryString = typeof atob === 'function' ? atob(base64) : Buffer.from(base64, 'base64').toString('binary');
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        return bytes.buffer;
    } catch (e) {
        console.error('Failed to decode data URL', e);
        return new ArrayBuffer(0);
    }
}

export class ImageExporter {
    constructor(private app: App) {}

    async save(canvas: Canvas, file: TFile): Promise<boolean> {
        if (!canvas) return false;

        try {
            const originalStacking = canvas.preserveObjectStacking;
            canvas.preserveObjectStacking = false;

            const mimeType = mime.getType(file.name) || `image/${file.extension}`;
            if (!mimeType) throw new Error('Unable to determine file type');

            let exportFormat: ExtendedImageFormat = 'png';
            if (mimeType === 'image/jpeg' || mimeType === 'image/jpg') {
                exportFormat = 'jpeg';
            } else if (mimeType === 'image/png') {
                exportFormat = 'png';
            } else if (mimeType === 'image/webp') {
                exportFormat = 'webp';
            } else if (mimeType === 'image/avif') {
                exportFormat = 'avif';
            }

            const objects = canvas.getObjects();
            if (objects.length === 0) return false;

            const backgroundImage = objects.find(obj => obj instanceof FabricImage) as FabricImage | undefined;

            canvas.renderAll();
            await new Promise(resolve => setTimeout(resolve, 50));

            const bounds = this.calculateBounds(canvas, backgroundImage);
            const { minX, minY, finalWidth, finalHeight, scaleToOriginal } = bounds;

            const currentVPT = (Array.isArray((canvas as any).viewportTransform)
                ? [...(canvas as any).viewportTransform]
                : [1, 0, 0, 1, 0, 0]) as [number, number, number, number, number, number];

            canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
            if (typeof (canvas as any).setZoom === 'function') {
                canvas.setZoom(1);
            }

            objects.forEach(obj => {
                const anyObj = obj as any;
                if (typeof anyObj.setCoords === 'function') {
                    anyObj.setCoords();
                }
                anyObj.visible = true;
            });

            canvas.renderAll();
            await new Promise(resolve => setTimeout(resolve, 100));

            let arrayBuffer: ArrayBuffer | null = null;

            // Method 1: Try toBlob first
            arrayBuffer = await this.exportViaToBlob(canvas, minX, minY, finalWidth, finalHeight, scaleToOriginal, mimeType);

            // Method 2: Try toDataURL if toBlob failed
            if (!arrayBuffer) {
                arrayBuffer = await this.exportViaDataURL(canvas, exportFormat, minX, minY, finalWidth, finalHeight, scaleToOriginal);
            }

            // Method 3: Try canvas drawing fallback
            if (!arrayBuffer) {
                arrayBuffer = await this.exportViaNativeCanvas(canvas, minX, minY, finalWidth, finalHeight, scaleToOriginal, mimeType);
            }

            if (!arrayBuffer || arrayBuffer.byteLength === 0) {
                canvas.setViewportTransform(currentVPT);
                canvas.renderAll();
                canvas.preserveObjectStacking = originalStacking;
                canvas.requestRenderAll();
                new Notice('Failed to export image');
                return false;
            }

            canvas.setViewportTransform(currentVPT);
            canvas.renderAll();

            await this.app.vault.modifyBinary(file, arrayBuffer);

            new Notice('Image saved successfully');

            await this.refreshActiveView();

            canvas.preserveObjectStacking = originalStacking;
            canvas.requestRenderAll();

            return true;
        } catch (error) {
            console.error('Save error:', error);
            new Notice('Error saving image');
            return false;
        }
    }

    private calculateBounds(canvas: Canvas, backgroundImage?: FabricImage): {
        minX: number;
        minY: number;
        finalWidth: number;
        finalHeight: number;
        scaleToOriginal: number;
    } {
        const objects = canvas.getObjects();
        let originalWidth = 0;
        let originalHeight = 0;
        let scale = { x: 1, y: 1 };
        let bgLeft = 0, bgTop = 0, bgRight = 0, bgBottom = 0;

        if (backgroundImage) {
            originalWidth = backgroundImage.width ?? 0;
            originalHeight = backgroundImage.height ?? 0;

            if (!originalWidth || !originalHeight) {
                const bi = backgroundImage as any;
                const imgEl = (bi && bi.img) as HTMLImageElement | undefined;
                const nativeCanvas = canvas.getElement?.();
                originalWidth = imgEl?.naturalWidth ?? imgEl?.width ?? nativeCanvas?.width ?? 0;
                originalHeight = imgEl?.naturalHeight ?? imgEl?.height ?? nativeCanvas?.height ?? 0;
            }

            const bi = backgroundImage as any;
            const sx = (backgroundImage as any).scaleX ?? bi?.opts?.scaleX ?? 1;
            const sy = (backgroundImage as any).scaleY ?? bi?.opts?.scaleY ?? 1;
            scale = { x: sx, y: sy };
            const displayWidth = originalWidth * scale.x;
            const displayHeight = originalHeight * scale.y;
            const left = (backgroundImage as any).left ?? 0;
            const top = (backgroundImage as any).top ?? 0;
            bgLeft = left;
            bgTop = top;
            bgRight = left + displayWidth;
            bgBottom = top + displayHeight;
        } else {
            const nativeCanvas = canvas.getElement();
            originalWidth = nativeCanvas?.width ?? 0;
            originalHeight = nativeCanvas?.height ?? 0;
            bgLeft = 0; bgTop = 0; bgRight = originalWidth; bgBottom = originalHeight;
        }

        let minX = bgLeft;
        let minY = bgTop;
        let maxX = bgRight;
        let maxY = bgBottom;

        const annotations = objects.filter(obj => obj !== backgroundImage);
        if (annotations.length > 0) {
            annotations.forEach(obj => {
                const anyObj = obj as any;
                if (anyObj && anyObj.visible === false) return;

                let objBounds: any = null;
                try {
                    if (typeof anyObj.getBoundingRect === 'function') {
                        objBounds = anyObj.getBoundingRect();
                    } else {
                        const left = Number(anyObj.left ?? 0);
                        const top = Number(anyObj.top ?? 0);
                        const width = Number(anyObj.width ?? 0) * Number(anyObj.scaleX ?? 1);
                        const height = Number(anyObj.height ?? 0) * Number(anyObj.scaleY ?? 1);
                        objBounds = { left, top, width, height };
                    }
                } catch {
                    objBounds = null;
                }

                if (objBounds) {
                    if (isFinite(objBounds.left)) minX = Math.min(minX, objBounds.left);
                    if (isFinite(objBounds.top)) minY = Math.min(minY, objBounds.top);
                    if (isFinite(objBounds.width)) maxX = Math.max(maxX, objBounds.left + objBounds.width);
                    if (isFinite(objBounds.height)) maxY = Math.max(maxY, objBounds.top + objBounds.height);
                }
            });
        }

        minX = Math.min(minX, bgLeft);
        minY = Math.min(minY, bgTop);
        maxX = Math.max(maxX, bgRight);
        maxY = Math.max(maxY, bgBottom);

        let finalWidth = maxX - minX;
        let finalHeight = maxY - minY;

        if (finalWidth <= 0 || finalHeight <= 0) {
            const nativeCanvas = canvas.getElement?.();
            const fallbackW = nativeCanvas?.width ?? 0;
            const fallbackH = nativeCanvas?.height ?? 0;
            minX = 0;
            minY = 0;
            if (fallbackW > 0 && fallbackH > 0) {
                finalWidth = fallbackW;
                finalHeight = fallbackH;
            } else {
                finalWidth = 10;
                finalHeight = 10;
            }
        }

        const baseW = backgroundImage ? (originalWidth * (scale.x || 1)) : (originalWidth || 1);
        const baseH = backgroundImage ? (originalHeight * (scale.y || 1)) : (originalHeight || 1);
        const displayWidth = baseW;
        const displayHeight = baseH;
        const scaleToOriginal = Math.max(
            originalWidth && displayWidth ? (originalWidth / displayWidth) : 1,
            originalHeight && displayHeight ? (originalHeight / displayHeight) : 1
        );

        return { minX, minY, finalWidth, finalHeight, scaleToOriginal };
    }

    private async exportViaToBlob(
        canvas: Canvas,
        minX: number,
        minY: number,
        finalWidth: number,
        finalHeight: number,
        scaleToOriginal: number,
        mimeType: string
    ): Promise<ArrayBuffer | null> {
        try {
            const canvasElement = canvas.toCanvasElement(scaleToOriginal);

            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = finalWidth * scaleToOriginal;
            tempCanvas.height = finalHeight * scaleToOriginal;
            const tempCtx = tempCanvas.getContext('2d');

            if (tempCtx) {
                tempCtx.drawImage(
                    canvasElement,
                    minX * scaleToOriginal,
                    minY * scaleToOriginal,
                    finalWidth * scaleToOriginal,
                    finalHeight * scaleToOriginal,
                    0, 0,
                    tempCanvas.width,
                    tempCanvas.height
                );

                const blob: Blob | null = await new Promise<Blob | null>((resolve) => {
                    const anyCanvas = tempCanvas as any;
                    if (typeof anyCanvas.toBlob === 'function') {
                        anyCanvas.toBlob((result: Blob | null) => resolve(result), mimeType, 1);
                    } else {
                        try {
                            const dataUrl = tempCanvas.toDataURL(mimeType, 1);
                            fetch(dataUrl).then(res => res.blob()).then(resolve).catch(() => resolve(null));
                        } catch {
                            resolve(null);
                        }
                    }
                });

                if (blob) {
                    return await blob.arrayBuffer();
                }
            }
        } catch (e) {
            console.debug('toCanvasElement method failed, trying alternative...', e);
        }
        return null;
    }

    private async exportViaDataURL(
        canvas: Canvas,
        exportFormat: ExtendedImageFormat,
        minX: number,
        minY: number,
        finalWidth: number,
        finalHeight: number,
        scaleToOriginal: number
    ): Promise<ArrayBuffer | null> {
        try {
            const dataUrl = canvas.toDataURL({
                format: exportFormat as ImageFormat,
                quality: 1,
                multiplier: scaleToOriginal,
                left: minX,
                top: minY,
                width: finalWidth,
                height: finalHeight,
                enableRetinaScaling: true
            });

            if (!dataUrl || dataUrl === 'data:,') {
                throw new Error('Invalid data URL');
            }

            return dataUrlToArrayBuffer(dataUrl);
        } catch (e) {
            console.debug('toDataURL method failed, trying alternative...', e);
        }
        return null;
    }

    private async exportViaNativeCanvas(
        canvas: Canvas,
        minX: number,
        minY: number,
        finalWidth: number,
        finalHeight: number,
        scaleToOriginal: number,
        mimeType: string
    ): Promise<ArrayBuffer | null> {
        try {
            const nativeCanvas = canvas.getElement();
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = finalWidth * scaleToOriginal;
            tempCanvas.height = finalHeight * scaleToOriginal;
            const tempCtx = tempCanvas.getContext('2d');

            if (tempCtx) {
                tempCtx.drawImage(
                    nativeCanvas,
                    minX, minY, finalWidth, finalHeight,
                    0, 0, tempCanvas.width, tempCanvas.height
                );

                const blob: Blob | null = await new Promise<Blob | null>((resolve) => {
                    const anyCanvas = tempCanvas as any;
                    if (typeof anyCanvas.toBlob === 'function') {
                        anyCanvas.toBlob((result: Blob | null) => resolve(result), mimeType, 1);
                    } else {
                        try {
                            const dataUrl = tempCanvas.toDataURL(mimeType, 1);
                            fetch(dataUrl).then(res => res.blob()).then(resolve).catch(() => resolve(null));
                        } catch {
                            resolve(null);
                        }
                    }
                });

                if (blob) {
                    return await blob.arrayBuffer();
                }
            }
        } catch (e) {
            console.debug('Native canvas fallback failed', e);
        }
        return null;
    }

    private async refreshActiveView(): Promise<void> {
        const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!activeView) return;

        const leaf = this.app.workspace.getMostRecentLeaf();
        if (leaf) {
            const currentState = leaf.getViewState();

            await leaf.setViewState({
                type: 'empty',
                state: {}
            });

            await leaf.setViewState(currentState);
        }
    }
}
