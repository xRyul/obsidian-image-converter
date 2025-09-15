import { describe, it, expect, beforeEach } from 'vitest';
import { FolderAndFilenameManagement } from '../../../src/FolderAndFilenameManagement';
import { VariableProcessor } from '../../../src/VariableProcessor';
import { SupportedImageFormats } from '../../../src/SupportedImageFormats';
import { DEFAULT_SETTINGS, type FolderPreset, type FilenamePreset, type ConversionPreset } from '../../../src/ImageConverterSettings';
import { fakeApp, fakeTFile, fakeVault } from '../../factories/obsidian';

function makeDeps(opts?: { attachmentFolderPath?: string }) {
  const vault = fakeVault({ attachmentFolderPath: opts?.attachmentFolderPath ?? 'attachments' });
  const app = fakeApp({ vault }) as any;
  const supported = new SupportedImageFormats(app);
  const settings = { ...DEFAULT_SETTINGS } as any;
  const vp = new VariableProcessor(app, settings);
  const ffm = new FolderAndFilenameManagement(app, settings, supported, vp);
  return { app, supported, settings, vp, ffm };
}

function installMomentStub() {
  (globalThis as any).moment = ((input?: any) => {
    const api: any = {
      format: (fmt: string) => '2025-01-02',
      add: () => api,
      subtract: () => api,
      startOf: () => api,
      endOf: () => api,
      daysInMonth: () => 31,
      week: () => 1,
      quarter: () => 1,
      calendar: () => '2025-01-02 12:00',
      fromNow: () => 'in a few seconds'
    };
    return api;
  }) as any;
}

describe('FolderAndFilenameManagement destination resolution', () => {
  let active: any;
  beforeEach(() => {
    installMomentStub();
    active = fakeTFile({ path: 'Notes/Topic/Active.md', name: 'Active.md', basename: 'Active', parent: { path: 'Notes/Topic', name: 'Topic', parent: { path: 'Notes', name: 'Notes', parent: { path: '/', name: '/', parent: null, children: [] } as any, children: [] } as any, children: [] } as any });
  });

  it('3.1 DEFAULT uses attachmentFolderPath; resolves relative ./ under active note parent', async () => {
    const { ffm } = makeDeps({ attachmentFolderPath: './assets' });
const file = new File([new Uint8Array([1])], 'img.png', { type: 'image/png' });
    const conv: ConversionPreset = { ...DEFAULT_SETTINGS.conversionPresets[0] } as any;
    const fname: FilenamePreset = { name: 'Custom', customTemplate: '{imagename}', skipRenamePatterns: '', conflictResolution: 'increment' };
    const folder: FolderPreset = { type: 'DEFAULT', name: 'Default' };
    const res = await ffm.determineDestination(file, active as any, conv, fname, folder);
    expect(res.destinationPath).toBe('Notes/Topic/assets');
  });

  it('3.2 ROOT resolves to vault root path', async () => {
    const { ffm } = makeDeps();
    const file = new File([new Uint8Array([1])], 'img.png', { type: 'image/png' });
    const conv: ConversionPreset = { ...DEFAULT_SETTINGS.conversionPresets[0] } as any;
    const fname: FilenamePreset = { name: 'Custom', customTemplate: '{imagename}', skipRenamePatterns: '', conflictResolution: 'increment' };
    const folder: FolderPreset = { type: 'ROOT', name: 'Root' };
    const res = await ffm.determineDestination(file, active as any, conv, fname, folder);
    expect(res.destinationPath).toBe('/');
  });

  it('3.3 CURRENT resolves to active note parent', async () => {
    const { ffm } = makeDeps();
    const file = new File([new Uint8Array([1])], 'img.png', { type: 'image/png' });
    const conv: ConversionPreset = { ...DEFAULT_SETTINGS.conversionPresets[0] } as any;
    const fname: FilenamePreset = { name: 'Custom', customTemplate: '{imagename}', skipRenamePatterns: '', conflictResolution: 'increment' };
    const folder: FolderPreset = { type: 'CURRENT', name: 'Current' };
    const res = await ffm.determineDestination(file, active as any, conv, fname, folder);
    expect(res.destinationPath).toBe('Notes/Topic');
  });

  it('3.4 SUBFOLDER processes template, sanitizes segments, and joins under active parent', async () => {
    const { ffm, settings } = makeDeps();
    settings.subfolderTemplate = '{notename}/pics:*?';
    const file = new File([new Uint8Array([1])], 'img.png', { type: 'image/png' });
    const conv: ConversionPreset = { ...DEFAULT_SETTINGS.conversionPresets[0] } as any;
    const fname: FilenamePreset = { name: 'Custom', customTemplate: '{imagename}', skipRenamePatterns: '', conflictResolution: 'increment' };
    const folder: FolderPreset = { type: 'SUBFOLDER', name: 'Sub' };
    const res = await ffm.determineDestination(file, active as any, conv, fname, folder);
    // Invalid characters :*? mapped to underscores and preserved (no collapsing)
    expect(res.destinationPath).toBe('Notes/Topic/Active/pics___');
  });

  it('3.5 CUSTOM without template falls back to default attachment folder', async () => {
    const { ffm } = makeDeps({ attachmentFolderPath: 'attachments' });
    const file = new File([new Uint8Array([1])], 'img.png', { type: 'image/png' });
    const conv: ConversionPreset = { ...DEFAULT_SETTINGS.conversionPresets[0] } as any;
    const fname: FilenamePreset = { name: 'Custom', customTemplate: '{imagename}', skipRenamePatterns: '', conflictResolution: 'increment' };
    const folder: FolderPreset = { type: 'CUSTOM', name: 'Custom (missing)' };
    const res = await ffm.determineDestination(file, active as any, conv, fname, folder);
    expect(res.destinationPath).toBe('attachments');
  });

  it('3.12 combinePath normalizes and handles root base', () => {
    const { ffm } = makeDeps();
    expect(ffm.combinePath('/', 'file.png')).toBe('/file.png');
    expect(ffm.combinePath('Folder', 'file.png')).toBe('Folder/file.png');
  });
});