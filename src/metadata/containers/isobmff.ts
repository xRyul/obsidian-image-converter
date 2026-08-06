// isobmff.ts
// HEIC/HEIF and AVIF share the ISO base media file format, where metadata is an
// item inside the `meta` box: `iinf` says what each item is, `iloc` says where
// its bytes are, and `iref` ties an item to the image it describes.
//
// Writing means rebuilding those three boxes and appending the EXIF payload as a
// new `mdat` at the end of the file, which leaves the existing image data where
// it is. `meta` still grows, so every absolute item offset that sits after it
// has to be patched by the same delta - the one step here that can silently
// corrupt a file, so the result is verified before it is returned.

import { Dimensions } from "../types";
import { ascii, concat, equalBytes, readFourCc, viewOf } from "./bytes";

/** Brands that indicate a still image we can read EXIF from. */
const BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1', 'avif', 'avis']);

const ITEM_TYPE_EXIF = 'Exif';
/** `cdsc`: "content describes". How an Exif item is bound to the image. */
const REFERENCE_TYPE_EXIF = 'cdsc';

/**
 * Box sizes are 32-bit. Held to 31 bits so the `mdat` header cannot push the
 * payload over the limit.
 */
export const MAX_EXIF_BYTES = 0x7fffffff;

/** Item IDs we write are 16-bit, which is what `infe` version 2 carries. */
const MAX_ITEM_ID = 0xffff;

interface Box {
    type: string;
    /** Offset of the box's size field. */
    start: number;
    payloadStart: number;
    end: number;
}

interface Extent {
    offset: number;
    length: number;
}

/** The `meta` box, split into the parts a rewrite needs to keep. */
interface Meta {
    box: Box;
    /** meta is a FullBox; these are its version and flags. */
    header: Uint8Array;
    children: Box[];
    /** False when `children` does not account for the whole box. See `walkAll`. */
    complete: boolean;
}

/** One `infe` entry. The raw box is reused verbatim when the entry survives. */
interface ItemEntry {
    itemId: number;
    itemType: string;
    bytes: Uint8Array;
}

interface ItemInfo {
    version: number;
    flags: Uint8Array;
    entries: ItemEntry[];
    /** False when `entries` does not account for every `infe` in the box. */
    complete: boolean;
}

/** One `iloc` entry, with its extents resolved. */
interface Location {
    itemId: number;
    constructionMethod: number;
    dataReferenceIndex: number;
    baseOffset: number;
    extents: Extent[];
    /**
     * True when the entry carries a non-zero extent_index, which only means
     * anything alongside item protection. Readable, but not safe to rewrite.
     */
    indexed: boolean;
}

/** True when the bytes declare an ISOBMFF still-image brand we can read. */
export function isIsobmff(bytes: Uint8Array): boolean {
    const ftyp = findBox(bytes, 0, bytes.length, 'ftyp');
    if (!ftyp) {
        return false;
    }

    // Payload is major_brand (4), minor_version (4), then compatible brands.
    for (let offset = ftyp.payloadStart; offset + 4 <= ftyp.end; offset += 4) {
        if (offset === ftyp.payloadStart + 4) {
            continue; // minor_version is a number, not a brand
        }
        if (BRANDS.has(readFourCc(bytes, offset))) {
            return true;
        }
    }

    return false;
}

/**
 * Reads the EXIF block out of the `Exif` item of a HEIC, HEIF or AVIF file.
 * @param bytes - The image file.
 * @returns The raw block, or null if there is no readable EXIF item.
 */
export function readExif(bytes: Uint8Array): Uint8Array | null {
    if (!isIsobmff(bytes)) {
        return null;
    }

    const meta = readMeta(bytes);
    if (!meta) {
        return null;
    }

    const iinfBox = findChild(meta, 'iinf');
    const ilocBox = findChild(meta, 'iloc');
    if (!iinfBox || !ilocBox) {
        return null;
    }

    const info = parseItemInfo(bytes, iinfBox);
    const locations = parseLocations(bytes, ilocBox);
    if (!info || !locations) {
        return null;
    }

    const item = info.entries.find((entry) => entry.itemType === ITEM_TYPE_EXIF);
    if (!item) {
        return null;
    }

    const location = locations.find((entry) => entry.itemId === item.itemId);
    if (!location || location.constructionMethod !== 0 || location.extents.length === 0) {
        // Other construction methods need the item reassembled from `idat`.
        return null;
    }

    return readExifItem(bytes, {
        offset: location.baseOffset + location.extents[0].offset,
        length: location.extents[0].length,
    });
}

/**
 * Writes an EXIF block into a HEIC, HEIF or AVIF file, replacing any item
 * already there.
 *
 * @param bytes - The image file.
 * @param exif - The raw block to embed.
 * @returns A new file carrying the block.
 * @throws If the file cannot be rewritten safely, or fails its own round trip.
 */
export function writeExif(bytes: Uint8Array, exif: Uint8Array): Uint8Array {
    if (!isIsobmff(bytes)) {
        throw new Error("Not an ISOBMFF still image");
    }
    if (exif.length > MAX_EXIF_BYTES) {
        throw new Error("EXIF block is too large for an ISOBMFF item");
    }

    const meta = readMeta(bytes);
    if (!meta) {
        throw new Error("ISOBMFF file has no meta box");
    }
    if (!meta.complete) {
        throw new Error("ISOBMFF meta box could not be fully parsed");
    }

    const iinfBox = findChild(meta, 'iinf');
    const ilocBox = findChild(meta, 'iloc');
    if (!iinfBox || !ilocBox) {
        throw new Error("ISOBMFF meta box has no item table");
    }

    const info = parseItemInfo(bytes, iinfBox);
    const locations = parseLocations(bytes, ilocBox);
    if (!info || !locations) {
        throw new Error("Could not parse the ISOBMFF item table");
    }
    if (!info.complete) {
        throw new Error("ISOBMFF item table has entries that cannot be rewritten");
    }

    // An item already holding EXIF is dropped from the tables. Its bytes stay in
    // place as dead weight, which costs a little size but leaves every other
    // item's offset alone.
    const replaced = info.entries.find((entry) => entry.itemType === ITEM_TYPE_EXIF);
    const replacedId = replaced ? replaced.itemId : null;
    const keptEntries = info.entries.filter((entry) => entry.itemId !== replacedId);
    const keptLocations = locations.filter((entry) => entry.itemId !== replacedId);

    if (keptLocations.some((entry) => entry.indexed)) {
        throw new Error("ISOBMFF items use extent indices, which cannot be rewritten");
    }

    const itemId = nextItemId(info.entries, locations);
    const payload = concat([uint32(0), exif]); // no gap before the TIFF header

    // Boxes whose size does not depend on offsets we have yet to compute.
    const newIinf = buildItemInfo(info, keptEntries, buildInfe(itemId));
    const newIref = buildItemReferences(bytes, meta, itemId, replacedId);

    // An `iloc` box's size is fixed by its entry and extent counts, not by the
    // values in it, so the meta box can be measured with placeholder offsets and
    // the real ones filled in once the delta is known.
    const placeholder = keptLocations.concat([newLocation(itemId, 0, payload.length)]);
    const probe = buildMeta(bytes, meta, newIinf, buildLocations(placeholder), newIref);

    const oldMetaLength = meta.box.end - meta.box.start;
    const delta = probe.length - oldMetaLength;
    const exifOffset = bytes.length + delta + 8; // past the appended mdat header

    const patched = keptLocations
        .map((entry) => shiftLocation(entry, meta.box.end, delta))
        .concat([newLocation(itemId, exifOffset, payload.length)]);
    const finalMeta = buildMeta(bytes, meta, newIinf, buildLocations(patched), newIref);

    if (finalMeta.length !== probe.length) {
        throw new Error("ISOBMFF meta box changed size after offset patching");
    }

    const out = concat([
        bytes.subarray(0, meta.box.start),
        finalMeta,
        bytes.subarray(meta.box.end),
        buildBox('mdat', payload),
    ]);

    const roundTripped = readExif(out);
    if (!roundTripped || !equalBytes(roundTripped, exif)) {
        throw new Error("ISOBMFF EXIF round trip failed");
    }
    if (!itemsIntact(bytes, keptLocations, out)) {
        throw new Error("ISOBMFF item offsets did not survive the rewrite");
    }

    return out;
}

/**
 * Reads the primary item's dimensions from its `ispe` property.
 * @param bytes - The image file.
 * @returns The dimensions, or null if no property could be resolved.
 */
export function readDimensions(bytes: Uint8Array): Dimensions | null {
    if (!isIsobmff(bytes)) {
        return null;
    }

    const meta = readMeta(bytes);
    const iprp = meta && findChild(meta, 'iprp');
    if (!meta || !iprp) {
        return null;
    }

    const ipco = findBox(bytes, iprp.payloadStart, iprp.end, 'ipco');
    if (!ipco) {
        return null;
    }

    const properties = [...walkBoxes(bytes, ipco.payloadStart, ipco.end)];
    const primary = readPrimaryItemId(bytes, meta);
    const indices = primary === null ? null : readPropertyIndices(bytes, iprp, primary);

    // Without an association the first `ispe` is the best guess available; with
    // one, only the primary item's own properties are considered.
    const associated = indices
        ? indices.map((index) => properties[index - 1]).filter((box): box is Box => Boolean(box))
        : properties;

    const ispe = associated.find((box) => box.type === 'ispe');
    if (!ispe || ispe.payloadStart + 12 > ispe.end) {
        return null;
    }

    const view = viewOf(bytes);
    const width = view.getUint32(ispe.payloadStart + 4, false);
    const height = view.getUint32(ispe.payloadStart + 8, false);
    if (width === 0 || height === 0) {
        return null;
    }

    // `ispe` describes the stored image, before any `irot` is applied.
    const quarterTurns = associated.find((box) => box.type === 'irot');
    const rotated = quarterTurns
        && quarterTurns.payloadStart < quarterTurns.end
        && (bytes[quarterTurns.payloadStart] & 0x03) % 2 === 1;

    return rotated ? { width: height, height: width } : { width, height };
}

/**
 * The Exif item payload is a 4-byte big-endian offset to the TIFF header,
 * followed by the block itself.
 */
function readExifItem(bytes: Uint8Array, extent: Extent): Uint8Array | null {
    const { offset, length } = extent;
    if (length < 4 || offset + length > bytes.length) {
        return null;
    }

    const headerOffset = viewOf(bytes).getUint32(offset, false);

    const blockStart = offset + 4 + headerOffset;
    const blockEnd = offset + length;
    if (blockStart >= blockEnd || blockEnd > bytes.length) {
        return null;
    }

    return bytes.slice(blockStart, blockEnd);
}

// --- Reading the meta box ---

function readMeta(bytes: Uint8Array): Meta | null {
    const box = findBox(bytes, 0, bytes.length, 'meta');
    if (!box || box.payloadStart + 4 > box.end) {
        return null;
    }

    // `meta` is a FullBox: version and flags precede its child boxes.
    const childrenStart = box.payloadStart + 4;
    const { boxes, complete } = walkAll(bytes, childrenStart, box.end);

    return {
        box,
        header: bytes.slice(box.payloadStart, childrenStart),
        children: boxes,
        complete,
    };
}

function findChild(meta: Meta, type: string): Box | null {
    return meta.children.find((child) => child.type === type) ?? null;
}

/** Parses `iinf`, keeping each `infe` box whole so it can be re-emitted. */
function parseItemInfo(bytes: Uint8Array, iinf: Box): ItemInfo | null {
    if (iinf.payloadStart + 4 > iinf.end) {
        return null;
    }

    const view = viewOf(bytes);
    const version = bytes[iinf.payloadStart];
    const flags = bytes.slice(iinf.payloadStart + 1, iinf.payloadStart + 4);

    // entry_count is 16-bit in version 0 and 32-bit above it. The count itself
    // is redundant here: the `infe` boxes that follow are walked directly.
    const entriesStart = iinf.payloadStart + 4 + (version === 0 ? 2 : 4);
    if (entriesStart > iinf.end) {
        return null;
    }

    const entries: ItemEntry[] = [];
    const { boxes, complete } = walkAll(bytes, entriesStart, iinf.end);

    let entriesIntact = complete;

    for (const infe of boxes) {
        if (infe.type !== 'infe') {
            continue; // padding; `iinf` carries nothing else worth keeping
        }
        if (infe.payloadStart + 4 > infe.end) {
            entriesIntact = false;
            continue;
        }

        const infeVersion = bytes[infe.payloadStart];
        const wideId = infeVersion >= 3;

        let cursor = infe.payloadStart + 4; // past version and flags
        if (cursor + (wideId ? 4 : 2) > infe.end) {
            entriesIntact = false;
            continue;
        }

        const itemId = wideId ? view.getUint32(cursor, false) : view.getUint16(cursor, false);
        cursor += wideId ? 4 : 2;
        cursor += 2; // item_protection_index

        // Only version 2 and above carry an item_type; older entries are kept
        // for re-emission but can never be the EXIF item.
        let itemType = '';
        if (infeVersion >= 2 && cursor + 4 <= infe.end) {
            itemType = readFourCc(bytes, cursor);
        }

        entries.push({ itemId, itemType, bytes: bytes.slice(infe.start, infe.end) });
    }

    return { version, flags, entries, complete: entriesIntact };
}

/** Parses `iloc` into absolute extents, one entry per item. */
function parseLocations(bytes: Uint8Array, iloc: Box): Location[] | null {
    if (iloc.payloadStart + 8 > iloc.end) {
        return null;
    }

    const view = viewOf(bytes);
    const version = bytes[iloc.payloadStart];

    let cursor = iloc.payloadStart + 4; // past version and flags

    const offsetSize = bytes[cursor] >> 4;
    const lengthSize = bytes[cursor] & 0x0f;
    const baseOffsetSize = bytes[cursor + 1] >> 4;
    const indexSize = (version === 1 || version === 2) ? (bytes[cursor + 1] & 0x0f) : 0;
    cursor += 2;

    let itemCount: number;
    if (version < 2) {
        itemCount = view.getUint16(cursor, false);
        cursor += 2;
    } else {
        itemCount = view.getUint32(cursor, false);
        cursor += 4;
    }

    const locations: Location[] = [];

    for (let i = 0; i < itemCount; i++) {
        if (cursor >= iloc.end) {
            return null;
        }

        let itemId: number;
        if (version < 2) {
            itemId = view.getUint16(cursor, false);
            cursor += 2;
        } else {
            itemId = view.getUint32(cursor, false);
            cursor += 4;
        }

        let constructionMethod = 0;
        if (version === 1 || version === 2) {
            constructionMethod = view.getUint16(cursor, false) & 0x0f;
            cursor += 2;
        }

        const dataReferenceIndex = view.getUint16(cursor, false);
        cursor += 2;
        const baseOffset = readUint(view, cursor, baseOffsetSize);
        cursor += baseOffsetSize;

        const extentCount = view.getUint16(cursor, false);
        cursor += 2;

        const extents: Extent[] = [];
        let indexed = false;

        for (let extent = 0; extent < extentCount; extent++) {
            if (cursor + indexSize + offsetSize + lengthSize > iloc.end) {
                return null;
            }

            if (indexSize > 0 && readUint(view, cursor, indexSize) !== 0) {
                indexed = true;
            }
            cursor += indexSize;

            const offset = readUint(view, cursor, offsetSize);
            cursor += offsetSize;
            const length = readUint(view, cursor, lengthSize);
            cursor += lengthSize;

            extents.push({ offset, length });
        }

        locations.push({ itemId, constructionMethod, dataReferenceIndex, baseOffset, extents, indexed });
    }

    return locations;
}

/** Reads the primary item ID from `pitm`. */
function readPrimaryItemId(bytes: Uint8Array, meta: Meta): number | null {
    const pitm = findChild(meta, 'pitm');
    if (!pitm || pitm.payloadStart + 6 > pitm.end) {
        return null;
    }

    const view = viewOf(bytes);
    const version = bytes[pitm.payloadStart];
    const cursor = pitm.payloadStart + 4;

    if (version === 0) {
        return view.getUint16(cursor, false);
    }
    return cursor + 4 <= pitm.end ? view.getUint32(cursor, false) : null;
}

/** Collects an item's 1-based property indices from the `ipma` boxes. */
function readPropertyIndices(bytes: Uint8Array, iprp: Box, itemId: number): number[] | null {
    const view = viewOf(bytes);

    for (const ipma of walkBoxes(bytes, iprp.payloadStart, iprp.end)) {
        if (ipma.type !== 'ipma' || ipma.payloadStart + 8 > ipma.end) {
            continue;
        }

        const version = bytes[ipma.payloadStart];
        const wideIndex = (bytes[ipma.payloadStart + 3] & 0x01) === 1;

        let cursor = ipma.payloadStart + 4;
        const entryCount = view.getUint32(cursor, false);
        cursor += 4;

        for (let entry = 0; entry < entryCount; entry++) {
            const wideId = version >= 1;
            if (cursor + (wideId ? 4 : 2) + 1 > ipma.end) {
                break;
            }

            const currentId = wideId ? view.getUint32(cursor, false) : view.getUint16(cursor, false);
            cursor += wideId ? 4 : 2;

            const associationCount = bytes[cursor];
            cursor += 1;

            const indices: number[] = [];
            for (let association = 0; association < associationCount; association++) {
                if (cursor + (wideIndex ? 2 : 1) > ipma.end) {
                    return null;
                }
                if (wideIndex) {
                    indices.push(view.getUint16(cursor, false) & 0x7fff);
                    cursor += 2;
                } else {
                    indices.push(bytes[cursor] & 0x7f);
                    cursor += 1;
                }
            }

            if (currentId === itemId) {
                return indices;
            }
        }
    }

    return null;
}

// --- Rewriting the meta box ---

function newLocation(itemId: number, offset: number, length: number): Location {
    return {
        itemId,
        constructionMethod: 0,
        dataReferenceIndex: 0,
        baseOffset: 0,
        extents: [{ offset, length }],
        indexed: false,
    };
}

/**
 * Moves an item's file offsets by the amount the meta box grew.
 *
 * Only construction method 0 is measured against the file. Method 1 is relative
 * to the `idat` box's payload, which does not move relative to itself, so those
 * entries pass through untouched.
 */
function shiftLocation(location: Location, oldMetaEnd: number, delta: number): Location {
    if (location.constructionMethod !== 0) {
        return location;
    }

    // Folding base_offset into each extent lets the rewritten box declare a
    // base_offset_size of zero.
    const extents = location.extents.map(({ offset, length }) => {
        const absolute = location.baseOffset + offset;
        return { offset: absolute >= oldMetaEnd ? absolute + delta : absolute, length };
    });

    return { ...location, baseOffset: 0, extents };
}

/** Picks an item ID no existing entry is using. */
function nextItemId(entries: ItemEntry[], locations: Location[]): number {
    let highest = 0;
    for (const entry of entries) {
        highest = Math.max(highest, entry.itemId);
    }
    for (const location of locations) {
        highest = Math.max(highest, location.itemId);
    }

    const itemId = highest + 1;
    if (itemId > MAX_ITEM_ID) {
        throw new Error("ISOBMFF item IDs are exhausted");
    }

    return itemId;
}

/** Builds the `infe` entry describing the EXIF item. */
function buildInfe(itemId: number): Uint8Array {
    return buildBox('infe', concat([
        new Uint8Array([2, 0, 0, 0]), // version 2, no flags
        uint16(itemId),
        uint16(0), // item_protection_index
        ascii(ITEM_TYPE_EXIF),
        new Uint8Array([0]), // item_name: an empty null-terminated string
    ]));
}

function buildItemInfo(info: ItemInfo, kept: ItemEntry[], added: Uint8Array): Uint8Array {
    const count = kept.length + 1;

    return buildBox('iinf', concat([
        new Uint8Array([info.version]),
        info.flags,
        info.version === 0 ? uint16(count) : uint32(count),
        ...kept.map((entry) => entry.bytes),
        added,
    ]));
}

/**
 * Builds `iloc` with fixed 32-bit offset and length fields, so its size depends
 * on the number of extents alone and can be measured before the offsets in it
 * are known.
 */
function buildLocations(locations: Location[]): Uint8Array {
    const parts: Uint8Array[] = [
        new Uint8Array([1, 0, 0, 0]), // version 1, no flags
        new Uint8Array([0x44]),       // offset_size 4, length_size 4
        new Uint8Array([0x00]),       // base_offset_size 0, index_size 0
        uint16(locations.length),
    ];

    for (const location of locations) {
        if (location.itemId > MAX_ITEM_ID) {
            throw new Error("ISOBMFF item ID is too large to rewrite");
        }

        parts.push(
            uint16(location.itemId),
            uint16(location.constructionMethod & 0x0f),
            uint16(location.dataReferenceIndex),
            uint16(location.extents.length),
        );

        for (const extent of location.extents) {
            // Method 1 offsets are relative to `idat` and keep their own base.
            const offset = location.constructionMethod === 0
                ? extent.offset
                : location.baseOffset + extent.offset;
            parts.push(uint32(offset), uint32(extent.length));
        }
    }

    return buildBox('iloc', concat(parts));
}

/**
 * Builds `iref`, adding a `cdsc` reference from the EXIF item to the primary
 * one. Readers largely ignore an Exif item that nothing binds to an image.
 *
 * @returns The box, or null when there is nothing to reference and no existing
 * box to preserve.
 */
function buildItemReferences(
    bytes: Uint8Array,
    meta: Meta,
    itemId: number,
    replacedId: number | null
): Uint8Array | null {
    const existing = findChild(meta, 'iref');
    const primary = readPrimaryItemId(bytes, meta);

    if (!existing && primary === null) {
        return null;
    }

    const view = viewOf(bytes);
    const version = existing && existing.payloadStart < existing.end
        ? bytes[existing.payloadStart]
        : 0;
    const wideId = version >= 1;
    const references: Uint8Array[] = [];

    if (existing) {
        for (const reference of walkBoxes(bytes, existing.payloadStart + 4, existing.end)) {
            if (reference.payloadStart + (wideId ? 4 : 2) > reference.end) {
                continue;
            }

            // References from the item being replaced go with it. Nothing points
            // *to* an Exif item, so the target lists are left alone.
            const from = wideId
                ? view.getUint32(reference.payloadStart, false)
                : view.getUint16(reference.payloadStart, false);
            if (from === replacedId) {
                continue;
            }

            references.push(bytes.slice(reference.start, reference.end));
        }
    }

    if (primary !== null) {
        references.push(buildBox(REFERENCE_TYPE_EXIF, concat([
            wideId ? uint32(itemId) : uint16(itemId),
            uint16(1), // reference_count
            wideId ? uint32(primary) : uint16(primary),
        ])));
    }

    if (references.length === 0) {
        return null;
    }

    return buildBox('iref', concat([new Uint8Array([version, 0, 0, 0]), ...references]));
}

/**
 * Reassembles `meta` from its original children, swapping in the rebuilt boxes.
 * Child order is otherwise preserved, since `hdlr` has to stay first.
 */
function buildMeta(
    bytes: Uint8Array,
    meta: Meta,
    iinf: Uint8Array,
    iloc: Uint8Array,
    iref: Uint8Array | null
): Uint8Array {
    const parts: Uint8Array[] = [meta.header];
    const hadIref = meta.children.some((child) => child.type === 'iref');

    for (const child of meta.children) {
        if (child.type === 'iloc') {
            parts.push(iloc);
            continue;
        }
        if (child.type === 'iref') {
            if (iref) {
                parts.push(iref);
            }
            continue;
        }

        if (child.type === 'iinf') {
            parts.push(iinf);
            // A new `iref` belongs after `iinf` in the box order the spec gives.
            if (iref && !hadIref) {
                parts.push(iref);
            }
            continue;
        }

        parts.push(bytes.subarray(child.start, child.end));
    }

    return buildBox('meta', concat(parts));
}

/**
 * Confirms every item the file already had still resolves to the same bytes.
 * Cheap next to the cost of handing back a file whose image data has been cut
 * loose from its offsets.
 */
function itemsIntact(source: Uint8Array, before: Location[], output: Uint8Array): boolean {
    const meta = readMeta(output);
    const ilocBox = meta && findChild(meta, 'iloc');
    if (!ilocBox) {
        return false;
    }

    const after = parseLocations(output, ilocBox);
    if (!after) {
        return false;
    }

    for (const original of before) {
        if (original.constructionMethod !== 0) {
            continue;
        }

        const moved = after.find((entry) => entry.itemId === original.itemId);
        if (!moved || moved.extents.length !== original.extents.length) {
            return false;
        }

        for (let i = 0; i < original.extents.length; i++) {
            const from = sliceExtent(source, original.baseOffset + original.extents[i].offset, original.extents[i].length);
            const to = sliceExtent(output, moved.baseOffset + moved.extents[i].offset, moved.extents[i].length);
            if (!from || !to || !equalBytes(from, to)) {
                return false;
            }
        }
    }

    return true;
}

function sliceExtent(bytes: Uint8Array, offset: number, length: number): Uint8Array | null {
    if (offset < 0 || offset + length > bytes.length) {
        return null;
    }
    return bytes.subarray(offset, offset + length);
}

// --- Box plumbing ---

function findBox(bytes: Uint8Array, start: number, end: number, type: string): Box | null {
    for (const box of walkBoxes(bytes, start, end)) {
        if (box.type === type) {
            return box;
        }
    }
    return null;
}

function* walkBoxes(bytes: Uint8Array, start: number, end: number): Generator<Box> {
    const view = viewOf(bytes);
    let offset = start;

    while (offset + 8 <= end) {
        let size = view.getUint32(offset, false);
        const type = readFourCc(bytes, offset + 4);
        let payloadStart = offset + 8;

        if (size === 1) {
            // 64-bit size follows the type.
            if (offset + 16 > end) {
                return;
            }
            size = view.getUint32(offset + 8, false) * 0x100000000
                + view.getUint32(offset + 12, false);
            payloadStart = offset + 16;
        } else if (size === 0) {
            size = end - offset; // box runs to the end of its parent
        }

        const boxEnd = offset + size;
        if (size < 8 || boxEnd > end) {
            return;
        }

        yield { type, start: offset, payloadStart, end: boxEnd };
        offset = boxEnd;
    }
}

/**
 * Walks a range and reports whether the boxes it found cover all of it.
 */
function walkAll(bytes: Uint8Array, start: number, end: number): { boxes: Box[]; complete: boolean } {
    const boxes = [...walkBoxes(bytes, start, end)];
    const walkedTo = boxes.length > 0 ? boxes[boxes.length - 1].end : start;

    return { boxes, complete: walkedTo === end };
}

function buildBox(type: string, payload: Uint8Array): Uint8Array {
    const size = 8 + payload.length;
    if (size > 0xffffffff) {
        throw new Error(`ISOBMFF ${type} box is too large`);
    }

    const out = new Uint8Array(size);
    new DataView(out.buffer).setUint32(0, size, false);
    out.set(ascii(type), 4);
    out.set(payload, 8);

    return out;
}

/** Reads a big-endian unsigned integer of 0, 4 or 8 bytes. */
function readUint(view: DataView, offset: number, size: number): number {
    if (size === 0) {
        return 0;
    }
    if (size === 4) {
        return view.getUint32(offset, false);
    }
    if (size === 8) {
        return view.getUint32(offset, false) * 0x100000000 + view.getUint32(offset + 4, false);
    }

    let value = 0;
    for (let i = 0; i < size; i++) {
        value = value * 256 + view.getUint8(offset + i);
    }
    return value;
}

function uint16(value: number): Uint8Array {
    if (value < 0 || value > 0xffff) {
        throw new Error("ISOBMFF value does not fit a 16-bit field");
    }

    const out = new Uint8Array(2);
    new DataView(out.buffer).setUint16(0, value, false);
    return out;
}

function uint32(value: number): Uint8Array {
    if (value < 0 || value > 0xffffffff) {
        throw new Error("ISOBMFF value does not fit a 32-bit field");
    }

    const out = new Uint8Array(4);
    new DataView(out.buffer).setUint32(0, value, false);
    return out;
}
