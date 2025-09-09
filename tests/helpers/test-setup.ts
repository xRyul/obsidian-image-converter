/**
 * Global test setup and configuration for Obsidian plugin testing.
 *
 * Configures a deterministic, isolated test environment with:
 * - Fake timers at fixed date (2024-01-01) for repeatability
 * - Seeded faker for stable random data generation
 * - DOM cleanup between tests (Happy-DOM environment)
 * - Consistent polyfills (crypto, TextEncoder/Decoder)
 * - Optional console suppression for cleaner test output
 *
 * Imported automatically by Vitest; influences all test files.
 */

import { afterAll, afterEach, beforeAll, vi } from 'vitest';
import { faker } from '@faker-js/faker';
import { TextDecoder, TextEncoder } from 'node:util';

// Happy-DOM is configured in vitest.config.ts and is automatically available

// Stable time for deterministic tests unless a test overrides it
const FIXED_DATE = new Date('2024-01-01T12:00:00.000Z');

// Preserve original console methods for optional suppression and later restore
const originalConsole = {
  log: console.log,
  warn: console.warn,
  info: console.info,
  debug: console.debug,
  error: console.error,
};

beforeAll(() => {
  // Use fake timers for deterministic timer-based logic
  vi.useFakeTimers();
  vi.setSystemTime(FIXED_DATE);

  // Ensure deterministic faker output across runs
  faker.seed(42);

  // Optionally suppress noisy console output in tests
  // Set SUPPRESS_LOGS=false to see logs locally when needed
  if (process.env.SUPPRESS_LOGS !== 'false') {
    console.log = vi.fn();
    console.warn = vi.fn();
    console.info = vi.fn();
    console.debug = vi.fn();
    // Keep console.error for visibility of real errors
  }

  // Consistent global polyfills
  if (!globalThis.crypto?.randomUUID) {
    (globalThis as any).crypto = {
      ...(globalThis as any).crypto,
      randomUUID: () =>
        'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
          const rand = (Math.random() * 16) | 0;
          const value = ch === 'x' ? rand : (rand & 0x3) | 0x8;
          return value.toString(16);
        }),
    };
  }

  if (!(globalThis as any).TextEncoder) (globalThis as any).TextEncoder = TextEncoder as any;
  if (!(globalThis as any).TextDecoder) (globalThis as any).TextDecoder = TextDecoder as any;
});

afterAll(() => {
  vi.useRealTimers();
  // Restore original console methods
  console.log = originalConsole.log;
  console.warn = originalConsole.warn;
  console.info = originalConsole.info;
  console.debug = originalConsole.debug;
  console.error = originalConsole.error;
});

afterEach(() => {
  // Ensure timers and mocks reset between tests
  vi.clearAllMocks();
  vi.clearAllTimers();

  // Clean DOM to prevent test pollution across cases
  if (typeof document !== 'undefined') {
    document.body.innerHTML = '';
    document.head.innerHTML = '';
  }

  // Ensure we return to fake timers deterministically for subsequent tests
  vi.useFakeTimers();

  // Reset system time back to fixed date in case a test modified it
  vi.setSystemTime(FIXED_DATE);

  // Avoid aggressive module resets that can interfere with stable mocks
  // vi.resetModules();
});

// Cross-platform and time utilities exposed for tests when helpful
export const testUtils = {
  normalizePath: (pathStr: string) => pathStr.replace(/\\\\/g, '/'),
  mockFileStats: (overrides: Partial<{ ctime: number; mtime: number; size: number }> = {}) => ({
    ctime: FIXED_DATE.getTime(),
    mtime: FIXED_DATE.getTime(),
    size: 1024,
    ...overrides,
  }),
  restoreConsole: () => {
    console.log = originalConsole.log;
    console.warn = originalConsole.warn;
    console.info = originalConsole.info;
    console.debug = originalConsole.debug;
    console.error = originalConsole.error;
  },
  advanceTime: (ms: number) => vi.advanceTimersByTime(ms),
  setTestTime: (date: Date | string) => vi.setSystemTime(new Date(date)),
};

// Expose utilities globally for convenience in tests
(globalThis as any).testUtilsGlobal = testUtils;
declare global {
  var testUtilsGlobal: typeof testUtils;
}
