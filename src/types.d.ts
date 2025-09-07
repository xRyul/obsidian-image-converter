//  THESE are undocumented-obsidian-types.d.ts and are simply for the build to execute

import type { EditorPosition } from 'obsidian';
declare module 'obsidian' {
    interface App {
        /**
         * Reveals a file or folder in the operating system's file explorer.
         * @param path - The path to the file or folder in the vault.
         */
        showInFolder(path: string): Promise<void>;
    }
    interface Vault {
        /**
         * Gets a configuration option from Obsidian's internal config.
         * Use this sparingly and be aware of potential compatibility issues if the internal config changes.
         * @param key - The key of the configuration option.
         * @returns The value of the configuration option, or undefined if not found.
         */
        getConfig(key: string): any;
    }
    interface MenuItem {
        /**
         * Creates a submenu for this menu item.
         * @returns The submenu's MenuItem instance.
         */
        setSubmenu(): MenuItem;

        /**
         * Adds a new item to the submenu.
         * @param callback - A function that configures the new menu item.
         * @returns The new menu item's MenuItem instance.
         */
        addItem(callback: (item: MenuItem) => any): MenuItem;

        /**
         * Adds a separator line to the menu.
         * @returns The current MenuItem instance.
         */
        addSeparator(): MenuItem;

        /**
         * Sets the icon for the menu item.
         * @param icon - The name of the Lucide icon to use (e.g., "lucide-file", "lucide-folder").
         * @returns The current MenuItem instance.
         */
        setIcon(icon: string): MenuItem;

        /**
         * Sets the title (text) of the menu item.
         * @param title - The title to display.
         * @returns The current MenuItem instance.
         */
        setTitle(title: string): MenuItem;

        /**
         * Sets the action to perform when the menu item is clicked.
         * @param callback - The function to execute on click.
         * @returns The current MenuItem instance.
         */
        onClick(callback: (event: MouseEvent | KeyboardEvent) => any): this;
    }
    interface Editor {
        posAtMouse(event: MouseEvent): EditorPosition | null;
    }
    interface Menu {
        addItem(callback: (item: MenuItem) => any): this;
        addSeparator(): this;
    }
}