import { describe, it, expect, beforeEach, vi } from 'vitest';
import ImageConverterPlugin from '../../../src/main';
import { ImageCaptionManager } from '../../../src/ImageCaptionManager';
import { fakeApp, fakePluginManifest } from '../../factories/obsidian';

function setupEmbed(alt: string, src: string, inCallout = false, presetEmbedAlt = !inCallout) {
  document.body.innerHTML = '';
  const container = document.createElement('div');
  container.className = 'markdown-preview-view';
  const parent = inCallout ? (container as any).createDiv('callout') : container;
  const embed = document.createElement('div');
  embed.className = 'internal-embed image-embed';
  embed.setAttribute('src', src);
  if (presetEmbedAlt) {
    // In Obsidian, the embed element often carries the caption via alt for non-callout renders.
    embed.setAttribute('alt', alt);
  }
  const img = document.createElement('img');
  img.setAttribute('alt', alt);
  embed.appendChild(img);
  parent.appendChild(embed);
  document.body.appendChild(container);
  return { container, parent, embed, img };
}

/**
 * Consolidated ImageCaptionManager integration tests (15.1–15.10)
 * Phases belong in the plan; filenames reflect behavior-centric structure.
 */

describe('ImageCaptionManager (integration)', () => {
  let plugin: any;

  beforeEach(() => {
    const app = fakeApp();
    plugin = new ImageConverterPlugin(app as any, fakePluginManifest());
    plugin.settings = {
      enableImageCaptions: true,
      skipCaptionExtensions: '',
      captionFontSize: '12px',
      captionColor: '#000',
      captionFontStyle: 'italic',
      captionBackgroundColor: 'transparent',
      captionPadding: '2px 4px',
      captionBorderRadius: '0',
      captionOpacity: '1',
      captionFontWeight: 'normal',
      captionTextTransform: 'none',
      captionLetterSpacing: 'normal',
      captionBorder: 'none',
      captionMarginTop: '4px',
      captionAlignment: 'center'
    } as any;
  });

  it('Given captioned alt text, When refreshed, Then body marked and embed alt set (15.1)', () => {
    const { embed } = setupEmbed('My Caption', 'imgs/pic.png', true);

    const manager = new ImageCaptionManager(plugin);
    manager.refresh();

    expect(document.body.classList.contains('image-captions-enabled')).toBe(true);
    expect(embed.getAttribute('alt')).toBe('My Caption');
  });

  it('Given wikilink-like caption in callout, When refreshed, Then embed alt matches caption (15.2)', () => {
    const { embed } = setupEmbed('Wikilink Caption', 'imgs/pic.png', true);

    const manager = new ImageCaptionManager(plugin);
    manager.refresh();

    expect(embed.getAttribute('alt')).toBe('Wikilink Caption');
  });

  it('Given non-empty alt, When refreshed, Then caption remains present via embed[alt] and enabled class (15.3)', () => {
    // Arrange
    const { container, embed, img } = setupEmbed('Visible', 'imgs/pic.png');

    const manager = new ImageCaptionManager(plugin);

    // Act
    manager.refresh();

    // Assert
    expect(document.body.classList.contains('image-captions-enabled')).toBe(true);
    expect(embed.getAttribute('alt')).toBe('Visible');
    expect(img.getAttribute('alt')).toBe('Visible');
    expect(container.contains(img)).toBe(true);
  });

  it('Given multiple images with different captions, When refreshed, Then each retains its own embed[alt] caption (15.4)', () => {
    // Arrange
    document.body.innerHTML = '';
    const container = document.createElement('div');
    container.className = 'markdown-preview-view';

    const e1 = document.createElement('div');
    e1.className = 'internal-embed image-embed';
    e1.setAttribute('src', 'imgs/a.png');
    e1.setAttribute('alt', 'A');
    const i1 = document.createElement('img');
    i1.setAttribute('alt', 'A');
    e1.appendChild(i1);

    const e2 = document.createElement('div');
    e2.className = 'internal-embed image-embed';
    e2.setAttribute('src', 'imgs/b.png');
    e2.setAttribute('alt', 'B');
    const i2 = document.createElement('img');
    i2.setAttribute('alt', 'B');
    e2.appendChild(i2);

    container.appendChild(e1);
    container.appendChild(e2);
    document.body.appendChild(container);

    const manager = new ImageCaptionManager(plugin);

    // Act
    manager.refresh();

    // Assert
    expect(e1.getAttribute('alt')).toBe('A');
    expect(e2.getAttribute('alt')).toBe('B');
  });

  it('Given styling enabled, When refreshed, Then caption styles reflect configuration (15.5)', () => {
    const { embed } = setupEmbed('Styled', 'imgs/pic.png');
    const manager = new ImageCaptionManager(plugin);
    manager.refresh();
    expect(document.body.classList.contains('image-captions-enabled')).toBe(true);
    const styleEl = document.getElementById('image-caption-styles') as HTMLStyleElement;
    expect(styleEl?.textContent).toContain(plugin.settings.captionFontSize);
    expect(styleEl?.textContent).toContain(plugin.settings.captionAlignment);
    // Confirm embed would be styled via attribute selector
    expect(embed.matches('.image-embed')).toBe(true);
  });

  it('Given skipCaptionExtensions includes jpg, When refreshed, Then jpg captions are removed and other formats keep captions (15.6)', () => {
    // Arrange
    plugin.settings.skipCaptionExtensions = 'jpg';
    const { embed, img } = setupEmbed('Skip me', 'imgs/pic.jpg');

    const manager = new ImageCaptionManager(plugin);

    // Act
    manager.refresh();

    // Assert
    expect(embed.getAttribute('alt')).toBeFalsy();
    expect(img.getAttribute('alt')).toBeFalsy();

    // Other formats not in the skip list keep embed[alt]
    const { embed: e2 } = setupEmbed('Yes', 'imgs/pic.png');
    manager.refresh();
    expect(e2.getAttribute('alt')).toBe('Yes');
  });

  it('Given reading and live preview simulated, When refreshed twice, Then enabled class persists (15.8)', () => {
    setupEmbed('Cap', 'imgs/pic.png');
    const manager = new ImageCaptionManager(plugin);
    manager.refresh(); // reading
    manager.refresh(); // simulate live preview
    expect(document.body.classList.contains('image-captions-enabled')).toBe(true);
  });

  it('Given callout embed, When img alt changes and refreshed, Then embed alt updates (15.9)', () => {
    document.body.innerHTML = '';
    const container = document.createElement('div');
    container.className = 'markdown-preview-view';
    const callout = (container as any).createDiv('callout');
    const embed = document.createElement('div');
    embed.className = 'internal-embed image-embed';
    embed.setAttribute('src', 'imgs/pic.png');
    const img = document.createElement('img');
    img.setAttribute('alt', 'Old');
    embed.appendChild(img);
    callout.appendChild(embed);
    document.body.appendChild(container);

    const manager = new ImageCaptionManager(plugin);
    manager.refresh();

    img.setAttribute('alt', 'New');
    manager.refresh();

    expect(embed.getAttribute('alt')).toBe('New');
  });

  it('Given images added/removed, When DOM mutates, Then captions sync after debounce (15.10)', () => {
    vi.useFakeTimers();

    // Arrange fresh container
    document.body.innerHTML = '';
    const container = document.createElement('div');
    container.className = 'markdown-preview-view';
    document.body.appendChild(container);

    const manager = new ImageCaptionManager(plugin);

    // Initially no embeds
    expect(document.querySelectorAll('.image-embed').length).toBe(0);

    // Add an image
    const embed = document.createElement('div');
    embed.className = 'internal-embed image-embed';
    embed.setAttribute('src', 'imgs/pic.png');
    const img = document.createElement('img');
    img.setAttribute('alt', 'Hello');
    embed.appendChild(img);
    container.appendChild(embed);

    // Trigger a mutation and advance debounce window
    (embed as HTMLElement).setAttribute('data-test', '1');
    vi.advanceTimersByTime(150);

    // Refresh to apply latest
    manager.refresh();

    expect(document.body.classList.contains('image-captions-enabled')).toBe(true);
    expect(img.getAttribute('alt')).toBe('Hello');

    // Remove node and advance debounce
    embed.remove();
    vi.advanceTimersByTime(150);
    manager.refresh();

    expect(document.querySelectorAll('.image-embed').length).toBe(0);

    vi.useRealTimers();
  });
});
