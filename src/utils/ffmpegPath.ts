import { App, Platform } from "obsidian";
// Electron environment supports Node.js APIs
import * as os from "os";
// Electron environment supports Node.js APIs
import * as path from "path";
// Electron environment supports Node.js APIs
import * as fs from "fs/promises";
// Electron environment supports Node.js APIs
import { constants as fsConstants } from "fs";

const WINDOWS_ENV_VAR_REGEX = /%([^%]+)%/g;
const POSIX_ENV_VAR_REGEX = /\$(\w+)|\$\{([^}]+)\}/g;

/**
 * Normalizes an executable path by performing the following operations:
 * 1. Quote removal: Removes surrounding single or double quotes
 * 2. Tilde expansion: Expands ~ to the user's home directory
 * 3. Environment variable expansion: Resolves %VAR% (Windows) or $VAR/${VAR} (POSIX)
 * 4. Path normalization: Normalizes separators using platform-appropriate path module
 *
 * @param rawPath - The raw path string to normalize
 * @returns The normalized path, or the original value if rawPath is empty
 */
export function normalizeExecutablePath(rawPath: string): string {
    if (!rawPath) {
        return rawPath;
    }

    let normalized = rawPath.trim();

    if (
        (normalized.startsWith('"') && normalized.endsWith('"')) ||
        (normalized.startsWith("'") && normalized.endsWith("'"))
    ) {
        normalized = normalized.slice(1, -1).trim();
    }

    normalized = expandTilde(normalized);
    normalized = expandEnvironmentVariables(normalized);

    const pathModule = Platform.isWin ? path.win32 : path.posix;
    return pathModule.normalize(normalized);
}

/**
 * Searches for the FFmpeg executable in common locations.
 * 
 * Search priority order:
 * 1. Vault directory: Checks the vault root and common subdirectories (bin/, tools/, .bin/)
 * 2. System PATH: Scans all directories in the PATH environment variable
 * 3. Common OS locations:
 *    - Windows: Program Files, Program Files (x86), ProgramData/chocolatey, C:\ffmpeg, C:\tools/ffmpeg
 *    - macOS: /opt/homebrew/bin, /usr/local/bin, /usr/bin, /opt/local/bin
 *    - Linux: /usr/bin, /usr/local/bin, /snap/bin, flatpak, linuxbrew
 *
 * @param app - Optional Obsidian App instance for vault path resolution. If undefined,
 *              vault candidates are skipped and only system paths are searched.
 * @returns The first valid executable path found, or null if FFmpeg is not found
 */
export async function findFfmpegExecutablePath(app?: App): Promise<string | null> {
    // Early return if app is undefined - only search system paths
    if (!app) {
        const candidateSet = new Set<string>();
        const exeName = Platform.isWin ? "ffmpeg.exe" : "ffmpeg";
        addPathCandidates(candidateSet, exeName);
        addCommonOsCandidates(candidateSet, exeName);
        const candidates = Array.from(candidateSet).map(normalizeExecutablePath);
        for (const candidate of candidates) {
            if (await isExecutable(candidate)) {
                return candidate;
            }
        }
        return null;
    }

    const candidateSet = new Set<string>();
    const exeName = Platform.isWin ? "ffmpeg.exe" : "ffmpeg";

    addVaultCandidates(candidateSet, app, exeName);
    addPathCandidates(candidateSet, exeName);
    addCommonOsCandidates(candidateSet, exeName);

    const candidates = Array.from(candidateSet).map(normalizeExecutablePath);

    for (const candidate of candidates) {
        if (await isExecutable(candidate)) {
            return candidate;
        }
    }

    return null;
}

function expandTilde(value: string): string {
    if (value === "~") {
        return os.homedir();
    }

    if (value.startsWith("~/") || value.startsWith("~\\")) {
        return path.join(os.homedir(), value.slice(2));
    }

    return value;
}

function expandEnvironmentVariables(value: string): string {
    if (Platform.isWin) {
        return value.replace(WINDOWS_ENV_VAR_REGEX, (_, name: string) => process.env[name] ?? `%${name}%`);
    }

    return value.replace(POSIX_ENV_VAR_REGEX, (match: string, simple: string, braced: string) => {
        const key = simple ?? braced;
        if (!key) {
            return match;
        }
        return process.env[key] ?? match;
    });
}

function addVaultCandidates(candidateSet: Set<string>, app: App | undefined, exeName: string): void {
    const adapter = app?.vault?.adapter as { getBasePath?: () => string } | undefined;
    const basePath = adapter?.getBasePath?.();
    if (!basePath) {
        return;
    }

    const baseCandidates = [
        path.join(basePath, exeName),
        path.join(basePath, "bin", exeName),
        path.join(basePath, "tools", exeName),
        path.join(basePath, ".bin", exeName)
    ];

    baseCandidates.forEach((candidate) => candidateSet.add(candidate));
}

function addPathCandidates(candidateSet: Set<string>, exeName: string): void {
    const envPath = process.env.PATH ?? "";
    const delimiter = Platform.isWin ? ";" : ":";
    const entries = envPath.split(delimiter).map((entry) => entry.trim()).filter(Boolean);

    entries.forEach((entry) => {
        candidateSet.add(path.join(entry, exeName));
    });
}

function addCommonOsCandidates(candidateSet: Set<string>, exeName: string): void {
    if (Platform.isWin) {
        const programFiles = process.env.ProgramFiles ?? "C:\\Program Files";
        const programFilesX86 = process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)";
        const programData = process.env.ProgramData ?? "C:\\ProgramData";

        [
            path.join(programFiles, "ffmpeg", "bin", exeName),
            path.join(programFiles, "FFmpeg", "bin", exeName),
            path.join(programFilesX86, "ffmpeg", "bin", exeName),
            path.join(programFilesX86, "FFmpeg", "bin", exeName),
            path.join(programData, "chocolatey", "bin", exeName),
            path.join("C:\\ffmpeg", "bin", exeName),
            path.join("C:\\tools", "ffmpeg", "bin", exeName)
        ].forEach((candidate) => candidateSet.add(candidate));
        return;
    }

    if (Platform.isMacOS) {
        [
            "/opt/homebrew/bin/ffmpeg",
            "/usr/local/bin/ffmpeg",
            "/usr/bin/ffmpeg",
            "/opt/local/bin/ffmpeg"
        ].forEach((candidate) => candidateSet.add(candidate));
        return;
    }

    [
        "/usr/bin/ffmpeg",
        "/usr/local/bin/ffmpeg",
        "/snap/bin/ffmpeg",
        "/var/lib/flatpak/exports/bin/ffmpeg",
        "/home/linuxbrew/.linuxbrew/bin/ffmpeg"
    ].forEach((candidate) => candidateSet.add(candidate));
}

async function isExecutable(candidate: string): Promise<boolean> {
    try {
        if (!candidate) {
            return false;
        }

        const accessMode = Platform.isWin ? fsConstants.F_OK : fsConstants.X_OK;
        await fs.access(candidate, accessMode);
        const stat = await fs.stat(candidate);
        return stat.isFile();
    } catch {
        return false;
    }
}
