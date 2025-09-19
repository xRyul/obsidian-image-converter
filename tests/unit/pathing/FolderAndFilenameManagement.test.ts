import { describe, it, expect, beforeEach } from 'vitest';
import { FileSystemAdapter } from 'obsidian';
import { FolderAndFilenameManagement } from '../../../src/FolderAndFilenameManagement';
import { VariableProcessor } from '../../../src/VariableProcessor';
import { SupportedImageFormats } from '../../../src/SupportedImageFormats';
import { DEFAULT_SETTINGS, type FolderPreset, type FilenamePreset, type ConversionPreset } from '../../../src/ImageConverterSettings';
import { fakeApp, fakeVault, fakeTFile, fakeTFolder } from '../../factories/obsidian';

// Consolidated suite bringing together destination, conflicts, sanitization, validation,
// getImagePath, and ensureFolderExists case-sensitivity tests for FolderAndFilenameManagement.

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

// -------------------- Destination resolution helpers --------------------
function makeDepsDest(opts?: { attachmentFolderPath?: string }) {
  const vault = fakeVault({ attachmentFolderPath: opts?.attachmentFolderPath ?? 'attachments' });
  const app = fakeApp({ vault }) as any;
  const supported = new SupportedImageFormats(app);
  const settings = { ...DEFAULT_SETTINGS } as any;
  const vp = new VariableProcessor(app, settings);
  const ffm = new FolderAndFilenameManagement(app, settings, supported, vp);
  return { app, supported, settings, vp, ffm };
}

// -------------------- getImagePath helpers --------------------
function makeSutImagePath(opts?: { basePath?: string; withUnicode?: boolean }) {
  const basePath = opts?.basePath ?? 'C:/Vault';
  // Seed vault with files and folders
  const image = fakeTFile({ path: 'Assets/image with spaces.png', name: 'image with spaces.png', extension: 'png' });
  const unicode = fakeTFile({ path: 'Assets/中文-汉字-測試.png', name: '中文-汉字-測試.png', extension: 'png' });
  const files = [image].concat(opts?.withUnicode ? [unicode] : []);
  const vault = fakeVault({ files });
  const app = fakeApp({ vault }) as any;

  // Install a FileSystemAdapter to exercise getBasePath branch
  const adapter = new FileSystemAdapter();
  (adapter as any).getBasePath = () => basePath;
  (app.vault as any).adapter = adapter;

  const settings = { ...DEFAULT_SETTINGS } as any;
  const supported = new SupportedImageFormats(app);
  const vp = new VariableProcessor(app, settings);
  const ffm = new FolderAndFilenameManagement(app, settings, supported, vp);
  return { app, ffm, image, unicode };
}
function makeImg(src: string): HTMLImageElement {
  const img = document.createElement('img');
  img.setAttribute('src', src);
  return img;
}

// -------------------- Generic FFM helper --------------------
function makeFFMGeneric() {
  const app = fakeApp({ vault: fakeVault() }) as any;
  const supported = new SupportedImageFormats(app);
  const vp = new VariableProcessor(app, { ...DEFAULT_SETTINGS } as any);
  const ffm = new FolderAndFilenameManagement(app, { ...DEFAULT_SETTINGS } as any, supported, vp);
  return { app, ffm };
}

// -------------------- ensureFolderExists (case sensitivity) helpers --------------------
function makeFFMWithFoldersCase(folderPaths: string[]) {
  const folders = folderPaths.map((pathStr) => fakeTFolder({ path: pathStr }));
  const app = fakeApp({ vault: fakeVault({ folders }) }) as any;
  const supported = new SupportedImageFormats(app);
  const vp = new VariableProcessor(app, { ...DEFAULT_SETTINGS } as any);
  const ffm = new FolderAndFilenameManagement(app, { ...DEFAULT_SETTINGS } as any, supported, vp);
  return { app, ffm };
}

// -----------------------------------------------------------------------------
// 1) Destination resolution
// -----------------------------------------------------------------------------
describe('FolderAndFilenameManagement destination resolution', () => {
  let active: any;
  beforeEach(() => {
    installMomentStub();
    active = fakeTFile({ path: 'Notes/Topic/Active.md', name: 'Active.md', basename: 'Active', parent: { path: 'Notes/Topic', name: 'Topic', parent: { path: 'Notes', name: 'Notes', parent: { path: '/', name: '/', parent: null, children: [] } as any, children: [] } as any, children: [] } as any });
  });

  it('3.1 DEFAULT uses attachmentFolderPath; resolves relative ./ under active note parent', async () => {
    const { ffm } = makeDepsDest({ attachmentFolderPath: './assets' });
    const file = new File([new Uint8Array([1])], 'img.png', { type: 'image/png' });
    const conv: ConversionPreset = { ...DEFAULT_SETTINGS.conversionPresets[0] } as any;
    const fname: FilenamePreset = { name: 'Custom', customTemplate: '{imagename}', skipRenamePatterns: '', conflictResolution: 'increment' };
    const folder: FolderPreset = { type: 'DEFAULT', name: 'Default' };
    const res = await ffm.determineDestination(file, active as any, conv, fname, folder);
    expect(res.destinationPath).toBe('Notes/Topic/assets');
  });

  it('3.2 ROOT resolves to vault root path', async () => {
    const { ffm } = makeDepsDest();
    const file = new File([new Uint8Array([1])], 'img.png', { type: 'image/png' });
    const conv: ConversionPreset = { ...DEFAULT_SETTINGS.conversionPresets[0] } as any;
    const fname: FilenamePreset = { name: 'Custom', customTemplate: '{imagename}', skipRenamePatterns: '', conflictResolution: 'increment' };
    const folder: FolderPreset = { type: 'ROOT', name: 'Root' };
    const res = await ffm.determineDestination(file, active as any, conv, fname, folder);
    expect(res.destinationPath).toBe('/');
  });

  it('3.3 CURRENT resolves to active note parent', async () => {
    const { ffm } = makeDepsDest();
    const file = new File([new Uint8Array([1])], 'img.png', { type: 'image/png' });
    const conv: ConversionPreset = { ...DEFAULT_SETTINGS.conversionPresets[0] } as any;
    const fname: FilenamePreset = { name: 'Custom', customTemplate: '{imagename}', skipRenamePatterns: '', conflictResolution: 'increment' };
    const folder: FolderPreset = { type: 'CURRENT', name: 'Current' };
    const res = await ffm.determineDestination(file, active as any, conv, fname, folder);
    expect(res.destinationPath).toBe('Notes/Topic');
  });

  it('3.4 SUBFOLDER processes template, sanitizes segments, and joins under active parent', async () => {
    const { ffm, settings } = makeDepsDest();
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
    const { ffm } = makeDepsDest({ attachmentFolderPath: 'attachments' });
    const file = new File([new Uint8Array([1])], 'img.png', { type: 'image/png' });
    const conv: ConversionPreset = { ...DEFAULT_SETTINGS.conversionPresets[0] } as any;
    const fname: FilenamePreset = { name: 'Custom', customTemplate: '{imagename}', skipRenamePatterns: '', conflictResolution: 'increment' };
    const folder: FolderPreset = { type: 'CUSTOM', name: 'Custom (missing)' };
    const res = await ffm.determineDestination(file, active as any, conv, fname, folder);
    expect(res.destinationPath).toBe('attachments');
  });

  it('3.12 combinePath normalizes and handles root base', () => {
    const { ffm } = makeDepsDest();
    expect(ffm.combinePath('/', 'file.png')).toBe('/file.png');
    expect(ffm.combinePath('Folder', 'file.png')).toBe('Folder/file.png');
  });
});

// -----------------------------------------------------------------------------
// 2) Conflicts and rename/convert skip rules
// -----------------------------------------------------------------------------
describe('FolderAndFilenameManagement conflicts and rename/convert skip rules', () => {
  function makeFFMConflicts() {
    const app = fakeApp({ vault: fakeVault() }) as any;
    const supported = new SupportedImageFormats(app);
    const vp = new VariableProcessor(app, { ...DEFAULT_SETTINGS } as any);
    const ffm = new FolderAndFilenameManagement(app, { ...DEFAULT_SETTINGS } as any, supported, vp);
    return { app, ffm };
  }

  it('3.13 increment conflict resolution appends numeric suffix', async () => {
    const { app, ffm } = makeFFMConflicts();
    // Simulate existing file "dir/name.png" and then ask for conflict resolution
    (app.vault.adapter.exists as any).mockResolvedValueOnce(true); // name.png exists
    ;(app.vault.adapter.exists as any)
      .mockResolvedValueOnce(true)   // name-1.png exists
      .mockResolvedValueOnce(false); // name-2.png available

    const final = await ffm.handleNameConflicts('dir', 'name.png', 'increment');
    expect(final).toBe('name-2.png');
  });

  it('3.14 reuse conflict mode returns base unchanged', async () => {
    const { ffm } = makeFFMConflicts();
    const final = await ffm.handleNameConflicts('dir', 'name.png', 'reuse');
    expect(final).toBe('name.png');
  });

  it('3.15 skip rename patterns respected', () => {
    const { ffm } = makeFFMConflicts();
    const preset: FilenamePreset = { name: 'x', customTemplate: '{imagename}', skipRenamePatterns: '*.png,/^keep/', conflictResolution: 'increment' } as any;
    expect(ffm.shouldSkipRename('photo.png', preset)).toBe(true);
    expect(ffm.shouldSkipRename('keep-this.jpg', preset)).toBe(true);
    expect(ffm.shouldSkipRename('other.gif', preset)).toBe(false);
  });

  it('3.16 skip conversion patterns respected', () => {
    const { ffm } = makeFFMConflicts();
    const conv: ConversionPreset = { ...DEFAULT_SETTINGS.conversionPresets[0], skipConversionPatterns: 'r/\\.png$/' } as any;
    expect(ffm.shouldSkipConversion('image.png', conv)).toBe(true);
    expect(ffm.shouldSkipConversion('image.jpg', conv)).toBe(false);
  });
});

// -----------------------------------------------------------------------------
// 3) getImagePath resolution
// -----------------------------------------------------------------------------
describe('FolderAndFilenameManagement.getImagePath', () => {
  it('resolves direct vault path found via vault lookup', () => {
    const { ffm, image } = makeSutImagePath();
    const img = makeImg(image.path);
    expect(ffm.getImagePath(img)).toBe(image.path);
  });

  it('resolves app://local URIs with query to vault path', () => {
    const { ffm, image } = makeSutImagePath();
    const img = makeImg(`app://local/${encodeURIComponent(image.path)}?v=123`);
    expect(ffm.getImagePath(img)).toBe(image.path);
  });

  it('resolves absolute app:// OS path under basePath (Windows)', () => {
    const { ffm } = makeSutImagePath({ basePath: 'C:/Vault' });
    const img = makeImg('app://obsidian/C:/Vault/Assets/image%20with%20spaces.png');
    expect(ffm.getImagePath(img)).toBe('/Assets/image with spaces.png');
  });

  it('resolves relative path from active note', () => {
    const { app, ffm, image } = makeSutImagePath();
    // Active note in Notes/Note.md; relative ../Assets/...
    (app.workspace as any).getActiveFile = () => ({
      path: 'Notes/Note.md',
      parent: { path: 'Notes' }
    }) as any;
    const img = makeImg('../Assets/image with spaces.png');
    expect(ffm.getImagePath(img)).toBe(image.path);
  });

  it('handles Unicode filenames and percent-decoding', () => {
    const { ffm, unicode } = makeSutImagePath({ withUnicode: true });
    const encoded = encodeURIComponent(unicode.path);
    const img = makeImg(`app://local/${encoded}`);
    expect(ffm.getImagePath(img)).toBe(unicode.path);
  });

  it('returns null when path cannot be resolved', () => {
    const { ffm } = makeSutImagePath();
    const img = makeImg('missing.png');
    expect(ffm.getImagePath(img)).toBeNull();
  });

  it('does not throw for Windows-reserved link-only names and returns null', () => {
    const { ffm } = makeSutImagePath();
    const img = makeImg('CON.png');
    expect(ffm.getImagePath(img)).toBeNull();
  });
});

// -----------------------------------------------------------------------------
// 4) Sanitization and ensureFolderExists (creation path)
// -----------------------------------------------------------------------------
describe('FolderAndFilenameManagement sanitization and ensureFolderExists', () => {
  it('3.9 sanitizeFilename replaces invalids, handles reserved names, preserves trailing dots/underscores, truncates', () => {
    const { ffm } = makeFFMGeneric();
    expect(ffm.sanitizeFilename('  My/File\\Name??**.txt  ')).toBe('My_File_Name____.txt');
    expect(ffm.sanitizeFilename('CON')).toMatch(/^CON_?$/);
    // Leading dots removed; internal dots preserved; trailing dots removed by base sanitization then extension is appended back by caller if present.
    expect(ffm.sanitizeFilename('..hidden..file..')).toBe('hidden..file.');
    const long = `${'A'.repeat(300)}.txt`;
    const out = ffm.sanitizeFilename(long);
    expect(out.length).toBeLessThanOrEqual(250 + '.txt'.length);
  });

  it('3.21 combinePath behavior', () => {
    const { ffm } = makeFFMGeneric();
    expect(ffm.combinePath('/', 'name.png')).toBe('/name.png');
    expect(ffm.combinePath('base', 'name.png')).toBe('base/name.png');
  });

  it('3.6–3.7 ensureFolderExists creates missing nested paths', async () => {
    const { app, ffm } = makeFFMGeneric();
    await ffm.ensureFolderExists('alpha/beta/gamma');
    expect(app.vault.createFolder).toHaveBeenCalled();
  });
});

// -----------------------------------------------------------------------------
// 5) Sanitization corpus
// -----------------------------------------------------------------------------
describe('FolderAndFilenameManagement.sanitizeFilename — corpus coverage', () => {
  it.each([
    ['image with spaces.png', 'image with spaces.png'],
    [' image with spaces .png ', 'image with spaces.png'], // trims leading/trailing spaces on base
    ['brackets[123].png', 'brackets[123].png'],
    ['(parentheses) & friends!.png', '(parentheses) & friends!.png'],
    ["rock'n'roll.png", "rock'n'roll.png"],
    ['percent%25.png', 'percent%25.png'],
    ['dollar$-at@-caret^.png', 'dollar$-at@-caret^.png'],
    ['plus+equals=.png', 'plus+equals=.png'],
    ['backtick`.png', 'backtick`.png'],
    ['a:b.png', 'a_b.png'],
    ['a*b.png', 'a_b.png'],
    ['a?b.png', 'a_b.png'],
    ['quote".png', 'quote_.png'],
    ['a<b.png', 'a_b.png'],
    ['a>b.png', 'a_b.png'],
    ['a|b.png', 'a_b.png'],
    ['..hidden..file..', 'hidden..file.'],
    ['CON', 'CON_'],
    ['NUL.txt', 'NUL_.txt'],
    ['LPT9', 'LPT9_'],
    ['COM1.png', 'COM1_.png'],
    ['café.png', 'café.png'],
    ['cafe\u0301.png', 'cafe\u0301.png'], // NFD stays as-is
    ['😀-emoji.png', '😀-emoji.png'],
    ['family-👨‍👩‍👧‍👦.jpg', 'family-👨‍👩‍👧‍👦.jpg'],
    ['nb\u00A0space.png', 'nb\u00A0space.png'],
  ])('sanitizes %s -> %s', (_in, expected) => {
    const { ffm } = makeFFMGeneric();
    expect(ffm.sanitizeFilename(_in)).toBe(expected);
  });
});

// -----------------------------------------------------------------------------
// 6) Template validation
// -----------------------------------------------------------------------------
describe('FolderAndFilenameManagement.validateTemplates delegates to VariableProcessor and throws on invalid', () => {
  it('3.23 throws Error and shows Notice when validation fails', async () => {
    const app = fakeApp({ vault: fakeVault() }) as any;
    const supported = new SupportedImageFormats(app);
    const settings = { ...DEFAULT_SETTINGS } as any;
    const vp = new VariableProcessor(app, settings);
    const ffm = new FolderAndFilenameManagement(app, settings, supported, vp);

    const activeRoot = fakeTFile({ path: 'Root.md', name: 'Root.md', basename: 'Root', parent: { path: '/', name: '/', parent: null, children: [] } as any });
    const file = new File([new Uint8Array([1])], 'x.png', { type: 'image/png' });
    const fname: FilenamePreset = { name: 'Custom', customTemplate: '{imagename}', skipRenamePatterns: '', conflictResolution: 'increment' };
    const folder: FolderPreset = { type: 'CUSTOM', name: 'Custom', customTemplate: 'x/{grandparentfolder}' };

    await expect(ffm.determineDestination(file, activeRoot as any, settings.conversionPresets[0] as any, fname, folder)).rejects.toThrow(/validation failed/i);
  });
});

// -----------------------------------------------------------------------------
// 7) ensureFolderExists — case sensitivity and creation
// -----------------------------------------------------------------------------
describe('FolderAndFilenameManagement.ensureFolderExists — case sensitivity and creation', () => {
  it('reuses existing folder with different case and does not create a new one', async () => {
    const { app, ffm } = makeFFMWithFoldersCase(['images']);
    await ffm.ensureFolderExists('Images');
    // Should not attempt to create 'Images'
    expect(app.vault.createFolder).not.toHaveBeenCalledWith('Images');
  });

  it('creates multi-level folders when not present (parents first)', async () => {
    const { app, ffm } = makeFFMWithFoldersCase([]);
    await ffm.ensureFolderExists('New/Sub/Path');
    expect(app.vault.createFolder).toHaveBeenCalledWith('New');
    expect(app.vault.createFolder).toHaveBeenCalledWith('New/Sub');
    expect(app.vault.createFolder).toHaveBeenCalledWith('New/Sub/Path');
  });
});

// -----------------------------------------------------------------------------
// 8) Additional sanitization cases
// -----------------------------------------------------------------------------
describe('FolderAndFilenameManagement.sanitizeFilename additional cases', () => {
  it('allows brackets and parentheses', () => {
    const { ffm } = makeFFMGeneric();
    expect(ffm.sanitizeFilename('brackets[1](test).png')).toBe('brackets[1](test).png');
  });

  it('replaces Windows-invalid characters with underscore', () => {
    const { ffm } = makeFFMGeneric();
    expect(ffm.sanitizeFilename('a:b*c?d"e<f>g|.png')).toBe('a_b_c_d_e_f_g_.png');
  });

  it('appends underscore for Windows-reserved base names', () => {
    const { ffm } = makeFFMGeneric();
    expect(ffm.sanitizeFilename('CON.png')).toBe('CON_.png');
    expect(ffm.sanitizeFilename('LPT1.jpg')).toBe('LPT1_.jpg');
  });

  it('trims leading/trailing spaces and dots from base', () => {
    const { ffm } = makeFFMGeneric();
    expect(ffm.sanitizeFilename('  file.png  ')).toBe('file.png');
    expect(ffm.sanitizeFilename('.hiddenfile.png')).toBe('hiddenfile.png');
    expect(ffm.sanitizeFilename('file..png')).toBe('file.png'); // trailing dots in base are trimmed, resulting in file.png
  });

  it('preserves internal multiple spaces and Unicode', () => {
    const { ffm } = makeFFMGeneric();
    expect(ffm.sanitizeFilename('many   spaces   inside.jpg')).toBe('many   spaces   inside.jpg');
    expect(ffm.sanitizeFilename('café.png')).toBe('café.png');
    expect(ffm.sanitizeFilename('中文-汉字-測試.png')).toBe('中文-汉字-測試.png');
    expect(ffm.sanitizeFilename('family-👨‍👩‍👧‍👦.jpg')).toBe('family-👨‍👩‍👧‍👦.jpg');
  });

  it('keeps non-breaking space U+00A0', () => {
    const { ffm } = makeFFMGeneric();
    expect(ffm.sanitizeFilename('nb\u00A0space.png')).toBe('nb\u00A0space.png');
  });
});
