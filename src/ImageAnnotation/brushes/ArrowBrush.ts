import {
    Canvas,
    PencilBrush,
    Point,
    Path,
    TEvent,
    TBrushEventData,
} from 'fabric';

export class ArrowBrush extends PencilBrush {
    private points: Point[] = [];
    private readonly minDistance = 3;
    private currentPath: Path | null = null;
    private currentArrowHead: Path | null = null;

    constructor(canvas: Canvas) {
        super(canvas);
        if (!this.width) {
            this.width = 8;
        }
    }

    onMouseDown(pointer: Point, ev: TBrushEventData): void {
        this.points = [pointer];
        this.currentPath = null;
        this.currentArrowHead = null;
    }

    onMouseMove(pointer: Point, ev: TBrushEventData): void {
        if (!this.points.length) return;

        const lastPoint = this.points[this.points.length - 1];
        const distance = Math.sqrt(
            Math.pow(pointer.x - lastPoint.x, 2) +
            Math.pow(pointer.y - lastPoint.y, 2)
        );

        if (distance >= this.minDistance) {
            this.points.push(pointer);

            if (this.currentPath) {
                this.canvas.remove(this.currentPath);
            }
            if (this.currentArrowHead) {
                this.canvas.remove(this.currentArrowHead);
            }

            this.currentPath = this.createSmoothedPath();
            this.currentArrowHead = this.createArrowHead();

            if (this.currentPath) {
                this.canvas.add(this.currentPath);
            }
            if (this.currentArrowHead) {
                this.canvas.add(this.currentArrowHead);
            }

            this.canvas.requestRenderAll();
        }
    }

    onMouseUp({ e }: TEvent<MouseEvent | PointerEvent | TouchEvent>): boolean {
        if (this.points.length >= 2) {
            if (this.currentPath) {
                this.canvas.remove(this.currentPath);
            }
            if (this.currentArrowHead) {
                this.canvas.remove(this.currentArrowHead);
            }

            const finalPath = this.createSmoothedPath();
            const finalArrowHead = this.createArrowHead();

            if (finalPath) {
                this.canvas.add(finalPath);
            }
            if (finalArrowHead) {
                this.canvas.add(finalArrowHead);
            }

            this.canvas.requestRenderAll();
        }

        this.points = [];
        this.currentPath = null;
        this.currentArrowHead = null;

        return false;
    }

    private createSmoothedPath(): Path | null {
        if (this.points.length < 2) return null;

        try {
            const simplifiedPoints = this.simplifyPoints(this.points, 50);
            const controlPoints = this.getControlPoints(simplifiedPoints);

            let pathData = `M ${simplifiedPoints[0].x} ${simplifiedPoints[0].y}`;

            for (let i = 0; i < controlPoints.length - 1; i++) {
                const cp = controlPoints[i];
                const nextCp = controlPoints[i + 1];
                pathData += ` C ${cp.cp2x} ${cp.cp2y} ${nextCp.cp1x} ${nextCp.cp1y} ${nextCp.x} ${nextCp.y}`;
            }

            return new Path(pathData, {
                stroke: this.color,
                strokeWidth: this.width,
                fill: '',
                strokeLineCap: 'round',
                strokeLineJoin: 'round',
                selectable: false,
                evented: false
            });
        } catch (error) {
            console.error('Error creating smoothed path:', error);
            return null;
        }
    }

    private simplifyPoints(points: Point[], tolerance: number): Point[] {
        if (points.length <= 2) return points;

        const simplified: Point[] = [points[0]];
        let [prevPoint] = points;

        for (let i = 1; i < points.length - 1; i++) {
            const point = points[i];
            const nextPoint = points[i + 1];

            const d1 = Math.hypot(point.x - prevPoint.x, point.y - prevPoint.y);
            const d2 = Math.hypot(nextPoint.x - point.x, nextPoint.y - point.y);

            if (d1 + d2 > tolerance) {
                simplified.push(point);
                prevPoint = point;
            }
        }

        simplified.push(points[points.length - 1]);
        return simplified;
    }

    private getControlPoints(points: Point[]): Array<{
        x: number;
        y: number;
        cp1x: number;
        cp1y: number;
        cp2x: number;
        cp2y: number;
    }> {
        const smoothing = 0.2;
        const result = [];

        for (let i = 0; i < points.length; i++) {
            const curr = points[i];
            const prev = points[i - 1] || curr;
            const next = points[i + 1] || curr;

            const dx = next.x - prev.x;
            const dy = next.y - prev.y;

            const cp1x = curr.x - dx * smoothing;
            const cp1y = curr.y - dy * smoothing;
            const cp2x = curr.x + dx * smoothing;
            const cp2y = curr.y + dy * smoothing;

            result.push({
                x: curr.x,
                y: curr.y,
                cp1x,
                cp1y,
                cp2x,
                cp2y
            });
        }

        return result;
    }

    private getAverageDirection(points: Point[], sampleSize = 5): { angle: number; endPoint: Point } {
        const lastPoints = points.slice(-sampleSize);
        if (lastPoints.length < 2) return { angle: 0, endPoint: points[points.length - 1] };

        const p1 = lastPoints[lastPoints.length - 2];
        const p2 = lastPoints[lastPoints.length - 1];

        const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x);

        return {
            angle,
            endPoint: p2
        };
    }

    private createArrowHead(): Path | null {
        try {
            if (this.points.length < 2) return null;

            const { angle, endPoint } = this.getAverageDirection(this.points);

            const arrowLength = Math.max(this.width * 2, 10);
            const arrowWidth = Math.max(this.width, 5);
            const arrowAngle = Math.PI / 6;

            const x1 = endPoint.x - arrowLength * Math.cos(angle - arrowAngle);
            const y1 = endPoint.y - arrowLength * Math.sin(angle - arrowAngle);
            const x2 = endPoint.x - arrowLength * Math.cos(angle + arrowAngle);
            const y2 = endPoint.y - arrowLength * Math.sin(angle + arrowAngle);

            const arrowPath = `M ${endPoint.x} ${endPoint.y} L ${x1} ${y1} M ${endPoint.x} ${endPoint.y} L ${x2} ${y2}`;

            return new Path(arrowPath, {
                stroke: this.color,
                strokeWidth: arrowWidth,
                fill: '',
                strokeLineCap: 'round',
                strokeLineJoin: 'round',
                selectable: false,
                evented: false
            });
        } catch (error) {
            console.error('Error creating arrow head:', error);
            return null;
        }
    }
}
