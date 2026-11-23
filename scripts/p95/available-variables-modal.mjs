#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const CHECK_NAME = "available-variables-modal";

const TARGET_SPECS = {
  openedModals: { label: "modal opens", comparator: ">=", target: 1, suffix: "" },
  renderedRows: { label: "variable rows rendered", comparator: ">=", target: 1, suffix: "" },
  staleDetachedClickListenersAfterSearch: { label: "stale detached click listeners", comparator: "<=", target: 0, suffix: "" },
  modalDomListenersAfterClose: { label: "modal DOM listeners after close", comparator: "<=", target: 0, suffix: "" },
  pendingFeedbackTimeoutsAfterClose: { label: "pending feedback timers after close", comparator: "<=", target: 0, suffix: "" },
  htmlInjectionElements: { label: "HTML injection elements rendered", comparator: "<=", target: 0, suffix: "" },
  htmlInjectionExecuted: { label: "HTML injection handlers executed", comparator: "<=", target: 0, suffix: "" },
  p95SearchRenderMs: { label: "p95 search render latency", comparator: "<=", target: 250, suffix: "ms" },
  runtimeErrors: { label: "runtime errors", comparator: "<=", target: 0, suffix: "" },
};

function parseArgs(argv) {
  const args = {
    vault: "plugin-testing-vault",
    id: "image-converter",
    reportPath: `_pi/p95/${CHECK_NAME}.current.json`,
    historyPath: `_pi/p95/${CHECK_NAME}.history.jsonl`,
    reportFile: null,
    label: "current",
    noFail: false,
    reloadBefore: true,
    reloadWaitMs: 3000,
    searchRounds: 3,
  };

  const targetByFlag = {
    "--target-opened-modals": "openedModals",
    "--target-rendered-rows": "renderedRows",
    "--target-stale-detached-click-listeners-after-search": "staleDetachedClickListenersAfterSearch",
    "--target-modal-dom-listeners-after-close": "modalDomListenersAfterClose",
    "--target-pending-feedback-timeouts-after-close": "pendingFeedbackTimeoutsAfterClose",
    "--target-html-injection-elements": "htmlInjectionElements",
    "--target-html-injection-executed": "htmlInjectionExecuted",
    "--target-p95-search-render-ms": "p95SearchRenderMs",
    "--target-runtime-errors": "runtimeErrors",
  };

  const targetSpecs = structuredClone(TARGET_SPECS);

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    const readValue = () => {
      if (next == null) throw new Error(`Missing value for ${arg}`);
      index += 1;
      return next;
    };

    if (arg === "--vault") args.vault = readValue();
    else if (arg === "--id") args.id = readValue();
    else if (arg === "--report-path") args.reportPath = readValue();
    else if (arg === "--history-path") args.historyPath = readValue();
    else if (arg === "--report-file") args.reportFile = readValue();
    else if (arg === "--label") args.label = readValue();
    else if (arg === "--no-fail") args.noFail = true;
    else if (arg === "--no-reload") args.reloadBefore = false;
    else if (arg === "--reload-wait-ms") args.reloadWaitMs = Number(readValue());
    else if (arg === "--search-rounds") args.searchRounds = Number(readValue());
    else if (Object.hasOwn(targetByFlag, arg)) targetSpecs[targetByFlag[arg]].target = Number(readValue());
    else if (arg === "--help" || arg === "-h") {
      console.log(`Usage: node scripts/p95/${CHECK_NAME}.mjs [options]\n\nOptions:\n  --vault <name>                                             Obsidian vault name (default: plugin-testing-vault)\n  --id <plugin-id>                                           Plugin id (default: image-converter)\n  --search-rounds <n>                                        Search term cycles to run (default: 3)\n  --report-path <path>                                       Vault-relative current report path\n  --history-path <path>                                      Vault-relative JSONL history path\n  --report-file <path>                                       Filesystem path to read the current report from\n  --label <name>                                             Label stored in the report (default: current)\n  --no-fail                                                  Print FAIL metrics but exit 0; useful for before-fix baselines\n  --no-reload                                                Do not reload the vault before measuring\n  --reload-wait-ms <n>                                       Wait after vault reload before eval (default: 3000)\n  --target-opened-modals <n>                                 Minimum opened modal count (default: 1)\n  --target-rendered-rows <n>                                 Minimum rendered row count (default: 1)\n  --target-stale-detached-click-listeners-after-search <n>   Maximum detached name-cell click listeners after search rerenders (default: 0)\n  --target-modal-dom-listeners-after-close <n>               Maximum tracked modal DOM listeners after close (default: 0)\n  --target-pending-feedback-timeouts-after-close <n>         Maximum pending copy feedback timers after close (default: 0)\n  --target-html-injection-elements <n>                       Maximum HTML elements created from variable text (default: 0)\n  --target-html-injection-executed <n>                       Maximum inline HTML handler executions (default: 0)\n  --target-p95-search-render-ms <n>                          Maximum p95 search render latency, ms (default: 250)\n  --target-runtime-errors <n>                                Maximum runtime/setup errors (default: 0)\n`);
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  for (const [key, value] of Object.entries({ reloadWaitMs: args.reloadWaitMs, searchRounds: args.searchRounds })) {
    if (!Number.isFinite(value) || value < 0) throw new Error(`--${key} must be a non-negative number`);
  }
  if (args.searchRounds < 1) throw new Error("--search-rounds must be at least 1");

  for (const [key, spec] of Object.entries(targetSpecs)) {
    if (!Number.isFinite(spec.target)) throw new Error(`Invalid target for ${key}`);
  }

  if (!args.reportFile && args.vault === "plugin-testing-vault") {
    args.reportFile = path.resolve(process.cwd(), "..", "plugin-testing-vault", args.reportPath);
  }

  args.targetSpecs = targetSpecs;
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
async function measureAvailableVariablesModalInObsidian(config) {
  const id = config.id;
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const round = (value) => Math.round(value * 100) / 100;
  const percentile = (values, p) => {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
    return round(sorted[index]);
  };
  const metricPass = (value, spec) => {
    if (typeof value !== "number" || !Number.isFinite(value)) return false;
    if (spec.comparator === "<=") return value <= spec.target;
    if (spec.comparator === ">=") return value >= spec.target;
    throw new Error(`Unsupported comparator: ${spec.comparator}`);
  };

  const manifest = app.plugins.manifests?.[id];
  if (!manifest?.dir) throw new Error(`Plugin ${id} is not installed`);

  const adapter = app.vault.adapter;
  const fixtureDir = `_pi/p95/${CHECK_NAME}`;
  const fixtureNotePath = `${fixtureDir}/fixture.md`;
  const originallyLoaded = Boolean(app.plugins.plugins[id]);
  const errors = [];
  const notes = [];
  const searchDurations = [];
  const metrics = {
    openedModals: 0,
    renderedRows: 0,
    staleDetachedClickListenersAfterSearch: Number.POSITIVE_INFINITY,
    modalDomListenersAfterClose: Number.POSITIVE_INFINITY,
    pendingFeedbackTimeoutsAfterClose: Number.POSITIVE_INFINITY,
    htmlInjectionElements: Number.POSITIVE_INFINITY,
    htmlInjectionExecuted: Number.POSITIVE_INFINITY,
    p95SearchRenderMs: Number.POSITIVE_INFINITY,
    runtimeErrors: 0,
  };

  const ensureFolder = async (folderPath) => {
    const parts = folderPath.split("/").filter(Boolean);
    let current = "";
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      if (!app.vault.getAbstractFileByPath(current)) {
        try { await app.vault.createFolder(current); }
        catch (error) { if (!String(error).includes("already exists")) throw error; }
      }
    }
  };
  const ensureFile = async (filePath, content) => {
    let file = app.vault.getAbstractFileByPath(filePath);
    if (!file) file = await app.vault.create(filePath, content);
    else await app.vault.modify(file, content);
    return file;
  };

  const trackedTargets = new Map();
  const originalAddEventListener = EventTarget.prototype.addEventListener;
  const originalRemoveEventListener = EventTarget.prototype.removeEventListener;
  const originalSetTimeout = window.setTimeout;
  const originalClearTimeout = window.clearTimeout;
  let restoreClipboard = null;
  let trackFeedbackTimers = false;
  const pendingFeedbackTimeouts = new Set();
  let plugin = null;
  let originalGetCategorizedVariables = null;

  const targetLabel = (target) => {
    if (target === window) return "window";
    if (target === activeDocument) return "document";
    if (!target?.nodeType) return Object.prototype.toString.call(target);
    const className = typeof target.className === "string" ? target.className : "";
    const tagName = target.tagName ?? target.nodeName;
    return `${tagName}${className ? `.${className.trim().replace(/\s+/g, ".")}` : ""}`;
  };
  const shouldTrackTarget = (target) => {
    if (!target?.nodeType || target.nodeType !== Node.ELEMENT_NODE) return false;
    const element = target;
    return Boolean(
      element.matches?.(".variable-search-input,.variable-name") ||
      element.closest?.(".image-converter-available-variables-modal")
    );
  };
  const ensureTrackedEntry = (target) => {
    let entry = trackedTargets.get(target);
    if (!entry) {
      entry = { label: targetLabel(target), listeners: new Map() };
      trackedTargets.set(target, entry);
    }
    return entry;
  };
  const addTrackedListener = (target, type, listener) => {
    if (!shouldTrackTarget(target)) return;
    const entry = ensureTrackedEntry(target);
    let listenersForType = entry.listeners.get(type);
    if (!listenersForType) {
      listenersForType = new Set();
      entry.listeners.set(type, listenersForType);
    }
    listenersForType.add(listener);
  };
  const removeTrackedListener = (target, type, listener) => {
    const entry = trackedTargets.get(target);
    if (!entry) return;
    const listenersForType = entry.listeners.get(type);
    if (!listenersForType) return;
    listenersForType.delete(listener);
    if (listenersForType.size === 0) entry.listeners.delete(type);
  };
  const countTrackedListeners = (predicate = () => true) => {
    let count = 0;
    for (const [target, entry] of trackedTargets.entries()) {
      for (const [type, listenersForType] of entry.listeners.entries()) {
        if (predicate(target, type, entry)) count += listenersForType.size;
      }
    }
    return count;
  };
  const countStaleDetachedClickListeners = () => countTrackedListeners((target, type) => (
    type === "click" &&
    target?.nodeType === Node.ELEMENT_NODE &&
    target.classList?.contains("variable-name") &&
    !target.isConnected
  ));
  const closeAvailableVariablesModals = async () => {
    for (const button of [...activeDocument.querySelectorAll(".image-converter-available-variables-modal .modal-close-button, .modal-container:has(.image-converter-available-variables-modal) .modal-close-button")]) {
      try { button.click(); }
      catch (error) { notes.push({ label: "close-button", message: String(error) }); }
    }
  };

  EventTarget.prototype.addEventListener = function patchedAddEventListener(type, listener, options) {
    addTrackedListener(this, type, listener);
    return originalAddEventListener.call(this, type, listener, options);
  };
  EventTarget.prototype.removeEventListener = function patchedRemoveEventListener(type, listener, options) {
    removeTrackedListener(this, type, listener);
    return originalRemoveEventListener.call(this, type, listener, options);
  };
  window.setTimeout = function patchedSetTimeout(handler, timeout, ...timerArgs) {
    let timeoutId;
    const wrappedHandler = (...handlerArgs) => {
      pendingFeedbackTimeouts.delete(timeoutId);
      if (typeof handler === "function") {
        return handler(...handlerArgs);
      }
      return Function(handler)();
    };
    timeoutId = originalSetTimeout.call(window, wrappedHandler, timeout, ...timerArgs);
    if (trackFeedbackTimers) pendingFeedbackTimeouts.add(timeoutId);
    return timeoutId;
  };
  window.clearTimeout = function patchedClearTimeout(timeoutId) {
    pendingFeedbackTimeouts.delete(timeoutId);
    return originalClearTimeout.call(window, timeoutId);
  };

  let fatalError = null;

  try {
    await ensureFolder(fixtureDir);
    await ensureFile(
      fixtureNotePath,
      "# P95 available variables modal\n\nThis fixture is created by scripts/p95/available-variables-modal.mjs.\n"
    );

    if (!app.plugins.plugins[id]) {
      await app.plugins.enablePlugin(id);
      await wait(350);
    }
    plugin = app.plugins.plugins[id];
    if (!plugin?.variableProcessor?.getCategorizedVariables) throw new Error(`Plugin ${id} has no variableProcessor.getCategorizedVariables()`);

    originalGetCategorizedVariables = plugin.variableProcessor.getCategorizedVariables.bind(plugin.variableProcessor);
    plugin.variableProcessor.getCategorizedVariables = () => ({
      "P95 fixture": [
        { name: "{p95_alpha}", description: "Alpha fixture variable", example: "alpha-output" },
        { name: "{p95_beta}", description: "Beta fixture variable", example: "beta-output" },
        { name: "{p95_gamma}", description: "Gamma fixture variable", example: "gamma-output" },
        { name: "{p95_delta}", description: "Delta fixture variable", example: "delta-output" },
        { name: "{p95_epsilon}", description: "Epsilon fixture variable", example: "epsilon-output" },
        {
          name: "<img class=\"p95-injected-name\" src=\"x\" onerror=\"window.__p95AvailableVariablesInjected=(window.__p95AvailableVariablesInjected||0)+1\">",
          description: "Description with <svg class=\"p95-injected-description\"></svg> markup",
          example: "<a class=\"p95-injected-example\" href=\"javascript:window.__p95AvailableVariablesInjected=(window.__p95AvailableVariablesInjected||0)+1\">bad link</a>",
        },
      ],
    });

    window.__p95AvailableVariablesInjected = 0;
    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
        const originalWriteText = navigator.clipboard.writeText.bind(navigator.clipboard);
        navigator.clipboard.writeText = async () => undefined;
        restoreClipboard = () => { navigator.clipboard.writeText = originalWriteText; };
      }
    } catch (error) {
      notes.push({ label: "stub-clipboard", message: String(error) });
    }

    await closeAvailableVariablesModals();
    const settingTab = app.setting?.pluginTabs?.find?.((tab) => tab.id === id || tab.plugin?.manifest?.id === id);
    if (!settingTab || typeof settingTab.showAvailableVariables !== "function") {
      throw new Error(`Could not find ImageConverterSettingTab for ${id}`);
    }

    settingTab.showAvailableVariables();

    const modalEl = activeDocument.querySelector(".image-converter-available-variables-modal");
    if (!modalEl) throw new Error("Available variables modal did not open");
    metrics.openedModals = activeDocument.querySelectorAll(".image-converter-available-variables-modal").length;
    metrics.renderedRows = modalEl.querySelectorAll(".variable-row").length;
    metrics.htmlInjectionElements = modalEl.querySelectorAll(".p95-injected-name,.p95-injected-description,.p95-injected-example,script").length;
    metrics.htmlInjectionExecuted = Number(window.__p95AvailableVariablesInjected || 0);

    const searchInput = modalEl.querySelector(".variable-search-input");
    if (!searchInput) throw new Error("Search input was not rendered");

    const searchTerms = ["p95", "alpha", "zzz-no-results", "beta", "", "gamma", "p95"];
    for (let roundIndex = 0; roundIndex < config.searchRounds; roundIndex += 1) {
      for (const term of searchTerms) {
        const startedAt = performance.now();
        searchInput.value = term;
        searchInput.dispatchEvent(new Event("input", { bubbles: true }));
        searchDurations.push(round(performance.now() - startedAt));
        metrics.renderedRows = Math.max(metrics.renderedRows, modalEl.querySelectorAll(".variable-row").length);
      }
    }
    metrics.p95SearchRenderMs = percentile(searchDurations, 95);
    metrics.staleDetachedClickListenersAfterSearch = countStaleDetachedClickListeners();

    const firstNameCell = modalEl.querySelector(".variable-name");
    if (!firstNameCell) throw new Error("No variable name cell was rendered after search");
    trackFeedbackTimers = true;
    firstNameCell.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    await Promise.resolve();
    await Promise.resolve();
    trackFeedbackTimers = false;

    await closeAvailableVariablesModals();
    metrics.pendingFeedbackTimeoutsAfterClose = pendingFeedbackTimeouts.size;
    metrics.modalDomListenersAfterClose = countTrackedListeners();
  } catch (error) {
    fatalError = error;
    errors.push({ label: "fatal", message: String(error), stack: error?.stack ?? null });
  } finally {
    trackFeedbackTimers = false;
    if (plugin && originalGetCategorizedVariables) {
      try { plugin.variableProcessor.getCategorizedVariables = originalGetCategorizedVariables; }
      catch (error) { notes.push({ label: "restore-variables", message: String(error) }); }
    }
    if (restoreClipboard) {
      try { restoreClipboard(); }
      catch (error) { notes.push({ label: "restore-clipboard", message: String(error) }); }
    }
    try { await closeAvailableVariablesModals(); }
    catch (error) { notes.push({ label: "final-close", message: String(error) }); }
    EventTarget.prototype.addEventListener = originalAddEventListener;
    EventTarget.prototype.removeEventListener = originalRemoveEventListener;
    window.setTimeout = originalSetTimeout;
    window.clearTimeout = originalClearTimeout;
    if (!originallyLoaded && app.plugins.plugins[id]) {
      try { await app.plugins.disablePlugin(id); }
      catch (error) { notes.push({ label: "restore-disable", message: String(error) }); }
    }
  }

  metrics.runtimeErrors = fatalError ? 1 : 0;
  const targetFailures = [];
  for (const [metricName, spec] of Object.entries(config.targetSpecs)) {
    if (!metricPass(metrics[metricName], spec)) {
      targetFailures.push({
        label: `target:${metricName}`,
        message: `${metricName} ${metrics[metricName]} must be ${spec.comparator} ${spec.target}`,
      });
    }
  }
  errors.push(...targetFailures);

  const trackedSummary = [...trackedTargets.entries()].map(([target, entry]) => ({
    label: entry.label,
    connected: Boolean(target?.isConnected),
    listeners: [...entry.listeners.entries()].map(([type, listenersForType]) => ({ type, count: listenersForType.size })),
  })).filter((entry) => entry.listeners.some((listenerEntry) => listenerEntry.count > 0)).slice(0, 50);

  const report = {
    check: CHECK_NAME,
    runId: config.runId,
    label: config.label,
    generatedAt: new Date().toISOString(),
    vault: app.vault.getName?.() ?? null,
    plugin: { id, version: manifest.version, dir: manifest.dir, originallyLoaded },
    fixture: { dir: fixtureDir, note: fixtureNotePath },
    config,
    targets: config.targetSpecs,
    metrics,
    details: {
      searchDurations,
      trackedSummary,
    },
    summary: {
      pass: errors.length === 0,
      errorCount: errors.length,
      errors: errors.slice(0, 50),
      notes: notes.slice(0, 50),
    },
  };

  await ensureFolder("_pi/p95");
  await adapter.write(config.reportPath, JSON.stringify(report, null, 2));

  if (config.historyPath) {
    const historyLine = JSON.stringify({
      runId: report.runId,
      label: report.label,
      generatedAt: report.generatedAt,
      pass: report.summary.pass,
      metrics: report.metrics,
      errorCount: report.summary.errorCount,
    });
    const existingHistory = await adapter.exists(config.historyPath) ? await adapter.read(config.historyPath) : "";
    await adapter.write(config.historyPath, `${existingHistory}${historyLine}\n`);
  }

  return JSON.stringify({ reportPath: config.reportPath, summary: report.summary, metrics: report.metrics });
}

function formatValue(value, suffix = "") {
  if (value == null || Number.isNaN(value) || value === Number.POSITIVE_INFINITY) return "-";
  if (typeof value === "number") return `${value}${suffix}`;
  return String(value);
}

function formatDelta(previous, current, suffix = "") {
  if (previous == null || current == null || Number.isNaN(previous) || Number.isNaN(current)) return "-";
  const delta = Math.round((current - previous) * 100) / 100;
  const sign = delta > 0 ? "+" : "";
  return `${sign}${delta}${suffix}`;
}

function metricPass(value, spec) {
  if (typeof value !== "number" || !Number.isFinite(value)) return false;
  if (spec.comparator === "<=") return value <= spec.target;
  if (spec.comparator === ">=") return value >= spec.target;
  throw new Error(`Unsupported comparator: ${spec.comparator}`);
}

function printMetricRow(name, previous, current, spec) {
  const suffix = spec.suffix ?? "";
  const targetText = `${spec.comparator} ${spec.target}${suffix}`;
  const status = metricPass(current, spec) ? "PASS" : "FAIL";
  console.log(`${name.padEnd(45)} ${formatValue(previous, suffix).padStart(12)} ${formatValue(current, suffix).padStart(12)} ${formatDelta(previous, current, suffix).padStart(12)} ${targetText.padStart(14)} ${status}`);
}

function printSummary(currentReport, previousReport) {
  const current = currentReport.metrics;
  const previous = previousReport?.metrics ?? null;

  console.log(`\nP95 ${CHECK_NAME}: ${currentReport.summary.pass ? "PASS" : "FAIL"}`);
  console.log("\nMetric                                         previous      current        delta         target status");
  console.log("----------------------------------------------------------------------------------------------------");
  for (const [metricName, spec] of Object.entries(currentReport.targets)) {
    printMetricRow(spec.label, previous?.[metricName], current[metricName], spec);
  }

  if (currentReport.summary.errorCount) {
    console.log(`\nErrors (${currentReport.summary.errorCount}): ${JSON.stringify(currentReport.summary.errors, null, 2)}`);
  }
  if (currentReport.summary.notes?.length) {
    console.log(`\nNotes: ${JSON.stringify(currentReport.summary.notes, null, 2)}`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const previousReport = await readJsonIfExists(args.reportFile);
  const injected = `const CHECK_NAME = ${JSON.stringify(CHECK_NAME)};\n(${measureAvailableVariablesModalInObsidian.toString()})(${JSON.stringify(args)})`;

  console.log(`Running P95 ${CHECK_NAME}: vault=${args.vault}, plugin=${args.id}`);
  if (args.reloadBefore) {
    console.log("Reloading vault before measurement to clear stale runtime state...");
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
