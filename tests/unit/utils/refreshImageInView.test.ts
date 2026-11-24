/**
 * Unit tests for the helper that loads a saved image again in the open note
 * without reloading the note.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { MarkdownView, type App } from 'obsidian';

import { refreshImageInView } from '../../../src/utils/refreshImageInView';
import { fakeAppWithResourcePath, fakeTFile, fakeWorkspace, makeObsidianAppResourcePath } from '../../factories/obsidian';

const NOW = 1800000000000;

/** An active note view that shows an `<img>` for each address. */
function makeView(addresses: string[]): MarkdownView {
  const view = new MarkdownView({} as any);
  const containerEl = document.createElement('div');
  for (const address of addresses) {
    const img = document.createElement('img');
    img.src = address;
    containerEl.appendChild(img);
  }
  (view as any).containerEl = containerEl;
  return view;
}

function imageAddresses(view: MarkdownView): string[] {
  return Array.from(view.containerEl.querySelectorAll('img')).map((img) => img.src);
}

function setup(addresses: string[], activeView?: MarkdownView | null) {
  const view = makeView(addresses);
  const workspace = fakeWorkspace({ activeView: activeView === undefined ? view : activeView });
  if (activeView === null) {
    (workspace.getActiveViewOfType as any) = vi.fn(() => null);
  }
  const { app } = fakeAppWithResourcePath({ workspace });
  return { app: app as App, view };
}

describe('refreshImageInView', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('gives each <img> of the saved file a new time after the "?"', () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const file = fakeTFile({ path: 'attachments/photo.png' });
    const address = makeObsidianAppResourcePath(file.path);
    const { app, view } = setup([address, address]);

    refreshImageInView(app, file);

    const expected = makeObsidianAppResourcePath(file.path, { mtime: NOW });
    expect(imageAddresses(view)).toEqual([expected, expected]);
  });

  it('finds a file whose name has a space, "#" or "%"', () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const file = fakeTFile({ path: 'notes/Pasted image #1 100%.png' });
    const { app, view } = setup([makeObsidianAppResourcePath(file.path)]);

    refreshImageInView(app, file);

    expect(imageAddresses(view)).toEqual([makeObsidianAppResourcePath(file.path, { mtime: NOW })]);
  });

  it('leaves other images alone, also when their path ends with the same name', () => {
    const file = fakeTFile({ path: 'photo.png' });
    const others = [
      makeObsidianAppResourcePath('sub/photo.png'),
      makeObsidianAppResourcePath('my photo.png'),
      'https://example.com/photo.png',
      'data:image/png;base64,iVBORw0KGgo=',
    ];
    const { app, view } = setup(others);
    const before = imageAddresses(view);

    refreshImageInView(app, file);

    expect(imageAddresses(view)).toEqual(before);
  });

  it('does nothing when no note is active', () => {
    const file = fakeTFile({ path: 'photo.png' });
    const { app } = setup([], null);

    expect(() => refreshImageInView(app, file)).not.toThrow();
    expect(app.vault.getResourcePath).not.toHaveBeenCalled();
  });
});
