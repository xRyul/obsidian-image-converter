import { vi } from 'vitest';

export class ChildProcess {
  stdin = { 
    write: vi.fn(), 
    end: vi.fn(),
    on: vi.fn()
  };
  stdout = { 
    on: vi.fn(),
    pipe: vi.fn()
  };
  stderr = { 
    on: vi.fn(),
    pipe: vi.fn()
  };
  on = vi.fn();
  kill = vi.fn();
  pid = 12345;
}

export const spawn = vi.fn(() => new ChildProcess());
// Provide Exit/Close emission helpers for tests if needed
;(spawn as any).emitExit = (proc: any, code = 0) => proc.emit && proc.emit('exit', code, null);
;(spawn as any).emitClose = (proc: any, code = 0) => proc.emit && proc.emit('close', code, null);
// Provide EventEmitter-like interface for listeners that code may expect
(spawn as any).mockImplementationOnce = (impl: any) => (spawn as any).mockImplementation(impl);
export const exec = vi.fn((cmd, callback) => {
  if (callback) callback(null, '', '');
  return new ChildProcess();
});
export const execSync = vi.fn(() => Buffer.from(''));
export const fork = vi.fn(() => new ChildProcess());