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

  it('15.1 Caption from alt text: given captions enabled and image has alt, when refreshed, then body marked and alt appears as caption', () => {
    const { embed } = setupEmbed('My Caption', 'imgs/pic.png', true);

    const manager = new ImageCaptionManager(plugin);
    manager.refresh();

    expect(document.body.classList.contains('image-captions-enabled')).toBe(true);
    expect(embed.getAttribute('alt')).toBe('My Caption');
  });

  it('15.2 Caption from wikilink: given wikilink alt/caption in callout, when refreshed, then embed alt matches caption', () => {
    const { embed } = setupEmbed('Wikilink Caption', 'imgs/pic.png', true);

    const manager = new ImageCaptionManager(plugin);
    manager.refresh();

    expect(embed.getAttribute('alt')).toBe('Wikilink Caption');
  });

  it('15.3 Caption visibility: given non-empty alt, when DOM processed, then visible caption appears below image', () => {
    const { container, embed, img } = setupEmbed('Visible', 'imgs/pic.png');

    const manager = new ImageCaptionManager(plugin);
    manager.refresh();

    expect(document.body.classList.contains('image-captions-enabled')).toBe(true);
    expect(embed.getAttribute('alt')).toBe('Visible');
    expect(img.getAttribute('alt')).toBe('Visible');
    expect(container.contains(img)).toBe(true);
  });

  it('15.4 Multiple images: given multiple images with different alt texts, when refreshed, then each shows its own caption', () => {
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
    manager.refresh();

    expect(e1.getAttribute('alt')).toBe('A');
    expect(e2.getAttribute('alt')).toBe('B');
  });

  it('15.5 Styling: given configured font size and alignment, when styles applied, then caption reflects configuration', () => {
    const { embed } = setupEmbed('Styled', 'imgs/pic.png');
    const manager = new ImageCaptionManager(plugin);
    manager.refresh();
    expect(document.body.classList.contains('image-captions-enabled')).toBe(true);
    // Verify old style element approach is not used
    expect(document.getElementById('image-caption-styles')).toBeNull();
    // Verify CSS variables are set on document.body
    expect(document.body.style.getPropertyValue('--image-converter-caption-font-size')).toBe(plugin.settings.captionFontSize);
    expect(document.body.style.getPropertyValue('--image-converter-caption-text-align')).toBe(plugin.settings.captionAlignment);
    // Confirm embed would be styled via attribute selector
    expect(embed.matches('.image-embed')).toBe(true);
  });

  it('15.5b Styling falsy values: given falsy caption settings, when refreshed, then CSS properties are removed not set to "null"', () => {
    plugin.settings.captionFontSize = '';
    plugin.settings.captionColor = '';
    plugin.settings.captionBorder = '';

    setupEmbed('Test', 'imgs/pic.png');
    const manager = new ImageCaptionManager(plugin);
    manager.refresh();

    // Falsy values should result in empty string (property removed), not 'null'
    expect(document.body.style.getPropertyValue('--image-converter-caption-font-size')).toBe('');
    expect(document.body.style.getPropertyValue('--image-converter-caption-color')).toBe('');
    expect(document.body.style.getPropertyValue('--image-converter-caption-border')).toBe('');
    // align-items is derived from captionAlignment, which remains at its default ('center') here
    expect(document.body.style.getPropertyValue('--image-converter-caption-align-items')).toBe('center');
  });

  it('15.6 Supported formats: given png/jpg/jpeg/webp/svg, when rendered with captions enabled, then captions shown', () => {
    const formats = ['png', 'jpg', 'jpeg', 'webp', 'svg'];
    const manager = new ImageCaptionManager(plugin);

    for (const ext of formats) {
      const { embed } = setupEmbed(`Caption for ${ext}`, `imgs/pic.${ext}`);
      manager.refresh();

      expect(document.body.classList.contains('image-captions-enabled')).toBe(true);
      expect(embed.getAttribute('alt')).toBe(`Caption for ${ext}`);
    }
  });

  it('15.7 Skip extensions: given skipCaptionExtensions includes jpg, when refreshed, then jpg captions are removed', () => {
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

  it('15.8 Mode coverage: given reading and live preview simulated, when refreshed twice, then captions shown in both modes', () => {
    setupEmbed('Cap', 'imgs/pic.png');
    const manager = new ImageCaptionManager(plugin);
    manager.refresh(); // reading
    manager.refresh(); // simulate live preview
    expect(document.body.classList.contains('image-captions-enabled')).toBe(true);
  });

  it('15.9 Updates on change: given existing caption, when alt text changes, then caption updates after debounce', () => {
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

  it('15.10 DOM mutations: given images added/removed, when DOM mutates, then captions added/removed accordingly', () => {
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

  it('15.11 Table backslash: given image in table with alt ending in backslash (Obsidian escape), when refreshed, then trailing backslash removed from caption', () => {
    // Arrange: simulate Obsidian's behavior where pipe escape results in trailing backslash
    document.body.innerHTML = '';
    const container = document.createElement('div');
    container.className = 'markdown-preview-view';
    const table = document.createElement('table');
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    const embed = document.createElement('div');
    embed.className = 'internal-embed image-embed';
    embed.setAttribute('src', 'imgs/pic.png');
    embed.setAttribute('alt', 'sample\\'); // Obsidian sets alt with trailing backslash
    const img = document.createElement('img');
    img.setAttribute('alt', 'sample\\');
    embed.appendChild(img);
    td.appendChild(embed);
    tr.appendChild(td);
    table.appendChild(tr);
    container.appendChild(table);
    document.body.appendChild(container);

    // Act
    const manager = new ImageCaptionManager(plugin);
    manager.refresh();

    // Assert: trailing backslash stripped
    expect(img.getAttribute('alt')).toBe('sample');
    expect(embed.getAttribute('alt')).toBe('sample');
  });

  it('15.12 Table backslash non-table: given image NOT in table with alt ending in backslash, when refreshed, then backslash preserved', () => {
    // Arrange: outside table, trailing backslash should remain (intentional content)
    const { embed, img } = setupEmbed('caption\\', 'imgs/pic.png');

    // Act
    const manager = new ImageCaptionManager(plugin);
    manager.refresh();

    // Assert: not in table, so backslash preserved
    expect(img.getAttribute('alt')).toBe('caption\\');
  });
});
