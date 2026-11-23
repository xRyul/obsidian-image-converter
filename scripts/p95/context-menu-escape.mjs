#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const CHECK_NAME = "context-menu-escape";

function parseArgs(argv) {
  const args = {
    vault: "plugin-testing-vault",
    id: "image-converter",
    trials: 8,
    opensPerTrial: 10,
    openWaitMs: 60,
    escapeWaitMs: 120,
    maxEscapes: null,
    targetMaxOpenMenus: 1,
    targetP95EscPresses: 1,
    targetP95HideMs: 250,
    reportPath: `_pi/p95/${CHECK_NAME}.current.json`,
    historyPath: `_pi/p95/${CHECK_NAME}.history.jsonl`,
    reportFile: null,
    label: "current",
    noFail: false,
    reloadBefore: true,
    reloadWaitMs: 3000,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    const readValue = () => {
      if (next == null) throw new Error(`Missing value for ${arg}`);
      i += 1;
      return next;
    };

    if (arg === "--vault") args.vault = readValue();
    else if (arg === "--id") args.id = readValue();
    else if (arg === "--trials") args.trials = Number(readValue());
    else if (arg === "--opens-per-trial") args.opensPerTrial = Number(readValue());
    else if (arg === "--open-wait-ms") args.openWaitMs = Number(readValue());
    else if (arg === "--escape-wait-ms") args.escapeWaitMs = Number(readValue());
    else if (arg === "--max-escapes") args.maxEscapes = Number(readValue());
    else if (arg === "--target-max-open-menus") args.targetMaxOpenMenus = Number(readValue());
    else if (arg === "--target-p95-esc-presses") args.targetP95EscPresses = Number(readValue());
    else if (arg === "--target-p95-hide-ms") args.targetP95HideMs = Number(readValue());
    else if (arg === "--report-path") args.reportPath = readValue();
    else if (arg === "--history-path") args.historyPath = readValue();
    else if (arg === "--report-file") args.reportFile = readValue();
    else if (arg === "--label") args.label = readValue();
    else if (arg === "--no-fail") args.noFail = true;
    else if (arg === "--no-reload") args.reloadBefore = false;
    else if (arg === "--reload-wait-ms") args.reloadWaitMs = Number(readValue());
    else if (arg === "--help" || arg === "-h") {
      console.log(`Usage: node scripts/p95/${CHECK_NAME}.mjs [options]\n\nOptions:\n  --vault <name>                  Obsidian vault name (default: plugin-testing-vault)\n  --id <plugin-id>                Plugin id (default: image-converter)\n  --trials <n>                    Independent repeated-open trials (default: 8)\n  --opens-per-trial <n>           Context-menu opens before pressing Escape (default: 10)\n  --open-wait-ms <n>              Wait after each open (default: 60)\n  --escape-wait-ms <n>            Wait budget for each Escape close (default: 120)\n  --max-escapes <n>               Safety cap for Escape presses (default: opens-per-trial + 5)\n  --target-max-open-menus <n>     Ideal maximum DOM menus after repeated opens (default: 1)\n  --target-p95-esc-presses <n>    Ideal p95 Escape presses to close all menus (default: 1)\n  --target-p95-hide-ms <n>        Ideal p95 time for Escape to hide a menu, ms (default: 250)\n  --report-path <path>            Vault-relative current report path\n  --history-path <path>           Vault-relative JSONL history path\n  --report-file <path>            Filesystem path to read the current report from\n  --label <name>                  Label stored in the report (default: current)\n  --no-fail                       Print FAIL metrics but exit 0; useful for before-fix baselines\n  --no-reload                     Do not reload the vault before measuring\n  --reload-wait-ms <n>            Wait after vault reload before eval (default: 3000)\n`);
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  for (const [key, value] of Object.entries({
    trials: args.trials,
    opensPerTrial: args.opensPerTrial,
    openWaitMs: args.openWaitMs,
    escapeWaitMs: args.escapeWaitMs,
    reloadWaitMs: args.reloadWaitMs,
    targetMaxOpenMenus: args.targetMaxOpenMenus,
    targetP95EscPresses: args.targetP95EscPresses,
    targetP95HideMs: args.targetP95HideMs,
  })) {
    if (!Number.isFinite(value) || value < 0) throw new Error(`--${key} must be a non-negative number`);
  }
  if (args.trials < 1) throw new Error("--trials must be at least 1");
  if (args.opensPerTrial < 1) throw new Error("--opens-per-trial must be at least 1");

  args.maxEscapes ??= args.opensPerTrial + 5;
  if (!Number.isFinite(args.maxEscapes) || args.maxEscapes < 1) throw new Error("--max-escapes must be at least 1");

  if (!args.reportFile && args.vault === "plugin-testing-vault") {
    args.reportFile = path.resolve(process.cwd(), "..", "plugin-testing-vault", args.reportPath);
  }

  args.runId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return args;
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${command} ${args.join(" ")} failed with code ${code ?? signal}\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`));
    });
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readJsonIfExists(filePath) {
  if (!filePath) return null;
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

async function readReportWithRetry(reportFile, runId, timeoutMs = 120_000) {
  const startedAt = Date.now();
  let lastError = null;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const report = JSON.parse(await fs.readFile(reportFile, "utf8"));
      if (report.runId === runId) return report;
      lastError = new Error(`Report runId=${report.runId ?? "<missing>"}; waiting for ${runId}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(250);
  }

  throw new Error(`Timed out waiting for ${reportFile}: ${lastError?.message ?? "unknown error"}`);
}

// This function is stringified and executed inside Obsidian by `obsidian eval`.
async function measureContextMenuEscapeInObsidian(config) {
  const id = config.id;
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const round = (value) => Math.round(value * 100) / 100;
  const percentile = (values, p) => {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
    return round(sorted[index]);
  };
  const stats = (values) => ({
    count: values.length,
    min: values.length ? round(Math.min(...values)) : 0,
    mean: values.length ? round(values.reduce((sum, value) => sum + value, 0) / values.length) : 0,
    p50: percentile(values, 50),
    p95: percentile(values, 95),
    max: values.length ? round(Math.max(...values)) : 0,
  });

  const manifest = app.plugins.manifests?.[id];
  if (!manifest?.dir) throw new Error(`Plugin ${id} is not installed`);

  const adapter = app.vault.adapter;
  const dataPath = `${manifest.dir}/data.json`;
  const originalDataExists = await adapter.exists(dataPath);
  const originalData = originalDataExists ? await adapter.read(dataPath) : null;
  const originallyLoaded = Boolean(app.plugins.plugins[id]);
  const originalNativeMenus = app.vault.getConfig?.("nativeMenus");
  let changedNativeMenus = false;

  const errors = [];
  const trials = [];
  const allEscapePressCounts = [];
  const allHideDurationsMs = [];

  const pngBuffer = Uint8Array.from(
    atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII="),
    (char) => char.charCodeAt(0)
  ).buffer;

  const ensureFolder = async (folderPath) => {
    if (!app.vault.getAbstractFileByPath(folderPath)) {
      try { await app.vault.createFolder(folderPath); }
      catch (error) { if (!String(error).includes("already exists")) throw error; }
    }
  };
  const ensureFile = async (filePath, content) => {
    let file = app.vault.getAbstractFileByPath(filePath);
    if (!file) file = await app.vault.create(filePath, content);
    else await app.vault.modify(file, content);
    return file;
  };
  const ensureBinary = async (filePath, buffer) => {
    let file = app.vault.getAbstractFileByPath(filePath);
    if (!file) file = await app.vault.createBinary(filePath, buffer);
    return file;
  };
  const countMenus = () =>
    [...document.querySelectorAll(".menu")].filter((menu) => !menu.parentElement?.closest(".menu")).length;
  const getImage = () => app.workspace.activeLeaf?.view?.containerEl?.querySelector?.(".image-embed img, img") ?? null;
  const dispatchEscape = () => {
    const eventInit = { key: "Escape", code: "Escape", keyCode: 27, which: 27, bubbles: true, cancelable: true };
    const target = document.activeElement instanceof Element ? document.activeElement : document.body;
    target.dispatchEvent(new KeyboardEvent("keydown", eventInit));
    target.dispatchEvent(new KeyboardEvent("keyup", eventInit));
  };
  const waitFor = async (predicate, timeoutMs, intervalMs = 10) => {
    const startedAt = performance.now();
    while (performance.now() - startedAt < timeoutMs) {
      if (predicate()) return true;
      await wait(intervalMs);
    }
    return predicate();
  };
  const openMenuOnImage = async (image) => {
    image.dispatchEvent(new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      button: 2,
      buttons: 2,
      clientX: 120,
      clientY: 100,
    }));
    await wait(config.openWaitMs);
  };
  const closeMenusWithEscape = async (maxEscapes) => {
    const hideDurationsMs = [];
    let presses = 0;

    while (countMenus() > 0 && presses < maxEscapes) {
      const beforeCount = countMenus();
      const startedAt = performance.now();
      dispatchEscape();
      presses += 1;
      await waitFor(() => countMenus() < beforeCount, config.escapeWaitMs);
      if (countMenus() < beforeCount) {
        hideDurationsMs.push(round(performance.now() - startedAt));
      }
      await wait(20);
    }

    return { presses, hideDurationsMs, remainingMenus: countMenus() };
  };

  let fatalError = null;

  try {
    if (app.vault.setConfig && originalNativeMenus !== false) {
      app.vault.setConfig("nativeMenus", false);
      changedNativeMenus = true;
    }

    if (app.plugins.plugins[id]) {
      await app.plugins.disablePlugin(id);
      await wait(250);
    }

    await adapter.write(dataPath, JSON.stringify({
      enableContextMenu: true,
      isImageAlignmentEnabled: true,
      isImageResizeEnbaled: true,
      isDragResizeEnabled: true,
      isScrollResizeEnabled: true,
      isResizeInReadingModeEnabled: true,
      enableImageCaptions: true,
      skipCaptionExtensions: "icns",
      disableObsidianImageSelectionOnClick: true,
      modalBehavior: "never",
      outputFormat: "NONE",
    }, null, 2));

    await ensureFolder("_pi");
    await ensureFolder("_pi/p95");
    await ensureBinary("_pi/p95-context-menu-escape.png", pngBuffer);
    const file = await ensureFile(
      "_pi/p95-context-menu-escape.md",
      "# P95 context-menu Escape check\n\n![[p95-context-menu-escape.png|120]]\n"
    );

    await app.plugins.enablePlugin(id);
    await wait(350);

    const leaf = app.workspace.getLeaf(true);
    await leaf.openFile(file);
    await wait(650);
    try { app.workspace.trigger?.("file-open", file); } catch (error) { errors.push({ label: "trigger:file-open", message: String(error) }); }
    try { app.workspace.trigger?.("layout-change"); } catch (error) { errors.push({ label: "trigger:layout-change", message: String(error) }); }
    await wait(250);

    const image = getImage();
    if (!image) throw new Error("No image found in active markdown view");

    for (let trialIndex = 0; trialIndex < config.trials; trialIndex += 1) {
      const cleanupBefore = await closeMenusWithEscape(config.maxEscapes);
      if (cleanupBefore.remainingMenus > 0) {
        errors.push({ label: `trial:${trialIndex}:cleanup-before`, message: `menus remained before trial: ${cleanupBefore.remainingMenus}` });
      }

      const menuCountsAfterOpen = [];
      for (let openIndex = 0; openIndex < config.opensPerTrial; openIndex += 1) {
        await openMenuOnImage(image);
        menuCountsAfterOpen.push(countMenus());
      }

      const menusBeforeEscape = countMenus();
      if (menusBeforeEscape === 0) {
        errors.push({ label: `trial:${trialIndex}:open`, message: "context menu did not create a DOM .menu element; check nativeMenus config" });
      }

      const closeResult = await closeMenusWithEscape(config.maxEscapes);
      allEscapePressCounts.push(closeResult.presses);
      allHideDurationsMs.push(...closeResult.hideDurationsMs);

      if (closeResult.remainingMenus > 0) {
        errors.push({ label: `trial:${trialIndex}:escape`, message: `menus remained after ${closeResult.presses} Escape presses: ${closeResult.remainingMenus}` });
      }

      trials.push({
        trial: trialIndex,
        menuCountsAfterOpen,
        maxMenuCountAfterOpen: Math.max(...menuCountsAfterOpen),
        menusBeforeEscape,
        escapePressesToClose: closeResult.presses,
        escapeHideDurationsMs: closeResult.hideDurationsMs,
        remainingMenusAfterEscape: closeResult.remainingMenus,
      });
    }
  } catch (error) {
    fatalError = String(error?.stack ?? error);
    errors.push({ label: "fatal", message: fatalError });
  } finally {
    await closeMenusWithEscape(Math.max(config.maxEscapes, config.opensPerTrial + 10));

    if (app.plugins.plugins[id]) {
      await app.plugins.disablePlugin(id);
      await wait(150);
    }

    if (originalDataExists) await adapter.write(dataPath, originalData);
    else if (await adapter.exists(dataPath)) await adapter.remove(dataPath);

    if (changedNativeMenus && app.vault.setConfig) {
      app.vault.setConfig("nativeMenus", originalNativeMenus);
    }

    if (originallyLoaded && !app.plugins.plugins[id]) {
      try { await app.plugins.enablePlugin(id); }
      catch (error) { errors.push({ label: "restore-enable", message: String(error) }); }
    }
  }

  const maxOpenMenus = trials.length ? Math.max(...trials.map((trial) => trial.maxMenuCountAfterOpen)) : 0;
  const escPressStats = stats(allEscapePressCounts);
  const hideMsStats = stats(allHideDurationsMs);

  if (maxOpenMenus > config.targetMaxOpenMenus) {
    errors.push({
      label: "target:max-open-menus",
      message: `max menus after repeated opens ${maxOpenMenus} > target ${config.targetMaxOpenMenus}`,
    });
  }
  if (escPressStats.p95 > config.targetP95EscPresses) {
    errors.push({
      label: "target:p95-escape-presses",
      message: `p95 Escape presses ${escPressStats.p95} > target ${config.targetP95EscPresses}`,
    });
  }
  if (hideMsStats.count > 0 && hideMsStats.p95 > config.targetP95HideMs) {
    errors.push({
      label: "target:p95-hide-ms",
      message: `p95 Escape hide time ${hideMsStats.p95}ms > target ${config.targetP95HideMs}ms`,
    });
  }

  const report = {
    check: CHECK_NAME,
    runId: config.runId,
    label: config.label,
    generatedAt: new Date().toISOString(),
    vault: app.vault.getName?.() ?? null,
    plugin: { id, version: manifest.version, dir: manifest.dir, originallyLoaded },
    config,
    targets: {
      maxOpenMenus,
      targetMaxOpenMenus: config.targetMaxOpenMenus,
      targetP95EscPresses: config.targetP95EscPresses,
      targetP95HideMs: config.targetP95HideMs,
    },
    summary: {
      pass: errors.length === 0,
      errorCount: errors.length,
      errors: errors.slice(0, 50),
      trialCount: trials.length,
      opensPerTrial: config.opensPerTrial,
      maxOpenMenus,
      escPressesToClose: escPressStats,
      escapeHideMs: hideMsStats,
      fatalError,
    },
    trials,
  };

  await ensureFolder("_pi");
  await ensureFolder("_pi/p95");
  await adapter.write(config.reportPath, JSON.stringify(report, null, 2));

  if (config.historyPath) {
    const historyLine = JSON.stringify({
      runId: report.runId,
      label: report.label,
      generatedAt: report.generatedAt,
      pass: report.summary.pass,
      maxOpenMenus: report.summary.maxOpenMenus,
      p95EscPresses: report.summary.escPressesToClose.p95,
      p95HideMs: report.summary.escapeHideMs.p95,
      errorCount: report.summary.errorCount,
    });
    const existingHistory = await adapter.exists(config.historyPath) ? await adapter.read(config.historyPath) : "";
    await adapter.write(config.historyPath, `${existingHistory}${historyLine}\n`);
  }

  return JSON.stringify({ reportPath: config.reportPath, summary: report.summary });
}

function formatValue(value, suffix = "") {
  if (value == null) return "-";
  if (typeof value === "number") return `${value}${suffix}`;
  return String(value);
}

function formatDelta(previous, current, suffix = "") {
  if (previous == null || current == null) return "-";
  const delta = Math.round((current - previous) * 100) / 100;
  const sign = delta > 0 ? "+" : "";
  return `${sign}${delta}${suffix}`;
}

function printMetricRow(name, previous, current, target, suffix = "") {
  const targetText = typeof target === "number" ? `<= ${target}${suffix}` : String(target);
  const status = typeof target === "number" && typeof current === "number" && current > target ? "FAIL" : "PASS";
  console.log(`${name.padEnd(34)} ${formatValue(previous, suffix).padStart(12)} ${formatValue(current, suffix).padStart(12)} ${formatDelta(previous, current, suffix).padStart(12)} ${targetText.padStart(14)} ${status}`);
}

function printSummary(currentReport, previousReport) {
  const current = currentReport.summary;
  const previous = previousReport?.summary ?? null;

  console.log(`\nP95 ${CHECK_NAME}: ${current.pass ? "PASS" : "FAIL"}`);
  console.log(`Trials: ${current.trialCount}, opens/trial: ${current.opensPerTrial}`);
  console.log("\nMetric                              previous      current        delta         target status");
  console.log("-----------------------------------------------------------------------------------------");
  printMetricRow(
    "max menus after repeated opens",
    previous?.maxOpenMenus,
    current.maxOpenMenus,
    currentReport.config.targetMaxOpenMenus
  );
  printMetricRow(
    "p95 Escape presses to close",
    previous?.escPressesToClose?.p95,
    current.escPressesToClose.p95,
    currentReport.config.targetP95EscPresses
  );
  printMetricRow(
    "p95 Escape hide latency",
    previous?.escapeHideMs?.p95,
    current.escapeHideMs.p95,
    currentReport.config.targetP95HideMs,
    "ms"
  );

  if (current.errorCount) {
    console.log(`\nErrors (${current.errorCount}): ${JSON.stringify(current.errors, null, 2)}`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const previousReport = await readJsonIfExists(args.reportFile);
  const injected = `const CHECK_NAME = ${JSON.stringify(CHECK_NAME)};\n(${measureContextMenuEscapeInObsidian.toString()})(${JSON.stringify(args)})`;

  console.log(`Running P95 ${CHECK_NAME}: vault=${args.vault}, plugin=${args.id}`);
  if (args.reloadBefore) {
    console.log("Reloading vault before measurement to clear stale runtime listeners...");
    const reloadResult = await run("obsidian", [`vault=${args.vault}`, "reload"]);
    if (reloadResult.stdout.trim()) console.log(reloadResult.stdout.trim());
    if (reloadResult.stderr.trim()) console.error(reloadResult.stderr.trim());
    await sleep(args.reloadWaitMs);
  }
  const result = await run("obsidian", [`vault=${args.vault}`, "eval", `code=${injected}`]);
  if (result.stdout.trim()) console.log(result.stdout.trim());
  if (result.stderr.trim()) console.error(result.stderr.trim());

  if (!args.reportFile) {
    console.log(`Report written in vault at: ${args.reportPath}`);
    return;
  }

  const currentReport = await readReportWithRetry(args.reportFile, args.runId);
  printSummary(currentReport, previousReport?.check === CHECK_NAME ? previousReport : null);
  console.log(`Report file: ${args.reportFile}`);

  if (!currentReport.summary.pass && !args.noFail) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
