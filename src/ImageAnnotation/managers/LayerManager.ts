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

        if (activeObject.type === 'activeselection') {
            const selection = activeObject as ActiveSelection;
            selection.getObjects().forEach(obj => {
                canvas.bringObjectToFront(obj);
            });
            canvas.bringObjectToFront(selection);
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

        if (activeObject.type === 'activeselection') {
            const selection = activeObject as ActiveSelection;
            selection.getObjects().forEach(obj => {
                canvas.bringObjectForward(obj);
            });
            canvas.bringObjectForward(selection);
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

        if (activeObject.type === 'activeselection') {
            const selection = activeObject as ActiveSelection;
            selection.getObjects().reverse().forEach(obj => {
                canvas.sendObjectBackwards(obj);
            });
            canvas.sendObjectBackwards(selection);
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

        if (activeObject.type === 'activeselection') {
            const selection = activeObject as ActiveSelection;
            selection.getObjects().reverse().forEach(obj => {
                canvas.sendObjectToBack(obj);
                if (obj !== selection) {
                    const objects = canvas.getObjects();
                    const index = objects.indexOf(obj);
                    if (index > 1) {
                        canvas.moveObjectTo(obj, 1);
                    }
                }
            });
            canvas.sendObjectToBack(selection);
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
