import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LinkFormatter } from '../../../src/LinkFormatter';
import type { NonDestructiveResizePreset } from '../../../src/NonDestructiveResizeSettings';
import { fakeApp, fakeTFile, fakeVault } from '../../factories/obsidian';
import { setMockImageSize } from '../../helpers/test-setup';

function makeFormatterForImage(path: string, width: number, height: number) {
  const file = fakeTFile({ path });
  const app = fakeApp({ vault: fakeVault({ files: [file] }) as any }) as any;
  (app.vault as any).getResourcePath = vi.fn(() => 'app://mock');
  const formatter = new LinkFormatter(app as any);
  setMockImageSize(width, height);
  return { app, file, formatter };
}

async function params(preset: NonDestructiveResizePreset, img: string, width: number, height: number) {
  const { formatter, file } = makeFormatterForImage(img, width, height);
  const out = await formatter.formatLink(file.path, 'wikilink', 'absolute', null, preset);
  // ![[/path|WxH]]
  const match = out.match(/\|([^\]]+)\]\]$/);
  return match ? match[1] : '';
}

describe('Non-destructive resize parameter computation (via LinkFormatter)', () => {
  beforeEach(() => {
    // Default editor width for editor-max-width tests
    vi.spyOn(LinkFormatter.prototype as any, 'getEditorMaxWidth').mockReturnValue(800);
  });

  it('20.1 Width (pixels) maintain aspect: 1000x800 → |500x400', async () => {
    const preset: NonDestructiveResizePreset = {
      name: 'W500', resizeDimension: 'width', width: 500,
      resizeScaleMode: 'auto', respectEditorMaxWidth: true,
      maintainAspectRatio: true, resizeUnits: 'pixels'
    };
    const sizeSpec = await params(preset, 'img/p.png', 1000, 800);
    expect(sizeSpec).toBe('500x400');
  });

  it('20.2 Height (percentage) maintain aspect: 50% of 1000x800 → |500x400', async () => {
    const preset: NonDestructiveResizePreset = {
      name: 'H50%', resizeDimension: 'height', height: 50,
      resizeScaleMode: 'auto', respectEditorMaxWidth: true,
      maintainAspectRatio: true, resizeUnits: 'percentage'
    };
    const sizeSpec = await params(preset, 'img/p.png', 1000, 800);
    expect(sizeSpec).toBe('500x400');
  });

  it('20.3 Both (custom) no aspect → exactly |300x100', async () => {
    const preset: NonDestructiveResizePreset = {
      name: 'Both', resizeDimension: 'both', customValue: '300x100',
      resizeScaleMode: 'auto', respectEditorMaxWidth: false,
      maintainAspectRatio: false, resizeUnits: 'pixels'
    };
    const sizeSpec = await params(preset, 'img/p.png', 1000, 800);
    expect(sizeSpec).toBe('300x100');
  });

  it('20.4 Both (percentage) 50x25 on 1200x800 → |600x200', async () => {
    const preset: NonDestructiveResizePreset = {
      name: 'Both %', resizeDimension: 'both', customValue: '50x25',
      resizeScaleMode: 'auto', respectEditorMaxWidth: false,
      maintainAspectRatio: false, resizeUnits: 'percentage'
    };
    const sizeSpec = await params(preset, 'img/p.png', 1200, 800);
    expect(sizeSpec).toBe('600x200');
  });

  it('20.5 Longest edge 1000 maintain aspect → 2000x1000 → |1000x500', async () => {
    const preset: NonDestructiveResizePreset = {
      name: 'Longest 1000', resizeDimension: 'longest-edge', longestEdge: 1000,
      resizeScaleMode: 'auto', respectEditorMaxWidth: false,
      maintainAspectRatio: true, resizeUnits: 'pixels'
    };
    const sizeSpec = await params(preset, 'img/p.png', 2000, 1000);
    expect(sizeSpec).toBe('1000x500');
  });

  it('20.5 Longest edge 1000 maintain aspect → 1000x2000 → |500x1000', async () => {
    const preset: NonDestructiveResizePreset = {
      name: 'Longest 1000', resizeDimension: 'longest-edge', longestEdge: 1000,
      resizeScaleMode: 'auto', respectEditorMaxWidth: true,
      maintainAspectRatio: true, resizeUnits: 'pixels'
    };
    const sizeSpec = await params(preset, 'img/p.png', 1000, 2000);
    expect(sizeSpec).toBe('500x1000');
  });

  it('20.6 Shortest edge 500 maintain aspect → 2000x1000 → |1000x500', async () => {
    const preset: NonDestructiveResizePreset = {
      name: 'Shortest 500', resizeDimension: 'shortest-edge', shortestEdge: 500,
      resizeScaleMode: 'auto', respectEditorMaxWidth: false,
      maintainAspectRatio: true, resizeUnits: 'pixels'
    };
    const sizeSpec = await params(preset, 'img/p.png', 2000, 1000);
    expect(sizeSpec).toBe('1000x500');
  });

  it('20.6 Shortest edge 500 maintain aspect → 1000x2000 → |500x1000', async () => {
    const preset: NonDestructiveResizePreset = {
      name: 'Shortest 500', resizeDimension: 'shortest-edge', shortestEdge: 500,
      resizeScaleMode: 'auto', respectEditorMaxWidth: false,
      maintainAspectRatio: true, resizeUnits: 'pixels'
    };
    const sizeSpec = await params(preset, 'img/p.png', 1000, 2000);
    expect(sizeSpec).toBe('500x1000');
  });

  it('20.8 Editor max width (pixels): editor=800, value=400 → |400x320', async () => {
    const preset: NonDestructiveResizePreset = {
      name: 'Editor 400', resizeDimension: 'editor-max-width', editorMaxWidthValue: 400,
      resizeScaleMode: 'auto', respectEditorMaxWidth: true,
      maintainAspectRatio: true, resizeUnits: 'pixels'
    };
    const sizeSpec = await params(preset, 'img/p.png', 1000, 800);
    expect(sizeSpec).toBe('400x320');
  });

  it('20.9 Editor max width (percentage): editor=800, value=50% → |400x320', async () => {
    const preset: NonDestructiveResizePreset = {
      name: 'Editor 50%', resizeDimension: 'editor-max-width', editorMaxWidthValue: 50,
      resizeScaleMode: 'auto', respectEditorMaxWidth: true,
      maintainAspectRatio: true, resizeUnits: 'percentage'
    };
    const sizeSpec = await params(preset, 'img/p.png', 1000, 800);
    expect(sizeSpec).toBe('400x320');
  });

  it('20.11 Scale mode reduce clamps width above original', async () => {
    const preset: NonDestructiveResizePreset = {
      name: 'Reduce W1200', resizeDimension: 'width', width: 1200,
      resizeScaleMode: 'reduce', respectEditorMaxWidth: false,
      maintainAspectRatio: true, resizeUnits: 'pixels'
    };
    const sizeSpec = await params(preset, 'img/p.png', 1000, 800);
    // Width clamped to original 1000, height 800
    expect(sizeSpec).toBe('1000x800');
  });

  it('20.13 None → empty string', async () => {
    const preset: NonDestructiveResizePreset = {
      name: 'None', resizeDimension: 'none',
      resizeScaleMode: 'auto', respectEditorMaxWidth: true,
      maintainAspectRatio: true, resizeUnits: 'pixels'
    };
    const { formatter, file } = makeFormatterForImage('img/p.png', 1000, 800);
    const out = await formatter.formatLink(file.path, 'wikilink', 'absolute', null, preset);
    expect(out).toBe('![[/img/p.png]]');
  });

  it('20.7 Original width maintainAspectRatio=true yields original WxH', async () => {
    const preset: NonDestructiveResizePreset = {
      name: 'Original Width keep aspect', resizeDimension: 'original-width',
      resizeScaleMode: 'auto', respectEditorMaxWidth: false,
      maintainAspectRatio: true, resizeUnits: 'pixels'
    };
    const sizeSpec = await params(preset, 'img/p.png', 1000, 800);
    expect(sizeSpec).toBe('1000x800');
  });

  it('20.7 Original width maintainAspectRatio=false emits both dimensions per implementation', async () => {
    const preset: NonDestructiveResizePreset = {
      name: 'Original Width no aspect', resizeDimension: 'original-width',
      resizeScaleMode: 'auto', respectEditorMaxWidth: false,
      maintainAspectRatio: false, resizeUnits: 'pixels'
    };
    const sizeSpec = await params(preset, 'img/p.png', 1000, 800);
    expect(sizeSpec).toBe('1000x800');
  });

  it('20.10 Respect editor constraint clamps width to editor and recomputes height', async () => {
    vi.spyOn(LinkFormatter.prototype as any, 'getEditorMaxWidth').mockReturnValue(800);
    const preset: NonDestructiveResizePreset = {
      name: 'W1200 clamp to editor', resizeDimension: 'width', width: 1200,
      resizeScaleMode: 'auto', respectEditorMaxWidth: true,
      maintainAspectRatio: true, resizeUnits: 'pixels'
    };
    const sizeSpec = await params(preset, 'img/p.png', 1000, 800);
    expect(sizeSpec).toBe('800x640');
  });

  it('20.11 Scale mode enlarge raises below-original width to original', async () => {
    const preset: NonDestructiveResizePreset = {
      name: 'Enlarge W500', resizeDimension: 'width', width: 500,
      resizeScaleMode: 'enlarge', respectEditorMaxWidth: false,
      maintainAspectRatio: true, resizeUnits: 'pixels'
    };
    const sizeSpec = await params(preset, 'img/p.png', 1000, 800);
    expect(sizeSpec).toBe('1000x800');
  });

  it('20.11 Scale mode auto leaves width unchanged', async () => {
    const preset: NonDestructiveResizePreset = {
      name: 'Auto W500', resizeDimension: 'width', width: 500,
      resizeScaleMode: 'auto', respectEditorMaxWidth: false,
      maintainAspectRatio: true, resizeUnits: 'pixels'
    };
    const sizeSpec = await params(preset, 'img/p.png', 1000, 800);
    expect(sizeSpec).toBe('500x400');
  });

  it('20.14 Output format supports missing side (width only → "|Wx")', async () => {
    const preset: NonDestructiveResizePreset = {
      name: 'Both custom width only', resizeDimension: 'both', customValue: '300x',
      resizeScaleMode: 'auto', respectEditorMaxWidth: false,
      maintainAspectRatio: true, resizeUnits: 'pixels'
    };
    const sizeSpec = await params(preset, 'img/p.png', 1000, 800);
    expect(sizeSpec).toBe('300x');
  });

  it('20.14 Output format supports missing side (height only → "|xH")', async () => {
    const preset: NonDestructiveResizePreset = {
      name: 'Both custom height only', resizeDimension: 'both', customValue: 'x200',
      resizeScaleMode: 'auto', respectEditorMaxWidth: false,
      maintainAspectRatio: true, resizeUnits: 'pixels'
    };
    const sizeSpec = await params(preset, 'img/p.png', 1000, 800);
    expect(sizeSpec).toBe('x200');
  });
});
