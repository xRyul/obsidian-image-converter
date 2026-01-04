import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const DEFAULT_PLUGINS_DIR =
	"C:\\Users\\daniel\\Developer\\Obsidian Plugins\\Plugin-Testing-Vault\\.obsidian\\plugins";

function parseArgs(argv) {
	const args = {};
	for (let i = 0; i < argv.length; i += 1) {
		const arg = argv[i];
		if (arg === "--pluginsDir") {
			args.pluginsDir = argv[i + 1];
			i += 1;
		}
	}
	return args;
}

async function pathExists(filePath) {
	try {
		await fs.stat(filePath);
		return true;
	} catch {
		return false;
	}
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	const pluginsDir =
		args.pluginsDir ?? process.env.OBSIDIAN_PLUGINS_DIR ?? DEFAULT_PLUGINS_DIR;

	const repoRoot = process.cwd();
	const buildDir = path.join(repoRoot, "build");
	const manifestPath = path.join(repoRoot, "manifest.json");

	if (!(await pathExists(buildDir))) {
		throw new Error(
			"Missing ./build output folder. Run `npm run build` first (or `npm run build:copy`).",
		);
	}

	const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
	const pluginId = manifest?.id;
	if (typeof pluginId !== "string" || pluginId.trim() === "") {
		throw new Error('manifest.json is missing a valid string field: "id"');
	}

	const destDir = path.join(pluginsDir, pluginId);

	// Guardrails: avoid deleting the whole plugins dir by mistake.
	if (path.resolve(destDir) === path.resolve(pluginsDir)) {
		throw new Error(
			`Refusing to delete destination folder because it resolves to the plugins root: ${pluginsDir}`,
		);
	}

	// Ensure the parent exists.
	await fs.mkdir(pluginsDir, { recursive: true });

	// Always recreate the plugin folder so we never keep stale files (e.g. old data.json).
	await fs.rm(destDir, { recursive: true, force: true });
	await fs.cp(buildDir, destDir, { recursive: true });

	console.log(`✅ Copied ${buildDir} -> ${destDir}`);
}

await main();