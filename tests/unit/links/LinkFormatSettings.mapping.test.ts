import { describe, it, expect, vi } from 'vitest';
import { LinkFormatter } from '../../../src/LinkFormatter';
import { type LinkFormatPreset, type PathFormat } from '../../../src/LinkFormatSettings';
import { fakeApp, fakeTFile, fakeVault } from '../../factories/obsidian';

function makeAppWithFile(path: string) {
  const file = fakeTFile({ path });
  const app = fakeApp({ vault: fakeVault({ files: [file] }) as any }) as any;
  (app.vault as any).getResourcePath = vi.fn(() => 'blob://mock');
  return { app, file };
}

describe('LinkFormatSettings → LinkFormatter mapping', () => {
  it('19.1 Selected preset determines link type (wikilink)', async () => {
    const { app, file } = makeAppWithFile('img/pic.png');
    const formatter = new LinkFormatter(app);
    const wikilinkPreset: LinkFormatPreset = {
      name: 'Wikilink Shortest',
      linkFormat: 'wikilink',
      pathFormat: 'shortest',
      prependCurrentDir: false,
      hideFolders: false
    };
    const out = await formatter.formatLink(file.path, wikilinkPreset.linkFormat, wikilinkPreset.pathFormat as PathFormat, null, null);
    expect(out).toBe('![[pic.png]]');
  });

  it('19.1 Selected preset determines link type (markdown)', async () => {
    const { app, file } = makeAppWithFile('img/pic.png');
    const formatter = new LinkFormatter(app);
    const preset: LinkFormatPreset = {
      name: 'Markdown Absolute',
      linkFormat: 'markdown',
      pathFormat: 'absolute',
      prependCurrentDir: false,
      hideFolders: false
    };
    const out = await formatter.formatLink(file.path, preset.linkFormat, preset.pathFormat as PathFormat, null, null);
    expect(out).toBe('![](/img/pic.png)');
  });

  it('19.2 Path formats shortest/absolute/relative', async () => {
    const { app, file } = makeAppWithFile('a/b/c.png');
    const formatter = new LinkFormatter(app);
    const note = fakeTFile({ path: 'a/note.md' });

    const shortest = await formatter.formatLink(file.path, 'wikilink', 'shortest', null, null);
    expect(shortest).toBe('![[c.png]]');

    const absolute = await formatter.formatLink(file.path, 'wikilink', 'absolute', null, null);
    expect(absolute).toBe('![[/a/b/c.png]]');

    const relative = await formatter.formatLink(file.path, 'wikilink', 'relative', note, null);
    expect(relative).toBe('![[./b/c.png]]');
  });

  it('19.3 Relative path requires active note: throws when missing active note', async () => {
    const { app, file } = makeAppWithFile('a/b/c.png');
    const formatter = new LinkFormatter(app);
    await expect(
      formatter.formatLink(file.path, 'markdown', 'relative', null, null)
    ).rejects.toThrow('Cannot format relative path without an active file.');
  });

  it('19.4 Markdown encoding: spaces encoded, others unchanged', async () => {
    const { app } = makeAppWithFile('a/My File(1)#v2.png');
    const formatter = new LinkFormatter(app);
    // Adjust filename in vault to include spaces/special chars
    (app.vault.getAbstractFileByPath as any) = vi.fn(() => fakeTFile({ path: 'a/My File(1)#v2.png' }));
    const out = await formatter.formatLink('a/My File(1)#v2.png', 'markdown', 'absolute', null, null);
    expect(out).toBe('![](/a/My%20File(1)#v2.png)');
  });

  it('19.5 No extra HTML attributes are added; alt only carries resize when provided', async () => {
    const { app } = makeAppWithFile('x/y.png');
    const formatter = new LinkFormatter(app);
    const out = await formatter.formatLink('x/y.png', 'markdown', 'absolute', null, null);
    expect(out).toBe('![](/x/y.png)');
  });
});
