// Shared types for Obsidian Canvas file structure

/**
 * Represents a single node in an Obsidian Canvas file.
 *
 * A node typically corresponds to a visual element on the canvas,
 * such as a file card, text card, or other canvas item. Nodes may
 * form a hierarchy via the `children` property.
 */
export interface CanvasNode {
    /** The type of canvas node (e.g., `"file"`, `"text"`). */
    type?: string;
    /** Path to the file when node type is `"file"`. */
    file?: string;
    /** Optional child nodes for hierarchical canvas structures. */
    children?: CanvasNode[];
}

/**
 * Root-level representation of an Obsidian Canvas file.
 *
 * Corresponds to the top-level JSON object in a `.canvas` file.
 */
export interface CanvasData {
    /** Collection of all nodes defined in the canvas. */
    nodes?: CanvasNode[];
}
