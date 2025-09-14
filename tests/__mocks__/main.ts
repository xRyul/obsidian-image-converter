/**
 * Mock implementation of the main plugin module
 */

import { Plugin } from 'obsidian';
import { vi } from 'vitest';

export default class ImageConverterPlugin extends Plugin {
  settings: any = {};
  
  constructor(app: any, manifest: any) {
    super(app, manifest);
  }
  
  async loadSettings() {
    this.settings = {};
  }
  
  async saveSettings() {
    // Mock implementation
  }
}