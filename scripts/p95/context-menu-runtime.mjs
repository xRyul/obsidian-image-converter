#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const CHECK_NAME = "context-menu-runtime";

const TARGET_SPECS = {
  mainMenuOpened: { label: "main-window menu opens", comparator: ">=", target: 1, suffix: "" },
  popoutMenuOpened: { label: "popout-window menu opens", comparator: ">=", target: 1, suffix: "" },
  maxOpenMenus: { label: "max menus after repeated opens", comparator: "<=", target: 1, suffix: "" },
  p95EscPresses: { label: "p95 Escape presses to close", comparator: "<=", target: 1, suffix: "" },
  p95HideMs: { label: "p95 Escape hide latency", comparator: "<=", target: 250, suffix: "ms" },
  contextMenuDomEventsPerOpen: { label: "ContextMenu DOM events/open", comparator: "<=", target: 0, suffix: "" },
  contextMenuDomEventsPerCopyAction: { label: "ContextMenu DOM events/copy", comparator: "<=", target: 0, suffix: "" },
  copySyncErrors: { label: "copy action sync errors", comparator: "<=", target: 0, suffix: "" },
};

function parseArgs(argv) {
  const args = {
    vault: "plugin-testing-vault",
    id: "image-converter",
    trials: 6,
    opensPerTrial: 8,
    openWaitMs: 70,
    escapeWaitMs: 150,
    maxEscapes: null,
    reportPath: `_pi/p95/${CHECK_NAME}.current.json`,
    historyPath: `_pi/p95/${CHECK_NAME}.history.jsonl`,
    reportFile: null,
    label: "current",
    noFail: false,
    reloadBefore: true,
    reloadWaitMs: 3000,
  };

  const targetByFlag = {
    "--target-main-menu-opened": "mainMenuOpened",
    "--target-popout-menu-opened": "popoutMenuOpened",
    "--target-max-open-menus": "maxOpenMenus",
    "--target-p95-escape-presses": "p95EscPresses",
    "--target-p95-hide-ms": "p95HideMs",
    "--target-context-menu-dom-events-per-open": "contextMenuDomEventsPerOpen",
    "--target-context-menu-dom-events-per-copy-action": "contextMenuDomEventsPerCopyAction",
    "--target-copy-sync-errors": "copySyncErrors",
  };

  const targetSpecs = structuredClone(TARGET_SPECS);

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
    else if (arg === "--report-path") args.reportPath = readValue();
    else if (arg === "--history-path") args.historyPath = readValue();
    else if (arg === "--report-file") args.reportFile = readValue();
    else if (arg === "--label") args.label = readValue();
    else if (arg === "--no-fail") args.noFail = true;
    else if (arg === "--no-reload") args.reloadBefore = false;
    else if (arg === "--reload-wait-ms") args.reloadWaitMs = Number(readValue());
    else if (Object.hasOwn(targetByFlag, arg)) targetSpecs[targetByFlag[arg]].target = Number(readValue());
    else if (arg === "--help" || arg === "-h") {
      console.log(`Usage: node scripts/p95/${CHECK_NAME}.mjs [options]\n\nOptions:\n  --vault <name>                                      Obsidian vault name (default: plugin-testing-vault)\n  --id <plugin-id>                                    Plugin id (default: image-converter)\n  --trials <n>                                        Independent repeated-open trials (default: 6)\n  --opens-per-trial <n>                               Context-menu opens per trial (default: 8)\n  --open-wait-ms <n>                                  Wait after each open (default: 70)\n  --escape-wait-ms <n>                                Wait budget for each Escape close (default: 150)\n  --max-escapes <n>                                   Safety cap for Escape presses (default: opens-per-trial + 5)\n  --target-main-menu-opened <n>                       Minimum main-window open count target (default: 1)\n  --target-popout-menu-opened <n>                     Minimum popout-window open count target (default: 1)\n  --target-max-open-menus <n>                         Maximum simultaneous menu target (default: 1)\n  --target-p95-escape-presses <n>                     Maximum p95 Escape presses target (default: 1)\n  --target-p95-hide-ms <n>                            Maximum p95 hide latency target (default: 250)\n  --target-context-menu-dom-events-per-open <n>       Maximum long-lived ContextMenu DOM events/open (default: 0)\n  --target-context-menu-dom-events-per-copy-action <n> Maximum long-lived ContextMenu DOM events/copy action (default: 0)\n  --target-copy-sync-errors <n>                       Maximum synchronous copy action errors (default: 0)\n  --report-path <path>                                Vault-relative current report path\n  --history-path <path>                               Vault-relative JSONL history path\n  --report-file <path>                                Filesystem path to read the current report from\n  --label <name>                                      Label stored in the report (default: current)\n  --no-fail                                           Print FAIL metrics but exit 0; useful for baselines\n  --no-reload                                         Do not reload the vault before measuring\n  --reload-wait-ms <n>                                Wait after vault reload before eval (default: 3000)\n`);
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
  })) {
    if (!Number.isFinite(value) || value < 0) throw new Error(`--${key} must be a non-negative number`);
  }
  if (args.trials < 1) throw new Error("--trials must be at least 1");
  if (args.opensPerTrial < 1) throw new Error("--opens-per-trial must be at least 1");

  for (const [key, spec] of Object.entries(targetSpecs)) {
    if (!Number.isFinite(spec.target)) throw new Error(`Invalid target for ${key}`);
  }

  args.maxEscapes ??= args.opensPerTrial + 5;
  if (!Number.isFinite(args.maxEscapes) || args.maxEscapes < 1) throw new Error("--max-escapes must be at least 1");

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
async function measureContextMenuRuntimeInObsidian(config) {
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
  const metricPass = (value, spec) => {
    if (typeof value !== "number" || !Number.isFinite(value)) return false;
    if (spec.comparator === "<=") return value <= spec.target;
    if (spec.comparator === ">=") return value >= spec.target;
    throw new Error(`Unsupported comparator: ${spec.comparator}`);
  };

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
  const notes = [];
  const trials = [];
  const allEscapePressCounts = [];
  const allHideDurationsMs = [];
  const documents = new Set();
  const fixtureDir = `_pi/p95/${CHECK_NAME}`;
  const fixtureImagePath = `${fixtureDir}/fixture.png`;
  const fixtureNotePath = `${fixtureDir}/fixture.md`;

  const registerCounts = {
    menuOpen: 0,
    copyAction: 0,
  };
  const registerPhaseAttempts = {
    menuOpen: 0,
    copyAction: 0,
  };
  let registerPhase = null;
  let originalContextMenuRegisterDomEvent = null;

  const pngBuffer = Uint8Array.from(
    atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII="),
    (char) => char.charCodeAt(0)
  ).buffer;
  const dataUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";

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
  const ensureBinary = async (filePath, buffer) => {
    let file = app.vault.getAbstractFileByPath(filePath);
    if (!file) file = await app.vault.createBinary(filePath, buffer);
    else await app.vault.modifyBinary(file, buffer);
    return file;
  };
  const addDocument = (doc) => {
    if (doc?.body) documents.add(doc);
  };
  const collectDocuments = () => {
    try { addDocument(activeDocument); } catch {}
    try { addDocument(app.workspace.containerEl?.ownerDocument); } catch {}
    try {
      app.workspace.iterateAllLeaves?.((leaf) => {
        addDocument(leaf?.view?.containerEl?.ownerDocument);
        addDocument(leaf?.containerEl?.ownerDocument);
      });
    } catch (error) {
      notes.push({ label: "collect-documents", message: String(error) });
    }
    return [...documents];
  };
  const countMenusInDocument = (doc) =>
    [...doc.querySelectorAll(".menu")].filter((menu) => !menu.parentElement?.closest(".menu")).length;
  const countMenus = (docs = collectDocuments()) => docs.reduce((sum, doc) => sum + countMenusInDocument(doc), 0);
  const getImageFromLeaf = (leaf, fallbackDoc) =>
    leaf?.view?.containerEl?.querySelector?.(".image-embed img, .markdown-preview-view img, .markdown-source-view img, img")
    ?? fallbackDoc?.querySelector?.(".image-embed img, .markdown-preview-view img, .markdown-source-view img, img")
    ?? null;
  const waitFor = async (predicate, timeoutMs, intervalMs = 20) => {
    const startedAt = performance.now();
    while (performance.now() - startedAt < timeoutMs) {
      if (predicate()) return true;
      await wait(intervalMs);
    }
    return predicate();
  };
  const waitForImage = async (leaf, doc, timeoutMs = 4000) => {
    let image = getImageFromLeaf(leaf, doc);
    await waitFor(() => {
      image = getImageFromLeaf(leaf, doc);
      return Boolean(image);
    }, timeoutMs);
    return image;
  };
  const dispatchEscape = (doc) => {
    const win = doc.defaultView ?? activeWindow;
    const eventInit = { key: "Escape", code: "Escape", keyCode: 27, which: 27, bubbles: true, cancelable: true };
    const target = doc.activeElement instanceof win.Element ? doc.activeElement : doc.body;
    target.dispatchEvent(new win.KeyboardEvent("keydown", eventInit));
    target.dispatchEvent(new win.KeyboardEvent("keyup", eventInit));
    doc.dispatchEvent(new win.KeyboardEvent("keydown", eventInit));
    doc.dispatchEvent(new win.KeyboardEvent("keyup", eventInit));
  };
  const openMenuOnImage = async (image) => {
    const doc = image.ownerDocument;
    const win = doc.defaultView ?? activeWindow;
    addDocument(doc);
    const event = new win.MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      button: 2,
      buttons: 2,
      clientX: 120,
      clientY: 100,
      view: win,
    });
    image.dispatchEvent(event);
    await wait(config.openWaitMs);
  };
  const closeMenusWithEscape = async (maxEscapes) => {
    const hideDurationsMs = [];
    let presses = 0;

    while (countMenus() > 0 && presses < maxEscapes) {
      const beforeCount = countMenus();
      const startedAt = performance.now();
      for (const doc of collectDocuments()) dispatchEscape(doc);
      presses += 1;
      await waitFor(() => countMenus() < beforeCount, config.escapeWaitMs);
      if (countMenus() < beforeCount) hideDurationsMs.push(round(performance.now() - startedAt));
      await wait(20);
    }

    return { presses, hideDurationsMs, remainingMenus: countMenus() };
  };
  const withRegisterPhase = async (phase, callback) => {
    if (Object.hasOwn(registerPhaseAttempts, phase)) registerPhaseAttempts[phase] += 1;
    registerPhase = phase;
    try { return await callback(); }
    finally { registerPhase = null; }
  };
  const runCopyActionChecks = async (contextMenu, doc) => {
    let syncErrors = 0;
    const testImage = doc.createElement("img");
    testImage.src = dataUrl;
    doc.body.appendChild(testImage);
    try {
      await withRegisterPhase("copyAction", async () => {
        try { await contextMenu.copyImageToClipboard?.({ target: testImage }); }
        catch (error) { syncErrors += 1; errors.push({ label: "copy-image-sync", message: String(error) }); }
      });
      await withRegisterPhase("copyAction", async () => {
        try { await contextMenu.copyImageAsBase64?.({ target: testImage }); }
        catch (error) { syncErrors += 1; errors.push({ label: "copy-base64-sync", message: String(error) }); }
      });
      await wait(250);
    } finally {
      testImage.remove();
    }
    return syncErrors;
  };

  let fatalError = null;
  let mainMenuOpened = 0;
  let popoutMenuOpened = 0;
  let copySyncErrors = 0;
  let popoutAttempted = false;
  let popoutLeaf = null;

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

    await ensureFolder(fixtureDir);
    await ensureBinary(fixtureImagePath, pngBuffer);
    const file = await ensureFile(
      fixtureNotePath,
      `# P95 ${CHECK_NAME}\n\n![[fixture.png|120]]\n`
    );

    await app.plugins.enablePlugin(id);
    await wait(500);

    const pluginInstance = app.plugins.plugins[id];
    const contextMenu = pluginInstance?.contextMenu;
    if (!contextMenu) throw new Error("Plugin did not expose contextMenu after enablePlugin");

    originalContextMenuRegisterDomEvent = contextMenu.registerDomEvent;
    contextMenu.registerDomEvent = function patchedContextMenuRegisterDomEvent(...args) {
      if (registerPhase && Object.hasOwn(registerCounts, registerPhase)) registerCounts[registerPhase] += 1;
      return originalContextMenuRegisterDomEvent.apply(this, args);
    };

    const mainLeaf = app.workspace.getLeaf(true);
    await mainLeaf.openFile(file);
    await mainLeaf.loadIfDeferred?.();
    try { app.workspace.setActiveLeaf?.(mainLeaf, { focus: true }); } catch {}
    await wait(900);
    try { app.workspace.trigger?.("file-open", file); } catch (error) { notes.push({ label: "trigger:file-open", message: String(error) }); }
    try { app.workspace.trigger?.("layout-change"); } catch (error) { notes.push({ label: "trigger:layout-change", message: String(error) }); }
    await wait(300);

    const mainDoc = mainLeaf.view?.containerEl?.ownerDocument ?? activeDocument;
    addDocument(mainDoc);
    const mainImage = await waitForImage(mainLeaf, mainDoc);
    if (!mainImage) throw new Error("No image found in main markdown view");

    await closeMenusWithEscape(Math.max(config.maxEscapes, config.opensPerTrial + 10));
    await withRegisterPhase("menuOpen", () => openMenuOnImage(mainImage));
    mainMenuOpened = countMenus() > 0 ? 1 : 0;
    await closeMenusWithEscape(config.maxEscapes);

    for (let trialIndex = 0; trialIndex < config.trials; trialIndex += 1) {
      const cleanupBefore = await closeMenusWithEscape(config.maxEscapes);
      if (cleanupBefore.remainingMenus > 0) {
        errors.push({ label: `trial:${trialIndex}:cleanup-before`, message: `menus remained before trial: ${cleanupBefore.remainingMenus}` });
      }

      const menuCountsAfterOpen = [];
      for (let openIndex = 0; openIndex < config.opensPerTrial; openIndex += 1) {
        await withRegisterPhase("menuOpen", () => openMenuOnImage(mainImage));
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

    copySyncErrors = await runCopyActionChecks(contextMenu, mainDoc);

    if (typeof app.workspace.openPopoutLeaf === "function") {
      popoutAttempted = true;
      try {
        popoutLeaf = app.workspace.openPopoutLeaf();
        await wait(700);
        await popoutLeaf.openFile(file);
        await popoutLeaf.loadIfDeferred?.();
        try { app.workspace.setActiveLeaf?.(popoutLeaf, { focus: true }); } catch {}
        await wait(1300);
        const popoutDoc = popoutLeaf.view?.containerEl?.ownerDocument;
        if (!popoutDoc || popoutDoc === mainDoc) {
          throw new Error("openPopoutLeaf did not expose a separate ownerDocument");
        }
        addDocument(popoutDoc);
        const popoutImage = await waitForImage(popoutLeaf, popoutDoc, 6000);
        if (!popoutImage) throw new Error("No image found in popout markdown view");
        await closeMenusWithEscape(config.maxEscapes);
        await withRegisterPhase("menuOpen", () => openMenuOnImage(popoutImage));
        popoutMenuOpened = countMenusInDocument(popoutDoc) > 0 ? 1 : 0;
        await closeMenusWithEscape(config.maxEscapes);
      } catch (error) {
        errors.push({ label: "popout", message: String(error?.stack ?? error) });
      }
    } else {
      errors.push({ label: "popout", message: "app.workspace.openPopoutLeaf is not available" });
    }
  } catch (error) {
    fatalError = String(error?.stack ?? error);
    errors.push({ label: "fatal", message: fatalError });
  } finally {
    await closeMenusWithEscape(Math.max(config.maxEscapes, config.opensPerTrial + 10));

    if (popoutLeaf?.detach) {
      try { popoutLeaf.detach(); }
      catch (error) { notes.push({ label: "popout-detach", message: String(error) }); }
    }

    const pluginInstance = app.plugins.plugins[id];
    if (pluginInstance?.contextMenu && originalContextMenuRegisterDomEvent) {
      try { pluginInstance.contextMenu.registerDomEvent = originalContextMenuRegisterDomEvent; }
      catch {}
    }

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
  const contextMenuDomEventsPerOpen = registerPhaseAttempts.menuOpen > 0 ? round(registerCounts.menuOpen / registerPhaseAttempts.menuOpen) : registerCounts.menuOpen;
  const contextMenuDomEventsPerCopyAction = registerPhaseAttempts.copyAction > 0 ? round(registerCounts.copyAction / registerPhaseAttempts.copyAction) : registerCounts.copyAction;
  const metrics = {
    mainMenuOpened,
    popoutMenuOpened,
    maxOpenMenus,
    p95EscPresses: escPressStats.p95,
    p95HideMs: hideMsStats.p95,
    contextMenuDomEventsPerOpen,
    contextMenuDomEventsPerCopyAction,
    copySyncErrors,
  };

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

  const report = {
    check: CHECK_NAME,
    runId: config.runId,
    label: config.label,
    generatedAt: new Date().toISOString(),
    vault: app.vault.getName?.() ?? null,
    plugin: { id, version: manifest.version, dir: manifest.dir, originallyLoaded },
    fixture: { dir: fixtureDir, note: fixtureNotePath, image: fixtureImagePath },
    config,
    targets: config.targetSpecs,
    metrics,
    summary: {
      pass: errors.length === 0,
      errorCount: errors.length,
      errors: errors.slice(0, 50),
      notes: notes.slice(0, 50),
      trialCount: trials.length,
      opensPerTrial: config.opensPerTrial,
      popoutAttempted,
      registerPhaseAttempts,
      rawRegisterCounts: registerCounts,
      maxOpenMenus,
      escPressesToClose: escPressStats,
      escapeHideMs: hideMsStats,
      fatalError,
    },
    trials,
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
  if (value == null || Number.isNaN(value)) return "-";
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
  console.log(`${name.padEnd(38)} ${formatValue(previous, suffix).padStart(12)} ${formatValue(current, suffix).padStart(12)} ${formatDelta(previous, current, suffix).padStart(12)} ${targetText.padStart(14)} ${status}`);
}

function printSummary(currentReport, previousReport) {
  const current = currentReport.metrics;
  const previous = previousReport?.metrics ?? null;

  console.log(`\nP95 ${CHECK_NAME}: ${currentReport.summary.pass ? "PASS" : "FAIL"}`);
  console.log(`Trials: ${currentReport.summary.trialCount}, opens/trial: ${currentReport.summary.opensPerTrial}`);
  console.log("\nMetric                                  previous      current        delta         target status");
  console.log("---------------------------------------------------------------------------------------------");
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
  const injected = `const CHECK_NAME = ${JSON.stringify(CHECK_NAME)};\n(${measureContextMenuRuntimeInObsidian.toString()})(${JSON.stringify(args)})`;

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
