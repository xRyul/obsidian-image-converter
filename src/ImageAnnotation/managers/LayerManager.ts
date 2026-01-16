import { Canvas, ActiveSelection } from 'fabric';

export class LayerManager {
    constructor(
        private getCanvas: () => Canvas | null,
        private onStateChange: () => void
    ) {}

    bringToFront(): void {
        const canvas = this.getCanvas();
        if (!canvas) return;

        const activeObject = canvas.getActiveObject();
        if (!activeObject) return;

        if (activeObject instanceof ActiveSelection) {
            activeObject.getObjects().forEach(obj => {
                canvas.bringObjectToFront(obj);
            });
            canvas.bringObjectToFront(activeObject);
        } else {
            canvas.bringObjectToFront(activeObject);
        }

        canvas.requestRenderAll();
        this.onStateChange();
    }

    bringForward(): void {
        const canvas = this.getCanvas();
        if (!canvas) return;

        const activeObject = canvas.getActiveObject();
        if (!activeObject) return;

        if (activeObject instanceof ActiveSelection) {
            activeObject.getObjects().forEach(obj => {
                canvas.bringObjectForward(obj);
            });
            canvas.bringObjectForward(activeObject);
        } else {
            canvas.bringObjectForward(activeObject);
        }

        canvas.requestRenderAll();
        this.onStateChange();
    }

    sendBackward(): void {
        const canvas = this.getCanvas();
        if (!canvas) return;

        const activeObject = canvas.getActiveObject();
        if (!activeObject) return;

        if (activeObject instanceof ActiveSelection) {
            [...activeObject.getObjects()].reverse().forEach(obj => {
                canvas.sendObjectBackwards(obj);
            });
            canvas.sendObjectBackwards(activeObject);
        } else {
            canvas.sendObjectBackwards(activeObject);
        }

        canvas.requestRenderAll();
        this.onStateChange();
    }

    sendToBack(): void {
        const canvas = this.getCanvas();
        if (!canvas) return;

        const activeObject = canvas.getActiveObject();
        if (!activeObject) return;

        if (activeObject instanceof ActiveSelection) {
            [...activeObject.getObjects()].reverse().forEach(obj => {
                canvas.sendObjectToBack(obj);

                const objects = canvas.getObjects();
                const index = objects.indexOf(obj);
                if (index > 1) {
                    canvas.moveObjectTo(obj, 1);
                }
            });
            canvas.sendObjectToBack(activeObject);
        } else {
            canvas.sendObjectToBack(activeObject);
            const objects = canvas.getObjects();
            const index = objects.indexOf(activeObject);
            if (index > 1) {
                canvas.moveObjectTo(activeObject, 1);
            }
        }

        canvas.requestRenderAll();
        this.onStateChange();
    }
}
