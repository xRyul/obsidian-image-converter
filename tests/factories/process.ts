/**
 * Factory functions for mocking process and spawn operations
 * Used for testing external tool integrations
 */

import { vi } from 'vitest';
import { EventEmitter } from 'events';

export interface MockSpawnOptions {
  exitCode?: number;
  stdout?: string | Buffer;
  stderr?: string | Buffer;
  error?: Error;
  delay?: number;
}

/**
 * Create a mock child process
 */
export function mockChildProcess(options: MockSpawnOptions = {}) {
  const proc = new EventEmitter();
  
  // Add process properties
  Object.assign(proc, {
    pid: Math.floor(Math.random() * 10000),
    stdin: {
      write: vi.fn((data: any) => true),
      end: vi.fn(),
      on: vi.fn(),
      pipe: vi.fn()
    },
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    kill: vi.fn(() => true),
    exitCode: null,
    signalCode: null,
    killed: false
  });
  
  // Simulate process execution
  if (options.delay) {
    setTimeout(() => emitProcessEvents(proc, options), options.delay);
  } else {
    Promise.resolve().then(() => emitProcessEvents(proc, options));
  }
  
  return proc;
}

function emitProcessEvents(proc: any, options: MockSpawnOptions) {
  if (options.stdout) {
    proc.stdout.emit('data', options.stdout);
  }
  
  if (options.stderr) {
    proc.stderr.emit('data', options.stderr);
  }
  
  if (options.error) {
    proc.emit('error', options.error);
  } else {
    proc.exitCode = options.exitCode ?? 0;
    proc.emit('exit', proc.exitCode, null);
    proc.emit('close', proc.exitCode, null);
  }
}

/**
 * Create a stubbed spawn function
 */
export function stubSpawn(defaultOptions: MockSpawnOptions = {}) {
  return vi.fn((command: string, args: string[], options?: any) => {
    return mockChildProcess(defaultOptions);
  });
}

/**
 * Create a stubbed exec function
 */
export function stubExec(defaultOptions: MockSpawnOptions = {}) {
  return vi.fn((command: string, callback?: (error: Error | null, stdout: string, stderr: string) => void) => {
    const proc = mockChildProcess(defaultOptions);
    
    if (callback) {
      Promise.resolve().then(() => {
        if (defaultOptions.error) {
          callback(defaultOptions.error, '', defaultOptions.stderr?.toString() || '');
        } else {
          callback(null, defaultOptions.stdout?.toString() || '', defaultOptions.stderr?.toString() || '');
        }
      });
    }
    
    return proc;
  });
}

/**
 * Helper to create temp file paths
 */
export function makeTempPath(prefix: string = 'test', ext: string = '.tmp'): string {
  const random = Math.random().toString(36).substring(7);
  return `/tmp/${prefix}-${random}${ext}`;
}

/**
 * Mock fs operations for temp files
 */
export function mockTempFileOps() {
  const tempFiles = new Map<string, Buffer>();
  
  return {
    mkdtemp: vi.fn(async (prefix: string) => {
      return makeTempPath(prefix, '');
    }),
    
    writeFile: vi.fn(async (path: string, data: Buffer | string) => {
      tempFiles.set(path, Buffer.isBuffer(data) ? data : Buffer.from(data));
    }),
    
    readFile: vi.fn(async (path: string) => {
      return tempFiles.get(path) || Buffer.from([]);
    }),
    
    unlink: vi.fn(async (path: string) => {
      tempFiles.delete(path);
    }),
    
    exists: vi.fn(async (path: string) => {
      return tempFiles.has(path);
    }),
    
    getTempFiles: () => tempFiles,
    
    clearTempFiles: () => tempFiles.clear()
  };
}