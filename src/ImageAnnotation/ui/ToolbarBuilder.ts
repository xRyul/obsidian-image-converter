import { ButtonComponent, DropdownComponent, Component } from 'obsidian';
import { BlendMode, BLEND_MODES, BRUSH_SIZES, BRUSH_OPACITIES, ToolPreset } from '../types';
import { hexToRgba, hslToRgb, rgbToHex, getLuminosity } from '../utils/colorUtils';
import { Canvas } from 'fabric';

export interface ToolbarCallbacks {
    onDrawingToggle: () => void;
    onTextToggle: () => void;
    onArrowToggle: () => void;
    onResetZoom: () => void;
    onClearAll: () => void;
    onSave: () => void;
    onBringToFront: () => void;
    onBringForward: () => void;
    onSendBackward: () => void;
    onSendToBack: () => void;
    onBackgroundToggle: (buttonEl: HTMLElement) => void;
    onColorChange: (color: string) => void;
    onSizeChange: (index: number) => void;
    onOpacityChange: (index: number, opacity: number) => void;
    onBlendModeChange: (mode: BlendMode) => void;
    onPresetSave: (index: number) => void;
    onPresetLoad: (index: number) => void;
    onTextBackgroundChange: (color: string) => void;
    getCanvas: () => Canvas | null;
    getCurrentOpacity: () => number;
    getBrushSizeIndex: () => number;
    getOpacityIndex: () => number;
    getBlendMode: () => BlendMode;
    isDrawingMode: () => boolean;
    isTextMode: () => boolean;
    isArrowMode: () => boolean;
}

export interface ToolbarElements {
    drawButton: ButtonComponent;
    textButton: ButtonComponent;
    arrowButton: ButtonComponent;
    textBackgroundControls: HTMLElement;
}

export class ToolbarBuilder {
    private dominantColors: string[] = [];
    private complementaryColors: string[][] = [];

    constructor(
        private componentContainer: Component,
        private modalEl: HTMLElement,
        private callbacks: ToolbarCallbacks
    ) {}

    setColors(dominantColors: string[], complementaryColors: string[][]): void {
        this.dominantColors = dominantColors;
        this.complementaryColors = complementaryColors;
    }

    build(container: HTMLElement): ToolbarElements {
        const toolbar = container.createDiv('image-converter-annotation-tool-annotation-toolbar');

        const drawingGroup = toolbar.createDiv('annotation-toolbar-group drawing-group');
        const brushControls = toolbar.createDiv('annotation-toolbar-group brush-controls');
        const utilityGroup = toolbar.createDiv('annotation-toolbar-group');

        const leftSection = drawingGroup.createDiv('image-converter-annotation-tool-left-section');
        const drawingToolsColumn = leftSection.createDiv('image-converter-annotation-tool-drawing-tools-column');

        // Drawing tools
        const drawButton = new ButtonComponent(drawingToolsColumn)
            .setTooltip('Draw (B)')
            .setIcon('pencil')
            .onClick(() => this.callbacks.onDrawingToggle());

        const arrowButton = new ButtonComponent(drawingToolsColumn)
            .setTooltip('Arrow (A)')
            .setIcon('arrow-right')
            .onClick(() => this.callbacks.onArrowToggle());

        const textButton = new ButtonComponent(drawingToolsColumn)
            .setTooltip('Add Text (T)')
            .setIcon('type')
            .onClick(() => this.callbacks.onTextToggle());

        new ButtonComponent(drawingToolsColumn)
            .setTooltip('Reset Zoom (1:1)')
            .setIcon('search')
            .onClick(() => this.callbacks.onResetZoom());

        // Color picker
        const colorPickerWrapper = leftSection.createDiv('image-converter-annotation-tool-color-picker-wrapper');
        const colorPicker = colorPickerWrapper.createEl('input', {
            type: 'color',
            value: '#ff0000'
        });
        colorPicker.addClass('color-picker');

        this.componentContainer.registerDomEvent(colorPicker, 'input', (e) => {
            const color = (e.target as HTMLInputElement).value;
            this.callbacks.onColorChange(color);
        });

        // Brush controls
        const brushControlsColumn = brushControls.createDiv('brush-controls-column');
        this.createSizeButtons(brushControlsColumn);
        this.createOpacityButtons(brushControlsColumn);
        this.createBlendModeButtons(brushControlsColumn);

        // Layer controls
        const layerControls = brushControlsColumn.createDiv('layer-controls');
        layerControls.createDiv('control-label').setText('Layer:');
        const layerButtonContainer = layerControls.createDiv('image-converter-annotation-tool-button-group');

        new ButtonComponent(layerButtonContainer)
            .setTooltip('Bring to Front')
            .setIcon('arrow-up-to-line')
            .onClick(() => this.callbacks.onBringToFront());

        new ButtonComponent(layerButtonContainer)
            .setTooltip('Bring Forward')
            .setIcon('arrow-up')
            .onClick(() => this.callbacks.onBringForward());

        new ButtonComponent(layerButtonContainer)
            .setTooltip('Send Backward')
            .setIcon('arrow-down')
            .onClick(() => this.callbacks.onSendBackward());

        new ButtonComponent(layerButtonContainer)
            .setTooltip('Send to Back')
            .setIcon('arrow-down-to-line')
            .onClick(() => this.callbacks.onSendToBack());

        // Text background controls
        const textBackgroundControls = brushControlsColumn.createDiv('text-background-controls');
        textBackgroundControls.style.display = 'none';
        this.createTextBackgroundControls(textBackgroundControls);

        // Utility buttons
        new ButtonComponent(utilityGroup)
            .setTooltip('Clear All')
            .setIcon('trash')
            .onClick(() => this.callbacks.onClearAll());

        this.createBackgroundButton(utilityGroup);

        const saveBtn = new ButtonComponent(utilityGroup)
            .setTooltip('Save (Ctrl/Cmd + S)')
            .setIcon('checkmark')
            .onClick(() => this.callbacks.onSave());
        saveBtn.buttonEl.addClass('mod-cta');

        return {
            drawButton,
            textButton,
            arrowButton,
            textBackgroundControls
        };
    }

    createColorSwatches(): void {
        const colorPickerWrapper = this.modalEl.querySelector('.image-converter-annotation-tool-color-picker-wrapper');
        if (!colorPickerWrapper) return;

        const updateObjectColor = (color: string) => {
            const colorPicker = this.modalEl.querySelector('.color-picker') as HTMLInputElement;
            if (colorPicker) {
                colorPicker.value = color;
                this.callbacks.onColorChange(color);
            }
        };

        const existingSwatches = colorPickerWrapper.querySelector('.image-converter-annotation-tool-color-swatches');
        if (existingSwatches) {
            existingSwatches.remove();
        }

        const swatchesContainer = (colorPickerWrapper as HTMLElement).createDiv('image-converter-annotation-tool-color-swatches');

        const grayScaleColors = ['#000000', '#ffffff', '#d1d3d4', '#a7a9acCC', '#808285', '#58595b'];
        const paletteColors = ['#ff80ff', '#ffc680', '#ffff80', '#80ff9e', '#80d6ff', '#bcb3ff'];

        // Grayscale row
        const grayScaleRow = swatchesContainer.createDiv('image-converter-annotation-tool-color-row');
        grayScaleRow.createSpan('image-converter-annotation-tool-row-label').setText('Grayscale:');
        const grayScaleSwatches = grayScaleRow.createDiv('image-converter-annotation-tool-swatches-container');
        grayScaleColors.forEach(color => {
            const swatch = grayScaleSwatches.createDiv('color-swatch preset');
            swatch.style.backgroundColor = color;
            swatch.setAttribute('title', color);
            this.componentContainer.registerDomEvent(swatch, 'click', () => updateObjectColor(color));
        });

        // Palette row
        const paletteRow = swatchesContainer.createDiv('image-converter-annotation-tool-color-row');
        paletteRow.createSpan('image-converter-annotation-tool-row-label').setText('Palette:');
        const paletteSwatches = paletteRow.createDiv('image-converter-annotation-tool-swatches-container');
        paletteColors.forEach(color => {
            const swatch = paletteSwatches.createDiv('color-swatch preset');
            swatch.style.backgroundColor = color;
            swatch.setAttribute('title', color);
            this.componentContainer.registerDomEvent(swatch, 'click', () => updateObjectColor(color));
        });

        // Dominant colors
        const colorPairs = this.dominantColors.map((dominantColor, index) => ({
            dominant: dominantColor,
            complementary: this.complementaryColors[index]?.[0] ?? dominantColor,
            luminosity: getLuminosity(dominantColor)
        })).sort((left, right) => left.luminosity - right.luminosity);

        const dominantRow = swatchesContainer.createDiv('image-converter-annotation-tool-color-row');
        dominantRow.createSpan('image-converter-annotation-tool-row-label').setText('Dominant:');
        const dominantSwatches = dominantRow.createDiv('image-converter-annotation-tool-swatches-container');
        colorPairs.forEach(pair => {
            const dominantSwatch = dominantSwatches.createDiv('color-swatch dominant');
            dominantSwatch.style.backgroundColor = pair.dominant;
            dominantSwatch.setAttribute('title', pair.dominant);
            this.componentContainer.registerDomEvent(dominantSwatch, 'click', () => updateObjectColor(pair.dominant));
        });

        // Complementary colors
        const complementaryRow = swatchesContainer.createDiv('image-converter-annotation-tool-color-row');
        complementaryRow.createSpan('image-converter-annotation-tool-row-label').setText('180:');
        const complementarySwatches = complementaryRow.createDiv('image-converter-annotation-tool-swatches-container');
        colorPairs.forEach(pair => {
            const complementarySwatch = complementarySwatches.createDiv('color-swatch complementary');
            complementarySwatch.style.backgroundColor = pair.complementary;
            complementarySwatch.setAttribute('title', pair.complementary);
            this.componentContainer.registerDomEvent(complementarySwatch, 'click', () => {
                const rgb = hslToRgb(pair.complementary);
                const hex = rgbToHex(rgb.red, rgb.green, rgb.blue);
                updateObjectColor(hex);
            });
        });

        this.createPresetButtons(swatchesContainer);
    }

    private createSizeButtons(container: HTMLElement): void {
        const brushControlsColumn = container.createDiv('brush-controls-column');

        const sizeButtonsContainer = brushControlsColumn.createDiv('size-buttons-container');
        const sizeLabel = sizeButtonsContainer.createDiv('control-label');
        sizeLabel.setText('Size:');

        const sizeButtonContainer = sizeButtonsContainer.createDiv('image-converter-annotation-tool-button-group');

        BRUSH_SIZES.forEach((size, index) => {
            const button = new ButtonComponent(sizeButtonContainer)
                .setButtonText(size.toString())
                .onClick(() => {
                    this.callbacks.onSizeChange(index);
                    sizeButtonContainer.querySelectorAll('button').forEach(btn =>
                        btn.removeClass('is-active'));
                    button.buttonEl.addClass('is-active');
                });

            if (index === this.callbacks.getBrushSizeIndex()) {
                button.buttonEl.addClass('is-active');
            }
        });
    }

    private createOpacityButtons(container: HTMLElement): void {
        let brushControlsColumn = container.querySelector('.brush-controls-column');
        if (!brushControlsColumn) {
            brushControlsColumn = container.createDiv('brush-controls-column');
        }

        const opacityButtonsContainer = (brushControlsColumn as HTMLElement).createDiv('opacity-buttons-container');
        const opacityLabel = opacityButtonsContainer.createDiv('control-label');
        opacityLabel.setText('Opacity:');

        const opacityButtonContainer = opacityButtonsContainer.createDiv('image-converter-annotation-tool-button-group');

        BRUSH_OPACITIES.forEach((opacity, index) => {
            const button = new ButtonComponent(opacityButtonContainer)
                .setButtonText(String(opacity * 100))
                .onClick(() => {
                    this.callbacks.onOpacityChange(index, opacity);
                    opacityButtonContainer.querySelectorAll('button').forEach(btn =>
                        btn.removeClass('is-active'));
                    button.buttonEl.addClass('is-active');
                });

            if (index === this.callbacks.getOpacityIndex()) {
                button.buttonEl.addClass('is-active');
            }
        });
    }

    private createBlendModeButtons(container: HTMLElement): void {
        const blendModesContainer = container.createDiv('blend-modes-container');
        const blendModeLabel = blendModesContainer.createDiv('control-label');
        blendModeLabel.setText('Blend:');

        const dropdownContainer = blendModesContainer.createDiv('dropdown-container');

        const getFriendlyName = (mode: BlendMode): string => {
            switch (mode) {
                case 'source-over': return 'Normal';
                case 'multiply': return 'Multiply';
                case 'screen': return 'Screen';
                case 'overlay': return 'Overlay';
                case 'darken': return 'Darken';
                case 'lighten': return 'Lighten';
                case 'color-dodge': return 'Dodge';
                case 'color-burn': return 'Burn';
                case 'hard-light': return 'Hard Light';
                case 'soft-light': return 'Soft Light';
                case 'difference': return 'Difference';
                case 'exclusion': return 'Exclusion';
                default: return mode;
            }
        };

        const dropdown = new DropdownComponent(dropdownContainer);

        BLEND_MODES.forEach((mode) => {
            dropdown.addOption(mode, getFriendlyName(mode));
        });

        dropdown.setValue(this.callbacks.getBlendMode());

        dropdown.onChange((value) => {
            this.callbacks.onBlendModeChange(value as BlendMode);
        });
    }

    private createBackgroundButton(container: HTMLElement): void {
        const bgButton = new ButtonComponent(container)
            .setTooltip('Background')
            .setIcon('layout-template')
            .onClick((e: MouseEvent) => {
                e.stopPropagation();
                this.callbacks.onBackgroundToggle(bgButton.buttonEl);
            });
    }

    private createTextBackgroundControls(container: HTMLElement): void {
        const textBgContainer = container.createDiv('image-converter-annotation-tool-control-group');
        textBgContainer.createDiv('control-label').setText('Text Background:');
        const controlsContainer = textBgContainer.createDiv('image-converter-annotation-tool-button-group');

        const bgColorWrapper = controlsContainer.createDiv('image-converter-annotation-tool-background-color-wrapper');
        const bgColorPicker = bgColorWrapper.createEl('input', {
            type: 'color',
            cls: 'background-color-picker',
            value: '#ffffff'
        });

        const alphaSlider = bgColorWrapper.createEl('input', {
            type: 'range',
            cls: 'background-alpha-slider',
            attr: {
                min: '0',
                max: '100',
                value: '70'
            }
        });

        new ButtonComponent(controlsContainer)
            .setTooltip('Transparent')
            .setIcon('eraser')
            .onClick(() => {
                this.callbacks.onTextBackgroundChange('transparent');
            });

        new ButtonComponent(controlsContainer)
            .setTooltip('Semi-transparent white')
            .setIcon('square')
            .onClick(() => {
                this.callbacks.onTextBackgroundChange('rgba(255, 255, 255, 0.7)');
            })
            .buttonEl.addClass('bg-white-semi');

        new ButtonComponent(controlsContainer)
            .setTooltip('Semi-transparent black')
            .setIcon('square')
            .onClick(() => {
                this.callbacks.onTextBackgroundChange('rgba(0, 0, 0, 0.7)');
            })
            .buttonEl.addClass('bg-black-semi');

        const updateBackground = () => {
            const color = bgColorPicker.value;
            const alpha = parseInt(alphaSlider.value) / 100;
            const rgba = hexToRgba(color, alpha);
            this.callbacks.onTextBackgroundChange(rgba);
        };

        this.componentContainer.registerDomEvent(bgColorPicker, 'input', updateBackground);
        this.componentContainer.registerDomEvent(alphaSlider, 'input', updateBackground);
    }

    private createPresetButtons(container: Element): void {
        const containerEl = container as HTMLElement;
        const presetContainer = containerEl.createDiv('image-converter-annotation-tool-preset-buttons');
        presetContainer.style.display = 'none';

        for (let i = 0; i < 3; i++) {
            const presetButton = presetContainer.createDiv(`preset-button preset-${i + 1}`);
            presetButton.createDiv('image-converter-annotation-tool-preset-color');
            presetButton.createSpan('preset-number').setText(`${i + 1}`);

            this.componentContainer.registerDomEvent(presetButton, 'click', (e) => {
                if (e.shiftKey) {
                    this.callbacks.onPresetSave(i);
                } else {
                    this.callbacks.onPresetLoad(i);
                }
            });

            presetButton.setAttribute('title', 'Click to load, Shift+Click to save');
        }
    }

    updatePresetButtons(presets: ToolPreset[], isTextMode: boolean): void {
        const presetButtons = this.modalEl.querySelectorAll('.preset-button');

        presetButtons.forEach((button, index) => {
            const colorDiv = button.querySelector('.image-converter-annotation-tool-preset-color') as HTMLDivElement;
            if (colorDiv && presets[index]) {
                if (isTextMode && presets[index].backgroundColor) {
                    colorDiv.style.backgroundColor = presets[index].backgroundColor ?? 'transparent';
                    colorDiv.style.opacity = (presets[index].backgroundOpacity ?? 1).toString();
                    colorDiv.style.border = `2px solid ${presets[index].color}`;
                } else {
                    colorDiv.style.backgroundColor = presets[index].color;
                    colorDiv.style.opacity = presets[index].opacity.toString();
                    colorDiv.style.border = 'none';
                }
            }
        });
    }
}
