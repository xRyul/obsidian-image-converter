import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VariableProcessor } from '@/VariableProcessor';
import { DEFAULT_SETTINGS } from '@/ImageConverterSettings';
import { fakeApp, fakeTFile, fakeVault } from '../../factories/obsidian';

function setMoment(date: Date) {
  const pad2 = (n: number) => n.toString().padStart(2, '0');
  (globalThis as any).moment = ((input?: any) => {
    const d = input ? new Date(input) : new Date(date);
    return {
      format: (f: string) => {
        switch (f) {
          case 'YYYY-MM-DD': return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth()+1)}-${pad2(d.getUTCDate())}`;
          case 'HH-mm-ss': return `${pad2(d.getUTCHours())}-${pad2(d.getUTCMinutes())}-${pad2(d.getUTCSeconds())}`;
          case 'YYYY': return d.getUTCFullYear().toString();
          case 'MM': return pad2(d.getUTCMonth()+1);
          case 'DD': return pad2(d.getUTCDate());
          case 'dddd': return ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][d.getUTCDay()];
          case 'MMMM': return ['January','February','March','April','May','June','July','August','September','October','November','December'][d.getUTCMonth()];
          default: return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth()+1)}-${pad2(d.getUTCDate())}`;
        }
      },
      add: (n: number, unit: string) => {
        const nd = new Date(d);
        if (unit.startsWith('day')) nd.setUTCDate(nd.getUTCDate()+n);
        if (unit.startsWith('week')) nd.setUTCDate(nd.getUTCDate()+7*n);
        if (unit.startsWith('month')) nd.setUTCMonth(nd.getUTCMonth()+n);
        return (globalThis as any).moment(nd);
      },
      subtract: (n: number, unit: string) => (globalThis as any).moment(d).add(-n, unit),
      startOf: (unit: string) => {
        const nd = new Date(d);
        if (unit==='week') { const day = nd.getUTCDay(); nd.setUTCDate(nd.getUTCDate()-day); nd.setUTCHours(0,0,0,0);} 
        if (unit==='month') { nd.setUTCDate(1); nd.setUTCHours(0,0,0,0);} 
        return (globalThis as any).moment(nd);
      },
      endOf: (unit: string) => {
        const nd = new Date(d);
        if (unit==='week') { const day = nd.getUTCDay(); nd.setUTCDate(nd.getUTCDate() + (6-day)); nd.setUTCHours(23,59,59,999);} 
        if (unit==='month') { nd.setUTCMonth(nd.getUTCMonth()+1, 0); nd.setUTCHours(23,59,59,999);} 
        return (globalThis as any).moment(nd);
      },
      daysInMonth: () => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth()+1, 0)).getUTCDate(),
      week: () => 1,
      quarter: () => Math.floor(d.getUTCMonth()/3)+1,
      calendar: () => `${d.getUTCFullYear()}-${pad2(d.getUTCMonth()+1)}-${pad2(d.getUTCDate())} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`,
      fromNow: () => 'in a few seconds'
    };
  }) as any;
}

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
    const f = new File([1], 'f.png', { type: 'image/png' });
    const out = await processor.processTemplate('{date} {time}', { file: f, activeFile: activeNote });
    expect(out).toMatch(/^2025-01-05 08-00-00$/);
  });

  it('2.29 startofweek and 2.30 endofweek (Sunday-based)', async () => {
    const f = new File([1], 'f.png', { type: 'image/png' });
    const out = await processor.processTemplate('{startofweek}|{endofweek}', { file: f, activeFile: activeNote });
    expect(out).toBe('2025-01-05|2025-01-11');
  });

  it('2.33 nextweek and 2.34 lastweek', async () => {
    const f = new File([1], 'f.png', { type: 'image/png' });
    const out = await processor.processTemplate('{nextweek}|{lastweek}', { file: f, activeFile: activeNote });
    expect(out).toBe('2025-01-12|2024-12-29');
  });

  it('2.40 counter increments per folder and is zero-padded', async () => {
    const f = new File([1], 'f.png', { type: 'image/png' });
    const ctx = { file: f, activeFile: activeNote };
    const a = await processor.processTemplate('{counter:000}', ctx);
    const b = await processor.processTemplate('{counter:000}', ctx);
    expect(a).toBe('001');
    expect(b).toBe('002');
  });
});