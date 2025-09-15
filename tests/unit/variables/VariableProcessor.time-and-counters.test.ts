import { describe, it, expect, beforeEach } from 'vitest';
import { VariableProcessor } from '../../../src/VariableProcessor';
import { DEFAULT_SETTINGS } from '../../../src/ImageConverterSettings';
import { fakeApp, fakeTFile, fakeVault } from '../../factories/obsidian';

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