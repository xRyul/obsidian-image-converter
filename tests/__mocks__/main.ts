/**
 * Mock implementation of the main plugin module
 */

import { Plugin } from 'obsidian';

export default class ImageConverterPlugin extends Plugin {
  settings: any = {};

  async loadSettings() {
    this.settings = {};
  }

  async saveSettings() {
    // Mock implementation
  }
}
