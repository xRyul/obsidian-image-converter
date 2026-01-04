import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MarkdownView } from 'obsidian';
import { LinkFormatter } from '../../../src/LinkFormatter';
import type { LinkFormat, PathFormat } from '../../../src/LinkFormatSettings';
import { fakeApp, fakeTFile, fakeVault } from '../../factories/obsidian';
import { setMockImageSize } from '../../helpers/test-setup';
import { IMAGE_FILENAMES } from '../../helpers/filename-corpus';

function makeFormatterWithFiles(paths: string[]) {
  const files = paths.map((pathStr) => fakeTFile({ path: pathStr, name: pathStr.split('/').pop()! }));
  const app = fakeApp({
    vault: fakeVault({ files }) as any,
    workspace: { getActiveFile: vi.fn(() => null) } as any,
  }) as any;
  // Provide getResourcePath used by LinkFormatter.getImageDimensions
  (app.vault as any).getResourcePath = vi.fn((tfile: any) => `app://local/${tfile.path}`);
  return { app, files, formatter: new LinkFormatter(app) };
}

function encodeSpacesOnly(inputPath: string): string {
  // Mirror LinkFormatter.encodeMarkdownPath behavior: only spaces to %20
  return inputPath.replace(/\s/g, '%20');
}

// -----------------------------------------------------------------------------
// Core behaviors (merged from formatting and path/encoding)
// -----------------------------------------------------------------------------

describe('LinkFormatter — core behaviors', () => {
  beforeEach(() => {
    setMockImageSize(100, 100);
  });

  it('wikilink with absolute path: ![[/{path}]]', async () => {
    const { files, formatter } = makeFormatterWithFiles(['images/pic.png']);
    const result = await formatter.formatLink(
      files[0].path,
      'wikilink' as LinkFormat,
      'absolute' as PathFormat,
      null,
      null
    );
    expect(result).toBe('![[/images/pic.png]]');
  });

  it('markdown with absolute path encodes spaces only', async () => {
    const { files, formatter } = makeFormatterWithFiles(['folder/My Image 1.png']);
    const res = await formatter.formatLink(
      files[0].path,
      'markdown',
      'absolute',
      null,
      null
    );
    expect(res).toBe('![](/folder/My%20Image%201.png)');
  });

  it('absolute path starts with a leading slash', async () => {
    const { formatter, files } = makeFormatterWithFiles(['a/b/photo.png']);
    const out = await formatter.formatLink(files[0].path, 'wikilink', 'absolute', null, null);
    expect(out).toBe('![[/a/b/photo.png]]');
  });

  it('relative path with same folder uses ./filename (wikilink)', async () => {
    const note = fakeTFile({ path: 'a/note.md' });
    const { files, formatter } = makeFormatterWithFiles(['a/image.png']);
    const out = await formatter.formatLink(files[0].path, 'wikilink', 'relative', note, null);
    expect(out).toBe('![[./image.png]]');
  });

  it('relative path with parent folder uses ../ (markdown)', async () => {
    const note = fakeTFile({ path: 'notes/n.md' });
    const { formatter, files } = makeFormatterWithFiles(['images/pic.png']);
    const out = await formatter.formatLink(files[0].path, 'markdown', 'relative', note, null);
    expect(out).toBe('![](../images/pic.png)');
  });

  it('relative wikilink with multi-level traversal uses ../../', async () => {
    const note = fakeTFile({ path: 'Notes/Sub/Note.md' });
    const { formatter, files } = makeFormatterWithFiles(['Assets/image with spaces.png']);
    const out = await formatter.formatLink(files[0].path, 'wikilink', 'relative', note, null);
    expect(out).toBe('![[../../Assets/image with spaces.png]]');
  });

  it('shortest path uses only the filename (wikilink)', async () => {
    const { formatter, files } = makeFormatterWithFiles(['deep/path/photo.png']);
    const out = await formatter.formatLink(files[0].path, 'wikilink', 'shortest', null, null);
    expect(out).toBe('![[photo.png]]');
  });

  it('encodes spaces in markdown (absolute)', async () => {
    const { formatter, files } = makeFormatterWithFiles(['img/My Pic.png']);
    const out = await formatter.formatLink(files[0].path, 'markdown', 'absolute', null, null);
    expect(out).toBe('![](/img/My%20Pic.png)');
  });

  it('preserves spaces in wikilink (absolute)', async () => {
    const { formatter, files } = makeFormatterWithFiles(['img/My Pic.png']);
    const out = await formatter.formatLink(files[0].path, 'wikilink', 'absolute', null, null);
    expect(out).toBe('![[/img/My Pic.png]]');
  });

  it('special characters (non-space) are not encoded in markdown', async () => {
    const { formatter, files } = makeFormatterWithFiles(['img/p#ic(1).png']);
    const out = await formatter.formatLink(files[0].path, 'markdown', 'absolute', null, null);
    expect(out).toBe('![](/img/p#ic(1).png)');
  });

  it('resizes in wikilink appends |WxH', async () => {
    const { formatter, files } = makeFormatterWithFiles(['img/pic.png']);
    const preset = {
      name: 'Width 50',
      resizeDimension: 'width',
      width: 50,
      resizeScaleMode: 'auto',
      respectEditorMaxWidth: false,
      maintainAspectRatio: true,
      resizeUnits: 'pixels',
    } as const;
    setMockImageSize(100, 100);
    const out = await formatter.formatLink(files[0].path, 'wikilink', 'absolute', null, preset as any);
    expect(out).toBe('![[/img/pic.png|50x50]]');
  });

  it('resizes in markdown uses alt text equal to |WxH', async () => {
    const { formatter, files } = makeFormatterWithFiles(['img/pic.png']);
    const preset = {
      name: 'Width 40',
      resizeDimension: 'width',
      width: 40,
      resizeScaleMode: 'auto',
      respectEditorMaxWidth: false,
      maintainAspectRatio: true,
      resizeUnits: 'pixels',
    } as const;
    setMockImageSize(100, 100);
    const out = await formatter.formatLink(files[0].path, 'markdown', 'absolute', null, preset as any);
    expect(out).toBe('![|40x40](/img/pic.png)');
  });

  it('no resize => empty alt for markdown', async () => {
    const { formatter, files } = makeFormatterWithFiles(['img/pic.png']);
    const out = await formatter.formatLink(files[0].path, 'markdown', 'absolute', null, null);
    expect(out).toBe('![](/img/pic.png)');
  });

  it('output paths use forward slashes (wikilink absolute)', async () => {
    const { formatter, files } = makeFormatterWithFiles(['folder/sub/p.png']);
    const out = await formatter.formatLink(files[0].path, 'wikilink', 'absolute', null, null);
    expect(out.startsWith('![[/')).toBe(true);
    expect(out.includes('\\')).toBe(false);
  });

  it('Unicode in markdown absolute is preserved (no encoding)', async () => {
    const { formatter, files } = makeFormatterWithFiles(['Assets/中文-汉字-測試.png']);
    const link = await formatter.formatLink(files[0].path, 'markdown', 'absolute', null);
    expect(link).toBe('![](/Assets/中文-汉字-測試.png)');
  });

  it('encodes spaces as %20 in markdown shortest', async () => {
    const { formatter, files } = makeFormatterWithFiles(['Assets/image with spaces.png']);
    const link = await formatter.formatLink(files[0].path, 'markdown', 'shortest', null);
    expect(link).toBe('![](image%20with%20spaces.png)');
  });
});

// -----------------------------------------------------------------------------
// Corpus coverage (absolute and relative same-folder)
// -----------------------------------------------------------------------------

describe('LinkFormatter — corpus coverage', () => {
  beforeEach(() => setMockImageSize(64, 48));

  it.each(IMAGE_FILENAMES.map((name) => `Assets/${name}`))(
    'wikilink absolute preserves characters: %s',
    async (vaultPath) => {
      const { formatter } = makeFormatterWithFiles([vaultPath]);
      const out = await formatter.formatLink(
        vaultPath,
        'wikilink' as LinkFormat,
        'absolute' as PathFormat,
        null,
        null
      );
      expect(out).toBe(`![[${`/${vaultPath}`}]]`);
    }
  );

  it.each(IMAGE_FILENAMES.map((name) => `Assets/${name}`))(
    'markdown absolute encodes spaces (and NBSP) only: %s',
    async (vaultPath) => {
      const { formatter } = makeFormatterWithFiles([vaultPath]);
      const out = await formatter.formatLink(
        vaultPath,
        'markdown' as LinkFormat,
        'absolute' as PathFormat,
        null,
        null
      );
      expect(out).toBe(`![](${encodeSpacesOnly(`/${vaultPath}`)})`);
    }
  );

  const sameFolderNames = ['image with spaces.png', '中文-汉字-測試.png', '😀-emoji.png'];
  const paths = sameFolderNames.map((name) => `Notes/${name}`);

  it.each(paths)('wikilink relative uses ./ for same folder: %s', async (vaultPath) => {
    const note = fakeTFile({ path: 'Notes/note.md' });
    const { formatter } = makeFormatterWithFiles(paths);
    const out = await formatter.formatLink(vaultPath, 'wikilink', 'relative', note as any, null);
    const filename = vaultPath.split('/').pop()!;
    expect(out).toBe(`![[./${filename}]]`);
  });

  it.each(paths)('markdown relative uses ./ and encodes only spaces: %s', async (vaultPath) => {
    const note = fakeTFile({ path: 'Notes/note.md' });
    const { formatter } = makeFormatterWithFiles(paths);
    const out = await formatter.formatLink(vaultPath, 'markdown', 'relative', note as any, null);
    const filename = vaultPath.split('/').pop()!;
    expect(out).toBe(`![](${encodeSpacesOnly(`./${filename}`)})`);
  });
});

// -----------------------------------------------------------------------------
// Platform-specific (Phase 9: 25.6)
// -----------------------------------------------------------------------------

describe('LinkFormatter — Platform-specific (Phase 9)', () => {
  it('25.6 Desktop-specific: getEditorMaxWidth reads CodeMirror .cm-line width when available', () => {
    const file = fakeTFile({ path: 'img/p.png', name: 'p.png', extension: 'png' });
    const app = fakeApp({ vault: fakeVault({ files: [file] }) as any }) as any;

    // LinkFormatter.getEditorMaxWidth uses workspace.getMostRecentLeaf().view.editor.cm
    const view = new (MarkdownView as any)();
    const cmLine = { clientWidth: 420 } as any;
    const querySelector = vi.fn(() => cmLine);
    (view as any).editor = { cm: { contentDOM: { querySelector } } };
    (app.workspace.getMostRecentLeaf as any) = vi.fn(() => ({ view }));

    const formatter = new LinkFormatter(app as any);
    const width = (formatter as any).getEditorMaxWidth();

    expect(width).toBe(420);
    expect(querySelector).toHaveBeenCalledWith('.cm-line');
  });

  it('25.6 Desktop-specific: getEditorMaxWidth falls back to 800 when cm-line is missing', () => {
    const file = fakeTFile({ path: 'img/p.png', name: 'p.png', extension: 'png' });
    const app = fakeApp({ vault: fakeVault({ files: [file] }) as any }) as any;

    const view = new (MarkdownView as any)();
    const querySelector = vi.fn(() => null);
    (view as any).editor = { cm: { contentDOM: { querySelector } } };
    (app.workspace.getMostRecentLeaf as any) = vi.fn(() => ({ view }));

    const formatter = new LinkFormatter(app as any);
    const width = (formatter as any).getEditorMaxWidth();

    expect(width).toBe(800);
  });
});
