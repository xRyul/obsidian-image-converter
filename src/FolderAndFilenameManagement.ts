// FolderAndFilenameManagement.ts
import { TFile, TFolder, App, normalizePath, Notice, FileSystemAdapter } from "obsidian";
import * as path from 'path';
import {
    ImageConverterSettings,
    FolderPreset,
    FilenamePreset,
    ConversionPreset,
} from "./ImageConverterSettings";
import { VariableProcessor, VariableContext } from "./VariableProcessor";
import { SupportedImageFormats } from "./SupportedImageFormats";

export class FolderAndFilenameManagement {
    constructor(
        private app: App,
        private settings: ImageConverterSettings,
        private supportedImageFormats: SupportedImageFormats,
        private variableProcessor: VariableProcessor
    ) { }

    async determineDestination(
        file: File,
        activeFile: TFile,
        selectedConversionPreset: ConversionPreset,
        selectedFilenamePreset: FilenamePreset,
        selectedFolderPreset: FolderPreset
    ): Promise<{ destinationPath: string; newFilename: string }> {
        // Step 1: Determine the target directory based on folder preset
        const destinationDir = await this.getDestinationDirectory(
            selectedFolderPreset,
            file,
            activeFile
        );

        let newFilename: string;
        let shouldSkipRename = false;

        // Step 2: Handle filename generation based on whether we should skip renaming
        if (selectedFilenamePreset && this.should_skip_rename(file.name, selectedFilenamePreset)) {
            // Skip rename case - use the original name without extension
            newFilename = file.name.substring(0, file.name.lastIndexOf('.'));
            shouldSkipRename = true; // Set the flag

        } else {
            // Normal case - generate a new filename according to preset
            newFilename = await this.generateNewFilename(
                selectedFilenamePreset,
                file,
                activeFile
            );
        }

        // Apply conflict resolution (only if NOT skipping rename)
        if (!shouldSkipRename) {
            newFilename = await this.handleNameConflicts(
                destinationDir,
                newFilename,
                selectedFilenamePreset?.conflictResolution || "reuse"
            );
        }

        // Step 3: Add the appropriate file extension based on conversion settings
        newFilename = this.addCorrectExtension(newFilename, file, selectedConversionPreset);


        // Step 4: Return both the destination path and final filename
        return {
            destinationPath: destinationDir,
            newFilename: newFilename
        };
    }

    private async getDestinationDirectory(
        selectedFolderPreset: FolderPreset,
        file: File,
        activeFile: TFile
    ): Promise<string> {
        let destinationDir = "";

        switch (selectedFolderPreset?.type) {
            case "DEFAULT":
                destinationDir = this.getDefaultAttachmentFolderPath(activeFile);
                break;
            case "ROOT":
                destinationDir = this.app.vault.getRoot().path;
                break;
            case "CURRENT":
                destinationDir = activeFile.parent?.path || "";
                break;
            case "SUBFOLDER": {
                // Use the custom template if provided, otherwise use activeFile.basename
                const subfolderName = this.settings.subfolderTemplate
                    ? await this.processSubfolderVariables(
                        this.settings.subfolderTemplate,
                        file,
                        activeFile
                    )
                    : activeFile.basename;

                destinationDir = activeFile.parent
                    ? normalizePath(
                        activeFile.parent.path + "/" + subfolderName
                    )
                    : subfolderName;
                break;
            }
            case "CUSTOM":
                if (selectedFolderPreset.customTemplate) {
                    destinationDir = await this.processSubfolderVariables(
                        selectedFolderPreset.customTemplate,
                        file,
                        activeFile
                    );
                } else {
                    new Notice("Custom folder template is not defined.");
                    destinationDir = this.getDefaultAttachmentFolderPath(
                        activeFile
                    );
                }
                break;
            default:
                destinationDir = this.getDefaultAttachmentFolderPath(
                    activeFile
                );
        }
        return destinationDir;
    }

    /**
     * Combines a base path and a filename, handling root paths correctly.
     * @param basePath The base path.
     * @param filename The filename.
     * @returns The combined path.
     */
    combinePath(basePath: string, filename: string): string {
        if (basePath === "/") {
            return normalizePath("/" + filename);
        } else {
            return normalizePath(basePath + "/" + filename);
        }
    }

    /**
     * Ensures that a folder exists at the given path, creating it if necessary.
     * Handles case sensitivity by first checking for an exact case match, and if not found, 
     * performs a case-insensitive search for an existing folder. If a folder with a different
     * case is found, its path is used instead.
     *
     * @param path - The path where the folder should exist.
     * @async
     * @throws {Error} If there is an error during folder creation.
     * 
     * @example
     * // Assume a folder "/MyNotes/images" exists in the vault.
     * 
     * // User tries to move an image to "/MyNotes/Images" (uppercase "I").
     * await ensureFolderExists("/MyNotes/Images"); 
     * // The existing "/MyNotes/images" folder will be used (no new folder created).
     *
     * // User tries to move an image to "/MyNotes/IMAGES" (all uppercase).
     * await ensureFolderExists("/MyNotes/IMAGES");
     * // The existing "/MyNotes/images" folder will be used (no new folder created).
     *
     * // User tries to move an image to "/NewFolder/Subfolder" (neither folder exists).
     * await ensureFolderExists("/NewFolder/Subfolder");
     * // Folders "/NewFolder" and "/NewFolder/Subfolder" will be created.
     */
    async ensureFolderExists(path: string): Promise<void> {
        const normalizedPath = normalizePath(path);
        if (!(await this.app.vault.adapter.exists(normalizedPath))) {
            const folders = normalizedPath.split('/').filter(Boolean);
            let currentPath = '';

            for (const folder of folders) {
                currentPath += (currentPath ? '/' : '') + folder;

                if (!(await this.app.vault.adapter.exists(currentPath))) {
                    // Folder doesn't exist (exact case), try case-insensitive search
                    const allFiles = this.app.vault.getAllLoadedFiles();
                    const existingFolder = allFiles.find(file =>
                        file.path.toLowerCase() === currentPath.toLowerCase() && file instanceof TFolder
                    );

                    if (existingFolder) {
                        // Found folder with different case, use it
                        currentPath = existingFolder.path;
                    } else {
                        // No folder found (any case), create it
                        await this.app.vault.createFolder(currentPath);
                    }
                } else {
                    // Folder exists (exact case), check and correct case if needed (original logic)
                    const existingFolder = await this.app.vault.getAbstractFileByPath(currentPath);
                    if (existingFolder && existingFolder.name !== folder) {
                        const newPath = currentPath.substring(0, currentPath.lastIndexOf('/')) + '/' + existingFolder.name;
                        if (await this.app.vault.adapter.exists(newPath)) {
                            currentPath = newPath;  // Use existing folder path
                        } else {
                            // Rare case: renamed folder does not exist, stick to original
                            new Notice(`Warning: Inconsistent folder casing detected. Using original path: ${currentPath}`);
                        }
                    }
                }
            }
        }
    }

    private getDefaultAttachmentFolderPath(activeFile: TFile): string {
        // @ts-ignore
        const configuredPath = this.app.vault.getConfig(
            "attachmentFolderPath"
        );
        if (configuredPath.startsWith("./")) {
            return activeFile.parent?.path
                ? normalizePath(
                    activeFile.parent.path +
                    "/" +
                    configuredPath.substring(2)
                )
                : configuredPath.substring(2);
        } else {
            return normalizePath(configuredPath);
        }
    }

    // Handle filename conflicts by adding a number suffix
    async handleNameConflicts(
        destinationDir: string,
        baseFilename: string,
        conflictMode: "reuse" | "increment" = "reuse"
    ): Promise<string> {
        const normalizedDestination = normalizePath(destinationDir);
        const lastDotIndex = baseFilename.lastIndexOf('.');
        const nameWithoutExt = lastDotIndex > -1
            ? baseFilename.substring(0, lastDotIndex)
            : baseFilename;
        const extension = lastDotIndex > -1
            ? baseFilename.substring(lastDotIndex)
            : '';

        let finalFilename = baseFilename;

        // If reuse mode, just return the original filename
        if (conflictMode === "reuse") {
            return finalFilename;
        }

        // Increment mode logic
        if (await this.app.vault.adapter.exists(`${normalizedDestination}/${finalFilename}`)) {
            let conflictCounter = 1;
            while (await this.app.vault.adapter.exists(`${normalizedDestination}/${nameWithoutExt}-${conflictCounter}${extension}`)) {
                conflictCounter++;
            }
            finalFilename = `${nameWithoutExt}-${conflictCounter}${extension}`;
        }

        return finalFilename;
    }

    async generateNewFilename(
        selectedFilenamePreset: FilenamePreset,
        file: File,
        activeFile: TFile,
        selectedConversionPreset?: ConversionPreset
    ): Promise<string> {
        let newFilename = file.name;

        if (selectedFilenamePreset && selectedFilenamePreset.customTemplate) {
            newFilename = await this.processSubfolderVariables(
                selectedFilenamePreset.customTemplate,
                file,
                activeFile
            );

            // Validate and remove extension if necessary
            newFilename = await this.validateAndRemoveExtension(newFilename, file);
        } else {
            // Default behavior (e.g., original filename without extension)
            newFilename = file.name.substring(0, file.name.lastIndexOf("."));
        }

        return newFilename;
    }

    private async validateAndRemoveExtension(filename: string, file: File): Promise<string> {
        const lastDotIndex = filename.lastIndexOf(".");
        if (lastDotIndex === -1) {
            return filename; // No extension found
        }

        const potentialExtension = filename.substring(lastDotIndex + 1).toLowerCase();

        // Check if the potential extension is supported
        if (this.supportedImageFormats.supportedExtensions.has(potentialExtension)) {
            // Get the mime type of the file
            const mimeType = await this.supportedImageFormats.getMimeTypeFromFile(file);

            // If mime type is known, validate the extension against it
            if (mimeType !== "unknown") {
                const mimeExtensions = this.supportedImageFormats.getExtensionsFromMimeType(mimeType);
                if (mimeExtensions && mimeExtensions.includes(potentialExtension)) {
                    // Valid extension for the given mime type, remove it
                    return filename.substring(0, lastDotIndex);
                } else {
                    // Invalid extension for the given mime type, keep the original filename
                    console.warn(`Mismatched extension for file: ${filename}, based on mime type: ${mimeType}. Keeping original filename.`);
                    return filename;
                }
            } else {
                // Mime type is unknown, remove the extension as a precaution
                console.warn(`Unknown mime type for file: ${filename}. Removing potential extension.`);
                return filename.substring(0, lastDotIndex);
            }
        }

        // Potential extension is not supported, keep the original filename
        return filename;
    }

    private addCorrectExtension(
        filename: string,
        file: File,
        selectedConversionPreset?: ConversionPreset
    ): string {
        const originalExtension = file.name
            .substring(file.name.lastIndexOf("."))
            .toLowerCase();

        // First check if conversion should be skipped
        if (selectedConversionPreset && this.should_skip_conversion(file.name, selectedConversionPreset)) {
            return filename + originalExtension;
        }

        // If not skipped, proceed with normal conversion logic
        const outputFormat = selectedConversionPreset
            ? selectedConversionPreset.outputFormat
            : this.settings.outputFormat;
        switch (outputFormat) {
            case "WEBP":
                return filename + ".webp";
            case "JPEG":
                return filename + ".jpeg";  // Corrected to .jpeg
            case "PNG":
                return filename + ".png";
            case "AVIF": // Correctly handle AVIF
                return filename + ".avif";
            case "ORIGINAL":
            case "NONE":
            default:
                return filename + originalExtension;
        }
    }

    /**
     * Sanitizes a filename by removing or replacing invalid characters, handling reserved names,
     * and ensuring compliance with common filesystem restrictions.
     *
     * @param filename - The filename string to sanitize.
     * @returns The sanitized filename string.
     *
     * **Character Restrictions and Replacements:**
     *
     * - **Invalid Characters:** The following characters are considered invalid and are replaced with underscores (`_`):
     *   - `\ / : * ? " < > | [ ] ( )`
     *
     * - **Reserved Names (Windows):** If the filename matches one of the following reserved names (case-insensitive),
     *   an underscore (`_`) is appended to the end:
     *   - `CON, PRN, AUX, NUL, COM1, COM2, COM3, COM4, COM5, COM6, COM7, COM8, COM9, LPT1, LPT2, LPT3, LPT4, LPT5, LPT6, LPT7, LPT8, LPT9`
     *
     * - **Leading/Trailing Dots:** Leading and trailing dots (`.`) are removed.
     *
     * - **Leading/Trailing Spaces:** Leading and trailing spaces are removed.
     *
     * - **Multiple Consecutive Dots:** Multiple consecutive dots in the middle of the filename are replaced with a single dot.
     *
     * NOT SAFE for FOLDER creation thus removed!! - **Empty Filename:** If the filename is empty or consists only of whitespace after sanitization, it is replaced with `"unnamed"`.
     *
     * - **Length Truncation (Optional):** By default, the maximum length of the sanitized filename (including extension) is 250 characters.
     * 
     * **Allowed Characters:**
     *
     * After sanitization, the filename will only contain the following characters:
     * - Alphanumeric characters (a-z, A-Z, 0-9)
     * - Underscores (`_`)
     * - Spaces (except leading or trailing)
     * - Dots (`.`) (except leading, trailing, or multiple consecutive dots, and it must have an extension)
     *
     * @example
     * ```typescript
     * sanitizeFilename("  My/File\\Name??**.txt  ");    // Returns: "My_File_Name.txt"
     * sanitizeFilename("...file.name...");           // Returns: "file.name"
     * sanitizeFilename("CON");                       // Returns: "CON_"
     * sanitizeFilename("  ");                         // Returns: "unnamed" NOT SAFE for FOLDER creation thus removed!! 
     * sanitizeFilename("...");                        // Returns: "unnamed" NOT SAFE for FOLDER creation thus removed!! 
     * sanitizeFilename("normal_file.txt");           // Returns: "normal_file.txt"
     * sanitizeFilename("a.very.long.name.with.dots.pdf"); // Returns: "a.very.long.name.with.dots.pdf"
     * sanitizeFilename("");                           // Returns: "unnamed" NOT SAFE for FOLDER creation thus removed!! 
     * sanitizeFilename("  . ");                     // Returns: "unnamed" NOT SAFE for FOLDER creation thus removed!! 
     * sanitizeFilename("LPT9.txt");                  // Returns: "LPT9_.txt"
     * sanitizeFilename(".hiddenfile");               // Returns: "hiddenfile"
     * sanitizeFilename("normal.file.name.with.spaces.txt"); // Returns: "normal.file.name.with.spaces.txt"
     * sanitizeFilename("A".repeat(300) + ".txt");    // Returns: "(truncated to 250 characters).txt"
     * sanitizeFilename("A".repeat(200) + "." + "B".repeat(200)); // Returns: "(truncated to 125 characters).(truncated to 125 characters)
     * ```
     */
    sanitizeFilename(filename: string): string {
        // Leading and trailing spaces are removed using trim() in the beginning of the function.
        filename = filename.trim();

        // Handle the case where there's no extension
        const lastDotIndex = filename.lastIndexOf(".");
        const extension = lastDotIndex !== -1 ? filename.substring(lastDotIndex) : "";
        const baseFilename = lastDotIndex !== -1 ? filename.substring(0, lastDotIndex) : filename;

        // 1. Remove/replace invalid characters
        // \ / : * ? " < > | [ ] ( ) - will be replaced with underscore
        let sanitizedBase = baseFilename
            .replace(/[\\/:"*?<>|]/g, "_")  // Replace with underscores
            .replace(/[()[\]]/g, '_')     // Remove special regex characters
            .replace(/^\s+|\s+$/g, '');     // Removes leading and trailing spaces

        // 2. Handle reserved names (Windows)
        // If the filename (after removing invalid characters) matches one of these reserved names (case-insensitively), an underscore (_) is appended to the end.
        const reservedNames = [
            "CON", "PRN", "AUX", "NUL",
            "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
            "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9"
        ];

        if (reservedNames.includes(sanitizedBase.toUpperCase())) {
            sanitizedBase += "_";
        }

        // 3. Remove leading/trailing dots
        // - Leading dots are often used for hidden files on Unix - like systems, but they can cause issues on Windows.
        // - Trailing dots are generally problematic on Windows.
        sanitizedBase = sanitizedBase.replace(/^\.+|\.+$/g, "");

        // @@@@@ NOT SAFE for FOLDER creation thus removed!! 
        // 4. Ensure we have a valid filename after all sanitization
        // If, after all the sanitization steps, the filename is empty, it's set to "unnamed".
        // if (!sanitizedBase) {
        //     sanitizedBase = "unnamed";
        // }

        // 5. Truncate if too long (optional)
        // Filenames longer than 250 characters are truncated to 250 characters to avoid potential issues with filesystem limitations (this is especially relevant on older Windows systems)
        if (sanitizedBase.length > 250) {
            sanitizedBase = sanitizedBase.substring(0, 250);
        }

        return sanitizedBase + extension;
    }

    should_skip_conversion(filename: string, preset: ConversionPreset): boolean {
        return this.matches_patterns(filename, preset.skipConversionPatterns);
    }

    should_skip_rename(
        filename: string,
        preset: FilenamePreset
    ): boolean {
        return this.matches_patterns(filename, preset.skipRenamePatterns);
    }

    matches_patterns(
        filename: string,
        patternsString: string
    ): boolean {
        if (!patternsString.trim()) {
            return false;
        }

        const patterns = patternsString
            .split(",")
            .map((p) => p.trim())
            .filter((p) => p.length > 0);

        return patterns.some((pattern) => {
            try {
                // Check if pattern is a regex (enclosed in /)
                if (pattern.startsWith("/") && pattern.endsWith("/")) {
                    // Extract regex pattern without the slashes
                    const regexPattern = pattern.slice(1, -1);
                    const regex = new RegExp(regexPattern, "i");
                    return regex.test(filename);
                }
                // Check if pattern is a regex (enclosed in r/)
                else if (pattern.startsWith("r/") && pattern.endsWith("/")) {
                    // Extract regex pattern without r/ and /
                    const regexPattern = pattern.slice(2, -1);
                    const regex = new RegExp(regexPattern, "i");
                    return regex.test(filename);
                }
                // Check if pattern is a regex (enclosed in regex:)
                else if (pattern.startsWith("regex:")) {
                    // Extract regex pattern without regex:
                    const regexPattern = pattern.slice(6);
                    const regex = new RegExp(regexPattern, "i");
                    return regex.test(filename);
                }
                // Default to glob pattern
                else {
                    const globPattern = pattern
                        .replace(/\./g, "\\.")
                        .replace(/\*/g, ".*")
                        .replace(/\?/g, ".");
                    const regex = new RegExp(`^${globPattern}$`, "i");
                    return regex.test(filename);
                }
            } catch (e) {
                console.error(`Invalid pattern: ${pattern}`, e);
                return false;
            }
        });
    }

    async processSubfolderVariables(
        template: string,
        file: File,
        activeFile: TFile
    ): Promise<string> {
        const context: VariableContext = {
            file: file,
            activeFile: activeFile,
        };

        let result = await this.variableProcessor.processTemplate(
            template,
            context
        );

        // Clean up the path
        result = result.replace(/\/+/g, "/");
        result = result
            .split("/")
            .map((segment) => this.sanitizeFilename(segment))
            .join("/");
        result = result.replace(/^\/+|\/+$/g, "");

        return normalizePath(result);
    }

    /**
     * Determines the most likely path of an image file within the Obsidian vault, 
     * handling various URI schemes and path formats.
     *
     * @param img - The HTMLImageElement representing the image.
     * @returns The resolved vault path of the image, or null if the path cannot be determined.
     */
    getImagePath(img: HTMLImageElement): string | null {
        try {
            const srcAttribute = img.getAttribute('src');
            if (!srcAttribute) return null;

            // 1. Try to resolve the path directly using Obsidian's Vault API
            let abstractFile = this.app.vault.getAbstractFileByPath(srcAttribute);
            if (abstractFile instanceof TFile) {
                return abstractFile.path;
            }

            // 2. Handle specific "app://" URI pattern with potential OS path
            if (srcAttribute.startsWith('app://')) {
                const parts = srcAttribute.substring('app://'.length).split('/');
                if (parts.length > 1) {
                    const potentialOsPathWithQuery = parts.slice(1).join('/');
                    const potentialOsPath = potentialOsPathWithQuery.split('?')[0]; // Remove query parameters
                    let decodedOsPath = decodeURIComponent(potentialOsPath);

                    // Standardize path separators to forward slashes
                    decodedOsPath = decodedOsPath.replace(/\\/g, '/');

                    // Get the vault's base path safely
                    let basePath: string | null = null;
                    if (this.app.vault.adapter instanceof FileSystemAdapter) {
                        basePath = this.app.vault.adapter.getBasePath();
                        // Ensure basePath also uses forward slashes for consistency
                        basePath = basePath.replace(/\\/g, '/');
                    }

                    if (basePath && decodedOsPath.startsWith(basePath)) {
                        // Extract the vault-relative path
                        const vaultRelativePath = decodedOsPath.substring(basePath.length);
                        // Normalize the path to ensure consistency
                        const normalizedVaultRelativePath = normalizePath(vaultRelativePath);
                        // console.log(`Detected OS path within vault: ${normalizedVaultRelativePath}`);
                        return normalizedVaultRelativePath; // Return the relative vault path
                    } else {
                        // console.log(`Detected and cleaned OS path (outside vault): ${decodedOsPath}`);
                        return decodedOsPath; // Return the cleaned OS path if not in vault
                    }
                }
            }

            // 3. Handle "app://local/" URIs (common for embedded images)
            if (srcAttribute.startsWith('app://local/')) {
                const internalPath = decodeURIComponent(srcAttribute.substring('app://local/'.length).split('?')[0]);
                abstractFile = this.app.vault.getAbstractFileByPath(internalPath);
                if (abstractFile instanceof TFile) {
                    return abstractFile.path;
                }
            }

            // 4. If direct resolution fails, consider it as a relative path from the current file
            const activeFile = this.app.workspace.getActiveFile();
            if (activeFile) {
                const parentFolder = activeFile.parent?.path || '';
                const resolvedPath = normalizePath(path.join(parentFolder, srcAttribute));
                abstractFile = this.app.vault.getAbstractFileByPath(resolvedPath);
                if (abstractFile instanceof TFile) {
                    return abstractFile.path;
                }
            }

            // 5. Consider paths relative to the vault root (less common but possible)
            const vaultRootPath = this.app.vault.getRoot().path;
            const vaultRelativePath = normalizePath(path.join(vaultRootPath, srcAttribute));
            abstractFile = this.app.vault.getAbstractFileByPath(vaultRelativePath);
            if (abstractFile instanceof TFile) {
                return abstractFile.path;
            }

            console.warn(`Could not resolve image path for src: ${srcAttribute}`);
            return null;

        } catch (error) {
            console.error('Error getting image path:', error);
            return null;
        }
    }

    /**
     * Performs a safe rename operation for a file, especially useful for case-only changes 
     * on case-insensitive file systems. It uses a temporary intermediate rename to ensure 
     * the file system properly updates the file's name and path.
     *
     * @param file - The TFile object representing the file to rename.
     * @param newPath - The new path (including filename) for the file.
     * @returns A Promise that resolves to true if the rename was successful, false otherwise.
     */
    async safeRenameFile(file: TFile, newPath: string): Promise<boolean> {
        const basePath = path.dirname(newPath);
        const newName = path.basename(newPath);
        const tempPath = normalizePath(path.join(basePath, `temp-${Date.now()}-${newName}`));

        try {
            await this.app.fileManager.renameFile(file, tempPath);
            const tempFile = this.app.vault.getAbstractFileByPath(tempPath);
            if (tempFile instanceof TFile) {
                await this.app.fileManager.renameFile(tempFile, newPath);
                return true; // Indicate success
            } else {
                new Notice(`Error: Temporary file not found after renaming.`);
                return false; // Indicate failure
            }
        } catch (error) {
            console.error('Error during safe rename:', error);
            new Notice(`Error renaming file: ${error.message}`);
            return false; // Indicate failure
        }
    }



}