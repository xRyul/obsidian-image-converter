export type ResizeDimension =
    | "width"
    | "height"
    | "both"
    | "longest-edge"
    | "shortest-edge"
    | "original-width"
    | "original-height"
    | "editor-max-width"
    | "none";
export type ResizeScaleMode = "auto" | "reduce" | "enlarge";



export type ResizeUnits = "pixels" | "percentage";

export interface NonDestructiveResizePreset {
    name: string;
    resizeDimension: ResizeDimension;
    width?: number; // In pixels or percentage (depending on resizeUnits)
    height?: number; // In pixels or percentage
    customValue?: string; // For "both", e.g., "300x200" or "50x75%"
    longestEdge?: number;
    shortestEdge?: number;
    editorMaxWidthValue?: number;
    resizeScaleMode: ResizeScaleMode;
    respectEditorMaxWidth: boolean;
    maintainAspectRatio: boolean; // New: Toggle aspect ratio preservation
    resizeUnits: ResizeUnits; // New: Pixels or percentage
}

export class NonDestructiveResizeSettings {
    resizePresets: NonDestructiveResizePreset[];
    selectedResizePreset: string;

    constructor() {
        this.resizePresets = [
            {
                name: "Default (No Resize)",
                resizeDimension: "none",
                resizeScaleMode: "auto",
                respectEditorMaxWidth: true,
                maintainAspectRatio: true,
                resizeUnits: "pixels",
            },
            {
                name: "Width 500px",
                resizeDimension: "width",
                width: 500,
                resizeScaleMode: "auto",
                respectEditorMaxWidth: true,
                maintainAspectRatio: true,
                resizeUnits: "pixels",
            },
            {
                name: "Height 800px",
                resizeDimension: "height",
                height: 800,
                resizeScaleMode: "auto",
                respectEditorMaxWidth: true,
                maintainAspectRatio: true,
                resizeUnits: "pixels",
            },
            {
                name: "50% Width",
                resizeDimension: "width",
                width: 50,
                resizeScaleMode: "auto",
                respectEditorMaxWidth: true,
                maintainAspectRatio: true,
                resizeUnits: "percentage",
            },
            {
                name: "Longest Edge 1000px",
                resizeDimension: "longest-edge",
                longestEdge: 1000,
                resizeScaleMode: "auto",
                respectEditorMaxWidth: true,
                maintainAspectRatio: true,
                resizeUnits: "pixels",
            },
            {
                name: "Fit Editor",
                resizeDimension: "editor-max-width",
                resizeScaleMode: "auto",
                respectEditorMaxWidth: true,
                maintainAspectRatio: true,
                resizeUnits: "pixels",
            },
            {
                name: "Original Width",
                resizeDimension: "original-width",
                resizeScaleMode: "auto",
                respectEditorMaxWidth: false,
                maintainAspectRatio: true,
                resizeUnits: "pixels",
            },
            {
                name: "Custom (Distort)",
                resizeDimension: "both",
                customValue: "300x100", // Example of potential distortion
                resizeScaleMode: "auto",
                respectEditorMaxWidth: false,
                maintainAspectRatio: false, // Allow distortion
                resizeUnits: "pixels",
            },
        ];
        this.selectedResizePreset = "Default (No Resize)";
    }
}