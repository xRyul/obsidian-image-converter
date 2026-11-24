// eslint-disable-next-line import/no-nodejs-modules -- this test reads the plugin stylesheet from disk.
import { readFileSync } from 'node:fs';
// eslint-disable-next-line import/no-nodejs-modules -- this test reads the plugin stylesheet from disk.
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const pluginStyles = readFileSync(resolve(process.cwd(), 'styles.css'), 'utf8');

describe('native image selection compatibility styles', () => {
  beforeEach(() => {
    document.head.replaceChildren();
    document.body.className = 'image-converter-disable-native-image-selection';
    document.body.replaceChildren();

    const sourceView = document.createElement('div');
    sourceView.className = 'markdown-source-view mod-cm6';
    const embed = document.createElement('div');
    embed.className = 'internal-embed media-embed image-embed';
    const actions = document.createElement('div');
    actions.className = 'embed-actions';

    embed.appendChild(actions);
    sourceView.appendChild(embed);
    document.body.appendChild(sourceView);

    // eslint-disable-next-line obsidianmd/no-forbidden-elements -- the stylesheet must be applied to verify computed CSS.
    const style = document.createElement('style');
    style.textContent = pluginStyles;
    document.head.appendChild(style);
  });

  afterEach(() => {
    document.head.replaceChildren();
    document.body.className = '';
    document.body.replaceChildren();
  });

  it('hides the Obsidian 1.13 image actions when native image selection is disabled', () => {
    const actions = document.querySelector<HTMLElement>('.embed-actions');

    expect(actions).not.toBeNull();
    expect(getComputedStyle(actions!).display).toBe('none');
    expect(getComputedStyle(actions!).pointerEvents).toBe('none');
  });

  it('leaves Obsidian image actions available when native image selection is enabled', () => {
    document.body.classList.remove('image-converter-disable-native-image-selection');
    const actions = document.querySelector<HTMLElement>('.embed-actions');

    expect(actions).not.toBeNull();
    expect(getComputedStyle(actions!).display).not.toBe('none');
    expect(getComputedStyle(actions!).pointerEvents).not.toBe('none');
  });

  it('hides the floating image preview only while revealing Markdown inside a table cell', () => {
    const sourceView = document.querySelector<HTMLElement>('.markdown-source-view');
    const tableWidget = document.createElement('div');
    tableWidget.className = 'cm-table-widget';
    const tableTooltip = document.createElement('div');
    tableTooltip.className = 'cm-image-reveal-tooltip';
    const regularTooltip = document.createElement('div');
    regularTooltip.className = 'cm-image-reveal-tooltip';

    tableWidget.appendChild(tableTooltip);
    sourceView!.appendChild(tableWidget);
    sourceView!.appendChild(regularTooltip);

    expect(getComputedStyle(tableTooltip).display).toBe('none');
    expect(getComputedStyle(tableTooltip).pointerEvents).toBe('none');
    expect(getComputedStyle(regularTooltip).display).not.toBe('none');
  });
});
