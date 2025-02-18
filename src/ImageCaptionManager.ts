import { MarkdownView } from "obsidian"
import ImageConverterPlugin from "./main";

export class ImageCaptionManager {
    private observer: MutationObserver | null = null;
    private observerTimeout: NodeJS.Timeout | null = null;
    private processing = false;

    constructor(private plugin: ImageConverterPlugin) {
        this.initializeObserver();
        this.applyCaptionStyles();
        this.applyCaptionClass();
    }

    initializeObserver() {
        // Cleanup existing observer if any
        this.cleanup();

        this.observer = new MutationObserver(this.handleMutations.bind(this));

        // Start observing with specific configuration
        this.startObserving();
    }

    private startObserving() {
        if (!this.observer) return;

        const config: MutationObserverInit = {
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

        const className = node.className;

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
        const altText = img.getAttribute('alt') || '';
        const extension = embedSrc.split('.').pop()?.split('?')[0]?.toLowerCase() || '';
        const excludedExtensions = skipCaptionExtensions.split(',').map(ext => ext.trim().toLowerCase());

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
                    const altText = img.getAttribute('alt') ?? '';
                    const extension = embedSrc.split('.').pop()?.split('?')[0]?.toLowerCase() ?? '';

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
        const styleId = 'image-caption-styles';
        let styleElement = document.getElementById(styleId) as HTMLStyleElement;

        if (!styleElement) {
            styleElement = document.createElement('style');
            styleElement.id = styleId;
            document.head.appendChild(styleElement);
        }

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

        styleElement.textContent = `
            /* Container styling */
            .image-captions-enabled .internal-embed.image-embed[alt] {
                display: flex !important;
                flex-direction: column;
                align-items: ${captionAlignment === 'center' ? 'center' :
                captionAlignment === 'left' ? 'flex-start' :
                    'flex-end'};
                justify-content: center;
                width: fit-content;
            }
        
            /* Caption styling */
            .image-captions-enabled .image-embed[alt]:after {
                display: block;
                width: var(--img-width);
                font-family: var(--font-interface);
                font-size: ${captionFontSize || 'var(--font-smaller)'};
                color: ${captionColor || 'var(--text-gray)'};
                background-color: ${captionBackgroundColor || 'transparent'};
                opacity: ${captionOpacity || '1'};
                content: attr(alt);
                margin-top: ${captionMarginTop || '4px'};
                padding: ${captionPadding || '2px 4px'};
                border-radius: ${captionBorderRadius || '0'};
                font-style: ${captionFontStyle || 'italic'};
                font-weight: ${captionFontWeight || 'normal'};
                text-transform: ${captionTextTransform || 'none'};
                letter-spacing: ${captionLetterSpacing || 'normal'};
                border: ${captionBorder || 'none'};
                text-align: ${captionAlignment || 'center'};
                transition: all 0.2s ease;
                box-sizing: border-box;
            }
        
            /* Image styling */
            .image-captions-enabled .image-embed[alt] img {
                display: block;
                max-width: 100%;
                height: auto;
            }
        `;
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
    }
}

