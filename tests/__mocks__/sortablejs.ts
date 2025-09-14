import { vi } from 'vitest';

const Sortable = {
  create: vi.fn(() => ({
    destroy: vi.fn(),
    option: vi.fn(),
    toArray: vi.fn(() => []),
    sort: vi.fn(),
    save: vi.fn(),
    handleEvent: vi.fn(),
    el: null
  })),
  get: vi.fn(),
  mount: vi.fn(),
  utils: {
    on: vi.fn(),
    off: vi.fn(),
    css: vi.fn(),
    find: vi.fn(),
    findAll: vi.fn()
  }
};

export default Sortable;