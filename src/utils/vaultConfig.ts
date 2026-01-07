import type { App } from "obsidian";

/**
 * Safely retrieves a string configuration value from Obsidian's internal vault config.
 * Handles the fact that getConfig returns `any` (can be string, null, undefined, or other types).
 *
 * @param app - The Obsidian App instance
 * @param key - The configuration key to retrieve
 * @param defaultValue - Default value if config is null/undefined (defaults to "")
 * @returns The config value as a string, or the default value
 */
export function getVaultConfigString(app: App, key: string, defaultValue = ""): string {
	const value: unknown = app.vault.getConfig(key);
	if (typeof value === "string") {
		return value;
	}
	return defaultValue;
}

/**
 * Safely retrieves a boolean configuration value from Obsidian's internal vault config.
 *
 * @param app - The Obsidian App instance
 * @param key - The configuration key to retrieve
 * @param defaultValue - Default value if config is null/undefined (defaults to false)
 * @returns The config value as a boolean, or the default value
 */
export function getVaultConfigBoolean(app: App, key: string, defaultValue = false): boolean {
	const value: unknown = app.vault.getConfig(key);
	if (typeof value === "boolean") {
		return value;
	}
	return defaultValue;
}
