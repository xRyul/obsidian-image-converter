// Decides when the original image is kept in place of the converted one:
// the image was not converted, or the conversion saves too little.

import type { ConversionPreset, ImageConverterSettings, OutputFormat } from "../ImageConverterSettings";
import * as isobmff from "../metadata/containers/isobmff";
import * as jpeg from "../metadata/containers/jpeg";
import * as png from "../metadata/containers/png";
import * as webp from "../metadata/containers/webp";

/**
 * Why the original image is kept.
 * - notConverted: the image processor did not give an image in the requested
 *   format. It gives the original bytes when a conversion fails.
 * - smallSaving: "Revert to original if larger" is on, and the converted
 *   image is not smaller by the minimum savings.
 */
export type KeepOriginalReason = "notConverted" | "smallSaving";

/** When a conversion reverts to the original image. */
export interface RevertPolicy {
    /** "Revert to original if larger" is on. */
    revertIfLarger: boolean;
    /** The converted image must be smaller by at least this much. */
    minSavingsKB: number;
}

const DEFAULT_MIN_SAVINGS_KB = 30;

const AVIF_BRANDS: ReadonlySet<string> = new Set(["avif", "avis"]);

/**
 * Tells whether the bytes are an image in the requested output format.
 * `ORIGINAL` and `NONE` request no format, so every image passes.
 */
export function isInOutputFormat(image: ArrayBuffer, format: OutputFormat): boolean {
    const bytes = new Uint8Array(image);

    switch (format) {
        case "WEBP":
            return webp.matches(bytes);
        case "JPEG":
            return jpeg.matches(bytes);
        case "PNG":
        case "PNGQUANT":
            return png.matches(bytes);
        case "AVIF":
            return isobmff.hasBrand(bytes, AVIF_BRANDS);
        case "ORIGINAL":
        case "NONE":
            return true;
        default:
            return false; // A format that is not known cannot be checked
    }
}

/** The conversion preset that is selected in the settings, if it still exists. */
export function getSelectedConversionPreset(
    settings: Pick<ImageConverterSettings, "conversionPresets" | "selectedConversionPreset">
): ConversionPreset | undefined {
    return settings.conversionPresets.find((preset) => preset.name === settings.selectedConversionPreset);
}

/**
 * Reads "Revert to original if larger" and "Minimum compression savings".
 * The values of the preset are used. A preset saved before it had these
 * values uses the plugin settings.
 */
export function getRevertPolicy(
    settings: Pick<ImageConverterSettings, "revertToOriginalIfLarger" | "minimumCompressionSavingsInKB">,
    preset?: ConversionPreset
): RevertPolicy {
    const minSavingsKB = preset?.minimumCompressionSavingsInKB ?? settings.minimumCompressionSavingsInKB;

    return {
        revertIfLarger: preset?.revertToOriginalIfLarger ?? settings.revertToOriginalIfLarger,
        minSavingsKB: typeof minSavingsKB === "number" && minSavingsKB >= 0 ? minSavingsKB : DEFAULT_MIN_SAVINGS_KB,
    };
}

/**
 * Tells why the original image must be kept in place of the converted one.
 *
 * @param originalSize - Size of the original image in bytes.
 * @param converted - What the image processor returned.
 * @param format - The output format that was requested.
 * @returns The reason, or null when the converted image is to be used.
 */
export function reasonToKeepOriginal(
    originalSize: number,
    converted: ArrayBuffer,
    format: OutputFormat,
    policy: RevertPolicy
): KeepOriginalReason | null {
    if (!isInOutputFormat(converted, format)) {
        return "notConverted";
    }
    if (policy.revertIfLarger && converted.byteLength + policy.minSavingsKB * 1024 > originalSize) {
        return "smallSaving";
    }
    return null;
}
