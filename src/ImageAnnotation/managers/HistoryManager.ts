import { Canvas, FabricObject, util } from 'fabric';

export class HistoryManager {
    private undoStack: string[] = [];
    private redoStack: string[] = [];
    private isUndoRedoAction = false;

    constructor(private getCanvas: () => Canvas | null) {}

    initialize(): void {
        this.undoStack = [JSON.stringify([])];
        this.redoStack = [];
    }

    isPerformingUndoRedo(): boolean {
        return this.isUndoRedoAction;
    }

    saveState(): void {
        const canvas = this.getCanvas();
        if (!canvas || this.isUndoRedoAction) {
            return;
        }

        if (this.undoStack.length === 0) {
            this.undoStack.push(JSON.stringify([]));
        }

        const objects = canvas.getObjects().slice(1);
        const newState = JSON.stringify(objects.map(obj => obj.toObject()));

        if (this.undoStack[this.undoStack.length - 1] === newState) {
            return;
        }

        this.undoStack.push(newState);
        this.redoStack = [];
    }

    async undo(): Promise<void> {
        const canvas = this.getCanvas();
        if (!canvas || this.undoStack.length <= 1) {
            return;
        }

        this.isUndoRedoAction = true;

        try {
            const currentState = this.undoStack.pop();
            if (currentState) {
                this.redoStack.push(currentState);
            }

            const previousState = this.undoStack[this.undoStack.length - 1];

            const objectsToRemove = canvas.getObjects().slice(1);
            objectsToRemove.forEach(obj => canvas.remove(obj));

            if (previousState) {
                const objects = JSON.parse(previousState);
                for (const objData of objects) {
                    const enlivenedObjects = await util.enlivenObjects([objData]);
                    enlivenedObjects.forEach(obj => {
                        if (obj instanceof FabricObject) {
                            canvas.add(obj);
                        }
                    });
                }
            }

            canvas.requestRenderAll();
        } catch (error) {
            console.error('Error during undo:', error);
        } finally {
            this.isUndoRedoAction = false;
        }
    }

    async redo(): Promise<void> {
        const canvas = this.getCanvas();
        if (!canvas || this.redoStack.length === 0) {
            return;
        }

        this.isUndoRedoAction = true;

        try {
            const nextState = this.redoStack.pop();
            if (!nextState) return;

            const currentObjects = canvas.getObjects().slice(1);
            const currentState = JSON.stringify(currentObjects.map(obj => obj.toObject()));
            this.undoStack.push(currentState);

            const objectsToRemove = canvas.getObjects().slice(1);
            objectsToRemove.forEach(obj => canvas.remove(obj));

            const objects = JSON.parse(nextState);
            for (const objData of objects) {
                const enlivenedObjects = await util.enlivenObjects([objData]);
                enlivenedObjects.forEach(obj => {
                    if (obj instanceof FabricObject) {
                        canvas.add(obj);
                    }
                });
            }

            canvas.requestRenderAll();
        } catch (error) {
            console.error('Error during redo:', error);
        } finally {
            this.isUndoRedoAction = false;
        }
    }

    clear(): void {
        this.undoStack = [];
        this.redoStack = [];
        this.isUndoRedoAction = false;
    }

    canUndo(): boolean {
        return this.undoStack.length > 1;
    }

    canRedo(): boolean {
        return this.redoStack.length > 0;
    }
}
