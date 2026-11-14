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
    MAX_EXIF_BYTES: number;
}

const READERS: ContainerReader[] = [jpeg, png, webp, isobmff, tiff];

/** Output containers we can write metadata into. */
const WRITERS: ContainerWriter[] = [jpeg, png, webp, isobmff];

export class MetadataTransfer {
    /**
     * Transfers metadata from the source image into the converted one.
     * If a step fails, this returns the output unchanged.
     *
     * @param source - The original image.
     * @param output - The converted bytes.
     * @param orientationApplied - True when the conversion rotated the pixels
     *        to match the Orientation tag of the source. If false, the tag
     *        keeps its value.
     * @returns The output, with metadata attached where possible.
     */
    async transfer(
        source: Blob,
        output: ArrayBuffer,
        orientationApplied = true
    ): Promise<ArrayBuffer> {
        try {
            return await this.run(source, output, orientationApplied);
        } catch (error) {
            console.warn("Image Converter: could not preserve metadata", error);
            return output;
        }
    }

    private async run(
        source: Blob,
        output: ArrayBuffer,
        orientationApplied: boolean
    ): Promise<ArrayBuffer> {
        const outputBytes = new Uint8Array(output);
        const sourceBytes = new Uint8Array(await source.arrayBuffer());

        // If the output is the source file unchanged (no conversion, or a
        // fallback after an error), it already has its metadata.
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

        const normalised = normalise(block, writer.readDimensions(outputBytes), orientationApplied);
        const serialised = serialiseWithin(normalised, writer.MAX_EXIF_BYTES);
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
