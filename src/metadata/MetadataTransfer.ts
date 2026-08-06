// MetadataTransfer.ts
// Reads the EXIF block out of the source image, normalises it for the re-encoded pixels,
// and writes it into whatever container actually came out of the conversion.

import { Dimensions } from "./types";
import { isEmptyBlock, normalise, parseExifBlock, serialiseWithin } from "./ExifBlock";
import { equalBytes } from "./containers/bytes";
import * as isobmff from "./containers/isobmff";
import * as jpeg from "./containers/jpeg";
import * as png from "./containers/png";
import * as tiff from "./containers/tiff";
import * as webp from "./containers/webp";

/** A container we can pull an EXIF block out of. */
interface ContainerReader {
    matches(bytes: Uint8Array): boolean;
    readExif(bytes: Uint8Array): Uint8Array | null;
}

/** A container we can also put an EXIF block back into. */
interface ContainerWriter extends ContainerReader {
    readDimensions(bytes: Uint8Array): Dimensions | null;
    writeExif(bytes: Uint8Array, exif: Uint8Array): Uint8Array;
    /** Hard ceiling on the EXIF block this container can hold. */
    maxExifBytes: number;
}

const JPEG_CODEC: ContainerWriter = {
    matches: jpeg.isJpeg,
    readExif: jpeg.readExif,
    readDimensions: jpeg.readDimensions,
    writeExif: jpeg.writeExif,
    maxExifBytes: jpeg.MAX_EXIF_BYTES,
};

const PNG_CODEC: ContainerWriter = {
    matches: png.isPng,
    readExif: png.readExif,
    readDimensions: png.readDimensions,
    writeExif: png.writeExif,
    maxExifBytes: png.MAX_EXIF_BYTES,
};

const WEBP_CODEC: ContainerWriter = {
    matches: webp.isWebp,
    readExif: webp.readExif,
    readDimensions: webp.readDimensions,
    writeExif: webp.writeExif,
    maxExifBytes: webp.MAX_EXIF_BYTES,
};

/** HEIC, HEIF and AVIF: read as a source, written when ffmpeg emits AVIF. */
const ISOBMFF_CODEC: ContainerWriter = {
    matches: isobmff.isIsobmff,
    readExif: isobmff.readExif,
    readDimensions: isobmff.readDimensions,
    writeExif: isobmff.writeExif,
    maxExifBytes: isobmff.MAX_EXIF_BYTES,
};

/** Source containers. TIFF is a read-only format we only convert from. */
const READERS: ContainerReader[] = [
    JPEG_CODEC,
    PNG_CODEC,
    WEBP_CODEC,
    ISOBMFF_CODEC,
    { matches: tiff.isTiff, readExif: tiff.readExif },
];

/** Output containers we can write metadata into. */
const WRITERS: ContainerWriter[] = [JPEG_CODEC, PNG_CODEC, WEBP_CODEC, ISOBMFF_CODEC];

export class MetadataTransfer {
    /**
     * Transfers metadata from the source image into the converted one.
	 * Failure path returns the output unchanged.
     *
     * @param source - The original image.
     * @param output - The converted bytes.
     * @returns The output, with metadata attached where possible.
     */
    async transfer(source: Blob, output: ArrayBuffer): Promise<ArrayBuffer> {
        try {
            return await this.run(source, output);
        } catch (error) {
            console.warn("Image Converter: could not preserve metadata", error);
            return output;
        }
    }

    private async run(source: Blob, output: ArrayBuffer): Promise<ArrayBuffer> {
        const outputBytes = new Uint8Array(output);
        const sourceBytes = new Uint8Array(await source.arrayBuffer());

        // Returns unmodified for no-op conversions and error fallbacks.
        if (equalBytes(sourceBytes, outputBytes)) {
            return output;
        }

        const reader = READERS.find((container) => container.matches(sourceBytes));
        const rawExif = reader?.readExif(sourceBytes);
        if (!rawExif) {
            return output;
        }

        const writer = WRITERS.find((container) => container.matches(outputBytes));
        if (!writer) {
            return output;
        }

        const block = parseExifBlock(rawExif);
        if (!block || isEmptyBlock(block)) {
            return output;
        }

        const normalised = normalise(block, writer.readDimensions(outputBytes));
        const serialised = serialiseWithin(normalised, writer.maxExifBytes);
        if (!serialised) {
            return output;
        }

        return toArrayBuffer(writer.writeExif(outputBytes, serialised));
    }
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
    if (bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength) {
        return bytes.buffer as ArrayBuffer;
    }
    return bytes.slice().buffer;
}
