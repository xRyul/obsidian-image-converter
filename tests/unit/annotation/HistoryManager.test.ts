import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FabricObject, SerializedObjectProps } from 'fabric';

// Hoisted module mock so HistoryManager imports the mocked fabric util.
// Keeps these unit tests deterministic and avoids relying on Fabric internals.
vi.mock('fabric', () => {
  class MockCanvas {}
  class MockFabricObject {
    toObject(): Record<string, unknown> {
      return { type: 'mock-fabric-object' };
    }
  }

  return {
    Canvas: MockCanvas,
    FabricObject: MockFabricObject,
    util: {
      enlivenObjects: (objects: unknown[]) => Promise.resolve(objects.map(() => new MockFabricObject())),
    },
  };
});

import { HistoryManager } from '../../../src/ImageAnnotation/managers/HistoryManager';

/**
 * HistoryManager Unit Tests: 16.12–16.18
 * 
 * These tests verify the ACTUAL validation and error handling logic in HistoryManager.
 * 
 * Test categories:
 * 1. Static validation methods (16.12–16.16): Pure functions, NO mocking needed
 * 2. Error handling in undo/redo (16.17–16.18): Minimal mocking, tests actual detection logic
 * 
 * For full undo/redo integration tests with canvas operations, see:
 * tests/integration/ui/ImageAnnotation.test.ts (16.7/16.8)
 */

/**
 * Interface for accessing private static methods in tests.
 * These methods are implementation details but need testing for robustness.
 * Using a separate interface (not intersection) avoids TypeScript private member conflicts.
 */
interface HistoryManagerTestAccess {
  isSerializedObjectProps(value: unknown): value is SerializedObjectProps;
  parseState(state: string): SerializedObjectProps[];
  serializeObject(obj: FabricObject): SerializedObjectProps;
}

// Access private static methods for unit testing
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-explicit-any
const HM: HistoryManagerTestAccess = HistoryManager as any;

describe('HistoryManager isSerializedObjectProps (16.12–16.13)', () => {
  it('16.12 isSerializedObjectProps: given valid object with type string and additional properties, returns true', () => {
    const valid = { type: 'rect', left: 10, top: 20 };
    expect(HM.isSerializedObjectProps(valid)).toBe(true);
  });

  it('16.12 isSerializedObjectProps: given object with type and exactly one additional property, returns true', () => {
    const valid = { type: 'circle', radius: 50 };
    expect(HM.isSerializedObjectProps(valid)).toBe(true);
  });

  it('16.12 isSerializedObjectProps: given object with null prototype, returns true', () => {
    const obj: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    obj.type = 'path';
    obj.path = 'M 0 0 L 10 10';
    expect(HM.isSerializedObjectProps(obj)).toBe(true);
  });

  it('16.13 isSerializedObjectProps: given null, returns false', () => {
    expect(HM.isSerializedObjectProps(null)).toBe(false);
  });

  it('16.13 isSerializedObjectProps: given undefined, returns false', () => {
    expect(HM.isSerializedObjectProps(undefined)).toBe(false);
  });

  it('16.13 isSerializedObjectProps: given array, returns false', () => {
    expect(HM.isSerializedObjectProps([{ type: 'rect' }])).toBe(false);
  });

  it('16.13 isSerializedObjectProps: given primitive values (string, number, boolean), returns false', () => {
    expect(HM.isSerializedObjectProps('rect')).toBe(false);
    expect(HM.isSerializedObjectProps(123)).toBe(false);
    expect(HM.isSerializedObjectProps(true)).toBe(false);
  });

  it('16.13 isSerializedObjectProps: given object without type property, returns false', () => {
    expect(HM.isSerializedObjectProps({ left: 10, top: 20 })).toBe(false);
  });

  it('16.13 isSerializedObjectProps: given object with non-string type, returns false', () => {
    expect(HM.isSerializedObjectProps({ type: 123, left: 10 })).toBe(false);
    expect(HM.isSerializedObjectProps({ type: null, left: 10 })).toBe(false);
  });

  it('16.13 isSerializedObjectProps: given object with only type property, returns false', () => {
    expect(HM.isSerializedObjectProps({ type: 'rect' })).toBe(false);
  });

  it('16.13 isSerializedObjectProps: given class instance (non-plain object), returns false', () => {
    class CustomClass {
      type = 'custom';
      value = 42;
    }
    const instance = new CustomClass();
    expect(HM.isSerializedObjectProps(instance)).toBe(false);
  });
});

describe('HistoryManager parseState (16.14–16.16)', () => {
  it('16.14 parseState: given valid JSON array with valid objects, returns array of objects', () => {
    const state = JSON.stringify([
      { type: 'rect', left: 10, top: 20 },
      { type: 'circle', radius: 50, fill: 'red' },
    ]);
    const result = HM.parseState(state);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ type: 'rect', left: 10, top: 20 });
    expect(result[1]).toEqual({ type: 'circle', radius: 50, fill: 'red' });
  });

  it('16.14 parseState: given empty array, returns empty array', () => {
    const result = HM.parseState('[]');
    expect(result).toEqual([]);
  });

  it('16.15 parseState: given malformed JSON, returns empty array and logs error', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = HM.parseState('{ invalid json }');
    expect(result).toEqual([]);
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Failed to parse state JSON'),
      expect.any(Object)
    );
    consoleSpy.mockRestore();
  });

  it('16.15 parseState: given non-array JSON, returns empty array and logs warning', () => {
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = HM.parseState('{"type": "object"}');
    expect(result).toEqual([]);
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Expected array but received different type'),
      expect.any(Object)
    );
    consoleSpy.mockRestore();
  });

  it('16.15 parseState: given JSON string primitive, returns empty array', () => {
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = HM.parseState('"just a string"');
    expect(result).toEqual([]);
    consoleSpy.mockRestore();
  });

  it('16.16 parseState: given array with invalid objects, filters them out and logs warning with samples', () => {
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const state = JSON.stringify([
      { type: 'rect', left: 10 },       // valid
      { left: 10, top: 20 },            // invalid: no type
      { type: 'circle', radius: 50 },   // valid
      null,                              // invalid: null
      'string',                          // invalid: primitive
    ]);
    
    const result = HM.parseState(state);
    
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ type: 'rect', left: 10 });
    expect(result[1]).toEqual({ type: 'circle', radius: 50 });
    
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Filtered out invalid objects'),
      expect.objectContaining({
        totalItems: 5,
        validItems: 2,
        invalidItems: 3,
      })
    );
    consoleSpy.mockRestore();
  });

  it('16.16 parseState: given many invalid items, limits sample to MAX_SAMPLE_INVALID_ITEMS', () => {
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const state = JSON.stringify([
      { noType: 1 },
      { noType: 2 },
      { noType: 3 },
      { noType: 4 },
      { noType: 5 },
    ]);
    
    HM.parseState(state);
    
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.anything(),
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- expect.any() returns any by design
      expect.objectContaining({ sampleInvalidItems: expect.any(Array) })
    );
    
    const callArgs = consoleSpy.mock.calls[0]?.[1] as { sampleInvalidItems: unknown[] } | undefined;
    expect(callArgs).toBeDefined();
    expect(callArgs?.sampleInvalidItems.length).toBeLessThanOrEqual(3);
    consoleSpy.mockRestore();
  });
});

/**
 * Tests 16.17-16.18: Undo/Redo corrupted state handling
 * 
 * These tests verify the error detection logic in undo/redo methods.
 * We use a minimal mock canvas because:
 * 1. For corrupted state: code aborts BEFORE calling enlivenObjects (we test the detection)
 * 2. For empty state: code needs basic canvas operations (getObjects, remove, add)
 * 
 * The actual canvas operations are tested in integration tests.
 */

/** Minimal canvas interface for testing - only the methods HistoryManager actually uses */
interface MinimalCanvasMock {
  getObjects: () => unknown[];
  add: (obj: unknown) => void;
  remove: (obj: unknown) => void;
  requestRenderAll: () => void;
}

/** Interface for accessing HistoryManager's private stacks in tests */
interface HistoryManagerInternals {
  undoStack: string[];
  redoStack: string[];
}

const createMinimalCanvasMock = (): MinimalCanvasMock => {
  const objects: unknown[] = [{}]; // Background object at index 0
  return {
    getObjects: () => objects,
    add: (obj: unknown) => { objects.push(obj); },
    remove: (obj: unknown) => {
      const idx = objects.indexOf(obj);
      if (idx > -1) objects.splice(idx, 1);
    },
    requestRenderAll: () => { /* no-op for tests */ },
  };
};

describe('HistoryManager undo corrupted state handling (16.17)', () => {
  let historyManager: HistoryManager;
  let mockCanvas: MinimalCanvasMock;

  beforeEach(() => {
    mockCanvas = createMinimalCanvasMock();
    historyManager = new HistoryManager(() => mockCanvas as unknown as import('fabric').Canvas);
    historyManager.initialize();
  });

  it('16.17 undo: given corrupted state (non-empty but 0 valid objects), aborts and restores stacks', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    
    // Access private stacks to inject corrupted state
    const hm = historyManager as unknown as HistoryManagerInternals;
    
    // Setup: corrupted state is the PREVIOUS state that undo will try to restore TO
    // Stack: ['[]', 'CORRUPTED', 'VALID'] - undo pops VALID, tries to restore CORRUPTED
    hm.undoStack.push(JSON.stringify([{ noType: 'invalid' }, { alsoNoType: true }])); // corrupted
    hm.undoStack.push(JSON.stringify([{ type: 'rect', left: 10 }])); // valid current
    
    const initialUndoLength = hm.undoStack.length;
    const initialRedoLength = hm.redoStack.length;
    
    await historyManager.undo();
    
    // Key assertion: corrupted state detected and error logged
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Failed to restore previous state'),
      expect.any(Object)
    );
    
    // Key assertion: stacks restored (operation aborted)
    expect(hm.undoStack.length).toBe(initialUndoLength);
    expect(hm.redoStack.length).toBe(initialRedoLength);
    
    consoleSpy.mockRestore();
  });

  it('16.17 undo: given legitimately empty state ([]), succeeds without error', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const hm = historyManager as unknown as HistoryManagerInternals;
    
    // Stack: ['[]', 'VALID'] - undo pops VALID, restores to '[]' (legitimate empty)
    hm.undoStack.push(JSON.stringify([{ type: 'rect', left: 10 }]));
    
    expect(historyManager.canUndo()).toBe(true);
    
    await historyManager.undo();
    
    // Key assertion: NO error for legitimate empty state
    expect(consoleSpy).not.toHaveBeenCalled();
    expect(hm.undoStack.length).toBe(1); // Back to initial '[]'
    
    consoleSpy.mockRestore();
  });
});

describe('HistoryManager redo corrupted state handling (16.18)', () => {
  let historyManager: HistoryManager;
  let mockCanvas: MinimalCanvasMock;

  beforeEach(() => {
    mockCanvas = createMinimalCanvasMock();
    historyManager = new HistoryManager(() => mockCanvas as unknown as import('fabric').Canvas);
    historyManager.initialize();
  });

  it('16.18 redo: given corrupted state (non-empty but 0 valid objects), aborts and restores stacks', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    
    const hm = historyManager as unknown as HistoryManagerInternals;
    
    // Corrupted state in redoStack - redo will try to restore TO this
    hm.redoStack.push(JSON.stringify([{ noType: 'invalid' }]));
    
    const initialUndoLength = hm.undoStack.length;
    const initialRedoLength = hm.redoStack.length;
    
    await historyManager.redo();
    
    // Key assertion: corrupted state detected
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Failed to restore next state'),
      expect.any(Object)
    );
    
    // Key assertion: stacks restored
    expect(hm.undoStack.length).toBe(initialUndoLength);
    expect(hm.redoStack.length).toBe(initialRedoLength);
    
    consoleSpy.mockRestore();
  });

  it('16.18 redo: given legitimately empty state ([]), succeeds without error', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const hm = historyManager as unknown as HistoryManagerInternals;
    
    // Legitimate empty state
    hm.redoStack.push('[]');
    
    expect(historyManager.canRedo()).toBe(true);
    
    await historyManager.redo();
    
    // Key assertion: NO error for legitimate empty state
    expect(consoleSpy).not.toHaveBeenCalled();
    expect(hm.redoStack.length).toBe(0);
    
    consoleSpy.mockRestore();
  });
});

describe('HistoryManager serializeObject fallback (16.12 supplement)', () => {
  it('16.12 serializeObject: given toObject() returns null, logs warning and returns minimal safe shape', () => {
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    
    const badObject = {
      toObject: () => null,
    } as unknown as FabricObject;
    
    const result = HM.serializeObject(badObject);
    
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('FabricObject.toObject() returned an unexpected shape'),
      expect.any(Object)
    );
    
    expect(result).toHaveProperty('type', 'unknown');
    
    consoleSpy.mockRestore();
  });

  it('16.12 serializeObject: given toObject() returns object without type, preserves properties with fallback type', () => {
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    
    const badObject = {
      toObject: () => ({ someProperty: 'value' }),
    } as unknown as FabricObject;
    
    const result = HM.serializeObject(badObject);
    
    expect(result).toHaveProperty('type', 'unknown');
    expect(result).toHaveProperty('someProperty', 'value');
    
    consoleSpy.mockRestore();
  });

  it('16.12 serializeObject: given toObject() returns object with type but insufficient properties, preserves type string', () => {
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    
    const badObject = {
      toObject: () => ({ type: 'custom-type' }),
    } as unknown as FabricObject;
    
    const result = HM.serializeObject(badObject);
    
    expect(result).toHaveProperty('type', 'custom-type');
    
    consoleSpy.mockRestore();
  });
});
