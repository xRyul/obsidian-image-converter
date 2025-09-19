import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VariableProcessor } from '../../../src/VariableProcessor';
import { DEFAULT_SETTINGS } from '../../../src/ImageConverterSettings';
import { fakeApp, fakeTFile, fakeVault } from '../../factories/obsidian';

// Helper: Minimal moment stub for deterministic formatting (used by core variables suite)
function makeMomentStub(baseDate: Date) {
  const pad2 = (num: number) => num.toString().padStart(2, '0');
  const fmt = (dt: Date, format: string) => {
    switch (format) {
      case 'YYYY': return dt.getUTCFullYear().toString();
      case 'MM': return pad2(dt.getUTCMonth() + 1);
      case 'DD': return pad2(dt.getUTCDate());
      case 'HH': return pad2(dt.getUTCHours());
      case 'mm': return pad2(dt.getUTCMinutes());
      case 'ss': return pad2(dt.getUTCSeconds());
      case 'YYYY-MM-DD': return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
      case 'dddd': return ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][dt.getUTCDay()];
      case 'MMMM': return ['January','February','March','April','May','June','July','August','September','October','November','December'][dt.getUTCMonth()];
      case 'Do': return `${dt.getUTCDate()}${([undefined,'st','nd','rd'] as any)[(dt.getUTCDate()%10)] || 'th'}`;
      case 'w': return '1';
      case 'Q': return Math.floor((dt.getUTCMonth())/3 + 1).toString();
      case 'YYYY/MM': return `${dt.getUTCFullYear()}/${pad2(dt.getUTCMonth() + 1)}`;
      case 'HH-mm-ss': return `${pad2(dt.getUTCHours())}-${pad2(dt.getUTCMinutes())}-${pad2(dt.getUTCSeconds())}`;
      default: return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
    }
  };
  const api = (input?: any) => {
    const date = input ? new Date(input) : new Date(baseDate);
    return {
      format: (formatStr: string) => fmt(date, formatStr),
      add: (num: number, unit: string) => {
        const d2 = new Date(date);
        if (unit.startsWith('day')) d2.setUTCDate(d2.getUTCDate() + num);
        if (unit.startsWith('week')) d2.setUTCDate(d2.getUTCDate() + num*7);
        if (unit.startsWith('month')) d2.setUTCMonth(d2.getUTCMonth() + num);
        return api(d2);
      },
      subtract: (num: number, unit: string) => api(date).add(-num, unit),
      startOf: (unit: string) => {
        const d2 = new Date(date);
        if (unit === 'week') {
          const day = d2.getUTCDay(); // Sunday=0
          d2.setUTCDate(d2.getUTCDate() - day);
          d2.setUTCHours(0,0,0,0);
        }
        if (unit === 'month') {
          d2.setUTCDate(1); d2.setUTCHours(0,0,0,0);
        }
        return api(d2);
      },
      endOf: (unit: string) => {
        const d2 = new Date(date);
        if (unit === 'week') {
          const day = d2.getUTCDay();
          d2.setUTCDate(d2.getUTCDate() + (6 - day));
          d2.setUTCHours(23,59,59,999);
        }
        if (unit === 'month') {
          d2.setUTCMonth(d2.getUTCMonth() + 1, 0); d2.setUTCHours(23,59,59,999);
        }
        return api(d2);
      },
      week: () => 1,
      quarter: () => Math.floor((date.getUTCMonth())/3 + 1),
      daysInMonth: () => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth()+1, 0)).getUTCDate(),
      calendar: () => `${fmt(date,'YYYY-MM-DD')} ${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())}`,
      fromNow: () => 'in a few seconds'
    } as any;
  };
  return api;
}

// Helper: Simple moment stub installer (used by hashes/random/uuid suite)
function installMomentStub() {
  (globalThis as any).moment = ((input?: any) => {
    const api: any = {
      format: (formatStr: string) => '2025-01-02',
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

// Helper: Moment stub with controllable base time (used by time/counters suite)
function setMoment(date: Date) {
  const pad2 = (num: number) => num.toString().padStart(2, '0');
  (globalThis as any).moment = ((input?: any) => {
    const base = input ? new Date(input) : new Date(date);
    return {
      format: (fmt: string) => {
        switch (fmt) {
          case 'YYYY-MM-DD': return `${base.getUTCFullYear()}-${pad2(base.getUTCMonth()+1)}-${pad2(base.getUTCDate())}`;
          case 'HH-mm-ss': return `${pad2(base.getUTCHours())}-${pad2(base.getUTCMinutes())}-${pad2(base.getUTCSeconds())}`;
          case 'YYYY': return base.getUTCFullYear().toString();
          case 'MM': return pad2(base.getUTCMonth()+1);
          case 'DD': return pad2(base.getUTCDate());
          case 'dddd': return ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][base.getUTCDay()];
          case 'MMMM': return ['January','February','March','April','May','June','July','August','September','October','November','December'][base.getUTCMonth()];
          default: return `${base.getUTCFullYear()}-${pad2(base.getUTCMonth()+1)}-${pad2(base.getUTCDate())}`;
        }
      },
      add: (num: number, unit: string) => {
        const nd = new Date(base);
        if (unit.startsWith('day')) nd.setUTCDate(nd.getUTCDate()+num);
        if (unit.startsWith('week')) nd.setUTCDate(nd.getUTCDate()+7*num);
        if (unit.startsWith('month')) nd.setUTCMonth(nd.getUTCMonth()+num);
        return (globalThis as any).moment(nd);
      },
      subtract: (num: number, unit: string) => (globalThis as any).moment(base).add(-num, unit),
      startOf: (unit: string) => {
        const nd = new Date(base);
        if (unit==='week') { const day = nd.getUTCDay(); nd.setUTCDate(nd.getUTCDate()-day); nd.setUTCHours(0,0,0,0);} 
        if (unit==='month') { nd.setUTCDate(1); nd.setUTCHours(0,0,0,0);} 
        return (globalThis as any).moment(nd);
      },
      endOf: (unit: string) => {
        const nd = new Date(base);
        if (unit==='week') { const day = nd.getUTCDay(); nd.setUTCDate(nd.getUTCDate() + (6-day)); nd.setUTCHours(23,59,59,999);} 
        if (unit==='month') { nd.setUTCMonth(nd.getUTCMonth()+1, 0); nd.setUTCHours(23,59,59,999);} 
        return (globalThis as any).moment(nd);
      },
      daysInMonth: () => new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth()+1, 0)).getUTCDate(),
      week: () => 1,
      quarter: () => Math.floor(base.getUTCMonth()/3)+1,
      calendar: () => `${base.getUTCFullYear()}-${pad2(base.getUTCMonth()+1)}-${pad2(base.getUTCDate())} ${pad2(base.getUTCHours())}:${pad2(base.getUTCMinutes())}`,
      fromNow: () => 'in a few seconds'
    };
  }) as any;
}

// Suite 1: core variables
describe('VariableProcessor core variables', () => {
  const fixedNow = new Date(Date.UTC(2025, 0, 2, 12, 34, 56)); // 2025-01-02T12:34:56Z
  let app: any;
  let processor: VariableProcessor;
  let activeNote: any;

  beforeEach(() => {
    (globalThis as any).moment = makeMomentStub(fixedNow);

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
    expect(out).toMatch(/^2025-01-02-\d{2}-\d{2}-\d{2}-2025-01-02$/); // time format is HH-mm-ss
  });

  it('2.10 date:FORMAT applies Moment format, invalid falls back to YYYY-MM-DD', async () => {
    const file = new File([new Uint8Array([1])], 'x.png', { type: 'image/png' });
    const outA = await processor.processTemplate('{date:YYYY/MM}', { file, activeFile: activeNote });
    expect(outA).toBe('2025/01');
    const outB = await processor.processTemplate('{date:INVALID}', { file, activeFile: activeNote });
    expect(outB).toMatch(/^2025-01-02$/);
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
    installMomentStub();
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
    expect(parts[2]).toMatch(/^[a-f0-9]{32}$/);
  });

  it('2.24 sha256: image content and types', async () => {
    const data = new Uint8Array([1,2,3,4]).buffer;
    const file = new File([data], 'img.jpg', { type: 'image/jpeg' });
    const out = await processor.processTemplate('{sha256:image:10}-{sha256:filename:10}', { file, activeFile: activeNote });
    const [hashA, hashB] = out.split('-');
    expect(hashA).toMatch(/^[a-f0-9]{10}$/);
    expect(hashB).toMatch(/^[a-f0-9]{10}$/);
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
});

// Suite 3: time and counters
describe('VariableProcessor time and counters', () => {
  let app: any; let processor: VariableProcessor; let activeNote: any;
  beforeEach(() => {
    setMoment(new Date(Date.UTC(2025, 0, 5, 8, 0, 0))); // Sun Jan 5, 2025 08:00:00Z
    const vault = fakeVault();
    activeNote = fakeTFile({ path: 'A/B/Active.md', name: 'Active.md', basename: 'Active' });
    app = fakeApp({ vault }) as any;
    processor = new VariableProcessor(app, { ...DEFAULT_SETTINGS } as any);
  });

  it('2.9 date and 2.11 time', async () => {
    const file = new File([new Uint8Array([1])], 'f.png', { type: 'image/png' });
    const out = await processor.processTemplate('{date} {time}', { file, activeFile: activeNote });
    expect(out).toMatch(/^2025-01-05 08-00-00$/);
  });

  it('2.29 startofweek and 2.30 endofweek (Sunday-based)', async () => {
    const file = new File([new Uint8Array([1])], 'f.png', { type: 'image/png' });
    const out = await processor.processTemplate('{startofweek}|{endofweek}', { file, activeFile: activeNote });
    expect(out).toBe('2025-01-05|2025-01-11');
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
