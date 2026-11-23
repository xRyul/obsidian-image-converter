#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

function parseArgs(argv) {
  const args = {
    vault: "plugin-testing-vault",
    id: "image-converter",
    cycles: 100,
    loadWaitMs: 150,
    unloadWaitMs: 150,
    reportPath: null,
    reportFile: null,
    leaveDisabled: false,
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
    else if (arg === "--cycles") args.cycles = Number(readValue());
    else if (arg === "--load-wait-ms") args.loadWaitMs = Number(readValue());
    else if (arg === "--unload-wait-ms") args.unloadWaitMs = Number(readValue());
    else if (arg === "--report-path") args.reportPath = readValue();
    else if (arg === "--report-file") args.reportFile = readValue();
    else if (arg === "--leave-disabled") args.leaveDisabled = true;
    else if (arg === "--help" || arg === "-h") {
      console.log(`Usage: node scripts/stress-plugin-unload.mjs [options]\n\nOptions:\n  --vault <name>          Obsidian vault name (default: plugin-testing-vault)\n  --id <plugin-id>        Plugin id (default: image-converter)\n  --cycles <n>            Load/unload cycles (default: 100)\n  --load-wait-ms <n>      Wait after enablePlugin before measuring (default: 150)\n  --unload-wait-ms <n>    Wait after disablePlugin before measuring (default: 150)\n  --report-path <path>    Vault-relative report path\n  --report-file <path>    Filesystem path to read the report from after eval\n  --leave-disabled        Do not restore the plugin's original loaded state\n`);
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!Number.isFinite(args.cycles) || args.cycles < 1) throw new Error("--cycles must be a positive number");
  if (!Number.isFinite(args.loadWaitMs) || args.loadWaitMs < 0) throw new Error("--load-wait-ms must be >= 0");
  if (!Number.isFinite(args.unloadWaitMs) || args.unloadWaitMs < 0) throw new Error("--unload-wait-ms must be >= 0");

  args.reportPath ??= `.obsidian/plugins/${args.id}/pi-unload-stress-report.json`;
  if (!args.reportFile && args.vault === "plugin-testing-vault") {
    args.reportFile = path.resolve(process.cwd(), "..", "plugin-testing-vault", args.reportPath);
  }
  return args;
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], ...options });
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

async function readReportWithRetry(reportFile, runId, timeoutMs) {
  const startedAt = Date.now();
  let lastError = null;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const reportRaw = await fs.readFile(reportFile, "utf8");
      const report = JSON.parse(reportRaw);
      if (report.runId === runId) return report;
      lastError = new Error(`Report exists but has runId=${report.runId ?? "<missing>"}; waiting for ${runId}`);
    } catch (error) {
      lastError = error;
    }

    await sleep(250);
  }

  throw new Error(`Timed out waiting for report ${reportFile}: ${lastError?.message ?? "unknown error"}`);
}

// This function is stringified and executed inside Obsidian by `obsidian eval`.
async function stressUnloadInObsidian(config) {
  const id = config.id;
  const cycles = config.cycles;
  const loadWaitMs = config.loadWaitMs;
  const unloadWaitMs = config.unloadWaitMs;
  const reportPath = config.reportPath;
  const leaveDisabled = config.leaveDisabled;
  const runId = config.runId;

  const wait = (ms) => new Promise((resolve) => originalSetTimeout(resolve, ms));
  const nowIso = () => new Date().toISOString();
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
    p99: percentile(values, 99),
    max: values.length ? round(Math.max(...values)) : 0,
  });

  const originalSetTimeout = window.setTimeout.bind(window);
  const originalClearTimeout = window.clearTimeout.bind(window);
  const originalSetInterval = window.setInterval.bind(window);
  const originalClearInterval = window.clearInterval.bind(window);
  const originalAddEventListener = EventTarget.prototype.addEventListener;
  const originalRemoveEventListener = EventTarget.prototype.removeEventListener;
  const OriginalMutationObserver = window.MutationObserver;

  const manifest = app.plugins.manifests?.[id];
  if (!manifest?.dir) throw new Error(`Plugin ${id} is not installed or has no manifest.dir`);

  const adapter = app.vault.adapter;
  const dataPath = `${manifest.dir}/data.json`;
  const originalDataExists = await adapter.exists(dataPath);
  const originalData = originalDataExists ? await adapter.read(dataPath) : null;
  const originallyLoaded = Boolean(app.plugins.plugins[id]);

  const captionCssProps = [
    "--image-converter-caption-align-items",
    "--image-converter-caption-font-size",
    "--image-converter-caption-color",
    "--image-converter-caption-bg",
    "--image-converter-caption-opacity",
    "--image-converter-caption-margin-top",
    "--image-converter-caption-padding",
    "--image-converter-caption-border-radius",
    "--image-converter-caption-font-style",
    "--image-converter-caption-font-weight",
    "--image-converter-caption-text-transform",
    "--image-converter-caption-letter-spacing",
    "--image-converter-caption-border",
    "--image-converter-caption-text-align",
  ];

  const domRecords = [];
  const eventRecords = [];
  const timeoutRecords = [];
  const intervalRecords = [];
  const observerRecords = [];
  const domEntries = [];
  const eventRefToRecord = new WeakMap();
  const observerToRecord = new WeakMap();
  let currentCycle = null;
  let currentPhase = "idle";
  let internalDepth = 0;
  let targetSeq = 0;
  const targetIds = new WeakMap();

  const isCapturing = () => currentCycle != null && internalDepth === 0;
  const captureOf = (options) => {
    if (options === true) return true;
    if (options && typeof options === "object") return Boolean(options.capture);
    return false;
  };
  const functionName = (listener) => {
    if (typeof listener === "function") return listener.name || "anonymous";
    if (listener && typeof listener === "object") return listener.constructor?.name || "listener-object";
    return typeof listener;
  };
  const targetLabel = (target) => {
    if (target === window) return "window";
    if (target === document) return "document";
    if (target === document.body) return "document.body";
    if (target instanceof HTMLElement) {
      const tag = target.tagName.toLowerCase();
      const idPart = target.id ? `#${target.id}` : "";
      const classPart = target.className && typeof target.className === "string"
        ? `.${target.className.trim().split(/\s+/).slice(0, 4).join(".")}`
        : "";
      return `${tag}${idPart}${classPart}`;
    }
    const ctor = target?.constructor?.name || typeof target;
    if (!targetIds.has(target)) targetIds.set(target, ++targetSeq);
    return `${ctor}#${targetIds.get(target)}`;
  };
  const activeRecords = (records, predicate) => records.filter((record) => predicate(record));
  const byKey = (records, keyFn) => {
    const result = {};
    for (const record of records) {
      const key = keyFn(record);
      result[key] = (result[key] || 0) + 1;
    }
    return result;
  };

  EventTarget.prototype.addEventListener = function patchedAddEventListener(type, listener, options) {
    if (isCapturing()) {
      const record = {
        cycle: currentCycle,
        phase: currentPhase,
        type: String(type),
        target: targetLabel(this),
        capture: captureOf(options),
        listener: functionName(listener),
        removed: false,
      };
      domRecords.push(record);
      domEntries.push({ target: this, type: String(type), listener, capture: captureOf(options), record });
    }
    return originalAddEventListener.apply(this, arguments);
  };

  EventTarget.prototype.removeEventListener = function patchedRemoveEventListener(type, listener, options) {
    const capture = captureOf(options);
    for (let i = domEntries.length - 1; i >= 0; i -= 1) {
      const entry = domEntries[i];
      if (!entry.record.removed && entry.target === this && entry.type === String(type) && entry.listener === listener && entry.capture === capture) {
        entry.record.removed = true;
        entry.record.removedPhase = currentPhase;
        break;
      }
    }
    return originalRemoveEventListener.apply(this, arguments);
  };

  window.setTimeout = function patchedSetTimeout(handler, delay, ...args) {
    if (!isCapturing()) return originalSetTimeout(handler, delay, ...args);
    let timerId;
    const record = {
      cycle: currentCycle,
      phase: currentPhase,
      delay: Number(delay) || 0,
      active: true,
      fired: false,
      cleared: false,
      handler: functionName(handler),
      id: null,
    };
    const wrapped = (...cbArgs) => {
      record.active = false;
      record.fired = true;
      if (typeof handler === "function") return handler(...cbArgs);
      return undefined;
    };
    timerId = originalSetTimeout(wrapped, delay, ...args);
    record.id = Number(timerId);
    timeoutRecords.push(record);
    return timerId;
  };
  window.clearTimeout = function patchedClearTimeout(timerId) {
    for (let i = timeoutRecords.length - 1; i >= 0; i -= 1) {
      const record = timeoutRecords[i];
      if (record.id === Number(timerId) && record.active) {
        record.active = false;
        record.cleared = true;
        record.clearedPhase = currentPhase;
        break;
      }
    }
    return originalClearTimeout(timerId);
  };
  globalThis.setTimeout = window.setTimeout;
  globalThis.clearTimeout = window.clearTimeout;

  window.setInterval = function patchedSetInterval(handler, delay, ...args) {
    const timerId = originalSetInterval(handler, delay, ...args);
    if (isCapturing()) {
      intervalRecords.push({
        cycle: currentCycle,
        phase: currentPhase,
        delay: Number(delay) || 0,
        active: true,
        cleared: false,
        handler: functionName(handler),
        id: Number(timerId),
      });
    }
    return timerId;
  };
  window.clearInterval = function patchedClearInterval(timerId) {
    for (let i = intervalRecords.length - 1; i >= 0; i -= 1) {
      const record = intervalRecords[i];
      if (record.id === Number(timerId) && record.active) {
        record.active = false;
        record.cleared = true;
        record.clearedPhase = currentPhase;
        break;
      }
    }
    return originalClearInterval(timerId);
  };
  globalThis.setInterval = window.setInterval;
  globalThis.clearInterval = window.clearInterval;

  if (OriginalMutationObserver) {
    window.MutationObserver = class InstrumentedMutationObserver extends OriginalMutationObserver {
      constructor(callback) {
        super(callback);
        if (isCapturing()) {
          const record = {
            cycle: currentCycle,
            phase: currentPhase,
            active: false,
            disconnected: false,
            observeCount: 0,
            target: null,
          };
          observerRecords.push(record);
          observerToRecord.set(this, record);
        }
      }
      observe(target, options) {
        const record = observerToRecord.get(this);
        if (record) {
          record.active = true;
          record.disconnected = false;
          record.observeCount += 1;
          record.target = targetLabel(target);
          record.options = {
            childList: Boolean(options?.childList),
            subtree: Boolean(options?.subtree),
            attributes: Boolean(options?.attributes),
            attributeFilter: Array.isArray(options?.attributeFilter) ? [...options.attributeFilter] : undefined,
          };
        }
        return super.observe(target, options);
      }
      disconnect() {
        const record = observerToRecord.get(this);
        if (record) {
          record.active = false;
          record.disconnected = true;
          record.disconnectedPhase = currentPhase;
        }
        return super.disconnect();
      }
    };
    globalThis.MutationObserver = window.MutationObserver;
  }

  const patchedEmitters = [];
  const wrongOffrefAttempts = [];
  const patchEmitter = (name, emitter) => {
    if (!emitter?.on || !emitter?.offref) return;
    const originalOn = emitter.on;
    const originalOffref = emitter.offref;
    emitter.on = function patchedOn(eventName, callback, ctx) {
      const ref = originalOn.apply(this, arguments);
      if (isCapturing()) {
        const record = {
          cycle: currentCycle,
          phase: currentPhase,
          emitter: name,
          eventName: String(eventName),
          listener: functionName(callback),
          off: false,
        };
        eventRecords.push(record);
        if (ref && typeof ref === "object") eventRefToRecord.set(ref, record);
      }
      return ref;
    };
    emitter.offref = function patchedOffref(ref) {
      if (ref && typeof ref === "object") {
        const record = eventRefToRecord.get(ref);
        if (record) {
          if (record.emitter === name) {
            record.off = true;
            record.offPhase = currentPhase;
            record.offEmitter = name;
          } else {
            wrongOffrefAttempts.push({
              cycle: currentCycle,
              phase: currentPhase,
              eventName: record.eventName,
              expectedEmitter: record.emitter,
              offEmitter: name,
            });
          }
        }
      }
      return originalOffref.apply(this, arguments);
    };
    patchedEmitters.push({ emitter, originalOn, originalOffref });
  };
  patchEmitter("workspace", app.workspace);
  patchEmitter("vault", app.vault);
  patchEmitter("metadataCache", app.metadataCache);

  const restoreInstrumentation = () => {
    EventTarget.prototype.addEventListener = originalAddEventListener;
    EventTarget.prototype.removeEventListener = originalRemoveEventListener;
    window.setTimeout = originalSetTimeout;
    window.clearTimeout = originalClearTimeout;
    window.setInterval = originalSetInterval;
    window.clearInterval = originalClearInterval;
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
    globalThis.setInterval = originalSetInterval;
    globalThis.clearInterval = originalClearInterval;
    if (OriginalMutationObserver) {
      window.MutationObserver = OriginalMutationObserver;
      globalThis.MutationObserver = OriginalMutationObserver;
    }
    for (const patch of patchedEmitters) {
      patch.emitter.on = patch.originalOn;
      patch.emitter.offref = patch.originalOffref;
    }
  };

  const ensureProbeNoteOpen = async () => {
    const folderPath = "_pi";
    if (!app.vault.getAbstractFileByPath(folderPath)) {
      try { await app.vault.createFolder(folderPath); } catch (error) { if (!String(error).includes("already exists")) throw error; }
    }
    const notePath = `${folderPath}/unload-stress.md`;
    let file = app.vault.getAbstractFileByPath(notePath);
    const content = "# Image Converter unload stress\n\nThis note is opened by scripts/stress-plugin-unload.mjs so the plugin has an active MarkdownView during load.\n\n![[pi-unload-stress-image.png|probe image]]\n";
    if (!file) file = await app.vault.create(notePath, content);
    else if (file.extension === "md") await app.vault.modify(file, content);
    const leaf = app.workspace.getLeaf(true);
    await leaf.openFile(file);
    await wait(100);
    return file;
  };

  const writeAllOnSettings = async () => {
    const settings = {
      isImageAlignmentEnabled: true,
      imageAlignmentCacheCleanupInterval: 3600000,
      imageAlignmentCacheLocation: "config",
      isImageResizeEnbaled: true,
      isDragResizeEnabled: true,
      isScrollResizeEnabled: true,
      isDragAspectRatioLocked: true,
      isResizeInReadingModeEnabled: true,
      disableObsidianImageSelectionOnClick: true,
      enableContextMenu: true,
      enableImageCaptions: true,
      skipCaptionExtensions: "icns",
      modalBehavior: "never",
    };
    await adapter.write(dataPath, JSON.stringify(settings, null, 2));
  };

  const restoreSettings = async () => {
    if (originalDataExists) await adapter.write(dataPath, originalData);
    else if (await adapter.exists(dataPath)) await adapter.remove(dataPath);
  };

  const commandIds = () => Object.keys(app.commands?.commands || {}).filter((commandId) => commandId.startsWith(`${id}:`)).sort();
  const bodyCaptionStyleResidue = () => Object.fromEntries(
    captionCssProps
      .map((prop) => [prop, document.body.style.getPropertyValue(prop)])
      .filter(([, value]) => value)
  );
  const componentState = (plugin) => {
    if (!plugin) return null;
    return {
      supportedImageFormats: Boolean(plugin.supportedImageFormats),
      folderAndFilenameManagement: Boolean(plugin.folderAndFilenameManagement),
      imageProcessor: Boolean(plugin.imageProcessor),
      variableProcessor: Boolean(plugin.variableProcessor),
      linkFormatter: Boolean(plugin.linkFormatter),
      batchImageProcessor: Boolean(plugin.batchImageProcessor),
      contextMenu: Boolean(plugin.contextMenu),
      contextMenuRegistered: Boolean(plugin.contextMenu?.contextMenuRegistered),
      imageAlignmentManager: Boolean(plugin.ImageAlignmentManager),
      imageAlignmentEventRefs: plugin.ImageAlignmentManager?.eventRefs?.length ?? null,
      imageAlignmentIntervalActive: Boolean(plugin.ImageAlignmentManager?.cleanupIntervalId),
      imageResizer: Boolean(plugin.imageResizer),
      imageResizerAttached: Boolean(plugin.imageResizer?.markdownView),
      imageResizerHandles: plugin.imageResizer?.handles?.length ?? null,
      captionManager: Boolean(plugin.captionManager),
      captionObserverActive: Boolean(plugin.captionManager?.observer),
    };
  };
  const domRecordKey = (record) => `${record.target}:${record.type}${record.capture ? ":capture" : ""}`;
  const domRecordKeyWithListener = (record) => `${domRecordKey(record)}:${record.listener}`;
  const pluginDomListeners = new Map([
    ["div.workspace-leaf-content:mouseover", new Set(["handleImageHover"])],
    ["div.workspace-leaf-content:mousedown:capture", new Set(["handleImageMouseDownCapture"])],
    ["div.workspace-leaf-content:click:capture", new Set(["handleImageClickCapture"])],
    ["document:mousedown", new Set(["handleMouseDown"])],
    ["document:mousemove", new Set(["handleMouseMove"])],
    ["document:mouseup", new Set(["handleMouseUp"])],
    ["div.workspace-leaf-content:wheel", new Set(["handleMouseWheel"])],
    ["document:pointerdown:capture", new Set(["handleContextMenuPointerDownCapture"])],
    ["document:mousedown:capture", new Set(["handleContextMenuMouseDownCapture"])],
    ["document:contextmenu:capture", new Set(["handleContextMenuEvent"])],
    ["document:click", new Set(["documentClickHandler"])],
  ]);
  const isPluginDomRecord = (record) => {
    const listeners = pluginDomListeners.get(domRecordKey(record));
    return Boolean(listeners?.has(record.listener));
  };
  const isPluginIntervalRecord = (record) => record.delay === 3600000;
  const resourceCounts = (cycle) => {
    const dom = domRecords.filter((record) => record.cycle === cycle);
    const events = eventRecords.filter((record) => record.cycle === cycle);
    const timeouts = timeoutRecords.filter((record) => record.cycle === cycle);
    const intervals = intervalRecords.filter((record) => record.cycle === cycle);
    const observers = observerRecords.filter((record) => record.cycle === cycle);

    const domActive = activeRecords(dom, (record) => !record.removed);
    const eventsActive = activeRecords(events, (record) => !record.off);
    const timeoutsActive = activeRecords(timeouts, (record) => record.active && !record.fired && !record.cleared);
    const intervalsActive = activeRecords(intervals, (record) => record.active && !record.cleared);
    const observersActive = activeRecords(observers, (record) => record.active && !record.disconnected);
    const pluginDomActive = domActive.filter(isPluginDomRecord);
    const pluginIntervalsActive = intervalsActive.filter(isPluginIntervalRecord);

    return {
      added: {
        domListeners: dom.length,
        eventRefs: events.length,
        timeouts: timeouts.length,
        intervals: intervals.length,
        mutationObservers: observers.length,
      },
      active: {
        domListeners: domActive.length,
        eventRefs: eventsActive.length,
        timeouts: timeoutsActive.length,
        intervals: intervalsActive.length,
        mutationObservers: observersActive.length,
      },
      pluginActive: {
        domListeners: pluginDomActive.length,
        eventRefs: eventsActive.length,
        intervals: pluginIntervalsActive.length,
        mutationObservers: observersActive.length,
      },
      addedBreakdown: {
        domByTargetAndType: byKey(dom, domRecordKey),
        domByTargetTypeAndListener: byKey(dom, domRecordKeyWithListener),
        eventsByEmitterAndName: byKey(events, (record) => `${record.emitter}:${record.eventName}`),
        timeoutsByDelayAndHandler: byKey(timeouts, (record) => `${record.delay}ms:${record.handler}`),
        intervalsByDelay: byKey(intervals, (record) => `${record.delay}ms`),
        observersByTarget: byKey(observers, (record) => record.target || "constructed-only"),
      },
      activeBreakdown: {
        domByTargetAndType: byKey(domActive, domRecordKey),
        domByTargetTypeAndListener: byKey(domActive, domRecordKeyWithListener),
        pluginDomByTargetAndType: byKey(pluginDomActive, domRecordKey),
        pluginDomByTargetTypeAndListener: byKey(pluginDomActive, domRecordKeyWithListener),
        eventsByEmitterAndName: byKey(eventsActive, (record) => `${record.emitter}:${record.eventName}`),
        timeoutsByDelayAndHandler: byKey(timeoutsActive, (record) => `${record.delay}ms:${record.handler}`),
        intervalsByDelay: byKey(intervalsActive, (record) => `${record.delay}ms`),
        pluginIntervalsByDelayAndHandler: byKey(pluginIntervalsActive, (record) => `${record.delay}ms:${record.handler}`),
        observersByTarget: byKey(observersActive, (record) => record.target || "constructed-only"),
      },
    };
  };
  const snapshot = (cycle, pluginRef = app.plugins.plugins[id] || null) => ({
    pluginLoaded: Boolean(app.plugins.plugins[id]),
    enabledPluginsHasId: Boolean(app.plugins.enabledPlugins?.has?.(id)),
    commandIds: commandIds(),
    bodyClasses: {
      captionsEnabled: document.body.classList.contains("image-captions-enabled"),
      nativeSelectionDisabled: document.body.classList.contains("image-converter-disable-native-image-selection"),
    },
    bodyCaptionStyleResidue: bodyCaptionStyleResidue(),
    domResidue: {
      resizeHandles: document.querySelectorAll(".image-resize-handle").length,
      resizeContainers: document.querySelectorAll(".image-resize-container").length,
      contextMenuInfoContainers: document.querySelectorAll(".image-converter-contextmenu-info-container").length,
      pluginClassElements: document.querySelectorAll('[class*="image-converter"], .image-resize-handle, .image-resize-container').length,
    },
    components: componentState(pluginRef),
    resources: resourceCounts(cycle),
  });

  const cyclesReport = [];
  const errors = [];
  let probeFilePath = null;

  try {
    internalDepth += 1;
    try {
      if (app.plugins.plugins[id]) {
        await app.plugins.disablePlugin(id);
        await wait(unloadWaitMs);
      }
      await writeAllOnSettings();
      const probeFile = await ensureProbeNoteOpen();
      probeFilePath = probeFile.path;
    } finally {
      internalDepth -= 1;
    }

    for (let cycle = 1; cycle <= cycles; cycle += 1) {
      let pluginRef = null;
      const cycleReport = { cycle };
      try {
        currentCycle = cycle;
        currentPhase = "load";
        const loadStart = performance.now();
        await app.plugins.enablePlugin(id);
        await wait(loadWaitMs);

        pluginRef = app.plugins.plugins[id] || null;
        const activeFile = app.workspace.getActiveFile();
        try { app.workspace.trigger?.("file-open", activeFile); } catch (error) { errors.push({ cycle, phase: "trigger:file-open", message: String(error) }); }
        try { app.workspace.trigger?.("active-leaf-change", app.workspace.activeLeaf); } catch (error) { errors.push({ cycle, phase: "trigger:active-leaf-change", message: String(error) }); }
        try { app.workspace.trigger?.("layout-change"); } catch (error) { errors.push({ cycle, phase: "trigger:layout-change", message: String(error) }); }
        await wait(50);

        cycleReport.loadMs = round(performance.now() - loadStart);
        cycleReport.loaded = snapshot(cycle, pluginRef);

        currentPhase = "unload";
        const unloadStart = performance.now();
        await app.plugins.disablePlugin(id);
        await wait(unloadWaitMs);
        cycleReport.unloadMs = round(performance.now() - unloadStart);
        cycleReport.unloaded = snapshot(cycle, pluginRef);
      } catch (error) {
        cycleReport.error = error instanceof Error ? { message: error.message, stack: error.stack } : { message: String(error) };
        errors.push({ cycle, phase: currentPhase, message: cycleReport.error.message });
        try {
          if (app.plugins.plugins[id]) {
            await app.plugins.disablePlugin(id);
            await wait(unloadWaitMs);
          }
        } catch (disableError) {
          errors.push({ cycle, phase: "error-cleanup-disable", message: String(disableError) });
        }
      } finally {
        currentPhase = "idle";
        currentCycle = null;
        cyclesReport.push(cycleReport);
      }
    }
  } finally {
    restoreInstrumentation();
  }

  const loadedResourceCounts = cyclesReport.map((cycle) => cycle.loaded?.resources?.added).filter(Boolean);
  const unloadedActiveCounts = cyclesReport.map((cycle) => cycle.unloaded?.resources?.active).filter(Boolean);
  const maxActiveAfterUnload = (key) => unloadedActiveCounts.length ? Math.max(...unloadedActiveCounts.map((counts) => counts[key] ?? 0)) : 0;
  const unloadedPluginActiveCounts = cyclesReport.map((cycle) => cycle.unloaded?.resources?.pluginActive).filter(Boolean);
  const maxPluginActiveAfterUnload = (key) => unloadedPluginActiveCounts.length ? Math.max(...unloadedPluginActiveCounts.map((counts) => counts[key] ?? 0)) : 0;
  const allCommandsCleared = cyclesReport.every((cycle) => (cycle.unloaded?.commandIds?.length ?? 0) === 0);
  const allPluginObjectsCleared = cyclesReport.every((cycle) => cycle.unloaded?.pluginLoaded === false);
  const allBodyClassesCleared = cyclesReport.every((cycle) => !cycle.unloaded?.bodyClasses?.captionsEnabled && !cycle.unloaded?.bodyClasses?.nativeSelectionDisabled);
  const allCaptionStylesCleared = cyclesReport.every((cycle) => Object.keys(cycle.unloaded?.bodyCaptionStyleResidue || {}).length === 0);
  const allDomResidueCleared = cyclesReport.every((cycle) => {
    const residue = cycle.unloaded?.domResidue;
    return residue
      && residue.resizeHandles === 0
      && residue.resizeContainers === 0
      && residue.contextMenuInfoContainers === 0
      && residue.pluginClassElements === 0;
  });

  const summary = {
    cycles: cyclesReport.length,
    pass: errors.length === 0
      && allCommandsCleared
      && allPluginObjectsCleared
      && allBodyClassesCleared
      && allCaptionStylesCleared
      && allDomResidueCleared
      && maxPluginActiveAfterUnload("domListeners") === 0
      && maxPluginActiveAfterUnload("eventRefs") === 0
      && maxPluginActiveAfterUnload("intervals") === 0
      && maxPluginActiveAfterUnload("mutationObservers") === 0
      && wrongOffrefAttempts.length === 0,
    timingsMs: {
      load: stats(cyclesReport.map((cycle) => cycle.loadMs).filter((value) => typeof value === "number")),
      unload: stats(cyclesReport.map((cycle) => cycle.unloadMs).filter((value) => typeof value === "number")),
    },
    loadedResourcesPerCycle: {
      domListeners: stats(loadedResourceCounts.map((counts) => counts.domListeners)),
      eventRefs: stats(loadedResourceCounts.map((counts) => counts.eventRefs)),
      intervals: stats(loadedResourceCounts.map((counts) => counts.intervals)),
      mutationObservers: stats(loadedResourceCounts.map((counts) => counts.mutationObservers)),
      timeouts: stats(loadedResourceCounts.map((counts) => counts.timeouts)),
    },
    maxActiveAfterUnload: {
      domListeners: maxActiveAfterUnload("domListeners"),
      eventRefs: maxActiveAfterUnload("eventRefs"),
      intervals: maxActiveAfterUnload("intervals"),
      mutationObservers: maxActiveAfterUnload("mutationObservers"),
      timeouts: maxActiveAfterUnload("timeouts"),
    },
    maxPluginActiveAfterUnload: {
      domListeners: maxPluginActiveAfterUnload("domListeners"),
      eventRefs: maxPluginActiveAfterUnload("eventRefs"),
      intervals: maxPluginActiveAfterUnload("intervals"),
      mutationObservers: maxPluginActiveAfterUnload("mutationObservers"),
    },
    cleanupChecks: {
      allCommandsCleared,
      allPluginObjectsCleared,
      allBodyClassesCleared,
      allCaptionStylesCleared,
      allDomResidueCleared,
    },
    firstLoadedResourceBreakdown: cyclesReport[0]?.loaded?.resources?.addedBreakdown ?? null,
    firstUnloadedActiveBreakdown: cyclesReport[0]?.unloaded?.resources?.activeBreakdown ?? null,
    wrongOffrefAttempts,
    errors,
  };

  const report = {
    runId,
    generatedAt: nowIso(),
    appVersion: app.version,
    vault: app.vault.getName?.() ?? null,
    plugin: {
      id,
      manifestVersion: manifest.version,
      manifestDir: manifest.dir,
      originallyLoaded,
      dataPath,
      allOnSettingsUsed: true,
      probeFilePath,
    },
    config: { cycles, loadWaitMs, unloadWaitMs, reportPath, leaveDisabled },
    summary,
    cycles: cyclesReport,
  };

  await adapter.write(reportPath, JSON.stringify(report, null, 2));

  await restoreSettings();

  if (!leaveDisabled && originallyLoaded) {
    try {
      await app.plugins.enablePlugin(id);
    } catch (error) {
      // The report is already written; this marker lets a follow-up read see restore failures.
      report.summary.restoreError = error instanceof Error ? error.message : String(error);
      await adapter.write(reportPath, JSON.stringify(report, null, 2));
    }
  }

  return JSON.stringify({ reportPath, summary });
}

function formatStats(stats) {
  return `min ${stats.min} / mean ${stats.mean} / p50 ${stats.p50} / p95 ${stats.p95} / max ${stats.max}`;
}

function printSummary(report) {
  const { summary } = report;
  console.log(`\nStress unload report: ${summary.pass ? "PASS" : "FAIL"}`);
  console.log(`Cycles: ${summary.cycles}`);
  console.log(`Load ms:   ${formatStats(summary.timingsMs.load)}`);
  console.log(`Unload ms: ${formatStats(summary.timingsMs.unload)}`);
  console.log("Loaded resources per cycle (mean / p95):");
  for (const [key, value] of Object.entries(summary.loadedResourcesPerCycle)) {
    console.log(`  ${key}: mean ${value.mean}, p95 ${value.p95}, min ${value.min}, max ${value.max}`);
  }
  console.log("Max active after unload:", JSON.stringify(summary.maxActiveAfterUnload));
  console.log("Max plugin-owned active after unload:", JSON.stringify(summary.maxPluginActiveAfterUnload));
  console.log("Cleanup checks:", JSON.stringify(summary.cleanupChecks));
  if (summary.wrongOffrefAttempts?.length) console.log("Wrong offref attempts:", JSON.stringify(summary.wrongOffrefAttempts.slice(0, 5), null, 2));
  if (summary.errors?.length) console.log("Errors:", JSON.stringify(summary.errors.slice(0, 5), null, 2));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  args.runId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const injected = `(${stressUnloadInObsidian.toString()})(${JSON.stringify(args)})`;

  console.log(`Running Obsidian unload stress: vault=${args.vault}, plugin=${args.id}, cycles=${args.cycles}`);
  if (args.reportFile) {
    await fs.rm(args.reportFile, { force: true });
  }

  const result = await run("obsidian", [`vault=${args.vault}`, "eval", `code=${injected}`]);
  if (result.stdout.trim()) console.log(result.stdout.trim());
  if (result.stderr.trim()) console.error(result.stderr.trim());

  if (!args.reportFile) {
    console.log(`Report written in vault at: ${args.reportPath}`);
    return;
  }

  const timeoutMs = Math.max(60_000, args.cycles * (args.loadWaitMs + args.unloadWaitMs + 400));
  const report = await readReportWithRetry(args.reportFile, args.runId, timeoutMs);
  printSummary(report);
  console.log(`Report file: ${args.reportFile}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
