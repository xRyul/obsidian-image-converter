import { MarkdownView } from "obsidian"
import ImageConverterPlugin from "./main";

export class ImageCaptionManager {
    private observer: MutationObserver | null = null;
    private observerTimeout: ReturnType<typeof setTimeout> | null = null;
    private processing = false;

    constructor(private plugin: ImageConverterPlugin) {
        this.initializeObserver();
        this.applyCaptionStyles();
        this.applyCaptionClass();
    }

    initializeObserver() {
        // Cleanup existing observer if any
        this.cleanup();

        this.observer = new MutationObserver((mutations) => this.handleMutations(mutations));

        // Start observing with specific configuration
        this.startObserving();
    }

    private startObserving() {
        if (!this.observer) return;

        const config = {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['alt', 'src', 'class']
        };

        const activeView = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
        if (!activeView) return;

        this.observer.observe(activeView.contentEl, config);
    }

    private handleMutations(mutations: MutationRecord[]) {
        if (this.processing) return;
        this.processing = true;

        // Clear existing timeout
        if (this.observerTimeout) {
            clearTimeout(this.observerTimeout);
        }

        // Filter mutations first
        const relevantMutations = mutations.filter(mutation => {
            const target = mutation.target as Element;

            // For childList mutations, check if any added nodes are relevant
            if (mutation.type === 'childList') {
                return Array.from(mutation.addedNodes).some(node =>
                    this.isRelevantNode(node as Element));
            }

            if (mutation.type === 'attributes') {
                return this.isRelevantNode(target);
            }

            return false;
        });

        // Only log relevant mutations
        // if (relevantMutations.length > 0) {
        //     console.log("Relevant Mutations:", relevantMutations.map(m => ({
        //         type: m.type,
        //         target: (m.target as Element).className,
        //         attributeName: m.attributeName
        //     })));
        // }

        // Debounce the processing
        this.observerTimeout = setTimeout(() => {
            try {
                if (relevantMutations.length > 0) {
                    this.processImageCaptions();
                }
            } catch (error) {
                console.error('Error processing mutations:', error);
            } finally {
                this.processing = false;
            }
        }, 100);
    }

    private isRelevantNode(node: Element): boolean {
        if (!(node instanceof Element)) return false;

        const { className } = node;

        // Handle case where className might be undefined or not a string
        if (typeof className !== 'string') return false;

        // Ignore CodeMirror and resize-related elements
        if (className.includes('cm-') || className.includes('image-resize') || className.includes("cm-content cm-lineWrapping")) return false;

        // Only match exactly what we need
        return node.matches('div.image-embed, div.callout') ||
            !!node.querySelector('div.image-embed, div.callout');
    }

    private processImageCaptions() {
        // Temporarily disconnect observer to prevent infinite loops
        this.observer?.disconnect();

        try {
            const activeView = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
            if (activeView) {
                activeView.contentEl.querySelectorAll('.image-embed').forEach(embed => {
                    this.processImageEmbed(embed as HTMLElement);
                });
            }

            // Process images in callouts specifically
            document.querySelectorAll('.callout .image-embed').forEach(embed => {
                this.processImageEmbed(embed as HTMLElement, true);
            });
        } finally {
            // Reconnect observer
            this.startObserving();
        }
    }

    private processImageEmbed(embed: HTMLElement, isInCallout = false) {
        const img = embed.querySelector('img');
        if (!img) return;

        const { enableImageCaptions, skipCaptionExtensions } = this.plugin.settings;
        if (!enableImageCaptions) return;

        // Get the actual width of the image
        const imgWidth = img.width || img.getAttribute('width');
        if (imgWidth) {
            embed.style.setProperty('--img-width', `${imgWidth}px`);
        }

        const embedSrc = embed.getAttribute('src') || '';
        let altText = img.getAttribute('alt') || '';
        const extension = embedSrc.split('.').pop()?.split('?')[0]?.toLowerCase() || '';
        const excludedExtensions = skipCaptionExtensions.split(',').map(ext => ext.trim().toLowerCase());

        // Fix: Strip trailing backslash from alt text
        // This occurs when Obsidian escapes pipes in wikilinks inside tables (e.g., ![[path\|caption\|450]])
        // Obsidian's rendering incorrectly includes the backslash in the caption (alt="sample\")
        // Check if we're in a table context and the alt ends with backslash
        const isInTable = embed.closest('table, .table-cell-wrapper, .cm-table-widget') !== null;
        if (isInTable && altText.endsWith('\\')) {
            altText = altText.slice(0, -1);
            // Update both img and embed alt attributes to fix the rendered caption
            img.setAttribute('alt', altText);
            embed.setAttribute('alt', altText);
        }

        // Handle caption visibility
        const isFilename = altText.trim().toLowerCase() === embedSrc.trim().toLowerCase();
        const shouldHideCaption = excludedExtensions.includes(extension) || isFilename;

        if (shouldHideCaption) {
            embed.removeAttribute('alt');
            img.removeAttribute('alt');
        } else if (isInCallout) {
            // Special handling for callout images
            embed.setAttribute('data-in-callout', 'true');
            if (altText) {
                embed.setAttribute('alt', altText);
            }
        }
    }

    applyCaptionClass() {
        const { enableImageCaptions, skipCaptionExtensions } = this.plugin.settings;
        const excludedExtensions = skipCaptionExtensions.split(',').map(ext => ext.trim().toLowerCase());

        if (enableImageCaptions) {
            document.body.classList.add('image-captions-enabled');

            document.querySelectorAll('.image-embed').forEach(embed => {
                const img = embed.querySelector('img');
                if (img) {
                    const embedSrc = embed.getAttribute('src') ?? '';
                    let altText = img.getAttribute('alt') ?? '';
                    const extension = embedSrc.split('.').pop()?.split('?')[0]?.toLowerCase() ?? '';

                    // Fix: Strip trailing backslash from alt text in tables
                    const isInTable = embed.closest('table, .table-cell-wrapper, .cm-table-widget') !== null;
                    if (isInTable && altText.endsWith('\\')) {
                        altText = altText.slice(0, -1);
                        img.setAttribute('alt', altText);
                        embed.setAttribute('alt', altText);
                    }

                    const isFilename = altText.trim().toLowerCase() === embedSrc.trim().toLowerCase();
                    const shouldHideCaption = excludedExtensions.includes(extension) || isFilename;

                    if (shouldHideCaption) {
                        embed.removeAttribute('alt');
                        img.removeAttribute('alt');
                    }
                }
            });
        } else {
            document.body.classList.remove('image-captions-enabled');
        }
    }

    applyCaptionStyles() {
        const {
            captionFontSize,
            captionColor,
            captionFontStyle,
            captionBackgroundColor,
            captionPadding,
            captionBorderRadius,
            captionMarginTop,
            captionOpacity,
            captionFontWeight,
            captionTextTransform,
            captionLetterSpacing,
            captionBorder,
            captionAlignment
        } = this.plugin.settings;

        // Compute align-items value from alignment setting
        const alignItems = captionAlignment === 'left' ? 'flex-start'
            : captionAlignment === 'right' ? 'flex-end' : 'center';

        // Helper to set or remove CSS custom properties based on value
        const rootStyle = document.body.style;
        const setOrRemove = (name: string, value: string | number | null | undefined) => {
            if (value != null && value !== '') {
                rootStyle.setProperty(name, String(value));
            } else {
                rootStyle.removeProperty(name);
            }
        };

        // Set CSS custom properties on document.body for caption styling
        rootStyle.setProperty('--image-converter-caption-align-items', alignItems);
        setOrRemove('--image-converter-caption-font-size', captionFontSize);
        setOrRemove('--image-converter-caption-color', captionColor);
        setOrRemove('--image-converter-caption-bg', captionBackgroundColor);
        setOrRemove('--image-converter-caption-opacity', captionOpacity);
        setOrRemove('--image-converter-caption-margin-top', captionMarginTop);
        setOrRemove('--image-converter-caption-padding', captionPadding);
        setOrRemove('--image-converter-caption-border-radius', captionBorderRadius);
        setOrRemove('--image-converter-caption-font-style', captionFontStyle);
        setOrRemove('--image-converter-caption-font-weight', captionFontWeight);
        setOrRemove('--image-converter-caption-text-transform', captionTextTransform);
        setOrRemove('--image-converter-caption-letter-spacing', captionLetterSpacing);
        setOrRemove('--image-converter-caption-border', captionBorder);
        setOrRemove('--image-converter-caption-text-align', captionAlignment);
    }

    public refresh() {
        this.processImageCaptions();
        this.applyCaptionClass();
        this.applyCaptionStyles();
    }

    public updateStyles() {
        this.applyCaptionStyles();
    }

    public cleanup() {
        if (this.observer) {
            this.observer.disconnect();
            this.observer = null;
        }

        if (this.observerTimeout) {
            clearTimeout(this.observerTimeout);
            this.observerTimeout = null;
        }

        // Remove CSS custom properties
        document.body.style.removeProperty('--image-converter-caption-align-items');
        document.body.style.removeProperty('--image-converter-caption-font-size');
        document.body.style.removeProperty('--image-converter-caption-color');
        document.body.style.removeProperty('--image-converter-caption-bg');
        document.body.style.removeProperty('--image-converter-caption-opacity');
        document.body.style.removeProperty('--image-converter-caption-margin-top');
        document.body.style.removeProperty('--image-converter-caption-padding');
        document.body.style.removeProperty('--image-converter-caption-border-radius');
        document.body.style.removeProperty('--image-converter-caption-font-style');
        document.body.style.removeProperty('--image-converter-caption-font-weight');
        document.body.style.removeProperty('--image-converter-caption-text-transform');
        document.body.style.removeProperty('--image-converter-caption-letter-spacing');
        document.body.style.removeProperty('--image-converter-caption-border');
        document.body.style.removeProperty('--image-converter-caption-text-align');
    }
}

