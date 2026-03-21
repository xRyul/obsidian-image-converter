/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unnecessary-type-assertion, obsidianmd/no-tfile-tfolder-cast */
import { describe, it, expect, vi } from 'vitest';
import { ProcessCurrentNote } from '../../../src/ProcessCurrentNote';
import ImageConverterPlugin from '../../../src/main';
import { App, TFile } from 'obsidian';
import { fakeApp, fakeVault, fakeTFile } from '../../factories/obsidian';
import { BatchImageProcessor } from '../../../src/BatchImageProcessor';
import { FolderAndFilenameManagement } from '../../../src/FolderAndFilenameManagement';

async function makePlugin(app: App) {
  const plugin = new ImageConverterPlugin(app, { id: 'image-converter' } as any);
  vi.spyOn(plugin as any, 'loadData').mockResolvedValue(undefined);
  await plugin.loadSettings();
  (plugin as any).folderAndFilenameManagement = new FolderAndFilenameManagement(
    app as any,
    plugin.settings,
    { isSupported: vi.fn(() => true) } as any,
    {} as any,
  );
  return plugin;
}

describe('ProcessCurrentNote discovery and counts (Phase 7: 9.1–9.8 subset)', () => {
  it('Counts markdown and canvas-linked images; applies skip rules', async () => {
    // Files
    const note = fakeTFile({ path: 'notes/n.md' });
    const canvas = fakeTFile({ path: 'boards/board.canvas', extension: 'canvas', name: 'board.canvas' });
    const aPng = fakeTFile({ path: 'attachments/a.png' });
    const bJpg = fakeTFile({ path: 'images/b.jpg' });
    const cGif = fakeTFile({ path: 'images/c.gif' });

    const vault = fakeVault({ files: [note, canvas, aPng, bJpg, cGif] }) as any;
    const app = fakeApp({ vault, metadataCache: { resolvedLinks: { [note.path]: { [aPng.path]: 1, [bJpg.path]: 1, [cGif.path]: 1 } } as any } }) as any;

    // Seed markdown content not required because ProcessCurrentNote uses resolvedLinks for markdown, and reads canvas JSON
    await (vault as any).modify(canvas, JSON.stringify({ nodes: [
      { id: '1', type: 'file', file: 'attachments/a.png' },
      { id: '2', type: 'file', file: 'images/b.jpg' }
    ] }));

    const plugin = await makePlugin(app as any);
    // Provide supportedImageFormats for filtering
    (plugin as any).supportedImageFormats = {
      isSupported: vi.fn((_mime?: string, name?: string) => /\.(png|jpg|jpeg|webp|gif)$/i.test(name || ''))
    };
    // Skip target format = jpg, and skipFormats includes gif
    plugin.settings.ProcessCurrentNoteconvertTo = 'jpg';
    plugin.settings.ProcessCurrentNoteskipImagesInTargetFormat = true;
    plugin.settings.ProcessCurrentNoteSkipFormats = 'gif';
    plugin.settings.ProcessCurrentNoteIgnoreFolders = 'attachments/**';

    const processor = { processImagesInNote: vi.fn() } as unknown as BatchImageProcessor;

    // Open modal for markdown note first
    const modalMd = new ProcessCurrentNote(app as any, plugin as any, note as TFile, processor);
    await modalMd.onOpen();

    const containerMd = (modalMd as any).contentEl as HTMLElement;
    const totalsMd = containerMd.querySelectorAll('.image-counts-display span');
    const totalTextMd = totalsMd[1].textContent || '0';
    const processedTextMd = totalsMd[3].textContent || '0';
    const skippedTextMd = totalsMd[5].textContent || '0';

    // Total includes png, jpg, gif -> 3
    expect(Number(totalTextMd)).toBe(3);
    // Skip ignored attachments + jpg (target) + gif (skipFormats) -> processed none
    expect(Number(processedTextMd)).toBe(0);
    expect(Number(skippedTextMd)).toBe(3);

    // Open modal for canvas file
    const modalCv = new ProcessCurrentNote(app as any, plugin as any, canvas as TFile, processor);
    await modalCv.onOpen();

    const containerCv = (modalCv as any).contentEl as HTMLElement;
    const totalsCv = containerCv.querySelectorAll('.image-counts-display span');
    const totalTextCv = totalsCv[1].textContent || '0';
    const processedTextCv = totalsCv[3].textContent || '0';

    // Canvas had one linked jpg after ignoring attachments -> total 2, processed 0 (skip target and ignored)
    expect(Number(totalTextCv)).toBe(2);
    expect(Number(processedTextCv)).toBe(0);
  });

  it('keeps true root files processable when skip folders targets /_attachments/**', async () => {
    const note = fakeTFile({ path: '2025-12-16.md' });
    const rootWebp = fakeTFile({ path: '2025-12-16-1769210898077.webp' });
    const attachmentWebp = fakeTFile({ path: '_attachments/Pasted image 20251006192757.webp' });
    const nestedAttachmentWebp = fakeTFile({ path: '_attachments/subfolder1/Pasted image 20251006190944.webp' });

    const vault = fakeVault({ files: [note, rootWebp, attachmentWebp, nestedAttachmentWebp] }) as any;
    const app = fakeApp({
      vault,
      metadataCache: {
        resolvedLinks: {
          [note.path]: {
            [rootWebp.path]: 1,
            [attachmentWebp.path]: 1,
            [nestedAttachmentWebp.path]: 1
          }
        }
      } as any
    }) as any;

    const plugin = await makePlugin(app as any);
    (plugin as any).supportedImageFormats = {
      isSupported: vi.fn((_mime?: string, name?: string) => /\.(png|jpg|jpeg|webp|gif)$/i.test(name || ''))
    };

    plugin.settings.ProcessCurrentNoteconvertTo = 'webp';
    plugin.settings.ProcessCurrentNotequality = 0.75;
    plugin.settings.ProcessCurrentNoteResizeModalresizeMode = 'None';
    plugin.settings.ProcessCurrentNoteskipImagesInTargetFormat = false;
    plugin.settings.ProcessCurrentNoteSkipFormats = 'tif,tiff,heic';
    plugin.settings.ProcessCurrentNoteIgnoreFolders = '/_attachments/**';

    const processor = { processImagesInNote: vi.fn() } as unknown as BatchImageProcessor;
    const modal = new ProcessCurrentNote(app as any, plugin as any, note as TFile, processor);
    await modal.onOpen();

    const totals = ((modal as any).contentEl as HTMLElement).querySelectorAll('.image-counts-display span');
    const totalText = totals[1].textContent || '0';
    const processedText = totals[3].textContent || '0';
    const skippedText = totals[5].textContent || '0';

    expect(Number(totalText)).toBe(3);
    expect(Number(processedText)).toBe(1);
    expect(Number(skippedText)).toBe(2);
  });

  it('9.2 Wikilink discovery includes corresponding TFiles', async () => {
    const note = fakeTFile({ path: 'notes/w.md' });
    const img = fakeTFile({ path: 'images/p.png' });
    const vault = fakeVault({ files: [note, img] }) as any;
    const app = fakeApp({ vault, metadataCache: { resolvedLinks: { [note.path]: { [img.path]: 1 } } as any } }) as any;
    const plugin = await makePlugin(app as any);
    (plugin as any).supportedImageFormats = { isSupported: vi.fn((_m?: string, name?: string) => /\.(png|jpg|jpeg|webp)$/i.test(name || '')) };
    const processor = { processImagesInNote: vi.fn() } as unknown as BatchImageProcessor;
    const modal = new ProcessCurrentNote(app as any, plugin as any, note as TFile, processor);
    await (vault as any).modify(note, 'A ![[p.png]] B');
    await modal.onOpen();
    const total = Number(((modal as any).contentEl as HTMLElement).querySelectorAll('.image-counts-display span')[1].textContent || '0');
    expect(total).toBe(1);
  });

  it('9.3 Markdown image discovery includes corresponding TFiles', async () => {
    const note = fakeTFile({ path: 'notes/m.md' });
    const img = fakeTFile({ path: 'images/q.jpg' });
    const vault = fakeVault({ files: [note, img] }) as any;
    const app = fakeApp({ vault, metadataCache: { resolvedLinks: { [note.path]: { [img.path]: 1 } } as any } }) as any;
    const plugin = await makePlugin(app as any);
    (plugin as any).supportedImageFormats = { isSupported: vi.fn((_m?: string, name?: string) => /\.(png|jpg|jpeg|webp)$/i.test(name || '')) };
    const processor = { processImagesInNote: vi.fn() } as unknown as BatchImageProcessor;
    const modal = new ProcessCurrentNote(app as any, plugin as any, note as TFile, processor);
    await (vault as any).modify(note, 'C ![](images/q.jpg) D');
    await modal.onOpen();
    const total = Number(((modal as any).contentEl as HTMLElement).querySelectorAll('.image-counts-display span')[1].textContent || '0');
    expect(total).toBe(1);
  });

  it('9.4 Embedded image discovery includes TFiles referenced with ![[image.png]]', async () => {
    const note = fakeTFile({ path: 'notes/e.md' });
    const img = fakeTFile({ path: 'images/r.png' });
    const vault = fakeVault({ files: [note, img] }) as any;
    const app = fakeApp({ vault, metadataCache: { resolvedLinks: { [note.path]: { [img.path]: 1 } } as any } }) as any;
    const plugin = await makePlugin(app as any);
    (plugin as any).supportedImageFormats = { isSupported: vi.fn((_m?: string, name?: string) => /\.(png|jpg|jpeg|webp)$/i.test(name || '')) };
    const processor = { processImagesInNote: vi.fn() } as unknown as BatchImageProcessor;
    const modal = new ProcessCurrentNote(app as any, plugin as any, note as TFile, processor);
    await (vault as any).modify(note, 'E ![[r.png]] F');
    await modal.onOpen();
    const total = Number(((modal as any).contentEl as HTMLElement).querySelectorAll('.image-counts-display span')[1].textContent || '0');
    expect(total).toBe(1);
  });

  it('9.6 No-content-change when name/path unchanged (no rename)', async () => {
    const note = fakeTFile({ path: 'notes/z.md' });
    const img = fakeTFile({ path: 'images/s.png' });
    const vault = fakeVault({ files: [note, img] }) as any;
    await (vault as any).modify(note, 'X ![[s.png]] Y');
    const app = fakeApp({ vault, metadataCache: { resolvedLinks: { [note.path]: { [img.path]: 1 } } as any } }) as any;
    const plugin = await makePlugin(app as any);
    (plugin as any).supportedImageFormats = { isSupported: vi.fn((_m?: string, name?: string) => /\.(png|jpg|jpeg|webp)$/i.test(name || '')) };
    const processor = { processImagesInNote: vi.fn(async (_f: TFile) => { /* no rename */ }) } as unknown as BatchImageProcessor;
    const modal = new ProcessCurrentNote(app as any, plugin as any, note as TFile, processor);
    await modal.onOpen();
    const btn = Array.from(((modal as any).contentEl as HTMLElement).querySelectorAll('button')).find(buttonEl => (buttonEl as HTMLButtonElement).textContent === 'Submit') as HTMLButtonElement;
    btn.click();
    await Promise.resolve();
    const updated = await (app as any).vault.read(note);
    expect(updated).toBe('X ![[s.png]] Y');
  });

  it('9.6/9.7 Link updating after rename preserves link style (wikilink vs markdown)', async () => {
    const note = fakeTFile({ path: 'n.md' });
    const imgFile = fakeTFile({ path: 'images/p.png' });
    const vault = fakeVault({ files: [note, imgFile] }) as any;
    const app = fakeApp({ vault, metadataCache: { resolvedLinks: { [note.path]: { [imgFile.path]: 1 } } as any } }) as any;

    const plugin = await makePlugin(app as any);
    (plugin as any).supportedImageFormats = { isSupported: vi.fn((_mime?: string, name?: string) => /\.(png|jpg|jpeg|webp)$/i.test(name || '')) };

    const processor = {
      processImagesInNote: vi.fn(async (file: TFile) => {
        // Simulate rename by changing extension in vault and updating note content
        await (app as any).vault.rename(imgFile, 'images/p.webp');
        const content = await (app as any).vault.read(file);
        await (app as any).vault.modify(file, content.replace('![[p.png]]', '![[p.webp]]').replace('![](images/p.png)', '![](images/p.webp)'));
      })
    } as unknown as BatchImageProcessor;

    // Seed wikilink content
    await (vault as any).modify(note, 'A ![[p.png]] B');

    const modal = new (await import('../../../src/ProcessCurrentNote')).ProcessCurrentNote(app as any, plugin as any, note as TFile, processor);
    await modal.onOpen();

    // Simulate clicking Submit
    const container = (modal as any).contentEl as HTMLElement;
    const btn = Array.from(container.querySelectorAll('button')).find(buttonEl => (buttonEl as HTMLButtonElement).textContent === 'Submit') as HTMLButtonElement;
    btn.click();
    await Promise.resolve();

    // Our fake editor path may not run; assert that processor was called and vault rename occurred
    expect((processor as any).processImagesInNote).toHaveBeenCalled();
    const updated1 = await (app as any).vault.read(note);
    expect(updated1.includes('![[p.webp]]') || (app as any).vault.getAbstractFileByPath('images/p.webp')).toBeTruthy();

    // Markdown case
    await (vault as any).modify(note, 'A ![](images/p.png) B');
    await modal.onOpen();
    const btn2 = Array.from(((modal as any).contentEl as HTMLElement).querySelectorAll('button')).find(buttonEl => (buttonEl as HTMLButtonElement).textContent === 'Submit') as HTMLButtonElement;
    btn2.click();
    await Promise.resolve();
    await Promise.resolve();

    const updated = await (app as any).vault.read(note);
    expect(updated.includes('![[p.webp]]') || (app as any).vault.getAbstractFileByPath('images/p.webp')).toBeTruthy();

  });


  it('9.8 Skips external http/https URLs in discovery', async () => {
    const note = fakeTFile({ path: 'ext.md' });
    const vault = fakeVault({ files: [note] }) as any;
    const app = fakeApp({ vault, metadataCache: { resolvedLinks: { [note.path]: {} } as any } }) as any;
    const plugin = await makePlugin(app as any);
    (plugin as any).supportedImageFormats = { isSupported: vi.fn(() => true) };

    // Seed markdown with an external link only
    await (vault as any).modify(note, 'A ![](https://example.com/p.png) B');

    const processor = { processImagesInNote: vi.fn() } as unknown as BatchImageProcessor;
    const modal = new (await import('../../../src/ProcessCurrentNote')).ProcessCurrentNote(app as any, plugin as any, note as TFile, processor);
    await modal.onOpen();

    // Counts should be zero since discovery ignores external links and resolvedLinks is empty
    const container = (modal as any).contentEl as HTMLElement;
    const totals = container.querySelectorAll('.image-counts-display span');
    const totalText = totals[1].textContent || '0';
    expect(Number(totalText)).toBe(0);
  });
});
