import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    // Global test configuration
    globals: true,
    environment: 'happy-dom',
    setupFiles: ['./tests/helpers/test-setup.ts'],
    
    // Test file patterns
    include: [
      'tests/unit/**/*.test.ts',
      'tests/integration/**/*.test.ts',
      'tests/e2e/**/*.test.ts'
    ],
    
    // Coverage configuration
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      reportsDirectory: './coverage',
      include: [
        'src/**/*.ts'
      ],
      exclude: [
        'src/**/*.d.ts',
        'src/types/**',
        'src/**/*.test.ts',
        'src/**/*.spec.ts',
        'node_modules/**',
        'tests/**'
      ],
      thresholds: {
        branches: 60,
        functions: 60,
        lines: 70,
        statements: 70
      }
    },
    
    // Performance and timeout settings
    testTimeout: 10000,
    hookTimeout: 10000,
    teardownTimeout: 1000,
    isolate: true,
    threads: true,
    
    // Mock configuration
    mockReset: true,
    clearMocks: true,
    restoreMocks: true,
    
    // Reporter settings
    reporters: process.env.CI ? ['verbose', 'json'] : [
      ['default', { 
        summary: true,
        // Disable Unicode characters for better terminal compatibility
      }]
    ],
    outputFile: process.env.CI ? './test-results.json' : undefined,
    
    // Watch mode exclusions
    watchExclude: [
      '**/node_modules/**',
      '**/build/**',
      '**/dist/**',
      '**/.obsidian/**'
    ],
    
    // Type checking
    typecheck: {
      enabled: true,
      tsconfig: './tsconfig.test.json'
    }
  },
  
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@mocks': path.resolve(__dirname, './tests/__mocks__'),
      '@fixtures': path.resolve(__dirname, './tests/fixtures'),
      '@helpers': path.resolve(__dirname, './tests/helpers'),
      'obsidian': path.resolve(__dirname, './tests/__mocks__/obsidian.ts')
    }
  },
  
  // Build configuration for test files
  esbuild: {
    target: 'es2024',
    platform: 'node'
  },
  
  // Define global constants
  define: {
    'process.env.NODE_ENV': '"test"',
    '__TEST__': 'true'
  }
});
