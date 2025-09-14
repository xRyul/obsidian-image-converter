import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VariableProcessor } from '@/VariableProcessor';
import { DEFAULT_SETTINGS } from '@/ImageConverterSettings';
import { fakeApp, fakeTFile, fakeVault } from '../../factories/obsidian';
import { setupFakeTimers } from '@helpers/test-setup';

// Minimal moment stub for deterministic formatting
function makeMomentStub(baseDate: Date) {
  const pad2 = (n: number) => n.toString().padStart(2, '0');
  const fmt = (d: Date, format: string) => {
    switch (format) {
      case 'YYYY': return d.getUTCFullYear().toString();
      case 'MM': return pad2(d.getUTCMonth() + 1);
      case 'DD': return pad2(d.getUTCDate());
      case 'HH': return pad2(d.getUTCHours());
      case 'mm': return pad2(d.getUTCMinutes());
      case 'ss': return pad2(d.getUTCSeconds());
      case 'YYYY-MM-DD': return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
      case 'dddd': return ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][d.getUTCDay()];
      case 'MMMM': return ['January','February','March','April','May','June','July','August','September','October','November','December'][d.getUTCMonth()];
      case 'Do': return `${d.getUTCDate()}${([,'st','nd','rd'] as any)[(d.getUTCDate()%10)] || 'th'}`;
      case 'w': return '1';
      case 'Q': return Math.floor((d.getUTCMonth())/3 + 1).toString();
      case 'YYYY/MM': return `${d.getUTCFullYear()}/${pad2(d.getUTCMonth() + 1)}`;
      case 'HH-mm-ss': return `${pad2(d.getUTCHours())}-${pad2(d.getUTCMinutes())}-${pad2(d.getUTCSeconds())}`;
      default: return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
    }
  };
  const api = (input?: any) => {
    const date = input ? new Date(input) : new Date(baseDate);
    return {
      format: (f: string) => fmt(date, f),
      add: (n: number, unit: string) => {
        const d2 = new Date(date);
        if (unit.startsWith('day')) d2.setUTCDate(d2.getUTCDate() + n);
        if (unit.startsWith('week')) d2.setUTCDate(d2.getUTCDate() + n*7);
        if (unit.startsWith('month')) d2.setUTCMonth(d2.getUTCMonth() + n);
        return api(d2);
      },
      subtract: (n: number, unit: string) => api(date).add(-n, unit),
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
    const f = new File([1], 'x.png', { type: 'image/png' });
    const out = await processor.processTemplate('{notename}-{notename_nospaces}', { file: f, activeFile: activeNote });
    expect(out).toBe('Active Note-Active_Note');
  });

  it('2.9–2.12 date/time/parts are based on frozen time', async () => {
    const f = new File([1], 'x.png', { type: 'image/png' });
    const out = await processor.processTemplate('{date}-{time}-{YYYY}-{MM}-{DD}', { file: f, activeFile: activeNote });
    expect(out).toMatch(/^2025-01-02-\d{2}-\d{2}-\d{2}-2025-01-02$/); // time format is HH-mm-ss
  });

  it('2.10 date:FORMAT applies Moment format, invalid falls back to YYYY-MM-DD', async () => {
    const f = new File([1], 'x.png', { type: 'image/png' });
    const a = await processor.processTemplate('{date:YYYY/MM}', { file: f, activeFile: activeNote });
    expect(a).toBe('2025/01');
    const b = await processor.processTemplate('{date:INVALID}', { file: f, activeFile: activeNote });
    expect(b).toMatch(/^2025-01-02$/);
  });

  it('2.41 unknown variables left unchanged; 2.42 empty template -> empty string; 2.43 malformed tokens unchanged', async () => {
    const f = new File([1], 'x.png', { type: 'image/png' });
    const a = await processor.processTemplate('prefix {unknown} suffix', { file: f, activeFile: activeNote });
    expect(a).toBe('prefix {unknown} suffix');
    const b = await processor.processTemplate('', { file: f, activeFile: activeNote });
    expect(b).toBe('');
    const c = await processor.processTemplate('{date:YYYY-MM', { file: f, activeFile: activeNote });
    expect(c).toBe('{date:YYYY-MM');
  });
});