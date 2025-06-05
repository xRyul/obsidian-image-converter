// VariableProcessor.ts
import { App, TFile } from "obsidian";
import { ImageConverterSettings } from "./ImageConverterSettings";


export interface VariableContext {
    file: TFile | File;
    activeFile: TFile;
}

// --- Variable List ---
export interface VariableInfo {
    name: string;
    description: string;
    example: string;
}

export class VariableProcessor {

    private counters: Map<string, number> = new Map();

    constructor(
        private app: App,
        private settings: ImageConverterSettings
    ) { }

    // Updated list of all available variables
    private allVariables: VariableInfo[] = [
        // Basic
        {
            name: "{imagename}",
            description: "The original name of the image file (without extension).",
            example: "image123",
        },
        {
            name: "{filetype}",
            description: "The file extension of the image.",
            example: "png",
        },
        {
            name: "{sizeb}",
            description: "The size of the image in bytes.",
            example: "24576",
        },
        {
            name: "{sizekb}",
            description: "The size of the image in kilobytes (2 decimal places).",
            example: "24.00",
        },
        {
            name: "{sizemb}",
            description: "The size of the image in megabytes (2 decimal places).",
            example: "0.02",
        },
        {
            name: "{notename}",
            description: "The name of the current note.",
            example: "MeetingNotes",
        },
        {
            name: "{notename_nospaces}",
            description: "The name of the current note with spaces replaced by underscores.",
            example: "Meeting_Notes",
        },

        // Date & Time
        {
            name: "{date}",
            description: "The current date (YYYY-MM-DD).",
            example: "2023-12-28",
        },
        {
            name: "{date:FORMAT}",
            description: "The current date in a custom format using Moment.js syntax.",
            example: "{date:YYYY-MM} -> 2023-12",
        },
        {
            name: "{time}",
            description: "The current time (HH-mm-ss).",
            example: "14-30-00",
        },
        {
            name: "{YYYY}",
            description: "The current year.",
            example: "2023",
        },
        {
            name: "{MM}",
            description: "The current month (01-12).",
            example: "12",
        },
        {
            name: "{DD}",
            description: "The current day of the month (01-31).",
            example: "28",
        },
        {
            name: "{HH}",
            description: "The current hour (00-23).",
            example: "14",
        },
        {
            name: "{mm}",
            description: "The current minute (00-59).",
            example: "30",
        },
        {
            name: "{ss}",
            description: "The current second (00-59).",
            example: "00",
        },
        {
            name: "{weekday}",
            description: "The current day of the week.",
            example: "Thursday",
        },
        {
            name: "{month}",
            description: "The current month name.",
            example: "December",
        },
        {
            name: "{calendar}",
            description: "A calendar view of the current date/time.",
            example: "12/28/2023 2:30 PM",
        },
        {
            name: "{today}",
            description: "The current date (YYYY-MM-DD).",
            example: "2023-12-28",
        },
        {
            name: "{YYYY-MM-DD}",
            description: "The current date (YYYY-MM-DD).",
            example: "2023-12-28",
        },
        {
            name: "{tomorrow}",
            description: "Tomorrow's date (YYYY-MM-DD).",
            example: "2023-12-29",
        },
        {
            name: "{yesterday}",
            description: "Yesterday's date (YYYY-MM-DD).",
            example: "2023-12-27",
        },
        {
            name: "{startofweek}",
            description: "The start of the current week (YYYY-MM-DD).",
            example: "2023-12-24",
        },
        {
            name: "{endofweek}",
            description: "The end of the current week (YYYY-MM-DD).",
            example: "2023-12-30",
        },
        {
            name: "{startofmonth}",
            description: "The start of the current month (YYYY-MM-DD).",
            example: "2023-12-01",
        },
        {
            name: "{endofmonth}",
            description: "The end of the current month (YYYY-MM-DD).",
            example: "2023-12-31",
        },
        {
            name: "{nextweek}",
            description: "The date of next week (YYYY-MM-DD).",
            example: "2024-01-04",
        },
        {
            name: "{lastweek}",
            description: "The date of last week (YYYY-MM-DD).",
            example: "2023-12-21",
        },
        {
            name: "{nextmonth}",
            description: "The date of next month (YYYY-MM-DD).",
            example: "2024-01-28",
        },
        {
            name: "{lastmonth}",
            description: "The date of last month (YYYY-MM-DD).",
            example: "2023-11-28",
        },
        {
            name: "{daysinmonth}",
            description: "The number of days in the current month.",
            example: "31",
        },
        {
            name: "{weekofyear}",
            description: "The week number of the current year.",
            example: "52",
        },
        {
            name: "{quarterofyear}",
            description: "The quarter of the current year.",
            example: "4",
        },
        {
            name: "{week}",
            description: "The current week number (alias for {weekofyear}).",
            example: "52",
        },
        {
            name: "{w}",
            description: "The current week number (alias for {weekofyear}).",
            example: "52",
        },
        {
            name: "{quarter}",
            description: "The current quarter (alias for {quarterofyear}).",
            example: "4",
        },
        {
            name: "{Q}",
            description: "The current quarter (alias for {quarterofyear}).",
            example: "4",
        },
        {
            name: "{dayofyear}",
            description: "The day of the year (1-366).",
            example: "362",
        },
        {
            name: "{DDD}",
            description: "The day of the year (1-366).",
            example: "362",
        },
        {
            name: "{monthname}",
            description: "The name of the current month.",
            example: "December",
        },
        {
            name: "{MMMM}",
            description: "The name of the current month.",
            example: "December",
        },
        {
            name: "{dayname}",
            description: "The name of the current day of the week.",
            example: "Thursday",
        },
        {
            name: "{dddd}",
            description: "The name of the current day of the week.",
            example: "Thursday",
        },
        {
            name: "{dateordinal}",
            description: "The current date with ordinal suffix (e.g., 28th).",
            example: "28th",
        },
        {
            name: "{Do}",
            description: "The current date with ordinal suffix (e.g., 28th).",
            example: "28th",
        },
        {
            name: "{relativetime}",
            description: "The relative time from now.",
            example: "in a few seconds",
        },
        {
            name: "{currentdate}",
            description: "The current date (YYYY-MM-DD).",
            example: "2023-12-28",
        },
        {
            name: "{yyyy}",
            description: "The current year.",
            example: "2023",
        },
        {
            name: "{timestamp}",
            description: "The current timestamp in milliseconds.",
            example: "1672234800000",
        },

        // File & Vault
        {
            name: "{vaultname}",
            description: "The name of the vault.",
            example: "MyVault",
        },
        {
            name: "{vaultpath}",
            description: "The root path of the vault.",
            example: "/Users/username/Documents/MyVault",
        },
        {
            name: "{parentfolder}",
            description: "The name of the immediate parent folder of the note.",
            example: "Project",
        },
		{
			name: "{grandparentfolder}",
			description: "Parent of the parent folder of the note, but not the vault root",
			example: "ParentOfProject"
		},
        {
            name: "{notefolder}",
            description: "The name of the immediate parent folder of the note.",
            example: "Project",
        },
        {
            name: "{notepath}",
            description: "The full path of the current note.",
            example: "Project/MeetingNotes",
        },

        // Image Metadata
        {
            name: "{width}",
            description: "The width of the image in pixels.",
            example: "800",
        },
        {
            name: "{height}",
            description: "The height of the image in pixels.",
            example: "600",
        },
        {
            name: "{aspectratio}",
            description: "The aspect ratio of the image (width/height, 2 decimal places).",
            example: "1.33",
        },
        {
            name: "{orientation}",
            description: "The orientation of the image (landscape, portrait, or square).",
            example: "landscape",
        },
        {
            name: "{resolution}",
            description: "The resolution of the image (width x height).",
            example: "800x600",
        },

        // Calculated Image Properties
        {
            name: "{ratio}",
            description: "The aspect ratio of the image, same as {aspectratio}.",
            example: "1.33",
        },
        {
            name: "{quality}",
            description: "The quality setting for image conversion/compression.",
            example: "75",
        },
        {
            name: "{megapixels}",
            description: "The size of the image in megapixels (2 decimal places).",
            example: "0.48",
        },
        {
            name: "{issquare}",
            description: "Whether the image is a perfect square (true/false).",
            example: "false",
        },
        {
            name: "{pixelcount}",
            description: "The total number of pixels in the image.",
            example: "480000",
        },
        {
            name: "{aspectratiotype}",
            description: "A common aspect ratio category (e.g., 4:3, 16:9, custom).",
            example: "4:3",
        },
        {
            name: "{resolutioncategory}",
            description: "A category based on pixel count (tiny, small, medium, large, very-large).",
            example: "small",
        },
        {
            name: "{filesizecategory}",
            description: "A category based on file size (e.g., 0-50KB, 51-200KB, etc.).",
            example: "0-50KB",
        },
        {
            name: "{dominantdimension}",
            description: "Whether the width or height is larger, or if they are equal.",
            example: "width",
        },
        {
            name: "{dimensiondifference}",
            description: "The absolute difference between width and height.",
            example: "200",
        },
        {
            name: "{bytesperpixel}",
            description: "The average number of bytes per pixel (2 decimal places).",
            example: "0.50",
        },
        {
            name: "{compressionratio}",
            description: "An estimate of the image compression ratio (2 decimal places).",
            example: "0.33",
        },
        {
            name: "{maxdimension}",
            description: "The larger dimension (width or height) of the image.",
            example: "800",
        },
        {
            name: "{mindimension}",
            description: "The smaller dimension (width or height) of the image.",
            example: "600",
        },
        {
            name: "{diagonalpixels}",
            description: "The diagonal pixel length of the image.",
            example: "1000",
        },
        {
            name: "{aspectratiosimplified}",
            description: "The aspect ratio in its simplest whole number form.",
            example: "4:3",
        },
        {
            name: "{screenfitcategory}",
            description: "A category based on whether the image fits within common screen sizes (e.g., fits-1080p, fits-1440p, fits-4k, above-4k).",
            example: "fits-1080p",
        },

        // Advanced
        {
            name: "{random}",
            description: "A random alphanumeric string (6 characters).",
            example: "a8f7n2",
        },
        {
            name: "{randomHex:X}",
            description: "A random hexadecimal string of X characters.",
            example: "{randomHex:8} -> 3e4a7f9b",
        },
        {
            name: "{counter:00X}",
            description: "An auto-incrementing counter (padded with zeros) for the folder. X determines the padding.",
            example: "{counter:001} -> 005 (if it's the fifth image in the folder)",
        },
        {
            name: "{MD5:type}",
            description: "The first 8 characters of the MD5 hash of the specified type. Supports: filename, fullpath, parentfolder, rootfolder, extension, notename, notefolder, notepath.",
            example: "{MD5:filename} -> 7a3b9e2c",
        },
        {
            name: "{MD5:type:X}",
            description: "The first X characters of the MD5 hash of the specified type. Supports the same types as {MD5:type}.",
            example: "{MD5:fullpath:10} -> 7a3b9e2c1d",
        },
        {
            name: "{MD5:custom text}",
            description: "The full MD5 hash of a custom text.",
            example: "{MD5:MyCustomText} -> 5f9e2b8a3c7d1f6a4e8b2c9d",
        },
        {
            name: "{size:UNIT:DECIMALS}",
            description: "Image size in a specific unit (B, KB, MB) with custom decimal places.",
            example: "{size:KB:3} -> 24.000",
        },
        {
            name: "{sha256:image}",
            description: "The SHA-256 hash of the image content.",
            example: "{sha256:image} -> full hash, {sha256:image:8} -> e3b0c442",
        },
        {
            name: "{sha256:type}",
            description: "The SHA-256 hash of the specified type. Supports: filename, fullpath, parentfolder, rootfolder, extension, notename, notefolder, notepath.",
            example: "{sha256:filename} -> e3b0c442",
        },
        {
            name: "{sha256:type:X}",
            description: "The first X characters of the SHA-256 hash of the specified type. Supports the same types as {sha256:type}.",
            example: "{sha256:fullpath:10} -> e3b0c44298",
        },
        {
            name: "{uuid}",
            description: "A universally unique identifier (UUID).",
            example: "a1b2c3d4-e5f6-7890-1234-567890abcdef",
        },
    ];

    async processTemplate(
        template: string,
        context: VariableContext
    ): Promise<string> {
        // Pass the template to getAvailableVariables
        const variables = await this.getAvailableVariables(context, template);
        let result = template;

        for (const [key, value] of Object.entries(variables)) {
            const regex = new RegExp(this.escapeRegExp(key), "g");
            result = result.replace(regex, value);
        }

        return result;
    }

    /**
     * Validates a template to ensure variables won't resolve to empty strings that would cause issues
     * @param template The template string to validate
     * @param context The variable context containing file and activeFile
     * @returns Object with validation results and any error messages
     */
    validateTemplate(template: string, context: VariableContext): { valid: boolean; errors: string[] } {
        const { activeFile } = context;
        const errors: string[] = [];

        // Check for {grandparentfolder} usage
        if (template.includes("{grandparentfolder}")) {
            const parentFolder = activeFile.parent;
            const grandparentFolder = parentFolder?.parent;
            
            // If there's no grandparent or the grandparent is the vault root
            if (!grandparentFolder || grandparentFolder.path === "/") {
                errors.push("Cannot use {grandparentfolder} - the current note has no grandparent folder. Please modify your template.");
            }
        }

        // Check for {parentfolder} usage when note is in vault root
        if (template.includes("{parentfolder}")) {
            const parentFolder = activeFile.parent;
            
            // If there's no parent or the parent is the vault root
            if (!parentFolder || parentFolder.path === "/") {
                errors.push("Cannot use {parentfolder} - the current note is in the vault root. Please modify your template.");
            }
        }

        return {
            valid: errors.length === 0,
            errors: errors
        };
    }

    // Expose allVariables publicly
    public getAllVariables(): VariableInfo[] {
        return this.allVariables;
    }
    public getCategorizedVariables(): Record<string, VariableInfo[]> {
        return this.groupVariablesByCategory(this.allVariables);
    }

    // Method to group variables by category (used by AvailableVariablesModal)
    private groupVariablesByCategory(variables: VariableInfo[]): Record<string, VariableInfo[]> {

        const categorized: Record<string, VariableInfo[]> = {
            "Basic": [],
            "Date & Time": [],
            "File & Vault": [],
            "Image Metadata": [],
            "Calculated Image Properties": [],
            "Advanced": []
        };

        for (const variable of variables) {
            if (variable.name.startsWith("{date") || ["{YYYY}", "{MM}", "{DD}", "{HH}", "{mm}", "{ss}", "{weekday}", "{month}", "{calendar}", "{today}", "{YYYY-MM-DD}", "{tomorrow}", "{yesterday}", "{startofweek}", "{endofweek}", "{startofmonth}", "{endofmonth}", "{nextweek}", "{lastweek}", "{nextmonth}", "{lastmonth}", "{daysinmonth}", "{weekofyear}", "{quarterofyear}", "{week}", "{w}", "{quarter}", "{Q}", "{dayofyear}", "{DDD}", "{monthname}", "{MMMM}", "{dayname}", "{dddd}", "{dateordinal}", "{Do}", "{relativetime}", "{currentdate}", "{yyyy}", "{time}", "{timestamp}"].includes(variable.name)) {
                categorized["Date & Time"].push(variable);
            } else if (["{vaultname}", "{vaultpath}", "{parentfolder}", "{grandparentfolder}" ,"{notefolder}", "{notepath}"].includes(variable.name)) {
                categorized["File & Vault"].push(variable);
            } else if (["{imagename}", "{filetype}", "{sizeb}", "{sizekb}", "{sizemb}", "{notename}", "{notename_nospaces}"].includes(variable.name)) {
                categorized["Basic"].push(variable);
            } else if (["{width}", "{height}", "{aspectratio}", "{orientation}", "{resolution}"].includes(variable.name)) {
                categorized["Image Metadata"].push(variable);
            } else if (["{ratio}", "{quality}", "{megapixels}", "{issquare}", "{pixelcount}", "{aspectratiotype}", "{resolutioncategory}", "{filesizecategory}", "{dominantdimension}", "{dimensiondifference}", "{bytesperpixel}", "{compressionratio}", "{maxdimension}", "{mindimension}", "{diagonalpixels}", "{aspectratiosimplified}", "{screenfitcategory}"].includes(variable.name)) {
                categorized["Calculated Image Properties"].push(variable);
            } else {
                categorized["Advanced"].push(variable);
            }
        }

        return categorized;
    }

    private async getAvailableVariables(
        context: VariableContext,
        template: string
    ): Promise<Record<string, string>> {
        const { file, activeFile } = context;
        const moment = (window as any).moment;
        let variables: Record<string, string> = {};

        // --- Static Variables ---
        variables["{random}"] = Math.random().toString(36).substring(2, 8);
        variables["{uuid}"] = crypto.randomUUID();

        // Handle both TFile and File types
        if (file instanceof TFile) {
            // File is a TFile (in the vault)
            variables["{imagename}"] = file.basename;
            variables["{filetype}"] = file.extension;

            // Get file size using app.vault.adapter.stat for TFile
            try {
                const fileStats = await this.app.vault.adapter.stat(file.path);
                if (fileStats) {
                    variables["{sizeb}"] = fileStats.size.toString();
                    variables["{sizekb}"] = (fileStats.size / 1024).toFixed(2);
                    variables["{sizemb}"] = (fileStats.size / (1024 * 1024)).toFixed(2);
                } else {
                    throw new Error("File stats not available");
                }
            } catch (error) {
                console.error("Error getting file stats:", error);
                variables["{sizeb}"] = "unknown";
                variables["{sizekb}"] = "unknown";
                variables["{sizemb}"] = "unknown";
            }
            // --- Image Metadata (for TFile) ---
            // ADD THIS CHECK HERE:
            if (!['heic', 'heif', 'tiff', 'tif'].includes(file.extension.toLowerCase())) {
                try {
                    const imgData = await this.getImageMetadata(file);
                    Object.assign(variables, imgData);
                } catch (error) {
                    console.debug("Image metadata extraction failed:", error);
                }
            }
        } else {
            // File is a File object (dragged/pasted)
            variables["{imagename}"] = file.name.substring(0, file.name.lastIndexOf("."));
            variables["{filetype}"] = file.name.substring(file.name.lastIndexOf(".") + 1);

            // Get file size directly from the File object
            variables["{sizeb}"] = file.size.toString();
            variables["{sizekb}"] = (file.size / 1024).toFixed(2);
            variables["{sizemb}"] = (file.size / (1024 * 1024)).toFixed(2);

            // --- Image Metadata (for File) ---
            // ADD THIS CHECK HERE:
            const fileExtension = file.name.split('.').pop()?.toLowerCase() || '';
            if (!['heic', 'heif', 'tiff', 'tif'].includes(fileExtension)) {
                try {
                    const imgData = await this.getImageMetadata(file);
                    Object.assign(variables, imgData);
                } catch (error) {
                    console.debug("Image metadata extraction failed:", error);
                }
            }
        }

        variables["{notename}"] = activeFile.basename;
        variables["{notename_nospaces}"] = activeFile.basename.replace(/\s+/g, "_");
        variables["{notepath}"] = activeFile.parent ? `${activeFile.parent.path}/${activeFile.basename}` : activeFile.basename;
        variables["{parentfolder}"] = activeFile.parent?.name || "";
        variables["{grandparentfolder}"] = (activeFile.parent?.parent?.path == "/" ? activeFile.parent?.name : activeFile.parent?.parent?.name) || "";
        variables["{notefolder}"] = activeFile.parent?.name || "";
        variables["{vaultname}"] = this.app.vault.getName();
        variables["{vaultpath}"] = this.app.vault.getRoot().path;
        variables["{timezone}"] = Intl.DateTimeFormat().resolvedOptions().timeZone;
        variables["{locale}"] = navigator.language;
        variables["{platform}"] = navigator.platform;
        variables["{useragent}"] = navigator.userAgent;

        // --- Date, Time, and Calendar Variables ---
        variables["{YYYY}"] = moment().format("YYYY");
        variables["{MM}"] = moment().format("MM");
        variables["{DD}"] = moment().format("DD");
        variables["{HH}"] = moment().format("HH");
        variables["{mm}"] = moment().format("mm");
        variables["{ss}"] = moment().format("ss");
        variables["{date}"] = moment().format("YYYY-MM-DD");
        variables["{weekday}"] = moment().format("dddd"); 
        variables["{month}"] = moment().format("MMMM");
        variables["{calendar}"] = moment().calendar();
        variables["{today}"] = moment().format('YYYY-MM-DD');
        variables["{YYYY-MM-DD}"] = moment().format('YYYY-MM-DD');
        variables["{tomorrow}"] = moment().add(1, 'day').format('YYYY-MM-DD');
        variables["{yesterday}"] = moment().subtract(1, 'day').format('YYYY-MM-DD');
        variables["{startofweek}"] = moment().startOf('week').format('YYYY-MM-DD');
        variables["{endofweek}"] = moment().endOf('week').format('YYYY-MM-DD');
        variables["{startofmonth}"] = moment().startOf('month').format('YYYY-MM-DD');
        variables["{endofmonth}"] = moment().endOf('month').format('YYYY-MM-DD');
        variables["{nextweek}"] = moment().add(1, 'week').format('YYYY-MM-DD');
        variables["{lastweek}"] = moment().subtract(1, 'week').format('YYYY-MM-DD');
        variables["{nextmonth}"] = moment().add(1, 'month').format('YYYY-MM-DD');
        variables["{lastmonth}"] = moment().subtract(1, 'month').format('YYYY-MM-DD');
        variables["{daysinmonth}"] = moment().daysInMonth().toString();
        variables["{weekofyear}"] = moment().week().toString();
        variables["{quarterofyear}"] = moment().quarter().toString();
        variables["{week}"] = moment().format('w');
        variables["{w}"] = moment().format('w');
        variables["{quarter}"] = moment().format('Q');
        variables["{Q}"] = moment().format('Q');
        variables["{dayofyear}"] = moment().format('DDD');
        variables["{DDD}"] = moment().format('DDD');
        variables["{monthname}"] = moment().format('MMMM');
        variables["{MMMM}"] = moment().format('MMMM');
        variables["{dayname}"] = moment().format('dddd');
        variables["{dddd}"] = moment().format('dddd');
        variables["{dateordinal}"] = moment().format('Do');
        variables["{Do}"] = moment().format('Do');
        variables["{relativetime}"] = moment().fromNow();
        variables["{currentdate}"] = moment().format('YYYY-MM-DD');
        variables["{yyyy}"] = moment().format('YYYY');
        variables["{time}"] = moment().format('HH-mm-ss');
        variables["{timestamp}"] = Date.now().toString();


        // --- Dynamic Variables ---
        variables = await this.processDynamicVariables(template, context, variables);

        // --- Image Metadata ---
        try {
            const imgData = await this.getImageMetadata(file);
            Object.assign(variables, imgData);
        } catch (error) {
            console.debug("Image metadata extraction failed:", error);
        }

        return variables;
    }


    private async processDynamicVariables(
        template: string,
        context: VariableContext,
        variables: Record<string, string>
    ): Promise<Record<string, string>> {
        const { file, activeFile } = context;
        const moment = (window as any).moment;

        // Handle {randomHex:X}
        const hexPattern = /{randomHex:(\d+)}/g;
        let hexMatch;
        while ((hexMatch = hexPattern.exec(template)) !== null) {
            const size = parseInt(hexMatch[1]);
            variables[hexMatch[0]] = this.generateRandomHex(size);
        }

        // Handle {counter:00X}
        const counterPattern = /{counter:(\d+)}/g;
        let counterMatch;
        while ((counterMatch = counterPattern.exec(template)) !== null) {
            const padding = counterMatch[1].length;
            variables[counterMatch[0]] = await this.getNextCounter(
                activeFile.parent?.path || "",
                padding
            );
        }

        // --- Handle {date:FORMAT} and basic date/time variables ---
        const dateAndTimePattern = /{date:(.*?)}/g;
        let dateAndTimeMatch;
        while ((dateAndTimeMatch = dateAndTimePattern.exec(template)) !== null) {
            if (dateAndTimeMatch[1]) {
                // It's a {date:FORMAT} pattern
                const format = dateAndTimeMatch[1];
                try {
                    variables[dateAndTimeMatch[0]] = moment().format(format);
                } catch (error) {
                    console.error(`Invalid date format: ${format}`, error);
                    variables[dateAndTimeMatch[0]] = moment().format("YYYY-MM-DD"); // Default format on error
                }
            }
        }

        // Handle {size:UNIT:DECIMALS}
        const sizePattern = /{size:(MB|KB|B):(\d+)}/g;
        let sizeMatch;
        let fileSize: number;

        if (file instanceof TFile) {
            try {
                const fileStats = await this.app.vault.adapter.stat(file.path);
                if (fileStats) {
                    fileSize = fileStats.size;
                } else {
                    throw new Error("File stats not available for size variables");
                }
            } catch (error) {
                console.error("Error getting file stats for size variables:", error);
                fileSize = 0; // Default value if file stats are unavailable
            }
        } else {
            fileSize = file.size;
        }

        while ((sizeMatch = sizePattern.exec(template)) !== null) {
            const unit = sizeMatch[1];
            const decimals = parseInt(sizeMatch[2]);
            variables[sizeMatch[0]] = this.formatSize(fileSize, unit, decimals);
        }

        // --- Handle MD5 Hashes ---
        // Allow user to specify what they want to hashe.g. filename, fodlerpaht , any name etc.
        // {MD5:filename} -> full MD5 hash of filename
        // {MD5:filename:8} -> first 8 characters of MD5 hash
        // {MD5:path} -> hash of file path
        // {MD5:fullpath} -> hash of complete path including filename
        // {MD5:parentfolder} -> hash of immediate parent folder name
        // {MD5:rootfolder} -> hash of root folder name
        // {MD5:extension} -> hash of file extension
        // {MD5:notename} -> hash of current note name
        // {MD5:notefolder} -> hash of current note's folder
        // {MD5:notepath} -> hash of current note's full path
        // {MD5:custom text} -> hash of custom text
        const md5Pattern = /{MD5:([\w\-./]+?)(?::(\d+))?}/g;
        let md5Match;
        while ((md5Match = md5Pattern.exec(template)) !== null) {
            const hashType = md5Match[1].toLowerCase();
            const length = md5Match[2] ? parseInt(md5Match[2]) : undefined;
            let textToHash = "";

            switch (hashType) {
                case "filename":
                    textToHash = file.name.substring(0, file.name.lastIndexOf("."));
                    break;
                case "imagepath":
                case "fullpath": {
                    // Get the relative path of the image
                    const relativeImagePath = file.name;
                    textToHash = relativeImagePath;
                    break;
                }
                case "parentfolder":
                    textToHash = activeFile.parent?.name || "";
                    break;
                case "grandparentfolder":
                    textToHash = (activeFile.parent?.parent?.path == "/" ? activeFile.parent?.name : activeFile.parent?.parent?.name) || "";
                    break;
                case "rootfolder":
                    textToHash = this.app.vault.getRoot().path;
                    break;
                case "extension":
                    textToHash = file.name.substring(file.name.lastIndexOf(".") + 1);
                    break;
                case "notename":
                    textToHash = activeFile.basename;
                    break;
                case "notename_nospaces":
                    textToHash = activeFile.basename.replace(/\s+/g, "_");
                    break;
                case "notefolder":
                    textToHash = activeFile.parent?.name || "";
                    break;
                case "notepath":
                    textToHash = activeFile.path;
                    break;
                default:
                    textToHash = hashType;
            }

            let md5Hash = await this.generateMD5(textToHash);
            if (length) {
                md5Hash = md5Hash.substring(0, length);
            }
            variables[`{MD5:${hashType}${(length ? ":" + length : "")}}`] = md5Hash;
        }

        // Handle SHA-256 hashes
        const sha256Pattern = /{sha256:([\w\-./]+?)(?::(\d+))?}/g;
        let sha256Match;
        while ((sha256Match = sha256Pattern.exec(template)) !== null) {
            const hashType = sha256Match[1].toLowerCase();
            const length = sha256Match[2] ? parseInt(sha256Match[2]) : undefined;
            let sha256Hash: string;

            if (hashType === "image") {
                // Handle image content hash
                sha256Hash = await this.generateFileContentSHA256(file);
            } else {
                // Handle other hash types (filename, path, etc.)
                let textToHash = "";
                switch (hashType) {
                    case "filename":
                        textToHash = file.name.substring(0, file.name.lastIndexOf("."));
                        break;
                    case "imagepath":
                    case "fullpath": {
                        const relativeImagePath = file.name;
                        textToHash = relativeImagePath;
                        break;
                    }
                    case "parentfolder":
                        textToHash = activeFile.parent?.name || "";
                        break;
                    case "grandparentfolder":
                        textToHash = (activeFile.parent?.parent?.path == "/" ? activeFile.parent?.name : activeFile.parent?.parent?.name) || "";
                        break;
                    case "rootfolder":
                        textToHash = this.app.vault.getRoot().path;
                        break;
                    case "extension":
                        textToHash = file.name.substring(file.name.lastIndexOf(".") + 1);
                        break;
                    case "notename":
                        textToHash = activeFile.basename;
                        break;
                    case "notename_nospaces":
                        textToHash = activeFile.basename.replace(/\s+/g, "_");
                        break;
                    case "notefolder":
                        textToHash = activeFile.parent?.name || "";
                        break;
                    case "notepath":
                        textToHash = activeFile.path;
                        break;
                    default:
                        textToHash = hashType;
                }
                sha256Hash = await this.generateSHA256(textToHash);
            }

            if (length) {
                sha256Hash = sha256Hash.substring(0, length);
            }
            variables[`{sha256:${hashType}${(length ? ":" + length : "")}}`] = sha256Hash;
        }

        return variables;
    }


    private async getImageMetadata(file: TFile | File): Promise<Record<string, string>> {
        const metadata: Record<string, string> = {};

        const fileExtension = file instanceof TFile ? file.extension.toLowerCase() : file.name.split('.').pop()?.toLowerCase() || '';
        const isHeicOrTiff = ['heic', 'heif', 'tiff', 'tif'].includes(fileExtension);

        if (isHeicOrTiff) {
            // For HEIC and TIFF, return empty metadata initially, as metadata should be extracted after decoding
            return metadata;
        }

        if (file instanceof TFile) {
            // Handle TFile (files already in the vault)
            try {
                const fileContent = await this.app.vault.readBinary(file);
                const blob = new Blob([fileContent], { type: `image/${file.extension}` });
                const img = new Image();
                img.src = URL.createObjectURL(blob);

                // Wait for the image to load
                await new Promise((resolve, reject) => {
                    img.onload = () => resolve(img);
                    img.onerror = (event) => {
                        console.error("Error extracting image metadata for File: ", event);
                        reject(event);
                    };
                });

                const { width, height } = img;

                metadata["{width}"] = width.toString();
                metadata["{height}"] = height.toString();
                metadata["{aspectratio}"] = (width / height).toFixed(2);
                metadata["{orientation}"] =
                    width > height
                        ? "landscape"
                        : width < height
                            ? "portrait"
                            : "square";

                // Calculate more properties
                const aspectRatio = width / height;
                const isSquare = Math.abs(aspectRatio - 1) < 0.01;
                const pixelCount = width * height;

                // Get file stats using app.vault.adapter.stat for TFile
                let fileSizeInBytes = 0;
                try {
                    const fileStats = await this.app.vault.adapter.stat(file.path);
                    if (fileStats) {
                        fileSizeInBytes = fileStats.size;
                    } else {
                        throw new Error("File stats not available");
                    }
                } catch (error) {
                    console.error("Error getting file stats:", error);
                }

                // Add properties to metadata object
                Object.assign(metadata, {
                    // Existing properties
                    '{ratio}': aspectRatio.toFixed(2),
                    '{quality}': this.settings.quality.toString(),
                    '{resolution}': `${img.width}x${img.height}`,
                    '{megapixels}': (pixelCount / 1000000).toFixed(2),

                    // New properties
                    '{issquare}': isSquare.toString(),
                    '{pixelcount}': pixelCount.toString(),
                    '{aspectratiotype}': (() => {
                        if (isSquare) return '1:1';
                        if (Math.abs(aspectRatio - 1.33) < 0.1) return '4:3';
                        if (Math.abs(aspectRatio - 1.78) < 0.1) return '16:9';
                        if (Math.abs(aspectRatio - 1.6) < 0.1) return '16:10';
                        return 'custom';
                    })(),
                    '{resolutioncategory}': (() => {
                        if (pixelCount < 100000) return 'tiny';      // < 0.1MP  (e.g., 316x316 or smaller)
                        if (pixelCount < 500000) return 'small';     // < 0.5MP  (e.g., 707x707 or smaller)
                        if (pixelCount < 2000000) return 'medium';   // < 2MP    (e.g., 1414x1414 or smaller)
                        if (pixelCount < 8000000) return 'large';    // < 8MP    (e.g., 2828x2828 or smaller)
                        return 'very-large';                         // >= 8MP   (e.g., larger than 2828x2828)
                    })(),
                    '{filesizecategory}': (() => {
                        if (fileSizeInBytes < 50 * 1024) return '0-50KB';
                        if (fileSizeInBytes < 200 * 1024) return '51-200KB';
                        if (fileSizeInBytes < 1024 * 1024) return '201-1024KB';
                        if (fileSizeInBytes < 5 * 1024 * 1024) return '1025KB-5MB';
                        if (fileSizeInBytes < 10 * 1024 * 1024) return '5MB-10MB';
                        return '10MB+';
                    })(),
                    '{dominantdimension}': width > height ? 'width' : (width < height ? 'height' : 'equal'),
                    '{dimensiondifference}': Math.abs(width - height).toString(),
                    '{bytesperpixel}': (fileSizeInBytes / pixelCount).toFixed(2),
                    '{compressionratio}': (fileSizeInBytes / (pixelCount * 3)).toFixed(2), // Assuming RGB
                    '{maxdimension}': Math.max(width, height).toString(),
                    '{mindimension}': Math.min(width, height).toString(),
                    '{diagonalpixels}': Math.sqrt(width * width + height * height).toFixed(0),
                    '{aspectratiosimplified}': (() => {
                        const gcd = (a: number, b: number): number => b ? gcd(b, a % b) : a;
                        const w = width;
                        const h = height;
                        const divisor = gcd(w, h);
                        return `${w / divisor}:${h / divisor}`;
                    })(),
                    '{screenfitcategory}': (() => {
                        const standardWidth = 1920;
                        const standardHeight = 1080;
                        if (width <= standardWidth && height <= standardHeight) return 'fits-1080p';
                        if (width <= 2560 && height <= 1440) return 'fits-1440p';
                        if (width <= 3840 && height <= 2160) return 'fits-4k';
                        return 'above-4k';
                    })(),
                });

                // Clean up the Blob URL
                URL.revokeObjectURL(img.src);

            } catch (error) {
                console.error("Error extracting image metadata for TFile:", error);
            }
        } else {
            // Handle File (files being dragged or pasted)
            try {
                const img = new Image();
                img.src = URL.createObjectURL(file);

                // Wait for the image to load
                await new Promise((resolve, reject) => {
                    img.onload = () => resolve(img);
                    img.onerror = (event) => {
                        console.error("Error extracting image metadata for File:", event);
                        reject(event);
                    };
                });

                const { width, height } = img;

                metadata["{width}"] = width.toString();
                metadata["{height}"] = height.toString();
                metadata["{aspectratio}"] = (width / height).toFixed(2);
                metadata["{orientation}"] =
                    width > height
                        ? "landscape"
                        : width < height
                            ? "portrait"
                            : "square";

                // Calculate more properties
                const aspectRatio = width / height;
                const isSquare = Math.abs(aspectRatio - 1) < 0.01;
                const pixelCount = width * height;

                // Get file size directly from the File object
                const fileSizeInBytes = file.size;

                // Add properties to metadata object
                Object.assign(metadata, {
                    // Existing properties
                    '{ratio}': aspectRatio.toFixed(2),
                    '{quality}': this.settings.quality.toString(),
                    '{resolution}': `${img.width}x${img.height}`,
                    '{megapixels}': (pixelCount / 1000000).toFixed(2),

                    // New properties
                    '{issquare}': isSquare.toString(),
                    '{pixelcount}': pixelCount.toString(),
                    '{aspectratiotype}': (() => {
                        if (isSquare) return '1:1';
                        if (Math.abs(aspectRatio - 1.33) < 0.1) return '4:3';
                        if (Math.abs(aspectRatio - 1.78) < 0.1) return '16:9';
                        if (Math.abs(aspectRatio - 1.6) < 0.1) return '16:10';
                        return 'custom';
                    })(),
                    '{resolutioncategory}': (() => {
                        if (pixelCount < 100000) return 'tiny';      // < 0.1MP  (e.g., 316x316 or smaller)
                        if (pixelCount < 500000) return 'small';     // < 0.5MP  (e.g., 707x707 or smaller)
                        if (pixelCount < 2000000) return 'medium';   // < 2MP    (e.g., 1414x1414 or smaller)
                        if (pixelCount < 8000000) return 'large';    // < 8MP    (e.g., 2828x2828 or smaller)
                        return 'very-large';                         // >= 8MP   (e.g., larger than 2828x2828)
                    })(),
                    '{filesizecategory}': (() => {
                        if (fileSizeInBytes < 50 * 1024) return '0-50KB';
                        if (fileSizeInBytes < 200 * 1024) return '51-200KB';
                        if (fileSizeInBytes < 1024 * 1024) return '201-1024KB';
                        if (fileSizeInBytes < 5 * 1024 * 1024) return '1025KB-5MB';
                        if (fileSizeInBytes < 10 * 1024 * 1024) return '5MB-10MB';
                        return '10MB+';
                    })(),
                    '{dominantdimension}': width > height ? 'width' : (width < height ? 'height' : 'equal'),
                    '{dimensiondifference}': Math.abs(width - height).toString(),
                    '{bytesperpixel}': (fileSizeInBytes / pixelCount).toFixed(2),
                    '{compressionratio}': (fileSizeInBytes / (pixelCount * 3)).toFixed(2), // Assuming RGB
                    '{maxdimension}': Math.max(width, height).toString(),
                    '{mindimension}': Math.min(width, height).toString(),
                    '{diagonalpixels}': Math.sqrt(width * width + height * height).toFixed(0),
                    '{aspectratiosimplified}': (() => {
                        const gcd = (a: number, b: number): number => b ? gcd(b, a % b) : a;
                        const w = width;
                        const h = height;
                        const divisor = gcd(w, h);
                        return `${w / divisor}:${h / divisor}`;
                    })(),
                    '{screenfitcategory}': (() => {
                        const standardWidth = 1920;
                        const standardHeight = 1080;
                        if (width <= standardWidth && height <= standardHeight) return 'fits-1080p';
                        if (width <= 2560 && height <= 1440) return 'fits-1440p';
                        if (width <= 3840 && height <= 2160) return 'fits-4k';
                        return 'above-4k';
                    })(),
                });

                // Clean up the Blob URL
                URL.revokeObjectURL(img.src);

            } catch (error) {
                console.error("Error extracting image metadata for File:", error);
            }
        }

        return metadata;
    }

    private formatSize(
        size: number,
        unit: string,
        decimals: number
    ): string {
        switch (unit) {
            case "MB":
                return (size / (1024 * 1024)).toFixed(decimals);
            case "KB":
                return (size / 1024).toFixed(decimals);
            case "B":
                return size.toFixed(decimals);
            default:
                return size.toString();
        }
    }

    private generateRandomHex(size: number): string {
        const array = new Uint8Array(Math.ceil(size / 2));
        window.crypto.getRandomValues(array);
        return Array.from(array)
            .map((b) => b.toString(16).padStart(2, "0"))
            .join("")
            .substring(0, size); // Trim in case size is odd
    }

    private async getNextCounter(
        folderPath: string,
        padding: number
    ): Promise<string> {
        const counterKey = `counter-${folderPath}`;
        let counter = this.counters.get(counterKey) || 0;
        counter++;
        this.counters.set(counterKey, counter);
        return counter.toString().padStart(padding, "0");
    }

    private async generateMD5(text: string): Promise<string> {
        // Implementation of MD5 algorithm
        function md5(string: string): string {
            function rotateLeft(value: number, shift: number): number {
                return (value << shift) | (value >>> (32 - shift));
            }

            function addUnsigned(lX: number, lY: number): number {
                const lX8 = lX & 0x80000000;
                const lY8 = lY & 0x80000000;
                const lX4 = lX & 0x40000000;
                const lY4 = lY & 0x40000000;
                const lResult = (lX & 0x3FFFFFFF) + (lY & 0x3FFFFFFF);

                if (lX4 & lY4) {
                    return lResult ^ 0x80000000 ^ lX8 ^ lY8;
                }
                if (lX4 | lY4) {
                    if (lResult & 0x40000000) {
                        return lResult ^ 0xC0000000 ^ lX8 ^ lY8;
                    } else {
                        return lResult ^ 0x40000000 ^ lX8 ^ lY8;
                    }
                } else {
                    return lResult ^ lX8 ^ lY8;
                }
            }

            function F(x: number, y: number, z: number): number {
                return (x & y) | ((~x) & z);
            }

            function G(x: number, y: number, z: number): number {
                return (x & z) | (y & (~z));
            }

            function H(x: number, y: number, z: number): number {
                return x ^ y ^ z;
            }

            function I(x: number, y: number, z: number): number {
                return y ^ (x | (~z));
            }

            function FF(a: number, b: number, c: number, d: number, x: number, s: number, ac: number): number {
                a = addUnsigned(a, addUnsigned(addUnsigned(F(b, c, d), x), ac));
                return addUnsigned(rotateLeft(a, s), b);
            }

            function GG(a: number, b: number, c: number, d: number, x: number, s: number, ac: number): number {
                a = addUnsigned(a, addUnsigned(addUnsigned(G(b, c, d), x), ac));
                return addUnsigned(rotateLeft(a, s), b);
            }

            function HH(a: number, b: number, c: number, d: number, x: number, s: number, ac: number): number {
                a = addUnsigned(a, addUnsigned(addUnsigned(H(b, c, d), x), ac));
                return addUnsigned(rotateLeft(a, s), b);
            }

            function II(a: number, b: number, c: number, d: number, x: number, s: number, ac: number): number {
                a = addUnsigned(a, addUnsigned(addUnsigned(I(b, c, d), x), ac));
                return addUnsigned(rotateLeft(a, s), b);
            }

            function convertToWordArray(string: string): number[] {
                let lWordCount: number;
                const lMessageLength = string.length;
                const lNumberOfWordsTemp1 = lMessageLength + 8;
                const lNumberOfWordsTemp2 = (lNumberOfWordsTemp1 - (lNumberOfWordsTemp1 % 64)) / 64;
                const lNumberOfWords = (lNumberOfWordsTemp2 + 1) * 16;
                const lWordArray = Array(lNumberOfWords - 1);
                let lBytePosition = 0;
                let lByteCount = 0;

                while (lByteCount < lMessageLength) {
                    lWordCount = (lByteCount - (lByteCount % 4)) / 4;
                    lBytePosition = (lByteCount % 4) * 8;
                    lWordArray[lWordCount] = (lWordArray[lWordCount] || 0) | (string.charCodeAt(lByteCount) << lBytePosition);
                    lByteCount++;
                }

                lWordCount = (lByteCount - (lByteCount % 4)) / 4;
                lBytePosition = (lByteCount % 4) * 8;
                lWordArray[lWordCount] = lWordArray[lWordCount] | (0x80 << lBytePosition);
                lWordArray[lNumberOfWords - 2] = lMessageLength << 3;
                lWordArray[lNumberOfWords - 1] = lMessageLength >>> 29;

                return lWordArray;
            }

            function wordToHex(lValue: number): string {
                let WordToHexValue = "",
                    WordToHexValueTemp = "",
                    lByte, lCount;

                for (lCount = 0; lCount <= 3; lCount++) {
                    lByte = (lValue >>> (lCount * 8)) & 255;
                    WordToHexValueTemp = "0" + lByte.toString(16);
                    WordToHexValue = WordToHexValue + WordToHexValueTemp.substr(WordToHexValueTemp.length - 2, 2);
                }

                return WordToHexValue;
            }

            const x = convertToWordArray(string);
            let k, AA, BB, CC, DD, a, b, c, d;
            const S11 = 7, S12 = 12, S13 = 17, S14 = 22;
            const S21 = 5, S22 = 9, S23 = 14, S24 = 20;
            const S31 = 4, S32 = 11, S33 = 16, S34 = 23;
            const S41 = 6, S42 = 10, S43 = 15, S44 = 21;

            a = 0x67452301;
            b = 0xEFCDAB89;
            c = 0x98BADCFE;
            d = 0x10325476;

            for (k = 0; k < x.length; k += 16) {
                AA = a;
                BB = b;
                CC = c;
                DD = d;

                a = FF(a, b, c, d, x[k], S11, 0xD76AA478);
                d = FF(d, a, b, c, x[k + 1], S12, 0xE8C7B756);
                c = FF(c, d, a, b, x[k + 2], S13, 0x242070DB);
                b = FF(b, c, d, a, x[k + 3], S14, 0xC1BDCEEE);
                a = FF(a, b, c, d, x[k + 4], S11, 0xF57C0FAF);
                d = FF(d, a, b, c, x[k + 5], S12, 0x4787C62A);
                c = FF(c, d, a, b, x[k + 6], S13, 0xA8304613);
                b = FF(b, c, d, a, x[k + 7], S14, 0xFD469501);
                a = FF(a, b, c, d, x[k + 8], S11, 0x698098D8);
                d = FF(d, a, b, c, x[k + 9], S12, 0x8B44F7AF);
                c = FF(c, d, a, b, x[k + 10], S13, 0xFFFF5BB1);
                b = FF(b, c, d, a, x[k + 11], S14, 0x895CD7BE);
                a = FF(a, b, c, d, x[k + 12], S11, 0x6B901122);
                d = FF(d, a, b, c, x[k + 13], S12, 0xFD987193);
                c = FF(c, d, a, b, x[k + 14], S13, 0xA679438E);
                b = FF(b, c, d, a, x[k + 15], S14, 0x49B40821);

                a = GG(a, b, c, d, x[k + 1], S21, 0xF61E2562);
                d = GG(d, a, b, c, x[k + 6], S22, 0xC040B340);
                c = GG(c, d, a, b, x[k + 11], S23, 0x265E5A51);
                b = GG(b, c, d, a, x[k], S24, 0xE9B6C7AA);
                a = GG(a, b, c, d, x[k + 5], S21, 0xD62F105D);
                d = GG(d, a, b, c, x[k + 10], S22, 0x2441453);
                c = GG(c, d, a, b, x[k + 15], S23, 0xD8A1E681);
                b = GG(b, c, d, a, x[k + 4], S24, 0xE7D3FBC8);
                a = GG(a, b, c, d, x[k + 9], S21, 0x21E1CDE6);
                d = GG(d, a, b, c, x[k + 14], S22, 0xC33707D6);
                c = GG(c, d, a, b, x[k + 3], S23, 0xF4D50D87);
                b = GG(b, c, d, a, x[k + 8], S24, 0x455A14ED);
                a = GG(a, b, c, d, x[k + 13], S21, 0xA9E3E905);
                d = GG(d, a, b, c, x[k + 2], S22, 0xFCEFA3F8);
                c = GG(c, d, a, b, x[k + 7], S23, 0x676F02D9);
                b = GG(b, c, d, a, x[k + 12], S24, 0x8D2A4C8A);

                a = HH(a, b, c, d, x[k + 5], S31, 0xFFFA3942);
                d = HH(d, a, b, c, x[k + 8], S32, 0x8771F681);
                c = HH(c, d, a, b, x[k + 11], S33, 0x6D9D6122);
                b = HH(b, c, d, a, x[k + 14], S34, 0xFDE5380C);
                a = HH(a, b, c, d, x[k + 1], S31, 0xA4BEEA44);
                d = HH(d, a, b, c, x[k + 4], S32, 0x4BDECFA9);
                c = HH(c, d, a, b, x[k + 7], S33, 0xF6BB4B60);
                b = HH(b, c, d, a, x[k + 10], S34, 0xBEBFBC70);
                a = HH(a, b, c, d, x[k + 13], S31, 0x289B7EC6);
                d = HH(d, a, b, c, x[k], S32, 0xEAA127FA);
                c = HH(c, d, a, b, x[k + 3], S33, 0xD4EF3085);
                b = HH(b, c, d, a, x[k + 6], S34, 0x4881D05);
                a = HH(a, b, c, d, x[k + 9], S31, 0xD9D4D039);
                d = HH(d, a, b, c, x[k + 12], S32, 0xE6DB99E5);
                c = HH(c, d, a, b, x[k + 15], S33, 0x1FA27CF8);
                b = HH(b, c, d, a, x[k + 2], S34, 0xC4AC5665);

                a = II(a, b, c, d, x[k], S41, 0xF4292244);
                d = II(d, a, b, c, x[k + 7], S42, 0x432AFF97);
                c = II(c, d, a, b, x[k + 14], S43, 0xAB9423A7);
                b = II(b, c, d, a, x[k + 5], S44, 0xFC93A039);
                a = II(a, b, c, d, x[k + 12], S41, 0x655B59C3);
                d = II(d, a, b, c, x[k + 3], S42, 0x8F0CCC92);
                c = II(c, d, a, b, x[k + 10], S43, 0xFFEFF47D);
                b = II(b, c, d, a, x[k + 1], S44, 0x85845DD1);
                a = II(a, b, c, d, x[k + 8], S41, 0x6FA87E4F);
                d = II(d, a, b, c, x[k + 15], S42, 0xFE2CE6E0);
                c = II(c, d, a, b, x[k + 6], S43, 0xA3014314);
                b = II(b, c, d, a, x[k + 13], S44, 0x4E0811A1);
                a = II(a, b, c, d, x[k + 4], S41, 0xF7537E82);
                d = II(d, a, b, c, x[k + 11], S42, 0xBD3AF235);
                c = II(c, d, a, b, x[k + 2], S43, 0x2AD7D2BB);
                b = II(b, c, d, a, x[k + 9], S44, 0xEB86D391);

                a = addUnsigned(a, AA);
                b = addUnsigned(b, BB);
                c = addUnsigned(c, CC);
                d = addUnsigned(d, DD);
            }

            const temp = wordToHex(a) + wordToHex(b) + wordToHex(c) + wordToHex(d);
            return temp.toLowerCase();
        }

        try {
            return md5(text);
        } catch (error) {
            console.error('MD5 generation failed:', error);
            return 'error';
        }
    }

    private escapeRegExp(string: string): string {
        return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }

    private async generateSHA256(text: string): Promise<string> {
        const encoder = new TextEncoder();
        const data = encoder.encode(text);
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
        return hashHex;
    }
    
    private async generateFileContentSHA256(file: TFile | File): Promise<string> {
        try {
            let arrayBuffer: ArrayBuffer;
            
            if (file instanceof TFile) {
                // Handle TFile (files in the vault)
                arrayBuffer = await this.app.vault.readBinary(file);
            } else {
                // Handle File (dragged/pasted files)
                arrayBuffer = await file.arrayBuffer();
            }
            
            const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer);
            const hashArray = Array.from(new Uint8Array(hashBuffer));
            const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
            return hashHex;
        } catch (error) {
            console.error('Error generating SHA-256 hash of file content:', error);
            return 'error';
        }
    }
}
