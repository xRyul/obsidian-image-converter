import { Canvas, Pattern, IText } from 'fabric';
import { Component } from 'obsidian';
import { BackgroundType, BACKGROUND_OPTIONS } from '../types';

const HIDDEN_CLASS = 'background-dropdown-hidden';
const SVG_NS = 'http://www.w3.org/2000/svg';
const SVG_VIEWBOX = '0 0 100 100';
const SVG_SIZE = '20';

export class BackgroundManager {
    private backgroundDropdown: HTMLElement | null = null;
    private currentBackground: BackgroundType = 'transparent';

    constructor(
        private getCanvas: () => Canvas | null,
        private componentContainer: Component
    ) {}

    /**
     * Creates the background selection dropdown UI.
     * @param container - The container element to append the dropdown to
     * @param _buttonComponent - Kept for backward compatibility with existing callers; intentionally unused
     */
    createBackgroundControls(container: HTMLElement, _buttonComponent?: unknown): void {
        this.backgroundDropdown = container.createDiv('background-dropdown');
        this.backgroundDropdown.addClass(HIDDEN_CLASS);

        BACKGROUND_OPTIONS.forEach(option => {
            const item = this.backgroundDropdown!.createDiv('background-option');

            switch (option) {
                case 'transparent': {
                    this.createTransparentIcon(item.createDiv('option-icon'));
                    break;
                }
                case 'grid': {
                    this.createGridIcon(item.createDiv('option-icon'));
                    break;
                }
                case 'dots': {
                    this.createDotsIcon(item.createDiv('option-icon'));
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

    private createSvgElement(): SVGSVGElement {
        const svg = document.createElementNS(SVG_NS, 'svg');
        svg.setAttribute('viewBox', SVG_VIEWBOX);
        svg.setAttribute('width', SVG_SIZE);
        svg.setAttribute('height', SVG_SIZE);
        return svg;
    }

    private createTransparentIcon(container: HTMLElement): void {
        const svg = this.createSvgElement();

        const rect1 = document.createElementNS(SVG_NS, 'rect');
        rect1.setAttribute('x', '0');
        rect1.setAttribute('y', '0');
        rect1.setAttribute('width', '50');
        rect1.setAttribute('height', '50');
        rect1.setAttribute('fill', '#ccc');
        svg.appendChild(rect1);

        const rect2 = document.createElementNS(SVG_NS, 'rect');
        rect2.setAttribute('x', '50');
        rect2.setAttribute('y', '50');
        rect2.setAttribute('width', '50');
        rect2.setAttribute('height', '50');
        rect2.setAttribute('fill', '#ccc');
        svg.appendChild(rect2);

        container.appendChild(svg);
    }

    private createGridIcon(container: HTMLElement): void {
        const svg = this.createSvgElement();

        const path = document.createElementNS(SVG_NS, 'path');
        path.setAttribute('d', 'M0 0 L100 0 M0 50 L100 50 M50 0 L50 100');
        path.setAttribute('stroke', '#000');
        path.setAttribute('stroke-width', '10');
        svg.appendChild(path);

        container.appendChild(svg);
    }

    private createDotsIcon(container: HTMLElement): void {
        const svg = this.createSvgElement();

        const circle = document.createElementNS(SVG_NS, 'circle');
        circle.setAttribute('cx', '50');
        circle.setAttribute('cy', '50');
        circle.setAttribute('r', '10');
        svg.appendChild(circle);

        container.appendChild(svg);
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

        const isHidden = this.backgroundDropdown.hasClass(HIDDEN_CLASS);
        if (isHidden) {
            const rect = buttonEl.getBoundingClientRect();
            this.backgroundDropdown.style.top = `${rect.bottom + 5}px`;
            this.backgroundDropdown.style.left = `${rect.left}px`;
            this.backgroundDropdown.removeClass(HIDDEN_CLASS);
        } else {
            this.hideBackgroundDropdown();
        }
    }

    hideBackgroundDropdown(): void {
        if (this.backgroundDropdown) {
            this.backgroundDropdown.addClass(HIDDEN_CLASS);
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
