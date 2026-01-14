import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'crypto';
import moment from 'moment';
import 'moment/locale/en-gb';
import { FileSystemAdapter } from 'obsidian';
import { VariableProcessor } from '../../../src/VariableProcessor';
import { DEFAULT_SETTINGS } from '../../../src/ImageConverterSettings';
import { fakeApp, fakeTFile, fakeVault } from '../../factories/obsidian';

// Suite 1: core variables
describe('VariableProcessor core variables', () => {
  // Use local time (not UTC) because VariableProcessor uses `moment()` (local) rather than `moment.utc()`.
  // Setting a local time here keeps formatted outputs consistent across timezones.
  const fixedNow = new Date(2025, 0, 2, 12, 34, 56); // Jan 2, 2025 12:34:56 (local time)
  let app: any;
  let processor: VariableProcessor;
  let activeNote: any;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(fixedNow);

    const vault = fakeVault({ attachmentFolderPath: 'attachments' });
    activeNote = fakeTFile({ path: 'Notes/Active Note.md', name: 'Active Note.md', basename: 'Active Note' });
    app = fakeApp({ vault }) as any;
    app.workspace.getActiveFile = vi.fn(() => activeNote);

    const settings = { ...DEFAULT_SETTINGS };
    processor = new VariableProcessor(app, settings as any);

    // Deterministic random/uuid
    vi.spyOn(Math, 'random').mockReturnValue(0.123456789);
    if (globalThis.crypto && 'randomUUID' in globalThis.crypto) {
      vi.spyOn(globalThis.crypto as any, 'randomUUID').mockReturnValue('00000000-0000-4000-8000-000000000000');
    }
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('2.1–2.2 imagename and filetype from File input', async () => {
    const file = new File([new Uint8Array(10)], 'photo.JPEG', { type: 'image/jpeg' });
    const out = await processor.processTemplate('{imagename}.{filetype}', { file, activeFile: activeNote });
    expect(out).toBe('photo.JPEG');
  });

  it('2.3 sizeb from File input', async () => {
    const file = new File([new Uint8Array(1024)], 'a.png', { type: 'image/png' });
    const out = await processor.processTemplate('{sizeb}', { file, activeFile: activeNote });
    expect(out).toBe('1024');
  });

  it('2.4–2.6 sizeb/sizekb/sizemb with TFile stat; unknown when stat unavailable', async () => {
    const tfile = fakeTFile({ path: 'img/pic.png', name: 'pic.png', extension: 'png', stat: { mtime: Date.now(), ctime: Date.now(), size: 2048 } });
    // Mock adapter.stat to return known value for this TFile
    (app.vault.adapter.stat as any).mockResolvedValue({ mtime: Date.now(), ctime: Date.now(), size: 2048 });
    const out1 = await processor.processTemplate('{sizeb}-{sizekb}-{sizemb}', { file: tfile as any, activeFile: activeNote });
    expect(out1).toBe('2048-2.00-0.00');

    // Stat unavailable -> unknown
    (app.vault.adapter.stat as any).mockResolvedValueOnce(null);
    const out2 = await processor.processTemplate('{sizeb}|{sizekb}|{sizemb}', { file: tfile as any, activeFile: activeNote });
    expect(out2).toBe('unknown|unknown|unknown');
  });

  it('2.7–2.8 notename and notename_nospaces', async () => {
    const file = new File([new Uint8Array([1])], 'x.png', { type: 'image/png' });
    const out = await processor.processTemplate('{notename}-{notename_nospaces}', { file, activeFile: activeNote });
    expect(out).toBe('Active Note-Active_Note');
  });
  
  it('2.9–2.12 date/time/parts are based on frozen time', async () => {
    const file = new File([new Uint8Array([1])], 'x.png', { type: 'image/png' });
    const out = await processor.processTemplate('{date}-{time}-{YYYY}-{MM}-{DD}', { file, activeFile: activeNote });

    expect(out).toBe('2025-01-02-12-34-56-2025-01-02');
  });

  it('2.10 date:FORMAT applies custom Moment format strings', async () => {
    const file = new File([new Uint8Array([1])], 'x.png', { type: 'image/png' });

    const outA = await processor.processTemplate('{date:YYYY/MM}', { file, activeFile: activeNote });
    expect(outA).toBe('2025/01');

    const outB = await processor.processTemplate('{date:[Year]-YYYY}', { file, activeFile: activeNote });
    expect(outB).toBe('Year-2025');
  });

  it('2.41 unknown variables left unchanged; 2.42 empty template -> empty string; 2.43 malformed tokens unchanged', async () => {
    const file = new File([new Uint8Array([1])], 'x.png', { type: 'image/png' });
    const strA = await processor.processTemplate('prefix {unknown} suffix', { file, activeFile: activeNote });
    expect(strA).toBe('prefix {unknown} suffix');
    const strB = await processor.processTemplate('', { file, activeFile: activeNote });
    expect(strB).toBe('');
    const strC = await processor.processTemplate('{date:YYYY-MM', { file, activeFile: activeNote });
    expect(strC).toBe('{date:YYYY-MM');
  });
});

// Suite 2: hashes, random, uuid
describe('VariableProcessor hashes, random, and uuid', () => {
  let app: any;
  let processor: VariableProcessor;
  let activeNote: any;

  beforeEach(() => {
    const vault = fakeVault({ attachmentFolderPath: 'attachments' });
    activeNote = fakeTFile({ path: 'Folder/Sub/Active.md', name: 'Active.md', basename: 'Active', parent: { path: 'Folder/Sub', name: 'Sub', parent: { path: 'Folder', name: 'Folder', parent: { path: '/', name: '/', parent: null, children: [] } as any, children: [] } as any, children: [] } as any });
    app = fakeApp({ vault }) as any;
    const settings = { ...DEFAULT_SETTINGS };
    processor = new VariableProcessor(app, settings as any);

    // Deterministic UUID and random
    if (globalThis.crypto && 'randomUUID' in globalThis.crypto) {
      vi.spyOn(globalThis.crypto as any, 'randomUUID').mockReturnValue('00000000-0000-4000-8000-000000000000');
    }
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
  });

  it('2.23 MD5 hashing of filename and truncation', async () => {
    const file = new File([new Uint8Array([1,2,3])], 'example.png', { type: 'image/png' });
    const out = await processor.processTemplate('{MD5:filename:8}', { file, activeFile: activeNote });
    expect(out).toMatch(/^[a-f0-9]{8}$/);
  });

  it('2.23 MD5 of notename/notepath and custom text', async () => {
    const file = new File([new Uint8Array([1,2,3])], 'ex.png', { type: 'image/png' });
    const out = await processor.processTemplate('{MD5:notename}-{MD5:notepath:6}-{MD5:custom-text}', { file, activeFile: activeNote });
    const parts = out.split('-');
    expect(parts[0]).toMatch(/^[a-f0-9]{32}$/);
    expect(parts[1]).toMatch(/^[a-f0-9]{6}$/);

    // Verify MD5 implementation matches a known-good reference.
    const expectedCustom = createHash('md5').update('custom-text').digest('hex');
    expect(parts[2]).toBe(expectedCustom);
  });

  it('2.24 sha256: image content and types', async () => {
    const data = new Uint8Array([1,2,3,4]).buffer;
    const file = new File([data], 'img.jpg', { type: 'image/jpeg' });
    const out = await processor.processTemplate('{sha256:image:10}-{sha256:filename:10}', { file, activeFile: activeNote });
    const [hashA, hashB] = out.split('-');
    expect(hashA).toMatch(/^[a-f0-9]{10}$/);
    expect(hashB).toMatch(/^[a-f0-9]{10}$/);
  });

  it('2.45 MD5 supports mixed-case type tokens and preserves token casing for replacement', async () => {
    const file = new File([new Uint8Array([1, 2, 3])], 'Example.PNG', { type: 'image/png' });
    const out = await processor.processTemplate('{MD5:FileName:8}', { file, activeFile: activeNote });

    const expected = createHash('md5').update('Example').digest('hex').substring(0, 8);
    expect(out).toBe(expected);
  });

  it('2.46 sha256 supports mixed-case type tokens and preserves token casing for replacement', async () => {
    const file = new File([new Uint8Array([1, 2, 3])], 'Example.PNG', { type: 'image/png' });
    const out = await processor.processTemplate('{sha256:FileName:10}', { file, activeFile: activeNote });

    const expected = createHash('sha256').update('Example').digest('hex').substring(0, 10);
    expect(out).toBe(expected);
  });

  it('2.47 MD5 fullpath hashes TFile.path when file is a vault TFile', async () => {
    const tfile = fakeTFile({
      path: 'Images/Sub/pic.png',
      name: 'pic.png',
      extension: 'png',
      basename: 'pic',
      stat: { mtime: Date.now(), ctime: Date.now(), size: 1 },
    });

    // Ensure stat() exists for TFile flows (file size variables are always populated)
    (app.vault.adapter.stat as any).mockResolvedValue({ mtime: Date.now(), ctime: Date.now(), size: 1 });

    const out = await processor.processTemplate('{MD5:fullpath:8}', { file: tfile as any, activeFile: activeNote });
    const expected = createHash('md5').update('Images/Sub/pic.png').digest('hex').substring(0, 8);
    expect(out).toBe(expected);
  });

  it('2.48 HEIC/TIFF metadata extraction is skipped (no throw; unresolved width/height remain)', async () => {
    const heicFile = new File([new Uint8Array([1])], 'x.heic', { type: 'image/heic' });
    const outFile = await processor.processTemplate('{width}|{height}', { file: heicFile, activeFile: activeNote });
    expect(outFile).toBe('{width}|{height}');

    const tiffFile = new File([new Uint8Array([1])], 'x.tiff', { type: 'image/tiff' });
    const outTiff = await processor.processTemplate('{width}|{height}', { file: tiffFile, activeFile: activeNote });
    expect(outTiff).toBe('{width}|{height}');

    const heicTFile = fakeTFile({ path: 'img/x.heic', name: 'x.heic', extension: 'heic', basename: 'x', stat: { mtime: Date.now(), ctime: Date.now(), size: 1 } });
    (app.vault.adapter.stat as any).mockResolvedValue({ mtime: Date.now(), ctime: Date.now(), size: 1 });
    const outHeicTFile = await processor.processTemplate('{width}|{height}', { file: heicTFile as any, activeFile: activeNote });
    expect(outHeicTFile).toBe('{width}|{height}');
  });

  it('2.25 uuid returns RFC 4122 string', async () => {
    const file = new File([new Uint8Array([1])], 'x.png', { type: 'image/png' });
    const out = await processor.processTemplate('{uuid}', { file, activeFile: activeNote });
    expect(out).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('2.26 random is 6-char alphanumeric', async () => {
    const file = new File([new Uint8Array([1])], 'x.png', { type: 'image/png' });
    const out = await processor.processTemplate('{random}', { file, activeFile: activeNote });
    expect(out).toMatch(/^[a-z0-9]{1,6}$/);
  });

  it('2.49 vaultpath uses FileSystemAdapter.getBasePath when available; falls back to vault root path otherwise', async () => {
    const file = new File([new Uint8Array([1])], 'x.png', { type: 'image/png' });

    // Desktop-like adapter
    app.vault.adapter = new FileSystemAdapter('C:/Vault');
    const outFs = await processor.processTemplate('{vaultpath}', { file, activeFile: activeNote });
    expect(outFs).toBe('C:/Vault');

    // Non-filesystem adapter fallback
    app.vault.adapter = {} as any;
    app.vault.getRoot = () => ({ path: '/VAULTROOT' }) as any;
    const outFallback = await processor.processTemplate('{vaultpath}', { file, activeFile: activeNote });
    expect(outFallback).toBe('/VAULTROOT');
  });
});

// Suite 3: time and counters
describe('VariableProcessor time and counters', () => {
  let app: any; let processor: VariableProcessor; let activeNote: any;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2025, 0, 5, 8, 0, 0)); // Jan 5, 2025 08:00:00 (local time)

    const vault = fakeVault();
    activeNote = fakeTFile({ path: 'A/B/Active.md', name: 'Active.md', basename: 'Active' });
    app = fakeApp({ vault }) as any;
    processor = new VariableProcessor(app, { ...DEFAULT_SETTINGS } as any);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('2.9 date and 2.11 time', async () => {
    const file = new File([new Uint8Array([1])], 'f.png', { type: 'image/png' });
    const out = await processor.processTemplate('{date} {time}', { file, activeFile: activeNote });

    expect(out).toBe('2025-01-05 08-00-00');
  });

  it('2.29 startofweek and 2.30 endofweek are locale-dependent', async () => {
    const file = new File([new Uint8Array([1])], 'f.png', { type: 'image/png' });
    const ctx = { file, activeFile: activeNote };

    const previousLocale = moment.locale();

    try {
      // en: Sunday as start of week
      moment.locale('en');
      const outEn = await processor.processTemplate('{startofweek}|{endofweek}', ctx);
      expect(outEn).toBe('2025-01-05|2025-01-11');

      // en-gb: Monday as start of week
      moment.locale('en-gb');
      const outGb = await processor.processTemplate('{startofweek}|{endofweek}', ctx);
      expect(outGb).toBe('2024-12-30|2025-01-05');
    } finally {
      moment.locale(previousLocale);
    }
  });

  it('2.33 nextweek and 2.34 lastweek', async () => {
    const file = new File([new Uint8Array([1])], 'f.png', { type: 'image/png' });
    const out = await processor.processTemplate('{nextweek}|{lastweek}', { file, activeFile: activeNote });

    expect(out).toBe('2025-01-12|2024-12-29');
  });

  it('2.40 counter increments per folder and is zero-padded', async () => {
    const file = new File([new Uint8Array([1])], 'f.png', { type: 'image/png' });
    const ctx = { file, activeFile: activeNote };
    const first = await processor.processTemplate('{counter:000}', ctx);
    const second = await processor.processTemplate('{counter:000}', ctx);
    expect(first).toBe('001');
    expect(second).toBe('002');
  });
});

// Suite 4: validation
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
