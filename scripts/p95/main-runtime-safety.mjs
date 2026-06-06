#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const CHECK_NAME = "main-runtime-safety";

const TARGET_SPECS = {
  syntheticActiveDocClassApplied: { label: "activeDocument body class applied", comparator: ">=", target: 1, suffix: "" },
  globalDocMutationsDuringActiveDocApply: { label: "inactive global document mutations", comparator: "<=", target: 0, suffix: "" },
  activeDocClassesRemovedOnUnload: { label: "activeDocument classes removed on unload", comparator: ">=", target: 1, suffix: "" },
  contextMenuRefsRetainedAfterUnload: { label: "ContextMenu refs retained after unload", comparator: "<=", target: 0, suffix: "" },
  resizerScrollTimersRetainedAfterUnload: { label: "ImageResizer scroll timers retained", comparator: "<=", target: 0, suffix: "" },
  modalRefsRetainedAfterUnload: { label: "modal refs retained after unload", comparator: "<=", target: 0, suffix: "" },
  extraModalCloseCallsOnUnload: { label: "extra modal close calls on unload", comparator: "<=", target: 0, suffix: "" },
  captionManagerRefsRetainedAfterUnload: { label: "caption manager refs retained", comparator: "<=", target: 0, suffix: "" },
  captionCleanupCallsOnUnload: { label: "caption cleanup calls on unload", comparator: ">=", target: 1, suffix: "" },
  dropDefaultPreventedHandleCalls: { label: "handled already-prevented drops", comparator: "<=", target: 0, suffix: "" },
  dropDefaultPreventedPreventCalls: { label: "preventDefault on prevented drops", comparator: "<=", target: 0, suffix: "" },
  pasteDefaultPreventedHandleCalls: { label: "handled already-prevented pastes", comparator: "<=", target: 0, suffix: "" },
  pasteDefaultPreventedPreventCalls: { label: "preventDefault on prevented pastes", comparator: "<=", target: 0, suffix: "" },
  reloadCommandCompletes: { label: "reload command completes", comparator: ">=", target: 1, suffix: "" },
  reloadCommandPluginLoadedAfter: { label: "plugin loaded after reload command", comparator: ">=", target: 1, suffix: "" },
  reloadCommandElapsedMs: { label: "reload command elapsed", comparator: "<=", target: 5000, suffix: "ms" },
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
    enableWaitMs: 900,
    eventWaitMs: 150,
  };

  const targetByFlag = {
    "--target-synthetic-active-doc-class-applied": "syntheticActiveDocClassApplied",
    "--target-global-doc-mutations-during-active-doc-apply": "globalDocMutationsDuringActiveDocApply",
    "--target-active-doc-classes-removed-on-unload": "activeDocClassesRemovedOnUnload",
    "--target-context-menu-refs-retained-after-unload": "contextMenuRefsRetainedAfterUnload",
    "--target-resizer-scroll-timers-retained-after-unload": "resizerScrollTimersRetainedAfterUnload",
    "--target-modal-refs-retained-after-unload": "modalRefsRetainedAfterUnload",
    "--target-extra-modal-close-calls-on-unload": "extraModalCloseCallsOnUnload",
    "--target-caption-manager-refs-retained-after-unload": "captionManagerRefsRetainedAfterUnload",
    "--target-caption-cleanup-calls-on-unload": "captionCleanupCallsOnUnload",
    "--target-drop-default-prevented-handle-calls": "dropDefaultPreventedHandleCalls",
    "--target-drop-default-prevented-prevent-calls": "dropDefaultPreventedPreventCalls",
    "--target-paste-default-prevented-handle-calls": "pasteDefaultPreventedHandleCalls",
    "--target-paste-default-prevented-prevent-calls": "pasteDefaultPreventedPreventCalls",
    "--target-reload-command-completes": "reloadCommandCompletes",
    "--target-reload-command-plugin-loaded-after": "reloadCommandPluginLoadedAfter",
    "--target-reload-command-elapsed-ms": "reloadCommandElapsedMs",
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
    else if (arg === "--enable-wait-ms") args.enableWaitMs = Number(readValue());
    else if (arg === "--event-wait-ms") args.eventWaitMs = Number(readValue());
    else if (Object.hasOwn(targetByFlag, arg)) targetSpecs[targetByFlag[arg]].target = Number(readValue());
    else if (arg === "--help" || arg === "-h") {
      console.log(`Usage: node scripts/p95/${CHECK_NAME}.mjs [options]\n\nOptions:\n  --vault <name>                                      Obsidian vault name (default: plugin-testing-vault)\n  --id <plugin-id>                                    Plugin id (default: image-converter)\n  --report-path <path>                                Vault-relative current report path\n  --history-path <path>                               Vault-relative JSONL history path\n  --report-file <path>                                Filesystem path to read the current report from\n  --label <name>                                      Label stored in report (default: current)\n  --no-fail                                           Exit 0 even if metrics miss targets; for known-bad baselines\n  --no-reload                                         Do not reload the vault before measuring\n  --reload-wait-ms <n>                                Wait after vault reload (default: 3000)\n  --enable-wait-ms <n>                                Wait after plugin enable (default: 900)\n  --event-wait-ms <n>                                 Wait after runtime event probes (default: 150)\n  --target-* <n>                                      Override any target metric\n`);
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  for (const [key, value] of Object.entries({
    reloadWaitMs: args.reloadWaitMs,
    enableWaitMs: args.enableWaitMs,
    eventWaitMs: args.eventWaitMs,
  })) {
    if (!Number.isFinite(value) || value < 0) throw new Error(`--${key} must be a non-negative number`);
  }

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
async function measureMainRuntimeSafetyInObsidian(config) {
  const id = config.id;
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const round = (value) => Math.round(value * 100) / 100;
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
  const fixtureDir = `_pi/p95/${CHECK_NAME}`;
  const fixtureImagePath = `${fixtureDir}/fixture.png`;
  const fixtureNotePath = `${fixtureDir}/fixture.md`;
  const bodyStateClass = "image-converter-disable-native-image-selection";
  const captionBodyClass = "image-captions-enabled";
  const modalProperties = [
    "processSingleImageModal",
    "processFolderModal",
    "processCurrentNote",
    "processAllVaultModal",
  ];

  const metrics = {
    syntheticActiveDocClassApplied: 0,
    globalDocMutationsDuringActiveDocApply: Number.POSITIVE_INFINITY,
    activeDocClassesRemovedOnUnload: 0,
    contextMenuRefsRetainedAfterUnload: Number.POSITIVE_INFINITY,
    resizerScrollTimersRetainedAfterUnload: Number.POSITIVE_INFINITY,
    modalRefsRetainedAfterUnload: Number.POSITIVE_INFINITY,
    extraModalCloseCallsOnUnload: Number.POSITIVE_INFINITY,
    captionManagerRefsRetainedAfterUnload: Number.POSITIVE_INFINITY,
    captionCleanupCallsOnUnload: 0,
    dropDefaultPreventedHandleCalls: Number.POSITIVE_INFINITY,
    dropDefaultPreventedPreventCalls: Number.POSITIVE_INFINITY,
    pasteDefaultPreventedHandleCalls: Number.POSITIVE_INFINITY,
    pasteDefaultPreventedPreventCalls: Number.POSITIVE_INFINITY,
    reloadCommandCompletes: 0,
    reloadCommandPluginLoadedAfter: 0,
    reloadCommandElapsedMs: Number.POSITIVE_INFINITY,
    runtimeErrors: 0,
  };

  const errors = [];
  const notes = [];
  let syntheticActiveDoc = null;
  let originalGlobalActiveDocument = globalThis.activeDocument;
  let originalWindowActiveDocument = window.activeDocument;
  let canOverrideActiveDocument = false;
  let mainLeaf = null;

  const pngBuffer = Uint8Array.from(
    atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII="),
    (char) => char.charCodeAt(0)
  ).buffer;

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
  const forceImageMetrics = (image, width = 120, height = 90) => {
    Object.defineProperty(image, "naturalWidth", { configurable: true, value: width });
    Object.defineProperty(image, "naturalHeight", { configurable: true, value: height });
    Object.defineProperty(image, "width", { configurable: true, value: width });
    Object.defineProperty(image, "height", { configurable: true, value: height });
    image.style.width = `${width}px`;
    image.style.height = `${height}px`;
    image.getBoundingClientRect = () => ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: width,
      bottom: height,
      width,
      height,
      toJSON: () => ({}),
    });
  };
  const createDomImageFixture = (leaf) => {
    const containerEl = leaf?.view?.containerEl;
    if (!containerEl) throw new Error("Cannot create DOM fixture without a Markdown leaf container");
    const doc = containerEl.ownerDocument;
    const host = doc.createElement("div");
    host.className = "p95-main-runtime-fixture markdown-source-view";
    host.setAttribute("data-p95-main-runtime-fixture", "true");
    const embed = doc.createElement("div");
    embed.className = "internal-embed image-embed";
    const image = doc.createElement("img");
    image.setAttribute("src", "app://vault/p95-main-runtime-fixture.png");
    image.setAttribute("alt", "p95 main runtime fixture");
    embed.appendChild(image);
    host.appendChild(embed);
    containerEl.appendChild(host);
    forceImageMetrics(image);
    return image;
  };
  const removeDomFixtures = (doc) => {
    for (const fixture of [...(doc?.querySelectorAll?.("[data-p95-main-runtime-fixture]") ?? [])]) {
      fixture.remove();
    }
  };
  const setActiveDocumentOverride = (doc) => {
    syntheticActiveDoc = doc;
    try {
      globalThis.activeDocument = doc;
      window.activeDocument = doc;
      canOverrideActiveDocument = globalThis.activeDocument === doc || window.activeDocument === doc;
    } catch (error) {
      notes.push({ label: "activeDocument-override", message: String(error) });
    }
  };
  const restoreActiveDocument = () => {
    try { globalThis.activeDocument = originalGlobalActiveDocument; }
    catch (error) { notes.push({ label: "restore-global-activeDocument", message: String(error) }); }
    try { window.activeDocument = originalWindowActiveDocument; }
    catch (error) { notes.push({ label: "restore-window-activeDocument", message: String(error) }); }
  };
  const countBodyClasses = (doc) => Number(Boolean(doc?.body?.classList?.contains(bodyStateClass)))
    + Number(Boolean(doc?.body?.classList?.contains(captionBodyClass)));
  const getReloadCommandId = () => {
    const commands = app.commands?.commands ?? {};
    return Object.keys(commands).find((commandId) => (
      commandId === `${id}:reload-plugin`
      || commandId.endsWith(":reload-plugin")
      || commandId === "reload-plugin"
    ));
  };

  try {
    if (app.plugins.plugins[id]) {
      await app.plugins.disablePlugin(id);
      await wait(250);
    }

    await adapter.write(dataPath, JSON.stringify({
      enableContextMenu: true,
      isImageAlignmentEnabled: false,
      isImageResizeEnbaled: true,
      isDragResizeEnabled: true,
      isScrollResizeEnabled: true,
      isResizeInReadingModeEnabled: true,
      isDragAspectRatioLocked: true,
      enableImageCaptions: true,
      disableObsidianImageSelectionOnClick: true,
      resizeSensitivity: 0.2,
      scrollwheelModifier: "None",
      modalBehavior: "never",
      outputFormat: "NONE",
    }, null, 2));

    await ensureFolder(fixtureDir);
    await ensureBinary(fixtureImagePath, pngBuffer);
    const file = await ensureFile(
      fixtureNotePath,
      `# P95 ${CHECK_NAME}\n\n![[fixture.png|120x90]]\n`
    );

    await app.plugins.enablePlugin(id);
    await wait(config.enableWaitMs);

    let pluginInstance = app.plugins.plugins[id];
    if (!pluginInstance) throw new Error("Plugin did not load after enablePlugin");

    syntheticActiveDoc = document.implementation.createHTMLDocument("p95-active-document");
    syntheticActiveDoc.body.classList.remove(bodyStateClass, captionBodyClass);
    document.body.classList.remove(bodyStateClass, captionBodyClass);
    setActiveDocumentOverride(syntheticActiveDoc);
    if (!canOverrideActiveDocument) {
      notes.push({ label: "activeDocument-override", message: "Could not verify activeDocument override; active-document metrics may fail conservatively" });
    }

    pluginInstance.settings.disableObsidianImageSelectionOnClick = true;
    await pluginInstance.saveSettings();
    metrics.syntheticActiveDocClassApplied = syntheticActiveDoc.body.classList.contains(bodyStateClass) ? 1 : 0;
    metrics.globalDocMutationsDuringActiveDocApply = document.body.classList.contains(bodyStateClass) ? 1 : 0;

    mainLeaf = app.workspace.getLeaf(true);
    await mainLeaf.openFile(file);
    await mainLeaf.loadIfDeferred?.();
    try { app.workspace.setActiveLeaf?.(mainLeaf, { focus: true }); } catch {}
    try { app.workspace.trigger?.("file-open", file); } catch (error) { notes.push({ label: "trigger:file-open", message: String(error) }); }
    try { app.workspace.trigger?.("active-leaf-change", mainLeaf); } catch (error) { notes.push({ label: "trigger:active-leaf-change", message: String(error) }); }
    try { app.workspace.trigger?.("layout-change"); } catch (error) { notes.push({ label: "trigger:layout-change", message: String(error) }); }
    await wait(config.eventWaitMs);

    const resizerBeforeUnload = pluginInstance.imageResizer;
    if (resizerBeforeUnload && typeof resizerBeforeUnload.attachView === "function" && mainLeaf?.view) {
      resizerBeforeUnload.attachView(mainLeaf.view);
      const image = createDomImageFixture(mainLeaf);
      const doc = image.ownerDocument;
      const win = doc.defaultView ?? activeWindow;
      image.dispatchEvent(new win.WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        deltaY: -60,
        clientX: 20,
        clientY: 20,
        view: win,
      }));
      await wait(25);
    } else {
      notes.push({ label: "resizer", message: "ImageResizer not available; timer retention metric will fail conservatively" });
    }

    let modalCloseCalls = 0;
    for (const propertyName of modalProperties) {
      pluginInstance[propertyName] = { close: () => { modalCloseCalls += 1; } };
    }

    let captionCleanupCalls = 0;
    if (pluginInstance.captionManager?.cleanup) {
      const originalCleanup = pluginInstance.captionManager.cleanup.bind(pluginInstance.captionManager);
      pluginInstance.captionManager.cleanup = (...args) => {
        captionCleanupCalls += 1;
        return originalCleanup(...args);
      };
    } else {
      notes.push({ label: "captionManager", message: "Caption manager not available before unload" });
    }

    syntheticActiveDoc.body.classList.add(bodyStateClass, captionBodyClass);
    const beforeUnloadPluginRef = pluginInstance;
    await app.plugins.disablePlugin(id);
    await wait(config.eventWaitMs);

    metrics.activeDocClassesRemovedOnUnload = countBodyClasses(syntheticActiveDoc) === 0 ? 1 : 0;
    metrics.contextMenuRefsRetainedAfterUnload = beforeUnloadPluginRef.contextMenu ? 1 : 0;
    metrics.resizerScrollTimersRetainedAfterUnload = resizerBeforeUnload?.scrollTimeout ? 1 : 0;
    metrics.modalRefsRetainedAfterUnload = modalProperties.reduce((count, propertyName) => count + (beforeUnloadPluginRef[propertyName] ? 1 : 0), 0);
    metrics.extraModalCloseCallsOnUnload = Math.max(0, modalCloseCalls - modalProperties.length);
    metrics.captionCleanupCallsOnUnload = captionCleanupCalls;
    metrics.captionManagerRefsRetainedAfterUnload = beforeUnloadPluginRef.captionManager ? 1 : 0;

    restoreActiveDocument();
    document.body.classList.remove(bodyStateClass, captionBodyClass);

    await app.plugins.enablePlugin(id);
    await wait(config.enableWaitMs);
    pluginInstance = app.plugins.plugins[id];
    if (!pluginInstance) throw new Error("Plugin did not reload for drop/paste probes");

    let dropHandleCalls = 0;
    let pasteHandleCalls = 0;
    const originalHandleDrop = pluginInstance.handleDrop;
    const originalHandlePaste = pluginInstance.handlePaste;
    pluginInstance.handleDrop = async () => { dropHandleCalls += 1; };
    pluginInstance.handlePaste = async () => { pasteHandleCalls += 1; };

    const imageFile = new File([new Uint8Array([137, 80, 78, 71])], "already-handled.png", { type: "image/png" });
    const editor = {
      posAtMouse: () => ({ line: 0, ch: 0 }),
      getCursor: () => ({ line: 0, ch: 0 }),
      replaceRange: () => {},
      setCursor: () => {},
    };

    let dropPreventCalls = 0;
    const dropEvent = {
      defaultPrevented: true,
      dataTransfer: { files: [imageFile] },
      preventDefault() { dropPreventCalls += 1; this.defaultPrevented = true; },
      stopPropagation() {},
      stopImmediatePropagation() {},
    };
    try { app.workspace.trigger?.("editor-drop", dropEvent, editor); }
    catch (error) { errors.push({ label: "editor-drop-trigger", message: String(error?.stack ?? error) }); }
    await wait(config.eventWaitMs);

    let pastePreventCalls = 0;
    const pasteEvent = {
      defaultPrevented: true,
      clipboardData: {
        items: [{ kind: "file", type: "image/png", getAsFile: () => imageFile }],
      },
      preventDefault() { pastePreventCalls += 1; this.defaultPrevented = true; },
      stopPropagation() {},
      stopImmediatePropagation() {},
    };
    try { app.workspace.trigger?.("editor-paste", pasteEvent, editor); }
    catch (error) { errors.push({ label: "editor-paste-trigger", message: String(error?.stack ?? error) }); }
    await wait(config.eventWaitMs);

    metrics.dropDefaultPreventedHandleCalls = dropHandleCalls;
    metrics.dropDefaultPreventedPreventCalls = dropPreventCalls;
    metrics.pasteDefaultPreventedHandleCalls = pasteHandleCalls;
    metrics.pasteDefaultPreventedPreventCalls = pastePreventCalls;

    pluginInstance.handleDrop = originalHandleDrop;
    pluginInstance.handlePaste = originalHandlePaste;

    const reloadCommandId = getReloadCommandId();
    if (reloadCommandId && app.commands?.executeCommandById) {
      const startedAt = performance.now();
      try {
        await Promise.resolve(app.commands.executeCommandById(reloadCommandId));
        metrics.reloadCommandCompletes = 1;

        const waitStartedAt = performance.now();
        while (!app.plugins.plugins[id] && performance.now() - waitStartedAt < 4500) {
          await wait(100);
        }

        metrics.reloadCommandElapsedMs = round(performance.now() - startedAt);
        metrics.reloadCommandPluginLoadedAfter = app.plugins.plugins[id] ? 1 : 0;
      } catch (error) {
        errors.push({ label: "reload-command", message: String(error?.stack ?? error) });
      }
    } else {
      notes.push({ label: "reload-command", message: `Could not find reload command; candidates include ${id}:reload-plugin` });
    }
  } catch (error) {
    errors.push({ label: "fatal", message: String(error?.stack ?? error) });
  } finally {
    restoreActiveDocument();

    try {
      document.body.classList.remove(bodyStateClass, captionBodyClass);
      syntheticActiveDoc?.body?.classList?.remove(bodyStateClass, captionBodyClass);
    } catch (error) {
      notes.push({ label: "cleanup-body-classes", message: String(error) });
    }

    try {
      removeDomFixtures(document);
      app.workspace.iterateAllLeaves?.((leaf) => removeDomFixtures(leaf.view?.containerEl?.ownerDocument));
    } catch (error) {
      notes.push({ label: "cleanup-dom-fixtures", message: String(error) });
    }

    try {
      if (app.plugins.plugins[id]) {
        await app.plugins.disablePlugin(id);
        await wait(150);
      }
    } catch (error) {
      notes.push({ label: "cleanup:disable", message: String(error) });
    }

    try {
      if (originalDataExists) await adapter.write(dataPath, originalData);
      else if (await adapter.exists(dataPath)) await adapter.remove(dataPath);
    } catch (error) {
      notes.push({ label: "restore-data", message: String(error) });
    }

    if (originallyLoaded && !app.plugins.plugins[id]) {
      try { await app.plugins.enablePlugin(id); }
      catch (error) { notes.push({ label: "restore-enable", message: String(error) }); }
    }
  }

  metrics.runtimeErrors = errors.length;
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
      canOverrideActiveDocument,
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
  console.log(`${name.padEnd(42)} ${formatValue(previous, suffix).padStart(12)} ${formatValue(current, suffix).padStart(12)} ${formatDelta(previous, current, suffix).padStart(12)} ${targetText.padStart(14)} ${status}`);
}

function printSummary(currentReport, previousReport) {
  const current = currentReport.metrics;
  const previous = previousReport?.metrics ?? null;

  console.log(`\nP95 ${CHECK_NAME}: ${currentReport.summary.pass ? "PASS" : "FAIL"}`);
  console.log(`Label: ${currentReport.label}`);
  console.log("\nMetric                                      previous      current        delta         target status");
  console.log("-------------------------------------------------------------------------------------------------");
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
  const injected = `const CHECK_NAME = ${JSON.stringify(CHECK_NAME)};\n(${measureMainRuntimeSafetyInObsidian.toString()})(${JSON.stringify(args)})`;

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
