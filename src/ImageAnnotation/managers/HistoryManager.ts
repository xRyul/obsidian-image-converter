import { Canvas, FabricObject, SerializedObjectProps, util } from 'fabric';

/** Minimum number of properties a valid serialized object must have (type + at least one other) */
const MIN_SERIALIZED_PROPS = 2;

/** Maximum number of invalid items to include in diagnostic logs */
const MAX_SAMPLE_INVALID_ITEMS = 3;

export class HistoryManager {
    private undoStack: string[] = [];
    private redoStack: string[] = [];
    private isUndoRedoAction = false;

    constructor(private getCanvas: () => Canvas | null) {}

    /**
     * Serializes a FabricObject to its plain object representation.
     * Note: FabricObject.toObject() returns `any` by design since subclasses
     * extend the base serialization. We defensively validate the result here
     * to avoid writing malformed state into the history stacks.
     */
    private static serializeObject(obj: FabricObject): SerializedObjectProps {
        const raw: unknown = obj.toObject();

        if (HistoryManager.isSerializedObjectProps(raw)) {
            return raw;
        }

        // Fallback: log and coerce into a minimal safe shape
        const rawObj = typeof raw === 'object' && raw !== null ? raw as Record<string, unknown> : {};
        const fallbackType = typeof rawObj.type === 'string' ? rawObj.type : 'unknown';

        console.warn(
            'HistoryManager.serializeObject: FabricObject.toObject() returned an unexpected shape. ' +
            'This may indicate a custom object with incompatible serialization. ' +
            'A minimal safe representation will be stored in history.',
            {
                objectType: fallbackType,
                rawKeys: typeof raw === 'object' && raw !== null
                    ? Object.keys(raw as Record<string, unknown>).slice(0, 10)
                    : typeof raw,
            }
        );

        // Double assertion is intentional: this is an error recovery path where we
        // salvage whatever properties exist rather than losing the user's annotation.
        // The object may be incomplete but is better than failing entirely.
        return {
            ...rawObj,
            type: fallbackType,
        } as unknown as SerializedObjectProps;
    }

    /**
     * Type guard to validate that a value conforms to SerializedObjectProps.
     * Required because toObject() returns `any` and stored state could be corrupted.
     */
    private static isSerializedObjectProps(value: unknown): value is SerializedObjectProps {
        if (typeof value !== 'object' || value === null || Array.isArray(value)) {
            return false;
        }

        // Ensure we only accept plain objects (no class instances, DOM nodes, etc.)
        // Note: JSON.parse() always returns Object.prototype objects, but we also check
        // for null prototype to support Object.create(null) if this guard is reused.
        const proto: unknown = Object.getPrototypeOf(value);
        if (proto !== Object.prototype && proto !== null) {
            return false;
        }

        const obj = value as Record<string, unknown>;

        // SerializedObjectProps requires 'type' as string (inherited from BaseProps)
        if (typeof obj.type !== 'string') {
            return false;
        }

        // Require at least one additional property besides 'type'
        if (Object.keys(obj).length < MIN_SERIALIZED_PROPS) {
            return false;
        }

        return true;
    }

    /**
     * Parses a JSON state string into an array of serialized Fabric objects.
     * Handles invalid JSON gracefully and filters out malformed objects.
     */
    private static parseState(state: string): SerializedObjectProps[] {
        let parsed: unknown;
        try {
            parsed = JSON.parse(state);
        } catch (error: unknown) {
            console.error(
                'HistoryManager.parseState: Failed to parse state JSON. ' +
                'This may indicate corrupted history state. History will be reset for this entry.',
                { error: error instanceof Error ? error.message : String(error), stateLength: state.length }
            );
            return [];
        }

        if (!Array.isArray(parsed)) {
            console.warn(
                'HistoryManager.parseState: Expected array but received different type. ' +
                'This may indicate incompatible state format from a different plugin version.',
                { receivedType: typeof parsed }
            );
            return [];
        }

        const validObjects: SerializedObjectProps[] = [];
        const invalidTypes = new Set<string>();
        const sampleInvalidItems: unknown[] = [];

        for (const value of parsed) {
            if (HistoryManager.isSerializedObjectProps(value)) {
                validObjects.push(value);
            } else {
                invalidTypes.add(Array.isArray(value) ? 'array' : typeof value);
                if (sampleInvalidItems.length < MAX_SAMPLE_INVALID_ITEMS) {
                    sampleInvalidItems.push(value);
                }
            }
        }

        const invalidCount = parsed.length - validObjects.length;
        if (invalidCount > 0) {
            console.warn(
                'HistoryManager.parseState: Filtered out invalid objects from parsed state. ' +
                'Possible causes: corrupted state, incompatible serialization format, or plugin version mismatch. ' +
                'Consider clearing annotation history if issues persist.',
                {
                    totalItems: parsed.length,
                    validItems: validObjects.length,
                    invalidItems: invalidCount,
                    invalidTypes: Array.from(invalidTypes),
                    sampleInvalidItems,
                }
            );
        }

        return validObjects;
    }

    initialize(): void {
        this.undoStack = [JSON.stringify([])];
        this.redoStack = [];
    }

    isPerformingUndoRedo(): boolean {
        return this.isUndoRedoAction;
    }

    /**
     * Serializes all annotation objects (excluding background) to a JSON string.
     * Note: Validation runs on each object. For canvases with many objects during
     * rapid edits, consider debouncing saveState() calls at the caller level.
     */
    private serializeCanvasState(canvas: Canvas): string {
        const objects = canvas.getObjects().slice(1);
        return JSON.stringify(objects.map(obj => HistoryManager.serializeObject(obj)));
    }

    saveState(): void {
        const canvas = this.getCanvas();
        if (!canvas || this.isUndoRedoAction) {
            return;
        }

        if (this.undoStack.length === 0) {
            this.undoStack.push(JSON.stringify([]));
        }

        const newState = this.serializeCanvasState(canvas);

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

            if (previousState) {
                const objects = HistoryManager.parseState(previousState);

                // Detect corrupted state: non-trivial state string but no valid objects parsed.
                // Abort undo to avoid losing current canvas content.
                const isEmptyState = previousState === '[]' || previousState === '';
                if (objects.length === 0 && !isEmptyState) {
                    console.error(
                        'HistoryManager.undo: Failed to restore previous state - parsed result is empty ' +
                        'but state appears non-empty. Aborting undo to preserve current canvas content.',
                        { stateLength: previousState.length }
                    );
                    // Restore stacks to previous state
                    if (currentState) {
                        this.undoStack.push(currentState);
                        this.redoStack.pop();
                    }
                    return;
                }

                const objectsToRemove = canvas.getObjects().slice(1);
                objectsToRemove.forEach(obj => canvas.remove(obj));

                const enlivenedObjects = await util.enlivenObjects(objects);
                enlivenedObjects.forEach(obj => {
                    if (obj instanceof FabricObject) {
                        canvas.add(obj);
                    }
                });
            } else {
                // Legitimately empty previous state - just clear canvas
                const objectsToRemove = canvas.getObjects().slice(1);
                objectsToRemove.forEach(obj => canvas.remove(obj));
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
            // Serialize current state BEFORE popping from redoStack to avoid desync
            // if serialization throws an exception
            const currentState = this.serializeCanvasState(canvas);

            const nextState = this.redoStack.pop();
            if (!nextState) return;

            this.undoStack.push(currentState);

            const objects = HistoryManager.parseState(nextState);

            // Detect corrupted state: non-trivial state string but no valid objects parsed.
            // Abort redo to avoid losing current canvas content.
            const isEmptyState = nextState === '[]' || nextState === '';
            if (objects.length === 0 && !isEmptyState) {
                console.error(
                    'HistoryManager.redo: Failed to restore next state - parsed result is empty ' +
                    'but state appears non-empty. Aborting redo to preserve current canvas content.',
                    { stateLength: nextState.length }
                );
                // Restore stacks to previous state
                this.undoStack.pop();
                this.redoStack.push(nextState);
                return;
            }

            const objectsToRemove = canvas.getObjects().slice(1);
            objectsToRemove.forEach(obj => canvas.remove(obj));

            const enlivenedObjects = await util.enlivenObjects(objects);
            enlivenedObjects.forEach(obj => {
                if (obj instanceof FabricObject) {
                    canvas.add(obj);
                }
            });

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
