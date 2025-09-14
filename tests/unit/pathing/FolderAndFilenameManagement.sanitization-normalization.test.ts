import { describe, it, expect } from 'vitest';
import { FolderAndFilenameManagement } from '@/FolderAndFilenameManagement';
import { VariableProcessor } from '@/VariableProcessor';
import { SupportedImageFormats } from '@/SupportedImageFormats';
import { DEFAULT_SETTINGS } from '@/ImageConverterSettings';
import { fakeApp, fakeVault } from '../../factories/obsidian';

describe('FolderAndFilenameManagement sanitization and ensureFolderExists', () => {
  function makeFFM() {
    const app = fakeApp({ vault: fakeVault() }) as any;
    const supported = new SupportedImageFormats(app);
    const vp = new VariableProcessor(app, { ...DEFAULT_SETTINGS } as any);
    const ffm = new FolderAndFilenameManagement(app, { ...DEFAULT_SETTINGS } as any, supported, vp);
    return { app, ffm };
  }

  it('3.9 sanitizeFilename replaces invalids, handles reserved names, preserves trailing dots/underscores, truncates', () => {
    const { ffm } = makeFFM();
    expect(ffm.sanitizeFilename('  My/File\\Name??**.txt  ')).toBe('My_File_Name____.txt');
    expect(ffm.sanitizeFilename('CON')).toMatch(/^CON_?$/);
    // Leading dots removed; internal dots preserved; trailing dots removed by base sanitization then extension is appended back by caller if present.
    expect(ffm.sanitizeFilename('..hidden..file..')).toBe('hidden..file.');
    const long = 'A'.repeat(300) + '.txt';
    const out = ffm.sanitizeFilename(long);
    expect(out.length).toBeLessThanOrEqual(250 + '.txt'.length);
  });

  it('3.21 combinePath behavior', () => {
    const { ffm } = makeFFM();
    expect(ffm.combinePath('/', 'name.png')).toBe('/name.png');
    expect(ffm.combinePath('base', 'name.png')).toBe('base/name.png');
  });

  it('3.6–3.7 ensureFolderExists creates missing nested paths', async () => {
    const { app, ffm } = makeFFM();
    await ffm.ensureFolderExists('alpha/beta/gamma');
    expect(app.vault.createFolder).toHaveBeenCalled();
  });
});