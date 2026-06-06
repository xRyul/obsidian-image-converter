#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const CHECK_NAME = "image-alignment-unload";

const TARGET_SPECS = {
  vaultEventRefsRegistered: { label: "vault event refs registered", comparator: ">=", target: 2, suffix: "" },
  activeDocAlignedElementsAfterApply: { label: "active doc aligned elems after apply", comparator: ">=", target: 1, suffix: "" },
  inactiveMainAlignedElementsAfterActiveApply: { label: "inactive main aligned elems after active apply", comparator: "<=", target: 0, suffix: "" },
  mainAppliedElementsBeforeUnload: { label: "main doc aligned elems before unload", comparator: ">=", target: 1, suffix: "" },
  popoutAppliedElementsBeforeUnload: { label: "popout doc aligned elems before unload", comparator: ">=", target: 1, suffix: "" },
  mainLeakedElementsAfterUnload: { label: "main doc leaked aligned elems", comparator: "<=", target: 0, suffix: "" },
  popoutLeakedElementsAfterUnload: { label: "popout doc leaked aligned elems", comparator: "<=", target: 0, suffix: "" },
  activeDocLeakedElementsAfterUnload: { label: "active doc leaked aligned elems", comparator: "<=", target: 0, suffix: "" },
  postUnloadReapplyCalls: { label: "post-unload reapply callbacks", comparator: "<=", target: 0, suffix: "" },
  postUnloadVaultEventCallbacks: { label: "post-unload vault event callbacks", comparator: "<=", target: 0, suffix: "" },
  unloadMs: { label: "plugin disable/unload latency", comparator: "<=", target: 1000, suffix: "ms" },
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
    postUnloadWaitMs: 150,
    fixtureWaitMs: 800,
  };

  const targetByFlag = {
    "--target-vault-event-refs-registered": "vaultEventRefsRegistered",
    "--target-active-doc-aligned-elements-after-apply": "activeDocAlignedElementsAfterApply",
    "--target-inactive-main-aligned-elements-after-active-apply": "inactiveMainAlignedElementsAfterActiveApply",
    "--target-main-applied-elements-before-unload": "mainAppliedElementsBeforeUnload",
    "--target-popout-applied-elements-before-unload": "popoutAppliedElementsBeforeUnload",
    "--target-main-leaked-elements-after-unload": "mainLeakedElementsAfterUnload",
    "--target-popout-leaked-elements-after-unload": "popoutLeakedElementsAfterUnload",
    "--target-active-doc-leaked-elements-after-unload": "activeDocLeakedElementsAfterUnload",
    "--target-post-unload-reapply-calls": "postUnloadReapplyCalls",
    "--target-post-unload-vault-event-callbacks": "postUnloadVaultEventCallbacks",
    "--target-unload-ms": "unloadMs",
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
    else if (arg === "--post-unload-wait-ms") args.postUnloadWaitMs = Number(readValue());
    else if (arg === "--fixture-wait-ms") args.fixtureWaitMs = Number(readValue());
    else if (Object.hasOwn(targetByFlag, arg)) targetSpecs[targetByFlag[arg]].target = Number(readValue());
    else if (arg === "--help" || arg === "-h") {
      console.log(`Usage: node scripts/p95/${CHECK_NAME}.mjs [options]\n\nOptions:\n  --vault <name>                                              Obsidian vault name (default: plugin-testing-vault)\n  --id <plugin-id>                                            Plugin id (default: image-converter)\n  --report-path <path>                                        Vault-relative current report path\n  --history-path <path>                                       Vault-relative JSONL history path\n  --report-file <path>                                        Filesystem path to read the current report from\n  --label <name>                                              Label stored in the report (default: current)\n  --no-fail                                                   Print FAIL metrics but exit 0; useful for before-fix baselines\n  --no-reload                                                 Do not reload the vault before measuring\n  --reload-wait-ms <n>                                        Wait after vault reload before eval (default: 3000)\n  --post-unload-wait-ms <n>                                   Wait after disable for leaked timer/event callbacks (default: 150)\n  --fixture-wait-ms <n>                                       Wait after opening fixture views (default: 800)\n  --target-vault-event-refs-registered <n>                    Minimum vault EventRefs registered by ImageAlignmentManager (default: 2)\n  --target-active-doc-aligned-elements-after-apply <n>        Minimum active-popout elements aligned by applyAlignmentsToNote (default: 1)\n  --target-inactive-main-aligned-elements-after-active-apply <n> Maximum inactive main-doc elements touched by active-doc apply (default: 0)\n  --target-main-applied-elements-before-unload <n>            Minimum main-doc aligned element setup count (default: 1)\n  --target-popout-applied-elements-before-unload <n>          Minimum popout-doc aligned element setup count (default: 1)\n  --target-main-leaked-elements-after-unload <n>              Maximum main-doc leaked aligned elements (default: 0)\n  --target-popout-leaked-elements-after-unload <n>            Maximum popout-doc leaked aligned elements (default: 0)\n  --target-active-doc-leaked-elements-after-unload <n>        Maximum active-doc leaked aligned elements (default: 0)\n  --target-post-unload-reapply-calls <n>                      Maximum callbacks from a pending reapply timer after unload (default: 0)\n  --target-post-unload-vault-event-callbacks <n>              Maximum vault event callbacks after unload (default: 0)\n  --target-unload-ms <n>                                      Maximum plugin disable/unload latency, ms (default: 1000)\n  --target-runtime-errors <n>                                 Maximum runtime/setup errors (default: 0)\n`);
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  for (const [key, value] of Object.entries({
    reloadWaitMs: args.reloadWaitMs,
    postUnloadWaitMs: args.postUnloadWaitMs,
    fixtureWaitMs: args.fixtureWaitMs,
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
async function measureImageAlignmentUnloadInObsidian(config) {
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
  const alignmentClasses = [
    "image-position-left",
    "image-position-center",
    "image-position-right",
    "image-wrap",
    "image-no-wrap",
    "image-converter-aligned",
  ];
  const alignmentSelector = alignmentClasses.map((className) => `.${className}`).join(",");
  const pngBuffer = Uint8Array.from(
    atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII="),
    (char) => char.charCodeAt(0)
  ).buffer;

  const errors = [];
  const notes = [];
  const documents = new Set();
  const metrics = {
    vaultEventRefsRegistered: 0,
    activeDocAlignedElementsAfterApply: 0,
    inactiveMainAlignedElementsAfterActiveApply: Number.POSITIVE_INFINITY,
    mainAppliedElementsBeforeUnload: 0,
    popoutAppliedElementsBeforeUnload: 0,
    mainLeakedElementsAfterUnload: Number.POSITIVE_INFINITY,
    popoutLeakedElementsAfterUnload: Number.POSITIVE_INFINITY,
    activeDocLeakedElementsAfterUnload: Number.POSITIVE_INFINITY,
    postUnloadReapplyCalls: Number.POSITIVE_INFINITY,
    postUnloadVaultEventCallbacks: Number.POSITIVE_INFINITY,
    unloadMs: Number.POSITIVE_INFINITY,
    runtimeErrors: 0,
  };

  let popoutLeaf = null;
  let mainDoc = null;
  let popoutDoc = null;
  let activeDocAtUnload = null;
  let postUnloadReapplyCalls = 0;
  let postUnloadVaultEventCallbacks = 0;
  let disabled = false;

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
    addDocument(mainDoc);
    addDocument(popoutDoc);
    return [...documents];
  };
  const countAlignedElements = (doc) => {
    if (!doc?.body) return 0;
    return [...doc.querySelectorAll(alignmentSelector)].filter((element) =>
      alignmentClasses.some((className) => element.classList.contains(className))
    ).length;
  };
  const isAlignedElement = (element) =>
    Boolean(element) && alignmentClasses.some((className) => element.classList.contains(className));
  const removeAlignmentClasses = (doc) => {
    if (!doc?.body) return;
    doc.querySelectorAll(alignmentSelector).forEach((element) => {
      element.classList.remove(...alignmentClasses);
    });
  };
  const getImageSrc = (image) => image?.getAttr?.("src") ?? image?.getAttribute?.("src") ?? "";
  const seedApplyCacheEntry = (manager, notePath, image) => {
    const src = getImageSrc(image);
    if (!src) return;
    if (!manager.cache[notePath]) manager.cache[notePath] = {};
    manager.cache[notePath][manager.getImageHash(notePath, src)] = {
      position: "center",
      width: "120px",
      height: "",
      wrap: false,
    };
  };
  const fixtureImageSelector = 'img[alt="P95 fixture"], img[src*="fixture.png"]';
  const fallbackImageSelector = ".image-embed img, .markdown-preview-view img, .markdown-source-view img, img";
  const getImageFromLeaf = (leaf, fallbackDoc) =>
    leaf?.view?.containerEl?.querySelector?.(fixtureImageSelector)
    ?? fallbackDoc?.querySelector?.(fixtureImageSelector)
    ?? leaf?.view?.containerEl?.querySelector?.(fallbackImageSelector)
    ?? fallbackDoc?.querySelector?.(fallbackImageSelector)
    ?? null;
  const waitFor = async (predicate, timeoutMs, intervalMs = 25) => {
    const startedAt = performance.now();
    while (performance.now() - startedAt < timeoutMs) {
      if (predicate()) return true;
      await wait(intervalMs);
    }
    return predicate();
  };
  const waitForImage = async (leaf, doc, timeoutMs = 5000) => {
    let image = getImageFromLeaf(leaf, doc);
    await waitFor(() => {
      image = getImageFromLeaf(leaf, doc);
      return Boolean(image);
    }, timeoutMs);
    return image;
  };
  const applyClassesThroughPlugin = (alignment, image, position) => {
    alignment.applyAlignmentToImage(image, {
      position,
      width: "120px",
      height: "",
      wrap: position === "left",
    });
  };
  const tryFocusLeaf = async (leaf, doc) => {
    try { app.workspace.setActiveLeaf?.(leaf, { focus: true }); } catch {}
    try { doc?.defaultView?.focus?.(); } catch {}
    await wait(100);
  };

  try {
    if (app.plugins.plugins[id]) {
      await app.plugins.disablePlugin(id);
      await wait(250);
    }

    await adapter.write(dataPath, JSON.stringify({
      enableContextMenu: false,
      isImageAlignmentEnabled: true,
      imageAlignmentDefaultAlignment: "none",
      imageAlignmentCacheLocation: "plugin",
      imageAlignmentCacheCleanupInterval: 0,
      isImageResizeEnbaled: false,
      isDragResizeEnabled: false,
      isScrollResizeEnabled: false,
      isResizeInReadingModeEnabled: false,
      enableImageCaptions: false,
      modalBehavior: "never",
      outputFormat: "NONE",
    }, null, 2));

    await ensureFolder(fixtureDir);
    await ensureBinary(fixtureImagePath, pngBuffer);
    const file = await ensureFile(
      fixtureNotePath,
      `# P95 ${CHECK_NAME}\n\n<img src="fixture.png" alt="P95 fixture" width="120">\n`
    );

    await app.plugins.enablePlugin(id);
    await wait(500);

    const pluginInstance = app.plugins.plugins[id];
    const manager = pluginInstance?.ImageAlignmentManager;
    const alignment = manager?.imageAlignment;
    if (!manager) throw new Error("Plugin did not expose ImageAlignmentManager after enablePlugin");
    if (!alignment?.applyAlignmentToImage || !alignment?.updateImageAlignment) {
      throw new Error("ImageAlignment instance is not reachable for runtime instrumentation");
    }

    const originalApplyAlignmentsToNote = manager.applyAlignmentsToNote.bind(manager);
    manager.applyAlignmentsToNote = async (...args) => {
      if (disabled) postUnloadReapplyCalls += 1;
      return originalApplyAlignmentsToNote(...args);
    };
    const originalRemoveNoteFromCache = manager.removeNoteFromCache.bind(manager);
    manager.removeNoteFromCache = (...args) => {
      if (disabled) postUnloadVaultEventCallbacks += 1;
      return originalRemoveNoteFromCache(...args);
    };
    const originalValidateNoteCache = manager.validateNoteCache.bind(manager);
    manager.validateNoteCache = async (...args) => {
      if (disabled) postUnloadVaultEventCallbacks += 1;
      return originalValidateNoteCache(...args);
    };

    const mainLeaf = app.workspace.getLeaf(true);
    await mainLeaf.openFile(file);
    await mainLeaf.loadIfDeferred?.();
    await tryFocusLeaf(mainLeaf, mainLeaf.view?.containerEl?.ownerDocument);
    await wait(config.fixtureWaitMs);
    try { app.workspace.trigger?.("file-open", file); } catch (error) { notes.push({ label: "trigger:file-open:main", message: String(error) }); }
    try { app.workspace.trigger?.("layout-change"); } catch (error) { notes.push({ label: "trigger:layout-change:main", message: String(error) }); }
    await wait(250);

    mainDoc = mainLeaf.view?.containerEl?.ownerDocument ?? activeDocument;
    addDocument(mainDoc);
    const mainImage = await waitForImage(mainLeaf, mainDoc);
    if (!mainImage) throw new Error("No image found in main markdown view");

    if (typeof app.workspace.openPopoutLeaf !== "function") {
      throw new Error("app.workspace.openPopoutLeaf is not available");
    }

    popoutLeaf = app.workspace.openPopoutLeaf();
    await wait(700);
    await popoutLeaf.openFile(file);
    await popoutLeaf.loadIfDeferred?.();
    popoutDoc = popoutLeaf.view?.containerEl?.ownerDocument;
    if (!popoutDoc || popoutDoc === mainDoc) {
      throw new Error("openPopoutLeaf did not expose a separate ownerDocument");
    }
    await tryFocusLeaf(popoutLeaf, popoutDoc);
    await wait(config.fixtureWaitMs);
    addDocument(popoutDoc);
    const popoutImage = await waitForImage(popoutLeaf, popoutDoc, 6000);
    if (!popoutImage) throw new Error("No image found in popout markdown view");

    metrics.vaultEventRefsRegistered = Array.isArray(manager.eventRefs) ? manager.eventRefs.length : 0;

    manager.cache = {};
    seedApplyCacheEntry(manager, file.path, mainImage);
    seedApplyCacheEntry(manager, file.path, popoutImage);
    removeAlignmentClasses(mainDoc);
    removeAlignmentClasses(popoutDoc);
    await tryFocusLeaf(popoutLeaf, popoutDoc);
    let previousActiveDocument = null;
    let previousActiveWindow = null;
    try { previousActiveDocument = activeDocument; } catch {}
    try { previousActiveWindow = activeWindow; } catch {}
    try { activeDocument = popoutDoc; } catch (error) { notes.push({ label: "force-active-document", message: String(error) }); }
    try { activeWindow = popoutDoc.defaultView ?? previousActiveWindow; } catch (error) { notes.push({ label: "force-active-window", message: String(error) }); }
    notes.push({
      label: "active-apply-setup",
      mainSrcPresent: Boolean(getImageSrc(mainImage)),
      popoutSrcPresent: Boolean(getImageSrc(popoutImage)),
      globalDocumentImages: document.querySelectorAll("img").length,
      activeDocumentIsPopout: activeDocument === popoutDoc,
      activeDocumentImages: activeDocument.querySelectorAll("img").length,
      mainDocImages: mainDoc.querySelectorAll("img").length,
      popoutDocImages: popoutDoc.querySelectorAll("img").length,
    });
    await manager.applyAlignmentsToNote(file.path);
    await wait(150);
    const mainImageAfterApply = getImageFromLeaf(mainLeaf, mainDoc);
    const popoutImageAfterApply = getImageFromLeaf(popoutLeaf, popoutDoc);
    metrics.activeDocAlignedElementsAfterApply = isAlignedElement(popoutImageAfterApply) ? 1 : 0;
    metrics.inactiveMainAlignedElementsAfterActiveApply = isAlignedElement(mainImageAfterApply) ? 1 : 0;
    try { if (previousActiveDocument) activeDocument = previousActiveDocument; } catch {}
    try { if (previousActiveWindow) activeWindow = previousActiveWindow; } catch {}
    removeAlignmentClasses(mainDoc);
    removeAlignmentClasses(popoutDoc);

    applyClassesThroughPlugin(alignment, mainImage, "left");
    applyClassesThroughPlugin(alignment, popoutImage, "right");
    metrics.mainAppliedElementsBeforeUnload = countAlignedElements(mainDoc);
    metrics.popoutAppliedElementsBeforeUnload = countAlignedElements(popoutDoc);

    await tryFocusLeaf(popoutLeaf, popoutDoc);
    activeDocAtUnload = popoutDoc;
    try {
      if (typeof activeDocument !== "undefined" && activeDocument?.body) {
        activeDocAtUnload = activeDocument;
      }
    } catch {}

    // Schedule the private debounced reapply path through the public context-menu update method.
    // A correct unload must clear this pending timer before it can call back into the manager.
    await alignment.updateImageAlignment(mainImage, { align: "center", wrap: false });

    disabled = true;
    const unloadStartedAt = performance.now();
    await app.plugins.disablePlugin(id);
    metrics.unloadMs = round(performance.now() - unloadStartedAt);
    await wait(config.postUnloadWaitMs);
    try { app.vault.trigger?.("delete", file); } catch (error) { notes.push({ label: "trigger:vault-delete:post-unload", message: String(error) }); }
    try { app.vault.trigger?.("rename", file, `${fixtureDir}/old-fixture.md`); } catch (error) { notes.push({ label: "trigger:vault-rename:post-unload", message: String(error) }); }
    await wait(config.postUnloadWaitMs);

    collectDocuments();
    metrics.mainLeakedElementsAfterUnload = countAlignedElements(mainDoc);
    metrics.popoutLeakedElementsAfterUnload = countAlignedElements(popoutDoc);
    metrics.activeDocLeakedElementsAfterUnload = countAlignedElements(activeDocAtUnload);
    metrics.postUnloadReapplyCalls = postUnloadReapplyCalls;
    metrics.postUnloadVaultEventCallbacks = postUnloadVaultEventCallbacks;
  } catch (error) {
    errors.push({ label: "fatal", message: String(error?.stack ?? error) });
  } finally {
    try {
      if (app.plugins.plugins[id]) {
        await app.plugins.disablePlugin(id);
        await wait(150);
      }
    } catch (error) {
      notes.push({ label: "cleanup:disable", message: String(error) });
    }

    if (popoutLeaf?.detach) {
      try { popoutLeaf.detach(); }
      catch (error) { notes.push({ label: "popout-detach", message: String(error) }); }
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
      documentsSeen: collectDocuments().map((doc) => ({
        title: doc.title,
        url: doc.URL,
        alignedElements: countAlignedElements(doc),
      })),
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
  console.log(`${name.padEnd(40)} ${formatValue(previous, suffix).padStart(12)} ${formatValue(current, suffix).padStart(12)} ${formatDelta(previous, current, suffix).padStart(12)} ${targetText.padStart(14)} ${status}`);
}

function printSummary(currentReport, previousReport) {
  const current = currentReport.metrics;
  const previous = previousReport?.metrics ?? null;

  console.log(`\nP95 ${CHECK_NAME}: ${currentReport.summary.pass ? "PASS" : "FAIL"}`);
  console.log("\nMetric                                    previous      current        delta         target status");
  console.log("-----------------------------------------------------------------------------------------------");
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
  const injected = `const CHECK_NAME = ${JSON.stringify(CHECK_NAME)};\n(${measureImageAlignmentUnloadInObsidian.toString()})(${JSON.stringify(args)})`;

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
