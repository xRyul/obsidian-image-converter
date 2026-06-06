#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

function parseArgs(argv) {
  const args = {
    vault: "plugin-testing-vault",
    id: "image-converter",
    notes: 5,
    noteRounds: 10,
    modeSwitches: 30,
    alignmentCycles: 60,
    resizeCycles: 30,
    contextMenuCycles: 50,
    reportPath: null,
    reportFile: null,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = argv[i + 1];
    const readValue = () => {
      if (value == null) throw new Error(`Missing value for ${arg}`);
      i += 1;
      return value;
    };

    if (arg === "--vault") args.vault = readValue();
    else if (arg === "--id") args.id = readValue();
    else if (arg === "--notes") args.notes = Number(readValue());
    else if (arg === "--note-rounds") args.noteRounds = Number(readValue());
    else if (arg === "--mode-switches") args.modeSwitches = Number(readValue());
    else if (arg === "--alignment-cycles") args.alignmentCycles = Number(readValue());
    else if (arg === "--resize-cycles") args.resizeCycles = Number(readValue());
    else if (arg === "--context-menu-cycles") args.contextMenuCycles = Number(readValue());
    else if (arg === "--report-path") args.reportPath = readValue();
    else if (arg === "--report-file") args.reportFile = readValue();
    else if (arg === "--help" || arg === "-h") {
      console.log(`Usage: node scripts/stress-plugin-interactions.mjs [options]\n\nOptions:\n  --vault <name>              Obsidian vault name (default: plugin-testing-vault)\n  --id <plugin-id>            Plugin id (default: image-converter)\n  --notes <n>                 Notes to switch across (default: 5)\n  --note-rounds <n>           Rounds through all notes (default: 10)\n  --mode-switches <n>         Reading/source view-state changes (default: 30)\n  --alignment-cycles <n>      Alignment changes (default: 60)\n  --resize-cycles <n>         Hover/drag/wheel resize cycles (default: 30)\n  --context-menu-cycles <n>   Context menu open/close cycles (default: 50)\n  --report-path <path>        Vault-relative report path\n  --report-file <path>        Filesystem path to read report from\n`);
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  args.reportPath ??= `.obsidian/plugins/${args.id}/pi-interaction-stress-report.json`;
  if (!args.reportFile && args.vault === "plugin-testing-vault") {
    args.reportFile = path.resolve(process.cwd(), "..", "plugin-testing-vault", args.reportPath);
  }

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

async function readReportWithRetry(reportFile, runId, timeoutMs = 120_000) {
  const startedAt = Date.now();
  let lastError = null;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const raw = await fs.readFile(reportFile, "utf8");
      const report = JSON.parse(raw);
      if (report.runId === runId) return report;
      lastError = new Error(`Report runId=${report.runId ?? "<missing>"}; waiting for ${runId}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(250);
  }

  throw new Error(`Timed out waiting for ${reportFile}: ${lastError?.message ?? "unknown error"}`);
}

async function stressInteractionsInObsidian(config) {
  const id = config.id;
  const runId = config.runId;
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const round = (value) => Math.round(value * 100) / 100;
  const stats = (values) => {
    const sorted = [...values].sort((a, b) => a - b);
    const pct = (p) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))] : 0;
    return {
      count: values.length,
      min: sorted.length ? round(sorted[0]) : 0,
      mean: sorted.length ? round(values.reduce((sum, value) => sum + value, 0) / values.length) : 0,
      p50: round(pct(50)),
      p95: round(pct(95)),
      max: sorted.length ? round(sorted[sorted.length - 1]) : 0,
    };
  };

  const manifest = app.plugins.manifests?.[id];
  if (!manifest?.dir) throw new Error(`Plugin ${id} is not installed`);

  const adapter = app.vault.adapter;
  const dataPath = `${manifest.dir}/data.json`;
  const originalDataExists = await adapter.exists(dataPath);
  const originalData = originalDataExists ? await adapter.read(dataPath) : null;
  const alignmentCachePath = `${app.vault.configDir}/image-converter-image-alignments.json`;
  const originalAlignmentCacheExists = await adapter.exists(alignmentCachePath);
  const originalAlignmentCache = originalAlignmentCacheExists ? await adapter.read(alignmentCachePath) : null;
  const originallyLoaded = Boolean(app.plugins.plugins[id]);

  const errors = [];
  const samples = [];
  const scenarioTimings = {};

  const allOnSettings = {
    isImageAlignmentEnabled: true,
    imageAlignmentDefaultAlignment: "none",
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
    outputFormat: "NONE",
  };

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

  const getPlugin = () => app.plugins.plugins[id] || app.plugins.getPlugin?.(id);
  const EXPECTED_CONTEXT_MENU_EVENTS = 5; // 4 document DOM listeners + 1 window-open EventRef.
  const getActiveView = () => app.workspace.activeLeaf?.view;
  const getActiveImage = () => getActiveView()?.containerEl?.querySelector?.(".image-embed img") || null;

  const countPluginClassElements = () => document.querySelectorAll('[class*="image-converter"], .image-resize-handle, .image-resize-container, .image-position-left, .image-position-center, .image-position-right, .image-wrap, .image-no-wrap').length;
  const snapshot = (label) => {
    const plugin = getPlugin();
    const resizer = plugin?.imageResizer;
    const contextMenu = plugin?.contextMenu;
    const alignmentManager = plugin?.ImageAlignmentManager;
    const captionManager = plugin?.captionManager;
    const sample = {
      label,
      pluginLoaded: Boolean(plugin),
      contextMenuEvents: contextMenu?._events?.length ?? null,
      contextMenuRegistered: Boolean(contextMenu?.contextMenuRegistered),
      resizerRootEvents: resizer?._events?.length ?? null,
      resizerChildren: resizer?._children?.length ?? null,
      resizerViewScopeEvents: resizer?.viewScope?._events?.length ?? null,
      resizerAttached: Boolean(resizer?.markdownView),
      resizerHandles: resizer?.handles?.length ?? null,
      resizeContainers: document.querySelectorAll(".image-resize-container").length,
      resizeHandlesDom: document.querySelectorAll(".image-resize-handle").length,
      alignmentEventRefs: alignmentManager?.eventRefs?.length ?? null,
      alignmentIntervalActive: Boolean(alignmentManager?.cleanupIntervalId),
      captionObserverActive: Boolean(captionManager?.observer),
      bodyCaptionsClass: document.body.classList.contains("image-captions-enabled"),
      bodyNativeSelectionClass: document.body.classList.contains("image-converter-disable-native-image-selection"),
      pluginClassElements: countPluginClassElements(),
      menuElements: document.querySelectorAll(".menu").length,
      contextMenuInfoContainers: document.querySelectorAll(".image-converter-contextmenu-info-container").length,
      activeFile: app.workspace.getActiveFile()?.path ?? null,
      activeMode: getActiveView()?.getState?.()?.mode ?? null,
      imageCount: getActiveView()?.containerEl?.querySelectorAll?.("img")?.length ?? 0,
    };
    samples.push(sample);
    return sample;
  };

  const assertStableLoaded = (sample, label) => {
    if (!sample.pluginLoaded) errors.push({ label, message: "plugin not loaded" });
    if (sample.contextMenuEvents !== EXPECTED_CONTEXT_MENU_EVENTS) errors.push({ label, message: `contextMenuEvents expected ${EXPECTED_CONTEXT_MENU_EVENTS}, got ${sample.contextMenuEvents}` });
    if (sample.resizerChildren !== 1) errors.push({ label, message: `resizerChildren expected 1, got ${sample.resizerChildren}` });
    if (sample.resizerViewScopeEvents !== 7) errors.push({ label, message: `resizerViewScopeEvents expected 7, got ${sample.resizerViewScopeEvents}` });
    if (sample.alignmentEventRefs !== 2) errors.push({ label, message: `alignmentEventRefs expected 2, got ${sample.alignmentEventRefs}` });
    if (!sample.alignmentIntervalActive) errors.push({ label, message: "alignment cleanup interval inactive" });
    if (!sample.captionObserverActive) errors.push({ label, message: "caption observer inactive" });
    if (!sample.bodyCaptionsClass) errors.push({ label, message: "caption body class missing" });
    if (!sample.bodyNativeSelectionClass) errors.push({ label, message: "native selection suppression body class missing" });
    if (sample.contextMenuInfoContainers !== 0) errors.push({ label, message: `context menu DOM residue ${sample.contextMenuInfoContainers}` });
  };

  const timed = async (name, fn) => {
    const start = performance.now();
    try {
      return await fn();
    } finally {
      const elapsed = round(performance.now() - start);
      (scenarioTimings[name] ||= []).push(elapsed);
    }
  };

  const openNote = async (file) => {
    const leaf = app.workspace.getLeaf(true);
    await leaf.openFile(file);
    await wait(350);
    try { app.workspace.trigger?.("file-open", file); } catch (error) { errors.push({ label: "trigger:file-open", message: String(error) }); }
    try { app.workspace.trigger?.("active-leaf-change", leaf); } catch (error) { errors.push({ label: "trigger:active-leaf-change", message: String(error) }); }
    try { app.workspace.trigger?.("layout-change"); } catch (error) { errors.push({ label: "trigger:layout-change", message: String(error) }); }
    await wait(150);
    return leaf;
  };

  const setModeState = async (leaf, file, mode) => {
    if (!leaf?.setViewState) return;
    await leaf.setViewState({ type: "markdown", state: { file: file.path, mode, source: mode === "source" ? false : undefined }, active: true });
    await wait(180);
    try { app.workspace.trigger?.("layout-change"); } catch (error) { errors.push({ label: "trigger:layout-change:mode", message: String(error) }); }
    await wait(60);
  };

  const waitFor = async (predicate, timeoutMs = 500, intervalMs = 25) => {
    const startedAt = performance.now();
    while (performance.now() - startedAt < timeoutMs) {
      if (predicate()) return true;
      await wait(intervalMs);
    }
    return predicate();
  };

  const dispatchHover = async () => {
    const image = getActiveImage();
    if (!image) return false;
    image.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, cancelable: true, clientX: 80, clientY: 80 }));
    await waitFor(() => document.querySelectorAll(".image-resize-handle").length === 8, 500);
    return true;
  };

  const dragResize = async () => {
    const image = getActiveImage();
    if (!image) return false;
    image.style.width = image.style.width || "120px";
    image.style.height = image.style.height || "80px";
    image.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: 120, bottom: 80, width: 120, height: 80, toJSON() {} });
    await dispatchHover();
    const handle = document.querySelector(".image-resize-handle-se");
    if (!handle) return false;
    handle.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, clientX: 120, clientY: 80 }));
    document.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, cancelable: true, clientX: 150, clientY: 110 }));
    await wait(40);
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, clientX: 150, clientY: 110 }));
    await wait(80);
    return true;
  };

  const wheelResize = async () => {
    const image = getActiveImage();
    if (!image) return false;
    image.style.width = image.style.width || "120px";
    image.style.height = image.style.height || "80px";
    image.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: 120, bottom: 80, width: 120, height: 80, toJSON() {} });
    const event = new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: -20, shiftKey: true });
    image.dispatchEvent(event);
    await wait(360);
    return true;
  };

  const openAndCloseContextMenu = async () => {
    const image = getActiveImage();
    if (!image) return false;
    image.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2, clientX: 120, clientY: 100 }));
    await wait(30);
    document.body.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, clientX: 1, clientY: 1 }));
    await wait(30);
    return true;
  };

  try {
    if (app.plugins.plugins[id]) {
      await app.plugins.disablePlugin(id);
      await wait(250);
    }

    await adapter.write(dataPath, JSON.stringify(allOnSettings, null, 2));
    await ensureFolder("_pi");
    await ensureBinary("_pi/pi-interaction-image.png", pngBuffer);

    const files = [];
    for (let i = 1; i <= config.notes; i += 1) {
      files.push(await ensureFile(
        `_pi/interaction-stress-${i}.md`,
        `# Interaction stress ${i}\n\n![[pi-interaction-image.png|stress image ${i}|120]]\n\nSome text around the image for wrap/alignment testing.\n`
      ));
    }

    await app.plugins.enablePlugin(id);
    await wait(350);
    await openNote(files[0]);
    const initial = snapshot("initial-loaded");
    assertStableLoaded(initial, "initial-loaded");

    await timed("note-switch-total", async () => {
      for (let roundIndex = 0; roundIndex < config.noteRounds; roundIndex += 1) {
        for (const file of files) {
          await timed("note-switch-step", async () => {
            await openNote(file);
            const hovered = await dispatchHover();
            const sample = snapshot(`note-switch:${roundIndex}:${file.basename}`);
            if (!hovered) errors.push({ label: sample.label, message: "no image to hover" });
            assertStableLoaded(sample, sample.label);
            if (sample.resizeHandlesDom !== 8) errors.push({ label: sample.label, message: `expected 8 resize handles after hover, got ${sample.resizeHandlesDom}` });
          });
        }
      }
    });

    await openNote(files[0]);
    const activeLeaf = app.workspace.activeLeaf;
    await timed("mode-switch-total", async () => {
      for (let i = 0; i < config.modeSwitches; i += 1) {
        await timed("mode-switch-step", async () => {
          await setModeState(activeLeaf, files[0], i % 2 === 0 ? "preview" : "source");
          const sample = snapshot(`mode-switch:${i}`);
          assertStableLoaded(sample, sample.label);
          if (sample.resizeContainers > 1) errors.push({ label: sample.label, message: `resize containers accumulated: ${sample.resizeContainers}` });
        });
      }
    });

    await openNote(files[0]);
    await timed("alignment-cycle-total", async () => {
      const manager = getPlugin()?.ImageAlignmentManager;
      const alignments = ["left", "center", "right", "none"];
      for (let i = 0; i < config.alignmentCycles; i += 1) {
        await timed("alignment-cycle-step", async () => {
          const align = alignments[i % alignments.length];
          await manager.saveImageAlignmentToCache(files[0].path, "pi-interaction-image.png", align, "120px", "80px", i % 2 === 0);
          await manager.applyAlignmentsToNote(files[0].path);
          await wait(20);
          const sample = snapshot(`alignment:${i}:${align}`);
          assertStableLoaded(sample, sample.label);
          if (sample.resizeContainers > 1) errors.push({ label: sample.label, message: `resize containers accumulated during alignment: ${sample.resizeContainers}` });
        });
      }
    });

    await openNote(files[0]);
    await timed("resize-cycle-total", async () => {
      for (let i = 0; i < config.resizeCycles; i += 1) {
        const dragged = await timed("drag-resize-step", dragResize);
        const wheeled = await timed("wheel-resize-step", wheelResize);
        const sample = snapshot(`resize:${i}`);
        if (!dragged) errors.push({ label: sample.label, message: "drag resize did not find image/handle" });
        if (!wheeled) errors.push({ label: sample.label, message: "wheel resize did not find image" });
        assertStableLoaded(sample, sample.label);
        if (sample.resizeContainers > 1) errors.push({ label: sample.label, message: `resize containers accumulated: ${sample.resizeContainers}` });
        if (sample.resizeHandlesDom > 8) errors.push({ label: sample.label, message: `resize handles accumulated: ${sample.resizeHandlesDom}` });
      }
    });

    await openNote(files[0]);
    await timed("context-menu-cycle-total", async () => {
      for (let i = 0; i < config.contextMenuCycles; i += 1) {
        const opened = await timed("context-menu-open-close-step", openAndCloseContextMenu);
        const sample = snapshot(`context-menu:${i}`);
        if (!opened) errors.push({ label: sample.label, message: "context menu did not find image" });
        assertStableLoaded(sample, sample.label);
        if (sample.menuElements !== 0) errors.push({ label: sample.label, message: `menu elements left open: ${sample.menuElements}` });
        if (sample.contextMenuEvents !== EXPECTED_CONTEXT_MENU_EVENTS) errors.push({ label: sample.label, message: `context menu component events accumulated: ${sample.contextMenuEvents}` });
      }
    });

    const beforeUnload = snapshot("before-unload");
    assertStableLoaded(beforeUnload, "before-unload");

    await app.plugins.disablePlugin(id);
    await wait(350);
    const afterUnload = snapshot("after-unload");

    if (afterUnload.pluginLoaded) errors.push({ label: "after-unload", message: "plugin still loaded" });
    if (afterUnload.resizeContainers !== 0) errors.push({ label: "after-unload", message: `resize containers after unload: ${afterUnload.resizeContainers}` });
    if (afterUnload.resizeHandlesDom !== 0) errors.push({ label: "after-unload", message: `resize handles after unload: ${afterUnload.resizeHandlesDom}` });
    if (afterUnload.pluginClassElements !== 0) errors.push({ label: "after-unload", message: `plugin class elements after unload: ${afterUnload.pluginClassElements}` });
    if (afterUnload.bodyCaptionsClass || afterUnload.bodyNativeSelectionClass) errors.push({ label: "after-unload", message: "body classes after unload" });
  } finally {
    if (originalDataExists) await adapter.write(dataPath, originalData);
    else if (await adapter.exists(dataPath)) await adapter.remove(dataPath);

    if (originalAlignmentCacheExists) await adapter.write(alignmentCachePath, originalAlignmentCache);
    else if (await adapter.exists(alignmentCachePath)) await adapter.remove(alignmentCachePath);

    if (originallyLoaded && !app.plugins.plugins[id]) {
      try { await app.plugins.enablePlugin(id); }
      catch (error) { errors.push({ label: "restore-enable", message: String(error) }); }
    }
  }

  const scenarioStats = Object.fromEntries(Object.entries(scenarioTimings).map(([name, values]) => [name, stats(values)]));
  const byLabelPrefix = samples.reduce((acc, sample) => {
    const prefix = String(sample.label).split(":")[0];
    acc[prefix] = (acc[prefix] || 0) + 1;
    return acc;
  }, {});

  const report = {
    runId,
    generatedAt: new Date().toISOString(),
    vault: app.vault.getName?.() ?? null,
    plugin: { id, version: manifest.version, dir: manifest.dir, originallyLoaded },
    config,
    summary: {
      pass: errors.length === 0,
      errors: errors.slice(0, 50),
      errorCount: errors.length,
      sampleCount: samples.length,
      samplesByScenario: byLabelPrefix,
      scenarioStats,
      maxContextMenuEvents: Math.max(...samples.map((sample) => sample.contextMenuEvents ?? 0)),
      maxResizerViewScopeEvents: Math.max(...samples.map((sample) => sample.resizerViewScopeEvents ?? 0)),
      maxResizerChildren: Math.max(...samples.map((sample) => sample.resizerChildren ?? 0)),
      maxResizeContainers: Math.max(...samples.map((sample) => sample.resizeContainers ?? 0)),
      maxResizeHandlesDom: Math.max(...samples.map((sample) => sample.resizeHandlesDom ?? 0)),
      afterUnload: samples.find((sample) => sample.label === "after-unload") ?? null,
      beforeUnload: samples.find((sample) => sample.label === "before-unload") ?? null,
    },
    samples,
  };

  await adapter.write(config.reportPath, JSON.stringify(report, null, 2));
  return JSON.stringify({ reportPath: config.reportPath, summary: report.summary });
}

function printSummary(report) {
  const s = report.summary;
  console.log(`\nInteraction stress report: ${s.pass ? "PASS" : "FAIL"}`);
  console.log(`Samples: ${s.sampleCount}`);
  console.log(`Samples by scenario: ${JSON.stringify(s.samplesByScenario)}`);
  console.log(`Max contextMenu._events: ${s.maxContextMenuEvents}`);
  console.log(`Max resizer view-scope events: ${s.maxResizerViewScopeEvents}`);
  console.log(`Max resizer children: ${s.maxResizerChildren}`);
  console.log(`Max resize containers: ${s.maxResizeContainers}`);
  console.log(`Max resize handles: ${s.maxResizeHandlesDom}`);
  console.log(`After unload: ${JSON.stringify(s.afterUnload)}`);
  if (s.errorCount) console.log(`Errors (${s.errorCount}): ${JSON.stringify(s.errors, null, 2)}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  args.runId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const injected = `(${stressInteractionsInObsidian.toString()})(${JSON.stringify(args)})`;

  console.log(`Running Obsidian interaction stress: vault=${args.vault}, plugin=${args.id}`);
  if (args.reportFile) await fs.rm(args.reportFile, { force: true });

  const result = await run("obsidian", [`vault=${args.vault}`, "eval", `code=${injected}`]);
  if (result.stdout.trim()) console.log(result.stdout.trim());
  if (result.stderr.trim()) console.error(result.stderr.trim());

  if (!args.reportFile) {
    console.log(`Report written in vault at: ${args.reportPath}`);
    return;
  }

  const report = await readReportWithRetry(args.reportFile, args.runId, 180_000);
  printSummary(report);
  console.log(`Report file: ${args.reportFile}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
