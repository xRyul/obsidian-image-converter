import { App, Component, Menu, TFile } from 'obsidian';
import ImageConverterPlugin from './main';
import { ImageAlignmentManager, ImagePositionData } from './ImageAlignmentManager';

export interface ImageAlignmentOptions {
    align: 'left' | 'center' | 'right' | 'none';
    wrap: boolean;
}

export class ImageAlignment extends Component {

    constructor(
        private app: App,
        private plugin: ImageConverterPlugin,
        private imageAlignmentManager: ImageAlignmentManager
    ) { super(); }

    /**
     * Adds image alignment options to the context menu.
     * @param menu - The context menu instance.
     * @param img - The target image element.
     * @param activeFile - The currently active file.
     */
    addAlignmentOptionsToContextMenu(menu: Menu, img: HTMLImageElement, activeFile: TFile) {
        menu.addItem((item) => {
            item
                .setTitle('Align image')
                .setIcon('align-justify')
                .setSubmenu()
                .addItem((subItem) => {
                    const currentAlignment = this.getCurrentImageAlignment(img);
                    subItem
                        .setTitle('Left')
                        .setIcon('align-left')
                        .setChecked(currentAlignment.align === 'left')
                        .onClick(async () => {
                            await this.updateImageAlignment(img, { align: currentAlignment.align === 'left' ? 'none' : 'left', wrap: currentAlignment.wrap });
                        });
                })
                .addItem((subItem) => {
                    const currentAlignment = this.getCurrentImageAlignment(img);
                    subItem
                        .setTitle('Center')
                        .setIcon('align-center')
                        .setChecked(currentAlignment.align === 'center')
                        .onClick(async () => {
                            await this.updateImageAlignment(img, { align: currentAlignment.align === 'center' ? 'none' : 'center', wrap: currentAlignment.wrap });
                        });
                })
                .addItem((subItem) => {
                    const currentAlignment = this.getCurrentImageAlignment(img);
                    subItem
                        .setTitle('Right')
                        .setIcon('align-right')
                        .setChecked(currentAlignment.align === 'right')
                        .onClick(async () => {
                            await this.updateImageAlignment(img, { align: currentAlignment.align === 'right' ? 'none' : 'right', wrap: currentAlignment.wrap });
                        });
                })
                .addSeparator()
                .addItem((subItem) => {
                    const currentAlignment = this.getCurrentImageAlignment(img);
                    subItem
                        .setTitle('Wrap Text')
                        .setChecked(currentAlignment.wrap)
                        .onClick(async () => {
                            // Default to left alignment if no alignment is set
                            const newAlign = currentAlignment.align === 'none' ? 'left' : currentAlignment.align;
                            await this.updateImageAlignment(img, { align: newAlign, wrap: !currentAlignment.wrap });
                        });
                });
        });
    }
    
    /**
     * Applies alignment styles to an image based on cached data. THIS is called from ImageAlignmentManager!
     * @param img - The target image element.
     * @param positionData - The cached alignment data.
     */
    public applyAlignmentToImage(img: HTMLImageElement, positionData: ImagePositionData) {
        if (!positionData) {
            console.error("No position data provided for image:", img.src);
            return;
        }

        // Always apply alignment, do not skip based on current alignment
        // Parent embed handling
        const parentEmbed = img.matchParent('.internal-embed.image-embed'); // Use matchParent
        if (parentEmbed) {
            parentEmbed.removeClass(
                'image-position-left',
                'image-position-center',
                'image-position-right',
                'image-wrap',
                'image-no-wrap'
            );

            if (positionData.position !== 'none') {
                parentEmbed.addClass(`image-position-${positionData.position}`, 'image-converter-aligned');
                parentEmbed.addClass(positionData.wrap ? 'image-wrap' : 'image-no-wrap');
            }
        }

        // Remove existing alignment classes first
        img.removeClass(
            'image-position-left',
            'image-position-center',
            'image-position-right',
            'image-wrap',
            'image-no-wrap',
            'image-converter-aligned'
        );

        // Re-apply alignment unconditionally
        if (positionData.position !== 'none') {
            img.addClass('image-converter-aligned');
            img.addClass(`image-position-${positionData.position}`);
            img.addClass(positionData.wrap ? 'image-wrap' : 'image-no-wrap');

            // Ensure width is applied
            if (positionData.width) {
                img.setCssStyles({ width: positionData.width });
            }
            if (positionData.height) {
                img.setCssStyles({ height: positionData.height });
            }

            // console.log("Alignment applied. New classes:", img.className);
        }

    }

    /**
     * Updates the alignment of an image via contextmenu
     * @param img - The target image element.
     * @param options - The alignment options.
     */
    async updateImageAlignment(img: HTMLImageElement, options: ImageAlignmentOptions) {
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile) return;

        const src = img.getAttribute('src');
        if (!src) return;

        // Use getRelativePath to normalize the src before saving
        const relativeSrc = this.imageAlignmentManager.getRelativePath(src);

        // --- Apply Visual Changes to IMG ---
        img.removeClass(
            'image-position-left',
            'image-position-center',
            'image-position-right',
            'image-wrap',
            'image-no-wrap',
            'image-converter-aligned'
        );
        if (options.align !== 'none') {
            img.addClass(`image-position-${options.align}`, 'image-converter-aligned');
            img.addClass(options.wrap ? 'image-wrap' : 'image-no-wrap');
        }

        // --- Apply Visual Changes to PARENT SPAN ---
        const parentEmbed = img.matchParent('.internal-embed.image-embed');
        if (parentEmbed) {
            parentEmbed.removeClass(
                'image-position-left',
                'image-position-center',
                'image-position-right',
                'image-wrap',
                'image-no-wrap',
                'image-converter-aligned'
            );
            if (options.align !== 'none') {
                parentEmbed.addClass(`image-position-${options.align}`);
                parentEmbed.addClass(options.wrap ? 'image-wrap' : 'image-no-wrap');
            }
        }


        if (options.align === 'none') {
            // Use the hash for removal
            void this.plugin.ImageAlignmentManager!.removeImageFromCache(activeFile.path, relativeSrc);
        } else {
            // Use the hash for saving
            void this.plugin.ImageAlignmentManager!.saveImageAlignmentToCache(
                activeFile.path,
                relativeSrc,  // Use normalized src
                options.align,
                img.style.width,
                img.style.height,
                options.wrap
            );
        }
    }

    /**
     * Gets the current alignment of an image. Check cache first and then fallback to CSS.
     * @param img - The target image element.
     * @returns The current alignment options.
     */
    public getCurrentImageAlignment(img: HTMLImageElement): ImageAlignmentOptions {
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile) return { align: 'none', wrap: false };

        const src = img.getAttr('src'); // Use getAttr instead of getAttribute
        if (!src) return { align: 'none', wrap: false };

        // First, try to get alignment from cache
        const cachedAlignment = this.imageAlignmentManager.getImageAlignment(
            activeFile.path,
            src
        );

        if (cachedAlignment) {
            return {
                align: cachedAlignment.position,
                wrap: cachedAlignment.wrap
            };
        }

        // Fallback to CSS class detection
        const alignClass = Array.from(img.classList).find(c => c.startsWith('image-position-'));
        const align = alignClass
            ? (alignClass.replace('image-position-', '') as 'left' | 'center' | 'right')
            : 'none';
        const wrap = img.hasClass('image-wrap'); // Use hasClass instead of classList.contains
        return { align, wrap };
    }

}