/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, afterEach } from 'vitest';
import { ImageAlignment } from '../../../src/ImageAlignment';
import { fakeApp } from '../../factories/obsidian';

const alignmentClasses = [
  'image-position-left',
  'image-position-center',
  'image-position-right',
  'image-wrap',
  'image-no-wrap',
  'image-converter-aligned',
];

function addAlignedImage(doc: Document, className: string) {
  const img = doc.createElement('img');
  img.classList.add(className, 'image-converter-aligned');
  doc.body.appendChild(img);
  return img;
}

describe('ImageAlignment lifecycle cleanup', () => {
  afterEach(() => {
    (globalThis as any).activeDocument = document;
    (globalThis as any).activeWindow = window;
    (window as any).activeDocument = document;
    (window as any).activeWindow = window;
  });

  it('removes plugin-owned alignment classes from both the main document and active popout document on unload', () => {
    document.body.innerHTML = '';
    const popoutDocument = document.implementation.createHTMLDocument('popout');
    const mainImage = addAlignedImage(document, 'image-position-left');
    const popoutImage = addAlignedImage(popoutDocument, 'image-position-right');

    (globalThis as any).activeDocument = popoutDocument;
    (globalThis as any).activeWindow = popoutDocument.defaultView ?? window;
    (window as any).activeDocument = popoutDocument;
    (window as any).activeWindow = popoutDocument.defaultView ?? window;

    const app = fakeApp({
      workspace: {
        containerEl: document.body,
        iterateAllLeaves: (callback: (leaf: any) => void) => {
          callback({ view: { containerEl: document.body } });
          callback({ view: { containerEl: popoutDocument.body } });
        },
      } as any,
    });
    const alignment = new ImageAlignment(app as any, {} as any, {} as any);

    alignment.onunload();

    for (const className of alignmentClasses) {
      expect(mainImage.classList.contains(className), `main ${className}`).toBe(false);
      expect(popoutImage.classList.contains(className), `popout ${className}`).toBe(false);
    }
  });
});
