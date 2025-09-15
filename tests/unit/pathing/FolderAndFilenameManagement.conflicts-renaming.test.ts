import { describe, it, expect } from 'vitest';
import { FolderAndFilenameManagement } from '../../../src/FolderAndFilenameManagement';
import { VariableProcessor } from '../../../src/VariableProcessor';
import { SupportedImageFormats } from '../../../src/SupportedImageFormats';
import { DEFAULT_SETTINGS, type FilenamePreset, type ConversionPreset } from '../../../src/ImageConverterSettings';
import { fakeApp, fakeVault } from '../../factories/obsidian';

describe('FolderAndFilenameManagement conflicts and rename/convert skip rules', () => {
  function makeFFM() {
    const app = fakeApp({ vault: fakeVault() }) as any;
    const supported = new SupportedImageFormats(app);
    const vp = new VariableProcessor(app, { ...DEFAULT_SETTINGS } as any);
    const ffm = new FolderAndFilenameManagement(app, { ...DEFAULT_SETTINGS } as any, supported, vp);
    return { app, ffm };
  }

  it('3.13 increment conflict resolution appends numeric suffix', async () => {
    const { app, ffm } = makeFFM();
    // Simulate existing file "dir/name.png" and then ask for conflict resolution
    (app.vault.adapter.exists as any).mockResolvedValueOnce(true); // name.png exists
    ;(app.vault.adapter.exists as any)
      .mockResolvedValueOnce(true)   // name-1.png exists
      .mockResolvedValueOnce(false); // name-2.png available

    const final = await ffm.handleNameConflicts('dir', 'name.png', 'increment');
    expect(final).toBe('name-2.png');
  });

  it('3.14 reuse conflict mode returns base unchanged', async () => {
    const { ffm } = makeFFM();
    const final = await ffm.handleNameConflicts('dir', 'name.png', 'reuse');
    expect(final).toBe('name.png');
  });

  it('3.15 skip rename patterns respected', () => {
    const { ffm } = makeFFM();
    const preset: FilenamePreset = { name: 'x', customTemplate: '{imagename}', skipRenamePatterns: '*.png,/^keep/', conflictResolution: 'increment' } as any;
    expect(ffm.shouldSkipRename('photo.png', preset)).toBe(true);
    expect(ffm.shouldSkipRename('keep-this.jpg', preset)).toBe(true);
    expect(ffm.shouldSkipRename('other.gif', preset)).toBe(false);
  });

  it('3.16 skip conversion patterns respected', () => {
    const { ffm } = makeFFM();
    const conv: ConversionPreset = { ...DEFAULT_SETTINGS.conversionPresets[0], skipConversionPatterns: 'r/\\.png$/' } as any;
    expect(ffm.shouldSkipConversion('image.png', conv)).toBe(true);
    expect(ffm.shouldSkipConversion('image.jpg', conv)).toBe(false);
  });
});