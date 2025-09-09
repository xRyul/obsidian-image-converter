/**
 * Example suite validating the test infrastructure.
 *
 * Confirms Vitest setup, Obsidian API mocks, builder utilities, custom assertions,
 * fake timers/time control, and DOM environment are wired correctly.
 */
import { describe, it, expect, vi } from 'vitest';
import { App, TFile, Notice } from 'obsidian';
import { anImage, someSettings, aNote } from '../helpers/test-builders';
import { expectImageFormat, expectFileSizeLessThan } from '../helpers/assertions';

describe('Example Test Suite - Validating Setup', () => {
  describe('Test Infrastructure', () => {
    it('should have working test environment', () => {
      expect(true).toBe(true);
    });

    it('should have access to Vitest utilities', () => {
      const mockFn = vi.fn();
      mockFn('test');
      expect(mockFn).toHaveBeenCalledWith('test');
    });
  });

  describe('Obsidian Mocks', () => {
    it('should create mock App instance', () => {
      const app = new App();
      expect(app).toBeDefined();
      expect(app.vault).toBeDefined();
      expect(app.workspace).toBeDefined();
    });

    it('should create mock TFile instance', () => {
      const file = new TFile();
      expect(file).toBeDefined();
      expect(file.path).toBe('test.md');
      expect(file.extension).toBe('md');
    });

    it('should create mock Notice', () => {
      const notice = new Notice('Test message');
      expect(notice).toBeDefined();
      expect(notice.setMessage).toBeDefined();
    });

    it('should mock vault operations', async () => {
      const app = new App();
      const testContent = 'test content';
      
      app.vault.read = vi.fn().mockResolvedValue(testContent);
      const content = await app.vault.read(new TFile());
      
      expect(content).toBe(testContent);
      expect(app.vault.read).toHaveBeenCalled();
    });
  });

  describe('Test Builders', () => {
    it('should create test image data', () => {
      const imageData = anImage()
        .withFormat('png')
        .withSize(1024)
        .build();
      
      expect(imageData).toBeInstanceOf(Uint8Array);
      expect(imageData.length).toBe(1024);
      expectImageFormat(imageData, 'png');
    });

    it('should create test settings', () => {
      const settings = someSettings()
        .withOutputFormat('WEBP')
        .withQuality(85)
        .build();
      
      expect(settings.outputFormat).toBe('WEBP');
      expect(settings.quality).toBe(85);
    });

    it('should create test note with images', () => {
      const note = aNote()
        .withParagraph('This is a test note')
        .withWikiImage('images/test.png', 'Test Image')
        .withMarkdownImage('images/another.jpg', 'Another Image')
        .build();
      
      expect(note.content).toContain('This is a test note');
      expect(note.content).toContain('[[images/test.png|Test Image]]');
      expect(note.content).toContain('![Another Image](images/another.jpg)');
      expect(note.images).toHaveLength(2);
    });
  });

  describe('Custom Assertions', () => {
    it('should validate image format', () => {
      const pngImage = anImage().withFormat('png').build();
      const jpegImage = anImage().withFormat('jpeg').build();
      
      expectImageFormat(pngImage, 'png');
      expectImageFormat(jpegImage, 'jpeg');
    });

    it('should validate file size', () => {
      const smallImage = anImage().withSize(500).build();
      const largeImage = anImage().withSize(2000).build();
      
      expectFileSizeLessThan(smallImage, 1000);
      expect(largeImage).toBeWithinSizeRange(1500, 2500);
    });

    it('should validate paths', () => {
      const validPath = 'images/subfolder/image.png';
      const invalidPath = '../../../etc/passwd';
      
      expect(validPath).toBeValidImagePath();
      expect(invalidPath).not.toBeValidImagePath();
    });
  });

  describe('Time Mocking', () => {
    it('should have frozen time in tests', () => {
      const date1 = new Date();
      
      // Wait a bit (in real time this would change)
      for (let i = 0; i < 1000000; i++) {
        // Do nothing
      }
      
      const date2 = new Date();
      
      // Times should be identical because time is frozen
      expect(date1.getTime()).toBe(date2.getTime());
      expect(date1.toISOString()).toBe('2024-01-01T12:00:00.000Z');
    });

    it('should allow time manipulation', () => {
      const originalDate = new Date();
      
      vi.setSystemTime(new Date('2025-06-15T10:30:00.000Z'));
      const newDate = new Date();
      
      expect(newDate.toISOString()).toBe('2025-06-15T10:30:00.000Z');
      
      // Reset to original
      vi.setSystemTime(originalDate);
    });
  });

  describe('Happy-DOM Environment', () => {
    it('should have DOM available', () => {
      const div = document.createElement('div');
      div.className = 'test-class';
      div.textContent = 'Test content';
      
      document.body.appendChild(div);
      
      const found = document.querySelector('.test-class');
      expect(found).toBeDefined();
      expect(found?.textContent).toBe('Test content');
      
      // Cleanup
      document.body.removeChild(div);
    });

    it('should support DOM events', () => {
      const button = document.createElement('button');
      const clickHandler = vi.fn();
      
      button.addEventListener('click', clickHandler);
      button.click();
      
      expect(clickHandler).toHaveBeenCalled();
    });
  });
});
