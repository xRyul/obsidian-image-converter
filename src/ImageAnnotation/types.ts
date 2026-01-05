import { ImageFormat } from 'fabric';

// Const arrays as single source of truth
export const BLEND_MODES = [
    'source-over',
    'multiply',
    'screen',
    'overlay',
    'darken',
    'lighten',
    'color-dodge',
    'color-burn',
    'hard-light',
    'soft-light',
    'difference',
    'exclusion'
] as const;

export const BACKGROUND_OPTIONS = ['transparent', '#ffffff', '#000000', 'grid', 'dots'] as const;

// Types derived from const arrays
export type BlendMode = typeof BLEND_MODES[number];
export type BackgroundType = typeof BACKGROUND_OPTIONS[number];
export type ExtendedImageFormat = ImageFormat | 'webp' | 'avif';

export interface ToolPreset {
    size: number;
    color: string;
    opacity: number;
    blendMode: BlendMode;
    backgroundColor?: string;
    backgroundOpacity?: number;
}

export enum ToolMode {
    NONE,
    DRAW,
    TEXT,
    ARROW
}

export interface ToolManagerState {
    currentTool: ToolMode;
    isDrawingMode: boolean;
    isTextMode: boolean;
    isArrowMode: boolean;
}

export interface ViewportState {
    currentZoom: number;
    isPanning: boolean;
    isSpacebarDown: boolean;
    lastPanPoint: { x: number; y: number } | null;
}

export const BRUSH_SIZES = [2, 4, 8, 12, 16, 24] as const;
export const BRUSH_OPACITIES = [0.2, 0.4, 0.6, 0.8, 0.9, 1.0] as const;
