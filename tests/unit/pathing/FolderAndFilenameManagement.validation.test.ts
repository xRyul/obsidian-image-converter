import { describe, it, expect } from 'vitest';
import { FolderAndFilenameManagement } from '@/FolderAndFilenameManagement';
import { VariableProcessor } from '@/VariableProcessor';
import { SupportedImageFormats } from '@/SupportedImageFormats';
import { DEFAULT_SETTINGS, type FolderPreset, type FilenamePreset } from '@/ImageConverterSettings';
import { fakeApp, fakeVault, fakeTFile } from '../../factories/obsidian';

describe('FolderAndFilenameManagement.validateTemplates delegates to VariableProcessor and throws on invalid', () => {
  it('3.23 throws Error and shows Notice when validation fails', async () => {
    const app = fakeApp({ vault: fakeVault() }) as any;
    const supported = new SupportedImageFormats(app);
    const settings = { ...DEFAULT_SETTINGS } as any;
    const vp = new VariableProcessor(app, settings);
    const ffm = new FolderAndFilenameManagement(app, settings, supported, vp);

    const activeRoot = fakeTFile({ path: 'Root.md', name: 'Root.md', basename: 'Root', parent: { path: '/', name: '/', parent: null, children: [] } as any });
    const file = new File([1], 'x.png', { type: 'image/png' });
    const fname: FilenamePreset = { name: 'Custom', customTemplate: '{imagename}', skipRenamePatterns: '', conflictResolution: 'increment' };
    const folder: FolderPreset = { type: 'CUSTOM', name: 'Custom', customTemplate: 'x/{grandparentfolder}' };

    await expect(ffm.determineDestination(file, activeRoot as any, settings.conversionPresets[0] as any, fname, folder)).rejects.toThrow(/validation failed/i);
  });
});