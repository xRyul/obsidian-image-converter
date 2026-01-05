/**
 * Color utility functions for the Image Annotation tool.
 */

export function hexToRgba(hex: string, opacity: number): string {
    const sanitizedHex = hex.replace('#', '');
    const red = parseInt(sanitizedHex.substring(0, 2), 16);
    const green = parseInt(sanitizedHex.substring(2, 4), 16);
    const blue = parseInt(sanitizedHex.substring(4, 6), 16);
    return `rgba(${red}, ${green}, ${blue}, ${opacity})`;
}

export function rgbaToHex(rgba: string): string {
    const rgbaMatch = rgba.match(/rgba?\((\d+), (\d+), (\d+)\)/);
    if (!rgbaMatch) return '#ff0000';
    const [, red, green, blue] = rgbaMatch.map(Number);
    return `#${((1 << 24) + (red << 16) + (green << 8) + blue).toString(16).slice(1)}`;
}

export function rgbaToHexWithAlpha(rgba: string): { hex: string; alpha: number } {
    const rgbaMatch = rgba.match(/rgba\((\d+), (\d+), (\d+), ([0-9.]+)\)/);
    if (!rgbaMatch) return { hex: '#ffffff', alpha: 1 };
    const red = Number(rgbaMatch[1]);
    const green = Number(rgbaMatch[2]);
    const blue = Number(rgbaMatch[3]);
    const alpha = parseFloat(rgbaMatch[4]);
    const hex = `#${((1 << 24) + (red << 16) + (green << 8) + blue).toString(16).slice(1)}`;
    return { hex, alpha };
}

export function hexToRgb(hex: string): { red: number; green: number; blue: number } {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
        red: parseInt(result[1], 16),
        green: parseInt(result[2], 16),
        blue: parseInt(result[3], 16)
    } : { red: 0, green: 0, blue: 0 };
}

export function rgbToHex(red: number, green: number, blue: number): string {
    const hex = [red, green, blue]
        .map((x) => x.toString(16).padStart(2, '0'))
        .join('');
    return `#${hex}`;
}

export function rgbToHsl(red: number, green: number, blue: number): { hue: number; saturation: number; lightness: number } {
    const rNorm = red / 255;
    const gNorm = green / 255;
    const bNorm = blue / 255;

    const max = Math.max(rNorm, gNorm, bNorm);
    const min = Math.min(rNorm, gNorm, bNorm);
    let hue = 0;
    let saturation = 0;
    const lightness = (max + min) / 2;

    if (max !== min) {
        const delta = max - min;
        saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);

        switch (max) {
            case rNorm: hue = (gNorm - bNorm) / delta + (gNorm < bNorm ? 6 : 0); break;
            case gNorm: hue = (bNorm - rNorm) / delta + 2; break;
            case bNorm: hue = (rNorm - gNorm) / delta + 4; break;
        }

        hue *= 60;
    }

    const saturationPercent = saturation * 100;
    const lightnessPercent = lightness * 100;

    return { hue, saturation: saturationPercent, lightness: lightnessPercent };
}

export function hslToString(hue: number, saturation: number, lightness: number): string {
    let hueNormalized = hue % 360;
    if (hueNormalized < 0) hueNormalized += 360;
    return `hsl(${Math.round(hueNormalized)}, ${Math.round(saturation)}%, ${Math.round(lightness)}%)`;
}

export function hslToRgb(hslStr: string): { red: number; green: number; blue: number } {
    const matches = hslStr.match(/hsl\((\d+),\s*(\d+)%,\s*(\d+)%\)/);
    if (!matches) return { red: 0, green: 0, blue: 0 };

    const hue = parseInt(matches[1]) / 360;
    const saturation = parseInt(matches[2]) / 100;
    const lightness = parseInt(matches[3]) / 100;

    let redLinear: number;
    let greenLinear: number;
    let blueLinear: number;

    if (saturation === 0) {
        redLinear = greenLinear = blueLinear = lightness;
    } else {
        const hue2rgb = (pComp: number, qComp: number, tComp: number) => {
            let tVal = tComp;
            if (tVal < 0) tVal += 1;
            if (tVal > 1) tVal -= 1;
            if (tVal < 1/6) return pComp + (qComp - pComp) * 6 * tVal;
            if (tVal < 1/2) return qComp;
            if (tVal < 2/3) return pComp + (qComp - pComp) * (2/3 - tVal) * 6;
            return pComp;
        };

        const qComp = lightness < 0.5 ? lightness * (1 + saturation) : lightness + saturation - lightness * saturation;
        const pComp = 2 * lightness - qComp;

        redLinear = hue2rgb(pComp, qComp, hue + 1/3);
        greenLinear = hue2rgb(pComp, qComp, hue);
        blueLinear = hue2rgb(pComp, qComp, hue - 1/3);
    }

    return {
        red: Math.round(redLinear * 255),
        green: Math.round(greenLinear * 255),
        blue: Math.round(blueLinear * 255)
    };
}

export function updateRgbaOpacity(rgba: string, newOpacity: number): string {
    const matches = rgba.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*[\d.]+)?\)/);
    if (matches) {
        const [, redStr, greenStr, blueStr] = matches;
        return `rgba(${redStr}, ${greenStr}, ${blueStr}, ${newOpacity})`;
    }
    return rgba;
}

export function getLuminosity(color: string): number {
    const rgb = hexToRgb(color);
    return 0.299 * rgb.red + 0.587 * rgb.green + 0.114 * rgb.blue;
}

export function getComplementaryColors(hex: string): string[] {
    const rgb = hexToRgb(hex);
    const hsl = rgbToHsl(rgb.red, rgb.green, rgb.blue);
    return [hslToString((hsl.hue + 180) % 360, hsl.saturation, hsl.lightness)];
}

export async function analyzeImageColors(img: HTMLImageElement): Promise<{ dominantColors: string[]; complementaryColors: string[][] }> {
    const tempCanvas = document.createElement('canvas');
    const ctx = tempCanvas.getContext('2d');
    if (!ctx) return { dominantColors: [], complementaryColors: [] };

    tempCanvas.width = img.width;
    tempCanvas.height = img.height;
    ctx.drawImage(img, 0, 0);

    const imageData = ctx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);
    const pixels = imageData.data;

    const colorMap = new Map<string, number>();

    for (let i = 0; i < pixels.length; i += 16) {
        const red = pixels[i];
        const green = pixels[i + 1];
        const blue = pixels[i + 2];
        const alpha = pixels[i + 3];

        if (alpha < 128) continue;

        const quantizedRed = Math.round(red / 32) * 32;
        const quantizedGreen = Math.round(green / 32) * 32;
        const quantizedBlue = Math.round(blue / 32) * 32;

        const hex = rgbToHex(quantizedRed, quantizedGreen, quantizedBlue);
        colorMap.set(hex, (colorMap.get(hex) || 0) + 1);
    }

    const sortedColors = Array.from(colorMap.entries())
        .map(([color, count]) => ({ color, count }))
        .sort((entryA, entryB) => entryB.count - entryA.count)
        .slice(0, 6)
        .map(item => item.color);

    const dominantColors = sortedColors;
    const complementaryColors = sortedColors.map(color => getComplementaryColors(color));

    return { dominantColors, complementaryColors };
}
