#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const CHECK_NAME = "image-resizer-runtime";

const TARGET_SPECS = {
  mainHandlesCreated: { label: "main resize handles created", comparator: ">=", target: 1, suffix: "" },
  mainActiveImageClearedAfterScroll: { label: "scroll state clears active image", comparator: ">=", target: 1, suffix: "" },
  mainLeakedContainersAfterScrollUnload: { label: "main leaked containers after unload", comparator: "<=", target: 0, suffix: "" },
  mainLeakedHandlesAfterScrollUnload: { label: "main leaked handles after unload", comparator: "<=", target: 0, suffix: "" },
  mainImagesRetainedAfterScrollUnload: { label: "main images retained after cleanup", comparator: ">=", target: 1, suffix: "" },
  popoutAvailable: { label: "popout API available", comparator: ">=", target: 1, suffix: "" },
  popoutClickOverridePrevented: { label: "popout click override prevented", comparator: ">=", target: 1, suffix: "" },
  popoutFocusedEmbedElementBlurred: { label: "popout focused embed blurred", comparator: ">=", target: 1, suffix: "" },
  popoutHandlesCreated: { label: "popout resize handles created", comparator: ">=", target: 1, suffix: "" },
  popoutDragStarted: { label: "popout drag resize starts", comparator: ">=", target: 1, suffix: "" },
  popoutWidthChanged: { label: "popout drag changes width", comparator: ">=", target: 1, suffix: "" },
  p95PopoutDragLatencyMs: { label: "p95 popout drag latency", comparator: "<=", target: 250, suffix: "ms" },
  popoutFallbackLeakedContainersAfterForceCleanup: { label: "popout fallback leaked containers", comparator: "<=", target: 0, suffix: "" },
  finalLeakedContainers: { label: "final leaked containers", comparator: "<=", target: 0, suffix: "" },
  runtimeErrors: { label: "runtime errors", comparator: "<=", target: 0, suffix: "" },
};

function parseArgs(argv) {
  const args = {
    vault: "plugin-testing-vault",
    id: "image-converter",
    trials: 5,
    viewWaitMs: 900,
    openWaitMs: 120,
    scrollSettleMs: 450,
    interactionWaitMs: 250,
    reportPath: `_pi/p95/${CHECK_NAME}.current.json`,
    historyPath: `_pi/p95/${CHECK_NAME}.history.jsonl`,
    reportFile: null,
    label: "current",
    noFail: false,
    reloadBefore: true,
    reloadWaitMs: 3000,
  };

  const targetByFlag = {
    "--target-main-handles-created": "mainHandlesCreated",
    "--target-main-active-image-cleared-after-scroll": "mainActiveImageClearedAfterScroll",
    "--target-main-leaked-containers-after-scroll-unload": "mainLeakedContainersAfterScrollUnload",
    "--target-main-leaked-handles-after-scroll-unload": "mainLeakedHandlesAfterScrollUnload",
    "--target-main-images-retained-after-scroll-unload": "mainImagesRetainedAfterScrollUnload",
    "--target-popout-available": "popoutAvailable",
    "--target-popout-click-override-prevented": "popoutClickOverridePrevented",
    "--target-popout-focused-embed-element-blurred": "popoutFocusedEmbedElementBlurred",
    "--target-popout-handles-created": "popoutHandlesCreated",
    "--target-popout-drag-started": "popoutDragStarted",
    "--target-popout-width-changed": "popoutWidthChanged",
    "--target-p95-popout-drag-latency-ms": "p95PopoutDragLatencyMs",
    "--target-popout-fallback-leaked-containers-after-force-cleanup": "popoutFallbackLeakedContainersAfterForceCleanup",
    "--target-final-leaked-containers": "finalLeakedContainers",
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
    else if (arg === "--trials") args.trials = Number(readValue());
    else if (arg === "--view-wait-ms") args.viewWaitMs = Number(readValue());
    else if (arg === "--open-wait-ms") args.openWaitMs = Number(readValue());
    else if (arg === "--scroll-settle-ms") args.scrollSettleMs = Number(readValue());
    else if (arg === "--interaction-wait-ms") args.interactionWaitMs = Number(readValue());
    else if (arg === "--report-path") args.reportPath = readValue();
    else if (arg === "--history-path") args.historyPath = readValue();
    else if (arg === "--report-file") args.reportFile = readValue();
    else if (arg === "--label") args.label = readValue();
    else if (arg === "--no-fail") args.noFail = true;
    else if (arg === "--no-reload") args.reloadBefore = false;
    else if (arg === "--reload-wait-ms") args.reloadWaitMs = Number(readValue());
    else if (Object.hasOwn(targetByFlag, arg)) targetSpecs[targetByFlag[arg]].target = Number(readValue());
    else if (arg === "--help" || arg === "-h") {
      console.log(`Usage: node scripts/p95/${CHECK_NAME}.mjs [options]\n\nOptions:\n  --vault <name>                                             Obsidian vault name (default: plugin-testing-vault)\n  --id <plugin-id>                                           Plugin id (default: image-converter)\n  --trials <n>                                               Popout drag trials for p95 latency (default: 5)\n  --view-wait-ms <n>                                         Wait after opening a markdown view (default: 900)\n  --open-wait-ms <n>                                         Wait after hover/fixture interactions (default: 120)\n  --scroll-settle-ms <n>                                     Wait for scroll debounce to clear activeImage (default: 450)\n  --interaction-wait-ms <n>                                  Wait budget for drag resize updates (default: 250)\n  --report-path <path>                                       Vault-relative current report path\n  --history-path <path>                                      Vault-relative JSONL history path\n  --report-file <path>                                       Filesystem path to read the current report from\n  --label <name>                                             Label stored in the report (default: current)\n  --no-fail                                                  Print FAIL metrics but exit 0; useful for baselines\n  --no-reload                                                Do not reload the vault before measuring\n  --reload-wait-ms <n>                                       Wait after vault reload before eval (default: 3000)\n  --target-main-handles-created <n>                          Minimum main handles created (default: 1)\n  --target-main-active-image-cleared-after-scroll <n>         Minimum activeImage cleared indicator after scroll debounce (default: 1)\n  --target-main-leaked-containers-after-scroll-unload <n>     Maximum leaked main resize containers after unload (default: 0)\n  --target-main-leaked-handles-after-scroll-unload <n>        Maximum leaked main resize handles after unload (default: 0)\n  --target-main-images-retained-after-scroll-unload <n>       Minimum images retained after cleanup (default: 1)\n  --target-popout-available <n>                               Minimum popout API availability indicator (default: 1)\n  --target-popout-click-override-prevented <n>                Minimum prevented popout image mousedown count (default: 1)\n  --target-popout-focused-embed-element-blurred <n>           Minimum popout focused embed blur indicator (default: 1)\n  --target-popout-handles-created <n>                         Minimum popout handles created (default: 1)\n  --target-popout-drag-started <n>                            Minimum popout drag-start indicator (default: 1)\n  --target-popout-width-changed <n>                           Minimum popout width-change indicator (default: 1)\n  --target-p95-popout-drag-latency-ms <n>                     Maximum p95 popout drag latency, ms (default: 250)\n  --target-popout-fallback-leaked-containers-after-force-cleanup <n> Maximum popout fallback leaked containers (default: 0)\n  --target-final-leaked-containers <n>                        Maximum final leaked containers across seen docs (default: 0)\n  --target-runtime-errors <n>                                 Maximum runtime/setup errors (default: 0)\n`);
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  for (const [key, value] of Object.entries({
    trials: args.trials,
    viewWaitMs: args.viewWaitMs,
    openWaitMs: args.openWaitMs,
    scrollSettleMs: args.scrollSettleMs,
    interactionWaitMs: args.interactionWaitMs,
    reloadWaitMs: args.reloadWaitMs,
  })) {
    if (!Number.isFinite(value) || value < 0) throw new Error(`--${key} must be a non-negative number`);
  }
  if (args.trials < 1) throw new Error("--trials must be at least 1");

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
async function measureImageResizerRuntimeInObsidian(config) {
  const id = config.id;
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const round = (value) => Math.round(value * 100) / 100;
  const percentile = (values, p) => {
    if (!values.length) return Number.POSITIVE_INFINITY;
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
  const dataPath = `${manifest.dir}/data.json`;
  const originalDataExists = await adapter.exists(dataPath);
  const originalData = originalDataExists ? await adapter.read(dataPath) : null;
  const originallyLoaded = Boolean(app.plugins.plugins[id]);

  const fixtureDir = `_pi/p95/${CHECK_NAME}`;
  const fixtureImagePath = `${fixtureDir}/fixture.png`;
  const fixtureNotePath = `${fixtureDir}/fixture.md`;
  const pngBuffer = Uint8Array.from(
    atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII="),
    (char) => char.charCodeAt(0)
  ).buffer;

  const errors = [];
  const notes = [];
  const documents = new Set();
  const dragLatencies = [];
  const metrics = {
    mainHandlesCreated: 0,
    mainActiveImageClearedAfterScroll: 0,
    mainLeakedContainersAfterScrollUnload: Number.POSITIVE_INFINITY,
    mainLeakedHandlesAfterScrollUnload: Number.POSITIVE_INFINITY,
    mainImagesRetainedAfterScrollUnload: 0,
    popoutAvailable: 0,
    popoutClickOverridePrevented: 0,
    popoutFocusedEmbedElementBlurred: 0,
    popoutHandlesCreated: 0,
    popoutDragStarted: 0,
    popoutWidthChanged: 0,
    p95PopoutDragLatencyMs: Number.POSITIVE_INFINITY,
    popoutFallbackLeakedContainersAfterForceCleanup: Number.POSITIVE_INFINITY,
    finalLeakedContainers: Number.POSITIVE_INFINITY,
    runtimeErrors: 0,
  };

  let popoutLeaf = null;
  let changedNativeMenus = false;
  const originalNativeMenus = app.vault.getConfig?.("nativeMenus");
  let previousActiveDocument = null;

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
  const countResizeContainers = (doc) => doc?.querySelectorAll?.(".image-resize-container")?.length ?? 0;
  const countResizeHandles = (doc) => doc?.querySelectorAll?.(".image-resize-handle")?.length ?? 0;
  const countImages = (doc) => doc?.querySelectorAll?.(".image-embed img, .markdown-preview-view img, .markdown-source-view img, img")?.length ?? 0;
  const countAllResizeContainers = () => collectDocuments().reduce((sum, doc) => sum + countResizeContainers(doc), 0);
  const unwrapResizeContainers = (doc) => {
    for (const container of [...(doc?.querySelectorAll?.(".image-resize-container") ?? [])]) {
      const image = container.querySelector("img");
      if (image && container.parentNode) container.parentNode.insertBefore(image, container);
      container.remove();
    }
  };
  const forceImageMetrics = (image, width = 120, height = 90) => {
    image.style.width = `${width}px`;
    image.style.height = `${height}px`;
    try { Object.defineProperty(image, "clientWidth", { configurable: true, value: width }); } catch {}
    try { Object.defineProperty(image, "clientHeight", { configurable: true, value: height }); } catch {}
    try { Object.defineProperty(image, "naturalWidth", { configurable: true, value: width }); } catch {}
    try { Object.defineProperty(image, "naturalHeight", { configurable: true, value: height }); } catch {}
    image.getBoundingClientRect = () => ({
      x: 10,
      y: 10,
      left: 10,
      top: 10,
      right: 10 + width,
      bottom: 10 + height,
      width,
      height,
      toJSON: () => {},
    });
  };
  const createDomImageFixture = (leaf, label) => {
    const containerEl = leaf?.view?.containerEl;
    if (!containerEl) throw new Error(`Cannot create ${label} DOM fixture without a leaf view container`);
    const doc = containerEl.ownerDocument;
    const host = doc.createElement("div");
    host.className = "p95-image-resizer-fixture markdown-source-view";
    host.setAttribute("data-p95-resizer-fixture", label);
    const embed = doc.createElement("div");
    embed.className = "internal-embed image-embed";
    const image = doc.createElement("img");
    image.setAttribute("src", "app://vault/fixture.png");
    image.setAttribute("alt", `p95 ${label} fixture`);
    embed.appendChild(image);
    host.appendChild(embed);
    containerEl.appendChild(host);
    forceImageMetrics(image);
    return image;
  };
  const countFixtureImages = (doc, label) => doc?.querySelectorAll?.(`[data-p95-resizer-fixture=\"${label}\"] img`)?.length ?? 0;
  const removeDomFixtures = (doc) => {
    for (const fixture of [...(doc?.querySelectorAll?.("[data-p95-resizer-fixture]") ?? [])]) {
      fixture.remove();
    }
  };
  const getImageFromLeaf = (leaf, fallbackDoc) =>
    leaf?.view?.containerEl?.querySelector?.(".image-embed img, .markdown-preview-view img, .markdown-source-view img, img")
    ?? fallbackDoc?.querySelector?.(".image-embed img, .markdown-preview-view img, .markdown-source-view img, img")
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
    if (image) forceImageMetrics(image);
    return image;
  };
  const setLeafSourceMode = (leaf) => {
    const view = leaf?.view;
    if (!view) return;
    const originalGetState = typeof view.getState === "function" ? view.getState.bind(view) : null;
    view.getState = () => ({ ...(originalGetState?.() ?? {}), mode: "source" });
  };
  const openFileInLeaf = async (leaf, file) => {
    await leaf.openFile(file);
    await leaf.loadIfDeferred?.();
    setLeafSourceMode(leaf);
    try { app.workspace.setActiveLeaf?.(leaf, { focus: true }); } catch {}
    await wait(config.viewWaitMs);
    try { app.workspace.trigger?.("file-open", file); } catch (error) { notes.push({ label: "trigger:file-open", message: String(error) }); }
    try { app.workspace.trigger?.("active-leaf-change", leaf); } catch (error) { notes.push({ label: "trigger:active-leaf-change", message: String(error) }); }
    try { app.workspace.trigger?.("layout-change"); } catch (error) { notes.push({ label: "trigger:layout-change", message: String(error) }); }
    await wait(config.openWaitMs);
  };
  const attachResizerToLeaf = async (leaf) => {
    const pluginInstance = app.plugins.plugins[id];
    const resizer = pluginInstance?.imageResizer;
    if (!resizer) throw new Error("Plugin did not expose imageResizer after enablePlugin");
    if (leaf?.view && typeof resizer.attachView === "function") {
      resizer.attachView(leaf.view);
      await wait(config.openWaitMs);
    }
    return resizer;
  };
  const dispatchHover = async (image) => {
    const doc = image.ownerDocument;
    const win = doc.defaultView ?? activeWindow;
    image.dispatchEvent(new win.MouseEvent("mouseover", {
      bubbles: true,
      cancelable: true,
      clientX: 20,
      clientY: 20,
      view: win,
    }));
    await waitFor(() => Boolean(image.matchParent?.(".image-resize-container")), 1000);
    await wait(config.openWaitMs);
  };
  const ensureHandles = async (image, resizer, label) => {
    const doc = image.ownerDocument;
    await dispatchHover(image);
    if (countResizeHandles(doc) === 0 && typeof resizer.createHandles === "function") {
      notes.push({ label: `${label}:create-handles-fallback`, message: "mouseover did not create handles; using ImageResizer.createHandles() to isolate cleanup/drag listener behavior" });
      resizer.createHandles(image);
      await wait(config.openWaitMs);
    }
    if (countResizeHandles(doc) === 0) {
      notes.push({ label: `${label}:handles-missing`, message: `resize containers=${countResizeContainers(doc)}, activeImage=${Boolean(resizer.activeImage)}, createHandles=${typeof resizer.createHandles}` });
    }
  };
  const dispatchWheel = async (image) => {
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
    await wait(config.scrollSettleMs);
  };
  const dispatchClickOverrideProbe = async (image, resizer) => {
    const doc = image.ownerDocument;
    const win = doc.defaultView ?? activeWindow;
    const embed = image.closest(".image-embed") ?? image.parentElement;
    let focusProbe = null;
    if (embed) {
      focusProbe = doc.createElement("button");
      focusProbe.textContent = "p95 focus probe";
      focusProbe.setAttribute("data-p95", "focus-probe");
      embed.appendChild(focusProbe);
      try { focusProbe.focus(); } catch (error) { notes.push({ label: "focus-probe", message: String(error) }); }
    }

    const event = new win.MouseEvent("mousedown", {
      button: 0,
      buttons: 1,
      bubbles: true,
      cancelable: true,
      clientX: 24,
      clientY: 24,
      view: win,
    });
    const dispatchReturned = image.dispatchEvent(event);
    const prevented = event.defaultPrevented || dispatchReturned === false;
    const blurred = focusProbe ? doc.activeElement !== focusProbe : prevented;
    try { focusProbe?.remove(); } catch {}

    // The click probe may create handles as a side effect. Keep active state deterministic for drag trials.
    if (!image.matchParent?.(".image-resize-container")) {
      try { resizer.activeImage = null; } catch {}
    }

    return { prevented, blurred };
  };
  const runPopoutDragTrial = async (image, handle, resizer, trialIndex) => {
    const doc = image.ownerDocument;
    const win = doc.defaultView ?? activeWindow;
    forceImageMetrics(image, 120 + trialIndex, 90);
    const beforeWidth = parseInt(image.style.width || "0", 10) || 120;
    const startedAt = performance.now();

    handle.dispatchEvent(new win.MouseEvent("mousedown", {
      button: 0,
      buttons: 1,
      bubbles: true,
      cancelable: true,
      clientX: 10,
      clientY: 10,
      view: win,
    }));
    await wait(20);
    const started = Boolean(resizer.resizeState?.isResizing || resizer.resizeState?.isDragging);

    doc.dispatchEvent(new win.MouseEvent("mousemove", {
      button: 0,
      buttons: 1,
      bubbles: true,
      cancelable: true,
      clientX: 70 + trialIndex,
      clientY: 45,
      view: win,
    }));

    await waitFor(() => {
      const currentWidth = parseInt(image.style.width || "0", 10) || beforeWidth;
      return currentWidth !== beforeWidth;
    }, config.interactionWaitMs);

    const afterWidth = parseInt(image.style.width || "0", 10) || beforeWidth;
    const changed = afterWidth !== beforeWidth;
    const latency = changed ? round(performance.now() - startedAt) : Number.POSITIVE_INFINITY;

    doc.dispatchEvent(new win.MouseEvent("mouseup", {
      button: 0,
      bubbles: true,
      cancelable: true,
      clientX: 70 + trialIndex,
      clientY: 45,
      view: win,
    }));
    await wait(config.openWaitMs);

    return { started, changed, latency, beforeWidth, afterWidth };
  };

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
      enableContextMenu: false,
      isImageAlignmentEnabled: false,
      isImageResizeEnbaled: true,
      isDragResizeEnabled: true,
      isScrollResizeEnabled: true,
      isResizeInReadingModeEnabled: true,
      isDragAspectRatioLocked: true,
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
    await wait(700);

    const mainLeaf = app.workspace.getLeaf(true);
    await openFileInLeaf(mainLeaf, file);
    const mainDoc = mainLeaf.view?.containerEl?.ownerDocument ?? activeDocument;
    addDocument(mainDoc);
    const mainResizer = await attachResizerToLeaf(mainLeaf);
    const mainImage = createDomImageFixture(mainLeaf, "main");
    await ensureHandles(mainImage, mainResizer, "main");
    metrics.mainHandlesCreated = countResizeHandles(mainDoc);
    await dispatchWheel(mainImage);
    metrics.mainActiveImageClearedAfterScroll = mainResizer.activeImage == null ? 1 : 0;
    await app.plugins.disablePlugin(id);
    await wait(250);
    metrics.mainLeakedContainersAfterScrollUnload = countResizeContainers(mainDoc);
    metrics.mainLeakedHandlesAfterScrollUnload = countResizeHandles(mainDoc);
    metrics.mainImagesRetainedAfterScrollUnload = countFixtureImages(mainDoc, "main");

    // Remove measured leaks before the popout scenario so failures stay independent.
    unwrapResizeContainers(mainDoc);

    await app.plugins.enablePlugin(id);
    await wait(700);

    if (typeof app.workspace.openPopoutLeaf === "function") {
      metrics.popoutAvailable = 1;
      popoutLeaf = app.workspace.openPopoutLeaf();
      await wait(900);
      await openFileInLeaf(popoutLeaf, file);
      const popoutDoc = popoutLeaf.view?.containerEl?.ownerDocument;
      if (!popoutDoc || popoutDoc === mainDoc) throw new Error("openPopoutLeaf did not expose a separate ownerDocument");
      addDocument(popoutDoc);
      try { previousActiveDocument = activeDocument; } catch {}
      try { activeDocument = popoutDoc; } catch (error) { notes.push({ label: "force-active-document", message: String(error) }); }

      const popoutResizer = await attachResizerToLeaf(popoutLeaf);
      const popoutImage = createDomImageFixture(popoutLeaf, "popout");
      const clickProbe = await dispatchClickOverrideProbe(popoutImage, popoutResizer);
      metrics.popoutClickOverridePrevented = clickProbe.prevented ? 1 : 0;
      metrics.popoutFocusedEmbedElementBlurred = clickProbe.blurred ? 1 : 0;

      unwrapResizeContainers(popoutDoc);
      popoutResizer.activeImage = null;
      await ensureHandles(popoutImage, popoutResizer, "popout");
      metrics.popoutHandlesCreated = countResizeHandles(popoutDoc);
      const handle = popoutImage.matchParent?.(".image-resize-container")?.querySelector?.(".image-resize-handle-se");
      if (!handle) throw new Error("No southeast resize handle found in popout view after hover/createHandles") ;

      const dragTrials = [];
      for (let trialIndex = 0; trialIndex < config.trials; trialIndex += 1) {
        const trial = await runPopoutDragTrial(popoutImage, handle, popoutResizer, trialIndex);
        dragTrials.push(trial);
        if (trial.started) metrics.popoutDragStarted = 1;
        if (trial.changed) metrics.popoutWidthChanged = 1;
        if (Number.isFinite(trial.latency)) dragLatencies.push(trial.latency);
      }
      metrics.p95PopoutDragLatencyMs = percentile(dragLatencies, 95);

      // Synthetic fallback for cleanupHandles(true) when markdownView is already gone but activeDocument is a popout.
      unwrapResizeContainers(popoutDoc);
      const fallbackContainer = popoutDoc.createElement("div");
      fallbackContainer.className = "image-resize-container";
      fallbackContainer.setAttribute("data-p95-fallback", "true");
      const fallbackImage = popoutDoc.createElement("img");
      fallbackImage.setAttribute("src", "app://vault/fixture.png");
      fallbackContainer.appendChild(fallbackImage);
      popoutDoc.body.appendChild(fallbackContainer);
      const savedView = popoutResizer.markdownView;
      const savedActiveImage = popoutResizer.activeImage;
      try {
        popoutResizer.markdownView = null;
        popoutResizer.activeImage = null;
        popoutResizer.cleanupHandles?.(true);
      } finally {
        popoutResizer.markdownView = savedView;
        popoutResizer.activeImage = savedActiveImage;
      }
      metrics.popoutFallbackLeakedContainersAfterForceCleanup = popoutDoc.querySelectorAll(".image-resize-container[data-p95-fallback]").length;

    } else {
      metrics.popoutAvailable = 0;
      errors.push({ label: "popout", message: "app.workspace.openPopoutLeaf is not available" });
    }
  } catch (error) {
    metrics.runtimeErrors += 1;
    errors.push({ label: "fatal", message: String(error?.stack ?? error) });
  } finally {
    metrics.finalLeakedContainers = countAllResizeContainers();
    for (const doc of collectDocuments()) unwrapResizeContainers(doc);
    for (const doc of collectDocuments()) removeDomFixtures(doc);

    if (popoutLeaf?.detach) {
      try { popoutLeaf.detach(); }
      catch (error) { notes.push({ label: "popout-detach", message: String(error) }); }
    }
    try { if (previousActiveDocument) activeDocument = previousActiveDocument; } catch {}

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
      catch (error) {
        metrics.runtimeErrors += 1;
        errors.push({ label: "restore-enable", message: String(error) });
      }
    }
  }

  metrics.p95PopoutDragLatencyMs = Number.isFinite(metrics.p95PopoutDragLatencyMs)
    ? metrics.p95PopoutDragLatencyMs
    : percentile(dragLatencies, 95);

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
        resizeContainers: countResizeContainers(doc),
        resizeHandles: countResizeHandles(doc),
        images: countImages(doc),
      })),
      dragLatencyMs: {
        count: dragLatencies.length,
        p95: metrics.p95PopoutDragLatencyMs,
        values: dragLatencies,
      },
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
  if (previous == null || current == null || Number.isNaN(previous) || Number.isNaN(current) || current === Number.POSITIVE_INFINITY || previous === Number.POSITIVE_INFINITY) return "-";
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
  console.log(`${name.padEnd(46)} ${formatValue(previous, suffix).padStart(12)} ${formatValue(current, suffix).padStart(12)} ${formatDelta(previous, current, suffix).padStart(12)} ${targetText.padStart(14)} ${status}`);
}

function printSummary(currentReport, previousReport) {
  const current = currentReport.metrics;
  const previous = previousReport?.metrics ?? null;

  console.log(`\nP95 ${CHECK_NAME}: ${currentReport.summary.pass ? "PASS" : "FAIL"}`);
  console.log("\nMetric                                          previous      current        delta         target status");
  console.log("-----------------------------------------------------------------------------------------------------");
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
  const injected = `const CHECK_NAME = ${JSON.stringify(CHECK_NAME)};\nconst reportExtra = {};\n(${measureImageResizerRuntimeInObsidian.toString()})(${JSON.stringify(args)})`;

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
