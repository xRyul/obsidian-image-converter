import { App, TFile, Notice, MarkdownView } from "obsidian";
import { EditorView } from "@codemirror/view";
import { LinkFormat, PathFormat } from "./LinkFormatSettings";
import { NonDestructiveResizePreset, ResizeScaleMode, ResizeUnits } from "./NonDestructiveResizeSettings";


export class LinkFormatter {

    constructor(private app: App) { }

    async formatLink(
        linkPath: string,
        linkFormat: LinkFormat,
        pathFormat: PathFormat,
        activeFile: TFile | null,
        resizePreset?: NonDestructiveResizePreset | null
    ): Promise<string> {
        if (!linkPath) {
            throw new Error("Link path cannot be empty.");
        }

        // Get the TFile object using the provided linkPath
        const file = this.app.vault.getAbstractFileByPath(linkPath);

        // Check if the file exists
        if (!(file instanceof TFile)) {
            throw new Error(`No file found at path: ${linkPath}`);
        }

        const formattedPath = this.formatPath(
            file,
            linkFormat,
            pathFormat,
            activeFile
        );

        let resizeParams = "";
        if (resizePreset) {
            resizeParams = await this.getResizeParams(
                resizePreset,
                file
            );
        }

        return linkFormat === "wikilink"
            ? `![[${formattedPath}${resizeParams}]]`
            : `![${resizeParams}](${this.encodeMarkdownPath(formattedPath)})`;
    }

    private encodeMarkdownPath(path: string): string {
        return path.replace(/\s/g, '%20');
    }

    private formatPath(
        file: TFile,
        linkFormat: LinkFormat,
        pathFormat: PathFormat,
        activeFile: TFile | null
    ): string {
        switch (pathFormat) {
            case "shortest":
                return file.name
            case "absolute":
                return this.formatAbsolutePath(file);
            case "relative":
                return this.formatRelativePath(file, activeFile);
            default:
                throw new Error(`Invalid path format: ${pathFormat}`);
        }
    }


    private formatAbsolutePath(file: TFile): string {
        return `/${file.path}`; // Add the leading slash back
    }

    private formatRelativePath(file: TFile, activeFile: TFile | null): string {
        if (!activeFile) {
            throw new Error("Cannot format relative path without an active file.");
        }

        if (!activeFile.parent) {
            throw new Error("Active file does not have a parent directory.");
        }

        const relativePath = this.getRelativePath(activeFile.path, file.path);

        // Always ensure we have either ./ or ../ prefix
        if (!relativePath.startsWith('../') && !relativePath.startsWith('./')) {
            return `./${relativePath}`;
        }

        return relativePath;
    }

    // Helper function to calculate relative path (can be made static)
    private getRelativePath(fromPath: string, toPath: string): string {
        const fromParts = fromPath.split("/").slice(0, -1); // Remove filename
        const toParts = toPath.split("/");

        // Find common path segments
        let commonCounter = 0;
        while (commonCounter < fromParts.length && commonCounter < toParts.length) {
            if (fromParts[commonCounter] !== toParts[commonCounter]) {
                break;
            }
            commonCounter++;
        }

        // Build the relative path
        let relativePath = "";

        // Add "../" for each level we need to go up
        for (let i = commonCounter; i < fromParts.length; i++) {
            relativePath += "../";
        }

        // Add the remaining path to the target
        relativePath += toParts.slice(commonCounter).join("/");

        // If we're in the same directory, prefix with "./"
        if (relativePath === toParts[toParts.length - 1]) {
            relativePath = `./${relativePath}`;
        }

        return relativePath;
    }


    // Add helper function to generate resize parameters
    private async getResizeParams(
        preset: NonDestructiveResizePreset,
        file: TFile
    ): Promise<string> {
        let resizeParams = "";
        const originalDimensions = await this.getImageDimensions(file);

        if (!originalDimensions) {
            console.warn(
                `Could not get dimensions for ${file.name}. No resizing applied.`
            );
            return "";
        }

        let width: number | undefined;
        let height: number | undefined;
        let longestEdge: number | undefined;
        let shortestEdge: number | undefined;

        // 1. Calculate Dimensions Based on Preset
        switch (preset.resizeDimension) {
            case "width":
                width = this.getDimensionValue(
                    preset.width,
                    originalDimensions.width,
                    preset.resizeUnits
                );

                // Calculate height only if maintainAspectRatio is true
                if (preset.maintainAspectRatio) {
                    height = Math.round(
                        (width ?? 0) *
                        originalDimensions.height /
                        originalDimensions.width
                    );

                }

                break;
            case "height":
                height = this.getDimensionValue(
                    preset.height,
                    originalDimensions.height,
                    preset.resizeUnits
                );
                // Calculate width only if maintainAspectRatio is true
                if (preset.maintainAspectRatio) {
                    width = Math.round(
                        (height ?? 0) *
                        originalDimensions.width /
                        originalDimensions.height
                    );
                }
                break;
            case "both":
                if (preset.customValue) {
                    const dimensions = this.parseCustomDimensions(
                        preset.customValue,
                        originalDimensions,
                        preset.resizeUnits
                    );
                    ({ width, height } = dimensions);
                }
                break;
            case "longest-edge":
                longestEdge = this.getDimensionValue(
                    preset.longestEdge,
                    Math.max(
                        originalDimensions.width,
                        originalDimensions.height
                    ),
                    preset.resizeUnits
                );
                // Calculate width and height based on the longest edge ONLY if maintainAspectRatio is true
                if (preset.maintainAspectRatio) {
                    if (originalDimensions.width >= originalDimensions.height) {
                        width = longestEdge;
                        height = Math.round(
                            (width ?? 0) *
                            originalDimensions.height /
                            originalDimensions.width
                        );
                    } else {
                        height = longestEdge;
                        width = Math.round(
                            (height ?? 0) *
                            originalDimensions.width /
                            originalDimensions.height
                        );
                    }
                } else {
                    // If not maintaining aspect ratio, only set the longest edge
                    width =
                        originalDimensions.width >= originalDimensions.height
                            ? longestEdge
                            : undefined;
                    height =
                        originalDimensions.height > originalDimensions.width
                            ? longestEdge
                            : undefined;
                }
                break;
            case "shortest-edge":
                shortestEdge = this.getDimensionValue(
                    preset.shortestEdge,
                    Math.min(
                        originalDimensions.width,
                        originalDimensions.height
                    ),
                    preset.resizeUnits
                );
                // Calculate width and height based on the shortest edge ONLY if maintainAspectRatio is true
                if (preset.maintainAspectRatio) {
                    if (originalDimensions.width < originalDimensions.height) {
                        width = shortestEdge;
                        height = Math.round(
                            (width ?? 0) *
                            originalDimensions.height /
                            originalDimensions.width
                        );
                    } else {
                        height = shortestEdge;
                        width = Math.round(
                            (height ?? 0) *
                            originalDimensions.width /
                            originalDimensions.height
                        );
                    }
                } else {
                    // If not maintaining aspect ratio, only set the shortest edge
                    width =
                        originalDimensions.width < originalDimensions.height
                            ? shortestEdge
                            : undefined;
                    height =
                        originalDimensions.height <= originalDimensions.width
                            ? shortestEdge
                            : undefined;
                }
                break;
            case "original-width":
                ({ width, height } = originalDimensions);
                height = preset.maintainAspectRatio
                    ? height
                    : undefined;
                break;
            case "editor-max-width": {
                const editorMaxWidth = this.getEditorMaxWidth();

                if (!editorMaxWidth || isNaN(editorMaxWidth)) {
                    console.warn("Invalid editorMaxWidth:", editorMaxWidth);
                    return "";
                }

                if (preset.editorMaxWidthValue === undefined || isNaN(preset.editorMaxWidthValue)) {
                    console.warn("Invalid editorMaxWidthValue:", preset.editorMaxWidthValue);
                    return "";
                }

                // Calculate the target width
                const targetWidth = preset.resizeUnits === "percentage"
                    ? Math.round((editorMaxWidth * preset.editorMaxWidthValue) / 100)
                    : preset.editorMaxWidthValue;

                width = targetWidth;

                // Always calculate height if we have original dimensions
                if (originalDimensions && originalDimensions.width > 0) {
                    const scalingFactor = targetWidth / originalDimensions.width;
                    height = Math.round(originalDimensions.height * scalingFactor);

                    // Apply aspect ratio constraints only if maintainAspectRatio is true
                    if (preset.maintainAspectRatio) {
                        const maxHeightToWidthRatio = 2;
                        if (height / width > maxHeightToWidthRatio) {
                            height = Math.round(width * maxHeightToWidthRatio);
                            width = Math.round(height * (originalDimensions.width / originalDimensions.height));
                        }
                    }
                } else {
                    // Fallback height if no original dimensions
                    height = Math.round(width * 0.75); // 4:3 aspect ratio as fallback
                }

                break;
            }
            case "none":
            default:
                return ""; // No resize parameters
        }

        // 2. Apply Scale Mode (Reduce/Enlarge)
        if (width !== undefined) {
            width = this.applyScaleModeToDimension(
                width,
                originalDimensions.width,
                preset.resizeScaleMode
            );
        }
        if (height !== undefined) {
            height = this.applyScaleModeToDimension(
                height,
                originalDimensions.height,
                preset.resizeScaleMode
            );
        }

        // 3. Apply Editor Max Width Constraint (if applicable and width is defined)
        if (preset.respectEditorMaxWidth && width !== undefined) {
            const editorMaxWidth = this.getEditorMaxWidth();
            if (width > editorMaxWidth) {
                if (preset.maintainAspectRatio && height !== undefined) {
                    height = Math.round(
                        editorMaxWidth *
                        originalDimensions.height /
                        originalDimensions.width
                    );
                }
                width = editorMaxWidth;
            }
        }

        // 4. Ensure Both Width and Height Are Present (ONLY if maintainAspectRatio is FALSE)
        if (!preset.maintainAspectRatio) {
            if (width === undefined && height !== undefined) {
                // Only set width to original if height is defined and we're not maintaining aspect ratio
                width = originalDimensions ? originalDimensions.width : 100;
            } else if (width === undefined) {
                // Only provide fallback if width is still undefined
                width = 100
            }

            if (height === undefined && width !== undefined) {
                // Only set height to original if width is defined and we're not maintaining aspect ratio
                height = originalDimensions ? originalDimensions.height : 100;
            } else if (height === undefined) {
                // Only provide fallback if height is still undefined
                height = 100;
            }
        }


        // 5. Build Resize Parameter String (Handle undefined width/height)
        if (width !== undefined || height !== undefined) {
            const roundedWidth = width !== undefined ? Math.round(width) : undefined;
            const roundedHeight = height !== undefined ? Math.round(height) : undefined;
            resizeParams = `|${roundedWidth ?? ""}x${roundedHeight ?? ""}`;
        } else {
            resizeParams = "";
        }

        return resizeParams;
    }

    private getDimensionValue(presetValue: number | undefined, originalDimension: number, resizeUnits: ResizeUnits): number | undefined {
        if (presetValue === undefined) return undefined;
        if (resizeUnits === "percentage") {
            return Math.round(originalDimension * presetValue / 100);
        }
        return presetValue;
    }

    private parseCustomDimensions(customValue: string, originalDimensions: { width: number, height: number }, resizeUnits: ResizeUnits): { width: number | undefined, height: number | undefined } {
        const match = customValue.match(/(\d*(?:\.\d+)?)(%)?x(\d*(?:\.\d+)?)(%)?/); // Allow decimal percentages
        if (!match) return { width: undefined, height: undefined };

        let width = match[1] ? parseFloat(match[1]) : undefined;
        let height = match[3] ? parseFloat(match[3]) : undefined;

        if (resizeUnits === "percentage") {
            if (width !== undefined) {
                width = Math.round(originalDimensions.width * width / 100);
            }
            if (height !== undefined) {
                height = Math.round(originalDimensions.height * height / 100);
            }
        }

        return { width, height };
    }

    private applyScaleModeToDimension(currentDimension: number, originalDimension: number, scaleMode: ResizeScaleMode): number {
        if (scaleMode === "reduce" && currentDimension > originalDimension) {
            return originalDimension;
        }
        if (scaleMode === "enlarge" && currentDimension < originalDimension) {
            return originalDimension;
        }
        return currentDimension;
    }

    /**
         * `getEditorMaxWidth`
         *
         * Calculates the maximum width (in pixels) available for content within the editor.
         * This function specifically targets the width of a single line element (`cm-line`)
         * in the CodeMirror 6 editor, providing a good approximation of the usable
         * horizontal space for text.
         *
         * **Why this approach?**
         * - The Obsidian API does not directly expose the editor's line width.
         * - We need to measure the width of a `cm-line` element, which is an internal
         *   implementation detail of CodeMirror.
         * - `clientWidth` is used because it gives the inner width of the element
         *   (including padding), which closely reflects the actual space available
         *   for text content.
         *
         * **Important Considerations:**
         * - This method relies on the `cm-line` class, which is part of CodeMirror 6's
         *   internal structure. Future CodeMirror updates *could* potentially change this,
         *   although it's less likely than changes to higher-level CSS classes.
         * - If the editor is empty, there might be no `cm-line` element. The function
         *   handles this with a fallback.
         * - This is still an approximation. Minor variations in line width might occur
         *   due to font size differences or other styling applied to specific lines.
         *
         * @returns {number} The maximum width available for content in the editor (width of a `cm-line`),
         *                   or 800 as a default if the width cannot be determined.
         */
    private getEditorMaxWidth(): number {

        // -------------------- OPTION 1. ------------------------- 
        // FULL WIDTH OF WHOLE EDITOR ARE
        // Get the width of the editor container (adjust the selector as needed)
        // const editorContainer = document.querySelector(
        //     ".cm-editor"
        // ) as HTMLElement;
        // if (!editorContainer) {
        //     console.warn("Editor container not found. Using default width.");
        //     return 800; // Default width
        // }

        // // Get computed styles
        // const computedStyles = window.getComputedStyle(editorContainer);

        // // Extract width, padding, and margin
        // const width = parseFloat(computedStyles.width);
        // const paddingLeft = parseFloat(computedStyles.paddingLeft);
        // const paddingRight = parseFloat(computedStyles.paddingRight);
        // const marginLeft = parseFloat(computedStyles.marginLeft);
        // const marginRight = parseFloat(computedStyles.marginRight);

        // // Calculate usable width
        // const usableWidth =
        //     width - paddingLeft - paddingRight - marginLeft - marginRight;


        // -------------------- OPTION 2. ------------------------- 
        //ONLY area where we can actually write - USE ONLY WIDTH
        const activeLeaf = this.app.workspace.getMostRecentLeaf();

        // If no active leaf or view is found, return the default width.
        if (!activeLeaf || !activeLeaf.view) {
            console.log("Active leaf or view not found, using default 800");
            return 800;
        }

        // Ensure the active view is a MarkdownView and has an associated editor.
        if (
            !(activeLeaf.view instanceof MarkdownView) ||
            !activeLeaf.view.editor
        ) {
            console.log(
                "Active view is not a MarkdownView or has no editor, using default 800"
            );
            return 800;
        }

        const { view } = activeLeaf;
        const { editor } = view;

        // Access the CodeMirror EditorView through the Obsidian Editor.
        // We temporarily use `as any` to bypass type checking for the undocumented `.cm` property,
        // and then immediately cast it to `EditorView` for type safety.
        const editorView = (editor as any).cm as EditorView;

        // If we cannot access the CodeMirror EditorView, return the default width.
        if (!editorView) {
            console.warn("Could not access CodeMirror EditorView");
            return 800;
        }

        // Get the width of a cm-line element (which represents a single line of text).
        // `contentDOM` is the element in CodeMirror 6 that directly contains the lines of code/text.
        // `clientWidth` provides the inner width of the element, including padding but excluding borders and margins.
        // The optional chaining operator (`?.`) ensures that if `querySelector` returns null (e.g., in an empty editor),
        // we don't throw an error.
        const contentWidth =
            editorView.contentDOM.querySelector(".cm-line")?.clientWidth;

        // If we cannot determine the content width (e.g., the editor is empty), return the default width.
        if (!contentWidth) {
            console.warn("Could not determine content width, using default 800");
            return 800;
        }

        return contentWidth;
    }

    // Helper function to get image dimensions (using async/await)
    private async getImageDimensions(
        file: TFile
    ): Promise<{ width: number; height: number } | null> {
        return new Promise((resolve) => {
            const img = new Image();

            img.onload = () => {
                // console.log(`Loaded dimensions for ${file.name}:`, { width: img.width, height: img.height });
                resolve({ width: img.width, height: img.height });
            };

            img.onerror = (error) => {
                // console.error(`Failed to load image ${file.name}:`, error);
                new Notice(`Failed to load image dimensions for ${file.name}`);
                resolve(null);
            };

            const resourcePath = this.app.vault.getResourcePath(file);
            // console.log(`Loading image from path: ${resourcePath}`);
            img.src = resourcePath;
        });
    }
}