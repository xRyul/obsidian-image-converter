import { describe, it, expect, beforeEach } from 'vitest';
import { VariableProcessor } from '../../../src/VariableProcessor';
import { DEFAULT_SETTINGS } from '../../../src/ImageConverterSettings';
import { fakeApp, fakeTFile, fakeVault } from '../../factories/obsidian';

describe('VariableProcessor.validateTemplate', () => {
  let app: any; let processor: VariableProcessor;

  beforeEach(() => {
    app = fakeApp({ vault: fakeVault() }) as any;
    processor = new VariableProcessor(app, { ...DEFAULT_SETTINGS } as any);
  });

  it('2.44 returns error when using {grandparentfolder} without real grandparent', () => {
    const activeRoot = fakeTFile({ path: 'RootNote.md', name: 'RootNote.md', basename: 'RootNote', parent: { path: '/', name: '/', parent: null, children: [] } as any });
    const file = new File([new Uint8Array([1])], 'img.png', { type: 'image/png' });
    const res = processor.validateTemplate('x/{grandparentfolder}/y', { file, activeFile: activeRoot as any });
    expect(res.valid).toBe(false);
    expect(res.errors.join(' ')).toContain('grandparent');
  });

  it('2.44 returns error when using {parentfolder} and note is in vault root', () => {
    const activeRoot = fakeTFile({ path: 'RootNote.md', name: 'RootNote.md', basename: 'RootNote', parent: { path: '/', name: '/', parent: null, children: [] } as any });
    const file = new File([new Uint8Array([1])], 'img.png', { type: 'image/png' });
    const res = processor.validateTemplate('x/{parentfolder}/y', { file, activeFile: activeRoot as any });
    expect(res.valid).toBe(false);
    expect(res.errors.join(' ')).toContain('parentfolder');
  });

  it('2.44 valid=true when constraints satisfied', () => {
    const grandparent = { path: 'Grand', name: 'Grand', parent: { path: '/', name: '/', parent: null, children: [] } as any, children: [] } as any;
    const parent = { path: 'Grand/Folder', name: 'Folder', parent: grandparent, children: [] } as any;
    const active = fakeTFile({ path: 'Grand/Folder/Note.md', name: 'Note.md', basename: 'Note', parent });
    const file = new File([new Uint8Array([1])], 'img.png', { type: 'image/png' });
    const res = processor.validateTemplate('{parentfolder}-{grandparentfolder}', { file, activeFile: active as any });
    expect(res.valid).toBe(true);
  });
});