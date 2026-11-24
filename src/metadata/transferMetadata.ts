// transferMetadata.ts
// Reads the EXIF block out of the source image, normalises it for the re-encoded pixels,
// and writes it into the container that the conversion produced.

import { Dimensions, ExifBlock, ExifIfd, MetadataMode } from "./types";
import { isEmptyBlock, normalise, parseExifBlock, readOrientation, serialiseWithin } from "./ExifBlock";
import { TAG_ORIENTATION } from "./tags";
import { equalBytes } from "./containers/bytes";
import * as isobmff from "./containers/isobmff";
import * as jpeg from "./containers/jpeg";
import * as png from "./containers/png";
import * as tiff from "./containers/tiff";
import * as webp from "./containers/webp";

/** A container we can pull an EXIF block out of.
 * Assumes `matches()` has already returned true for the bytes.
 */
interface ContainerReader {
    matches(bytes: Uint8Array): boolean;
    readExif(bytes: Uint8Array): Uint8Array | null;
}

/** A container we can also put an EXIF block into, or take it out of. */
interface ContainerWriter extends ContainerReader {
    readDimensions(bytes: Uint8Array): Dimensions | null;
    writeExif(bytes: Uint8Array, exif: Uint8Array): Uint8Array;
    removeExif(bytes: Uint8Array): Uint8Array;
    /** Hard ceiling on the EXIF block this container can hold. */
    MAX_EXIF_BYTES?: number;
}

const READERS: ContainerReader[] = [jpeg, png, webp, isobmff, tiff];

/** Output containers we can write metadata into. */
const WRITERS: ContainerWriter[] = [jpeg, png, webp, isobmff];

/**
 * Transfers metadata from the source image into the converted one.
 *
 * In "keep-all" mode, a failed step returns the output unchanged. In the
 * other modes, a failed step returns the output with no EXIF, or throws if
 * the EXIF cannot be removed: the caller must not save the image then.
 *
 * @param orientationApplied - True when the conversion rotated the pixels
 *        to match the Orientation tag of the source. If false, the tag
 *        keeps its value.
 * @param mode - Which metadata to keep. See `MetadataMode`.
 */
export async function transferMetadata(
    source: Blob,
    output: ArrayBuffer,
    orientationApplied = true,
    mode: MetadataMode = "keep-all"
): Promise<ArrayBuffer> {
    try {
        return await transfer(source, output, orientationApplied, mode);
    } catch (error) {
        console.warn("Image Converter: could not preserve metadata", error);
        return mode === "keep-all" ? output : removeMetadata(output);
    }
}

/**
 * Removes the EXIF block from an image.
 *
 * @returns The image without EXIF. These are the same bytes when the image
 *          has none.
 * @throws If the image has EXIF that cannot be removed safely.
 */
export function removeMetadata(image: ArrayBuffer): ArrayBuffer {
    const bytes = new Uint8Array(image);
    const reader = READERS.find((container) => container.matches(bytes));
    if (!reader || reader.readExif(bytes) === null) {
        return image;
    }

    const writer = WRITERS.find((container) => container.matches(bytes));
    if (!writer) {
        throw new Error("Image Converter: cannot remove EXIF from this image format");
    }

    const stripped = writer.removeExif(bytes);
    if (writer.readExif(stripped) !== null) {
        throw new Error("Image Converter: EXIF is still in the image after removal");
    }

    return toArrayBuffer(stripped);
}

async function transfer(
    source: Blob,
    output: ArrayBuffer,
    orientationApplied: boolean,
    mode: MetadataMode
): Promise<ArrayBuffer> {
    const outputBytes = new Uint8Array(output);
    const sourceBytes = new Uint8Array(await source.arrayBuffer());

    // The output can be the source file unchanged: no conversion, or a
    // fallback after an error. It already has its metadata, and its pixels
    // are as stored.
    const unchanged = equalBytes(sourceBytes, outputBytes);
    if (unchanged && mode === "keep-all") {
        return output;
    }

    // With no block to write, keep-all leaves the output as it is. The other
    // modes remove any EXIF that it holds.
    const withoutBlock = () => (mode === "keep-all" ? output : removeMetadata(output));

    const reader = READERS.find((container) => container.matches(sourceBytes));
    const rawExif = reader?.readExif(sourceBytes);
    const parsed = rawExif ? parseExifBlock(rawExif) : null;
    if (!parsed) {
        return withoutBlock();
    }

    if (mode === "strip-location" && unchanged && parsed.gps.size === 0) {
        return output; // there is no location to remove
    }

    const block = keptTags(parsed, mode, unchanged || !orientationApplied);

    const writer = WRITERS.find((container) => container.matches(outputBytes));
    if (!writer || isEmptyBlock(block)) {
        return withoutBlock();
    }

    // Unchanged pixels keep the tags as they are. In strip-all mode, the
    // block holds only an Orientation tag that must keep its value.
    const normalised = unchanged || mode === "strip-all"
        ? block
        : normalise(block, writer.readDimensions(outputBytes), orientationApplied);
    const serialised = serialiseWithin(normalised, writer.MAX_EXIF_BYTES ?? Infinity);
    if (!serialised) {
        return withoutBlock();
    }

    return toArrayBuffer(writer.writeExif(outputBytes, serialised));
}

/**
 * The tags of the source that the mode keeps.
 *
 * @param pixelsAsStored - True when the output pixels are not rotated. Then
 *        viewers need the Orientation tag to show the image upright, so
 *        strip-all keeps it.
 */
function keptTags(block: ExifBlock, mode: MetadataMode, pixelsAsStored: boolean): ExifBlock {
    if (mode === "keep-all") {
        return block;
    }
    if (mode === "strip-location") {
        return { ...block, gps: new Map() };
    }

    const ifd0: ExifIfd = new Map();
    const orientation = block.ifd0.get(TAG_ORIENTATION);
    if (pixelsAsStored && orientation && readOrientation(block) !== 1) {
        ifd0.set(TAG_ORIENTATION, orientation);
    }

    return { bigEndian: block.bigEndian, ifd0, exif: new Map(), gps: new Map(), interop: new Map() };
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
    if (bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength) {
        return bytes.buffer as ArrayBuffer;
    }
    return bytes.slice().buffer;
}
