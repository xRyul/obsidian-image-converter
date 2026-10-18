/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument */
import { describe, expect, it, vi } from 'vitest';
import { BatchImageProcessor } from '../../../src/BatchImageProcessor';
import ImageConverterPlugin from '../../../src/main';
import { DEFAULT_SETTINGS } from '../../../src/ImageConverterSettings';
import { FolderAndFilenameManagement } from '../../../src/FolderAndFilenameManagement';
import { ProcessSingleImageModal } from '../../../src/ProcessSingleImageModal';
import { ImageResizer } from '../../../src/ImageResizer';
import { ImageExporter } from '../../../src/ImageAnnotation/export/ImageExporter';
import { Crop } from '../../../src/Crop';
import { ContextMenu } from '../../../src/ContextMenu';
import { isPathExcluded } from '../../../src/ExcludedFolders';
import { fakeApp, fakeVault, fakeTFile, fakeTFolder, fakeWorkspace, fakePluginManifest } from '../../factories/obsidian';

function fixture() {
    const note = fakeTFile({ path: 'Notes/note.md' });
    const protectedNote = fakeTFile({ path: 'Research/note.md' });
    const canvas = fakeTFile({ path: 'Notes/board.canvas' });
    const protectedCanvas = fakeTFile({ path: 'Research/board.canvas' });
    const image = fakeTFile({ path: 'Images/image.png' });
    const protectedImage = fakeTFile({ path: 'Research/Images/image.png' });
    const vault = fakeVault({
        files: [note, protectedNote, canvas, protectedCanvas, image, protectedImage],
        fileContents: new Map([
            [note.path, 'Images/image.png'],
            [protectedNote.path, 'Images/image.png'],
            [canvas.path, JSON.stringify({ nodes: [{ type: 'file', file: protectedImage.path }] })],
            [protectedCanvas.path, JSON.stringify({ nodes: [{ type: 'file', file: image.path }] })]
        ])
    });
    const app = fakeApp({
        vault,
        workspace: fakeWorkspace({ activeFile: note }),
        metadataCache: { resolvedLinks: {
            [note.path]: { [image.path]: 1, [protectedImage.path]: 1 },
            [protectedNote.path]: { [image.path]: 1 }
        } } as any
    }) as any;
    const plugin = new ImageConverterPlugin(app, fakePluginManifest({ id: 'image-converter' }));
    plugin.settings = { ...DEFAULT_SETTINGS, excludedFolders: 'Research' };
    plugin.supportedImageFormats = { isSupported: (_mime: string, name: string) => /\.png$/.test(name) } as any;
    const imageProcessor = { processImage: vi.fn() };
    const pathing = { getImagePath: vi.fn(() => protectedImage.path) };
    const batch = new BatchImageProcessor(app, plugin, imageProcessor as any, pathing as any);
    return { app, plugin, vault, batch, imageProcessor, note, protectedNote, canvas, protectedCanvas, image, protectedImage, pathing };
}

describe('Global excluded folders across processing entry points', () => {
    it('filters vault candidates and Canvas references before reading excluded Canvas files', async () => {
        const { batch, vault, image, protectedCanvas } = fixture();
        expect((await batch.getAllImageFiles()).map(file => file.path)).toEqual([image.path]);
        expect(vault.read).not.toHaveBeenCalledWith(protectedCanvas);
    });

    it('skips excluded source notes even when they link to images elsewhere', async () => {
        const { batch, protectedNote, vault, imageProcessor } = fixture();
        await batch.processImagesInNote(protectedNote);
        expect(vault.readBinary).not.toHaveBeenCalled();
        expect(imageProcessor.processImage).not.toHaveBeenCalled();
    });

    it('filters protected images referenced by ordinary notes and recursive folders', () => {
        const { batch, note, image } = fixture();
        expect((batch as any).getLinkedImageFiles(note).map((file: any) => file.path)).toEqual([image.path]);
        expect((batch as any).getImageFiles(fakeTFolder({ path: '/' }), true).map((file: any) => file.path)).toEqual([image.path]);
    });

    it('does not read or rewrite excluded Markdown or Canvas files', async () => {
        const { batch, protectedNote, protectedCanvas, vault, note } = fixture();
        await batch.updateLinksInNote(protectedNote, 'Images/image.png', 'Images/image.webp');
        await batch.updateCanvasFileLinks(protectedCanvas, 'Images/image.png', 'Images/image.webp');
        expect(vault.read).not.toHaveBeenCalled();
        expect(vault.modify).not.toHaveBeenCalled();
        await batch.updateLinksInNote(note, 'Images/image.png', 'Images/image.webp');
        expect(vault.modify).toHaveBeenCalledWith(note, 'Images/image.webp');
    });

    it('leaves native drop and paste behavior untouched in excluded notes', async () => {
        const { app, plugin, protectedNote } = fixture();
        app.workspace.getActiveFile.mockReturnValue(protectedNote);
        const drop = vi.spyOn(plugin as any, 'handleDrop');
        const paste = vi.spyOn(plugin as any, 'handlePaste');
        (plugin as any).dropPasteRegisterEvents();
        const preventDefault = vi.fn();
        for (const eventName of ['editor-drop', 'editor-paste']) {
            const handler = app.workspace.on.mock.calls.find((call: any[]) => call[0] === eventName)[1];
            await handler({ defaultPrevented: false, preventDefault }, {});
        }
        expect(preventDefault).not.toHaveBeenCalled();
        expect(drop).not.toHaveBeenCalled();
        expect(paste).not.toHaveBeenCalled();
    });

    it('guards direct drop/paste calls and excluded output paths', async () => {
        const { app, plugin, protectedNote, vault } = fixture();
        app.workspace.getActiveFile.mockReturnValue(protectedNote);
        const image = new File(['image'], 'test.png', { type: 'image/png' });
        await (plugin as any).handleDrop([{ name: image.name, type: image.type, file: image }], {}, {}, {});
        await (plugin as any).handlePaste([{ kind: 'file', type: image.type, file: image }], {}, {});
        expect(vault.createBinary).not.toHaveBeenCalled();
        expect((plugin as any).validateAttachmentPath('Research/new.png')).toBe(false);
    });

    it('rejects excluded folders and both sides of a safe rename', async () => {
        const { app, plugin, image, protectedImage } = fixture();
        const pathing = new FolderAndFilenameManagement(app, plugin.settings, plugin.supportedImageFormats, {} as any);
        await expect(pathing.ensureFolderExists('Research/New')).rejects.toThrow('excluded');
        expect(await pathing.safeRenameFile(image, 'Research/new.png')).toBe(false);
        expect(await pathing.safeRenameFile(protectedImage, 'Images/new.png')).toBe(false);
        expect(app.fileManager.renameFile).not.toHaveBeenCalled();
    });

    it('blocks single-image processing, crop and annotation export before reading or writing', async () => {
        const { app, plugin, protectedImage, vault } = fixture();
        const modal = new ProcessSingleImageModal(app, plugin, protectedImage);
        await (modal as any).processImage();
        const excluded = (filePath: string) => isPathExcluded(filePath, plugin.settings);
        const crop = new Crop(app, protectedImage, excluded);
        await crop.saveImage();
        const exporter = new ImageExporter(app, excluded);
        expect(await exporter.save({} as any, protectedImage)).toBe(false);
        expect(vault.readBinary).not.toHaveBeenCalled();
        expect(vault.modifyBinary).not.toHaveBeenCalled();
    });

    it('does not attach resize handling or create plugin menu actions for excluded content', () => {
        const { app, plugin, protectedNote, note, pathing } = fixture();
        const resizer = new ImageResizer(plugin);
        const detach = vi.spyOn(resizer, 'detachView');
        resizer.attachView({ file: protectedNote } as any);
        expect(detach).toHaveBeenCalled();
        const menu = { addItem: vi.fn(), addSeparator: vi.fn() };
        const contextMenu = new ContextMenu(app, plugin, pathing as any, {} as any);
        contextMenu.createContextMenuItems(menu as any, document.createElement('img'), note, {} as any);
        expect(menu.addItem).not.toHaveBeenCalled();
        const preventDefault = vi.fn();
        contextMenu.handleContextMenuEvent({ target: document.createElement('img'), preventDefault } as any);
        expect(preventDefault).not.toHaveBeenCalled();
    });

    it('loads saved exclusions without changing the empty default', async () => {
        const { plugin } = fixture();
        expect(DEFAULT_SETTINGS.excludedFolders).toBe('');
        vi.spyOn(plugin as any, 'loadData').mockResolvedValue({ excludedFolders: 'Research\nOriginals' });
        await plugin.loadSettings();
        expect(plugin.settings.excludedFolders).toBe('Research\nOriginals');
    });
});
