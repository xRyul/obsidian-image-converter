import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VariableProcessor } from '@/VariableProcessor';
import { DEFAULT_SETTINGS } from '@/ImageConverterSettings';
import { fakeApp, fakeTFile, fakeVault } from '../../factories/obsidian';

function installMomentStub() {
  (globalThis as any).moment = ((input?: any) => {
    const api: any = {
      format: (f: string) => '2025-01-02',
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

    // Deterministic UUID
    if (globalThis.crypto && 'randomUUID' in globalThis.crypto) {
      vi.spyOn(globalThis.crypto as any, 'randomUUID').mockReturnValue('00000000-0000-4000-8000-000000000000');
    }
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
  });

  it('2.23 MD5 hashing of filename and truncation', async () => {
    const file = new File([1,2,3], 'example.png', { type: 'image/png' });
    const out = await processor.processTemplate('{MD5:filename:8}', { file, activeFile: activeNote });
    expect(out).toMatch(/^[a-f0-9]{8}$/);
  });

  it('2.23 MD5 of notename/notepath and custom text', async () => {
    const file = new File([1,2,3], 'ex.png', { type: 'image/png' });
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
    const [a, b] = out.split('-');
    expect(a).toMatch(/^[a-f0-9]{10}$/);
    expect(b).toMatch(/^[a-f0-9]{10}$/);
  });

  it('2.25 uuid returns RFC 4122 string', async () => {
    const f = new File([1], 'x.png', { type: 'image/png' });
    const out = await processor.processTemplate('{uuid}', { file: f, activeFile: activeNote });
    expect(out).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('2.26 random is 6-char alphanumeric', async () => {
    const f = new File([1], 'x.png', { type: 'image/png' });
    const out = await processor.processTemplate('{random}', { file: f, activeFile: activeNote });
    expect(out).toMatch(/^[a-z0-9]{1,6}$/);
  });
});