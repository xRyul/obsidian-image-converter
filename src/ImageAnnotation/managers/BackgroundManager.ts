import { Canvas, Pattern, IText } from 'fabric';
import { Component } from 'obsidian';
import { BackgroundType, BACKGROUND_OPTIONS } from '../types';

export class BackgroundManager {
    private backgroundDropdown: HTMLElement | null = null;
    private currentBackground: BackgroundType = 'transparent';

    constructor(
        private getCanvas: () => Canvas | null,
        private componentContainer: Component
    ) {}

    createBackgroundControls(container: HTMLElement, _buttonComponent: any): void {
        this.backgroundDropdown = container.createDiv('background-dropdown');
        this.backgroundDropdown.style.display = 'none';

        BACKGROUND_OPTIONS.forEach(option => {
            const item = this.backgroundDropdown!.createDiv('background-option');

            switch (option) {
                case 'transparent': {
                    item.createDiv('option-icon').innerHTML = `<svg viewBox="0 0 100 100" width="20" height="20">
                        <rect x="0" y="0" width="50" height="50" fill="#ccc"/>
                        <rect x="50" y="50" width="50" height="50" fill="#ccc"/>
                    </svg>`;
                    break;
                }
                case 'grid': {
                    item.createDiv('option-icon').innerHTML = `<svg viewBox="0 0 100 100" width="20" height="20">
                        <path d="M0 0 L100 0 M0 50 L100 50 M50 0 L50 100" stroke="#000" stroke-width="10"/>
                    </svg>`;
                    break;
                }
                case 'dots': {
                    item.createDiv('option-icon').innerHTML = `<svg viewBox="0 0 100 100" width="20" height="20">
                        <circle cx="50" cy="50" r="10"/>
                    </svg>`;
                    break;
                }
                default: {
                    const preview = item.createDiv('color-preview');
                    preview.style.backgroundColor = option;
                }
            }

            this.componentContainer.registerDomEvent(item, 'click', (e: MouseEvent) => {
                e.stopPropagation();
                const canvas = this.getCanvas();
                const activeObject = canvas?.getActiveObject();
                if (activeObject instanceof IText && activeObject.isEditing) return;

                this.setBackground(option);
                this.hideBackgroundDropdown();
            });

            if (option === this.currentBackground) {
                item.addClass('is-active');
            }
        });

        this.componentContainer.registerDomEvent(document, 'click', () => {
            this.hideBackgroundDropdown();
        });
    }

    createBackgroundPattern(type: BackgroundType): string | Pattern {
        if (type === 'grid' || type === 'dots') {
            const patternCanvas = document.createElement('canvas');
            const ctx = patternCanvas.getContext('2d');
            if (!ctx) return 'transparent';

            patternCanvas.width = 20;
            patternCanvas.height = 20;

            switch (type) {
                case 'grid': {
                    ctx.strokeStyle = '#ddd';
                    ctx.lineWidth = 1;
                    ctx.beginPath();
                    ctx.moveTo(0, 0);
                    ctx.lineTo(20, 0);
                    ctx.moveTo(0, 0);
                    ctx.lineTo(0, 20);
                    ctx.stroke();
                    return new Pattern({
                        source: patternCanvas,
                        repeat: 'repeat'
                    });
                }
                case 'dots': {
                    ctx.fillStyle = '#ddd';
                    ctx.beginPath();
                    ctx.arc(10, 10, 1, 0, Math.PI * 2);
                    ctx.fill();
                    return new Pattern({
                        source: patternCanvas,
                        repeat: 'repeat'
                    });
                }
            }
        }
        return type;
    }

    toggleBackgroundDropdown(buttonEl: HTMLElement): void {
        if (!this.backgroundDropdown) return;

        if (this.backgroundDropdown.style.display === 'none') {
            const rect = buttonEl.getBoundingClientRect();
            this.backgroundDropdown.style.top = `${rect.bottom + 5}px`;
            this.backgroundDropdown.style.left = `${rect.left}px`;
            this.backgroundDropdown.style.display = 'block';
        } else {
            this.hideBackgroundDropdown();
        }
    }

    hideBackgroundDropdown(): void {
        if (this.backgroundDropdown) {
            this.backgroundDropdown.style.display = 'none';
        }
    }

    setBackground(type: BackgroundType): void {
        const canvas = this.getCanvas();
        if (!canvas) return;

        const pattern = this.createBackgroundPattern(type);
        canvas.backgroundColor = pattern;
        canvas.requestRenderAll();

        this.currentBackground = type;
    }

    getCurrentBackground(): BackgroundType {
        return this.currentBackground;
    }

    getDropdownElement(): HTMLElement | null {
        return this.backgroundDropdown;
    }
}
