#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const CHECK_NAME = "image-alignment-popout-scope";

const TARGET_SPECS = {
  popoutSeparateDocument: { label: "popout separate document", comparator: ">=", target: 1, suffix: "" },
  popoutApplyAlignedImages: { label: "popout apply aligned images", comparator: ">=", target: 1, suffix: "" },
  popoutVisualLayoutFailures: { label: "popout visual layout failures", comparator: "<=", target: 0, suffix: "" },
  sameDocumentLeafPairRendered: { label: "same-doc rendered note panes", comparator: ">=", target: 2, suffix: "" },
  sameDocumentTargetAlignedImages: { label: "same-doc target note aligned images", comparator: ">=", target: 1, suffix: "" },
  sameDocumentWrongNoteAlignedImages: { label: "same-doc wrong-note aligned images", comparator: "<=", target: 0, suffix: "" },
  sameDocumentWrongNoteVisualMutations: { label: "same-doc wrong-note visual mutations", comparator: "<=", target: 0, suffix: "" },
  p95ApplyMs: { label: "p95 applyAlignmentsToNote latency", comparator: "<=", target: 250, suffix: "ms" },
  runtimeErrors: { label: "runtime/setup errors", comparator: "<=", target: 0, suffix: "" },
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
    viewWaitMs: 900,
    applySettleMs: 150,
  };

  const targetByFlag = {
    "--target-popout-separate-document": "popoutSeparateDocument",
    "--target-popout-apply-aligned-images": "popoutApplyAlignedImages",
    "--target-popout-visual-layout-failures": "popoutVisualLayoutFailures",
    "--target-same-document-leaf-pair-rendered": "sameDocumentLeafPairRendered",
    "--target-same-document-target-aligned-images": "sameDocumentTargetAlignedImages",
    "--target-same-document-wrong-note-aligned-images": "sameDocumentWrongNoteAlignedImages",
    "--target-same-document-wrong-note-visual-mutations": "sameDocumentWrongNoteVisualMutations",
    "--target-p95-apply-ms": "p95ApplyMs",
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
    else if (arg === "--view-wait-ms") args.viewWaitMs = Number(readValue());
    else if (arg === "--apply-settle-ms") args.applySettleMs = Number(readValue());
    else if (Object.hasOwn(targetByFlag, arg)) targetSpecs[targetByFlag[arg]].target = Number(readValue());
    else if (arg === "--help" || arg === "-h") {
      console.log(`Usage: node scripts/p95/${CHECK_NAME}.mjs [options]\n\nOptions:\n  --vault <name>                                      Obsidian vault name (default: plugin-testing-vault)\n  --id <plugin-id>                                    Plugin id (default: image-converter)\n  --report-path <path>                                Vault-relative current report path\n  --history-path <path>                               Vault-relative JSONL history path\n  --report-file <path>                                Filesystem path to read the current report from\n  --label <name>                                      Label stored in the report (default: current)\n  --no-fail                                           Print FAIL metrics but exit 0; useful for before-fix baselines\n  --no-reload                                         Do not reload the vault before measuring\n  --reload-wait-ms <n>                                Wait after vault reload before eval (default: 3000)\n  --view-wait-ms <n>                                  Wait after opening each note view (default: 900)\n  --apply-settle-ms <n>                               Wait after applyAlignmentsToNote (default: 150)\n  --target-popout-separate-document <n>               Minimum distinct popout document target (default: 1)\n  --target-popout-apply-aligned-images <n>            Minimum popout images aligned by applyAlignmentsToNote (default: 1)\n  --target-popout-visual-layout-failures <n>          Maximum popout computed-layout mismatches (default: 0)\n  --target-same-document-leaf-pair-rendered <n>       Minimum same-document rendered panes (default: 2)\n  --target-same-document-target-aligned-images <n>    Minimum target-note images aligned in same document (default: 1)\n  --target-same-document-wrong-note-aligned-images <n> Maximum other-note images mutated in same document (default: 0)\n  --target-same-document-wrong-note-visual-mutations <n> Maximum other-note computed-layout mutations (default: 0)\n  --target-p95-apply-ms <n>                           Maximum p95 apply latency, ms (default: 250)\n  --target-runtime-errors <n>                         Maximum runtime/setup errors (default: 0)\n`);
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  for (const [key, value] of Object.entries({
    reloadWaitMs: args.reloadWaitMs,
    viewWaitMs: args.viewWaitMs,
    applySettleMs: args.applySettleMs,
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
async function measureImageAlignmentPopoutScopeInObsidian(config) {
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
  const dataPath = `${manifest.dir}/data.json`;
  const originalDataExists = await adapter.exists(dataPath);
  const originalData = originalDataExists ? await adapter.read(dataPath) : null;
  const originallyLoaded = Boolean(app.plugins.plugins[id]);

  const cachePaths = [
    `${manifest.dir}/image-converter-image-alignments.json`,
    `${app.vault.configDir}/image-converter-image-alignments.json`,
  ];
  const originalCacheFiles = [];
  for (const cachePath of cachePaths) {
    const exists = await adapter.exists(cachePath);
    originalCacheFiles.push({ path: cachePath, exists, data: exists ? await adapter.read(cachePath) : null });
  }

  const fixtureDir = `_pi/p95/${CHECK_NAME}`;
  const fixtureImagePath = `${fixtureDir}/shared.png`;
  const popoutNotePath = `${fixtureDir}/popout-note.md`;
  const targetNotePath = `${fixtureDir}/same-doc-target.md`;
  const otherNotePath = `${fixtureDir}/same-doc-other.md`;
  const fixtureImageName = "shared.png";
  const pngBuffer = Uint8Array.from(
    atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII="),
    (char) => char.charCodeAt(0)
  ).buffer;

  const alignmentClasses = [
    "image-position-left",
    "image-position-center",
    "image-position-right",
    "image-wrap",
    "image-no-wrap",
    "image-converter-aligned",
  ];
  const alignmentSelector = alignmentClasses.map((className) => `.${className}`).join(",");
  const imageSelector = `img[alt*="P95"], img[src*="${fixtureImageName}"], .image-embed img, .markdown-preview-view img, .markdown-source-view img, img`;
  const errors = [];
  const notes = [];
  const documents = new Set();
  const applyDurations = [];
  const metrics = {
    popoutSeparateDocument: 0,
    popoutApplyAlignedImages: 0,
    popoutVisualLayoutFailures: Number.POSITIVE_INFINITY,
    sameDocumentLeafPairRendered: 0,
    sameDocumentTargetAlignedImages: 0,
    sameDocumentWrongNoteAlignedImages: Number.POSITIVE_INFINITY,
    sameDocumentWrongNoteVisualMutations: Number.POSITIVE_INFINITY,
    p95ApplyMs: Number.POSITIVE_INFINITY,
    runtimeErrors: 0,
  };

  let popoutLeaf = null;
  let targetLeaf = null;
  let otherLeaf = null;
  let mainDoc = null;
  let popoutDoc = null;

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
  const getLeafFilePath = (leaf) => {
    try {
      return leaf?.view?.file?.path
        ?? leaf?.view?.getState?.()?.file
        ?? leaf?.getViewState?.()?.state?.file
        ?? null;
    } catch {
      return null;
    }
  };
  const openLeafPreview = async (leaf, file, label) => {
    if (!leaf) throw new Error(`Missing leaf for ${label}`);
    if (typeof leaf.setViewState === "function") {
      await leaf.setViewState({ type: "markdown", state: { file: file.path, mode: "preview" }, active: true });
    } else {
      await leaf.openFile(file);
    }
    await leaf.loadIfDeferred?.();
    try { app.workspace.setActiveLeaf?.(leaf, { focus: true }); } catch (error) { notes.push({ label: `${label}:set-active`, message: String(error) }); }
    try { leaf.view?.containerEl?.ownerDocument?.defaultView?.focus?.(); } catch (error) { notes.push({ label: `${label}:focus-window`, message: String(error) }); }
    await wait(config.viewWaitMs);
    try { app.workspace.trigger?.("file-open", file); } catch (error) { notes.push({ label: `${label}:trigger:file-open`, message: String(error) }); }
    try { app.workspace.trigger?.("active-leaf-change", leaf); } catch (error) { notes.push({ label: `${label}:trigger:active-leaf-change`, message: String(error) }); }
    try { app.workspace.trigger?.("layout-change"); } catch (error) { notes.push({ label: `${label}:trigger:layout-change`, message: String(error) }); }
    await wait(config.viewWaitMs);
  };
  const getImageSrc = (image) => image?.getAttr?.("src") ?? image?.getAttribute?.("src") ?? image?.currentSrc ?? image?.src ?? "";
  const getImageFromLeaf = (leaf) => {
    const containerEl = leaf?.view?.containerEl;
    if (!containerEl) return null;
    const candidates = [...containerEl.querySelectorAll(imageSelector)];
    return candidates.find((image) => Boolean(image?.getAttribute?.("src")))
      ?? candidates.find((image) => Boolean(getImageSrc(image)))
      ?? candidates[0]
      ?? null;
  };
  const waitFor = async (predicate, timeoutMs, intervalMs = 25) => {
    const startedAt = performance.now();
    while (performance.now() - startedAt < timeoutMs) {
      if (predicate()) return true;
      await wait(intervalMs);
    }
    return predicate();
  };
  const waitForImage = async (leaf, label, timeoutMs = 6000) => {
    let image = getImageFromLeaf(leaf);
    await waitFor(() => {
      image = getImageFromLeaf(leaf);
      return Boolean(image && getImageSrc(image));
    }, timeoutMs);
    if (!image || !getImageSrc(image)) {
      notes.push({
        label: `${label}:image-missing`,
        leafFile: getLeafFilePath(leaf),
        containerClass: leaf?.view?.containerEl?.className ?? null,
        imageCount: leaf?.view?.containerEl?.querySelectorAll?.("img")?.length ?? 0,
        firstImageOuterHTML: leaf?.view?.containerEl?.querySelector?.("img")?.outerHTML?.slice(0, 300) ?? null,
      });
    }
    return image;
  };
  const getEmbed = (image) => image?.matchParent?.(".internal-embed.image-embed") ?? image?.closest?.(".internal-embed.image-embed") ?? image?.parentElement ?? null;
  const removeAlignmentClassesInLeaf = (leaf) => {
    leaf?.view?.containerEl?.querySelectorAll?.(alignmentSelector).forEach((element) => {
      element.classList.remove(...alignmentClasses);
      if (element instanceof HTMLImageElement) {
        element.style.width = "";
        element.style.height = "";
      }
    });
  };
  const isAligned = (image) => Boolean(image) && alignmentClasses.some((className) => image.classList.contains(className));
  const countAlignedImagesInLeaf = (leaf) => {
    if (!leaf?.view?.containerEl) return 0;
    return [...leaf.view.containerEl.querySelectorAll("img")].filter(isAligned).length;
  };
  const getVisualState = (image) => {
    if (!image) return null;
    const doc = image.ownerDocument;
    const win = doc.defaultView ?? activeWindow;
    const imageStyle = win.getComputedStyle(image);
    const embed = getEmbed(image);
    const embedStyle = embed ? win.getComputedStyle(embed) : null;
    return {
      imageClasses: [...image.classList],
      embedClasses: embed ? [...embed.classList] : [],
      float: imageStyle.float,
      display: imageStyle.display,
      clear: imageStyle.clear,
      width: imageStyle.width,
      inlineWidth: image.style.width,
      marginLeft: imageStyle.marginLeft,
      marginRight: imageStyle.marginRight,
      embedTextAlign: embedStyle?.textAlign ?? null,
      leafFile: getLeafFilePath(image.closest?.(".workspace-leaf")?.leaf),
    };
  };
  const countRightWrapVisualFailures = (image) => {
    const state = getVisualState(image);
    if (!state) return 1;
    let failures = 0;
    if (!state.imageClasses.includes("image-position-right")) failures += 1;
    if (!state.imageClasses.includes("image-wrap")) failures += 1;
    if (!state.imageClasses.includes("image-converter-aligned")) failures += 1;
    if (state.float !== "right") failures += 1;
    if (!/^120(\.\d+)?px$/.test(state.width) && state.inlineWidth !== "120px") failures += 1;
    return failures;
  };
  const hasWrongNoteVisualMutation = (image) => {
    const state = getVisualState(image);
    if (!state) return false;
    return state.imageClasses.includes("image-position-right")
      || state.imageClasses.includes("image-wrap")
      || state.imageClasses.includes("image-converter-aligned")
      || state.float === "right"
      || state.embedTextAlign === "right";
  };
  const saveRightWrapAlignment = async (manager, notePath, image) => {
    const src = getImageSrc(image);
    if (!src) throw new Error(`No src for ${notePath}`);
    await manager.saveImageAlignmentToCache(notePath, src, "right", "120px", "", true);
  };
  const timedApply = async (manager, notePath, label) => {
    const startedAt = performance.now();
    await manager.applyAlignmentsToNote(notePath);
    const elapsed = round(performance.now() - startedAt);
    applyDurations.push(elapsed);
    notes.push({ label: `${label}:apply-ms`, elapsed });
    await wait(config.applySettleMs);
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
    const popoutFile = await ensureFile(
      popoutNotePath,
      `# P95 popout apply\n\nThis note proves applyAlignmentsToNote() reaches an image rendered in a popout document.\n\n<img src="${fixtureImageName}" alt="P95 popout image" width="120">\n\nTrailing text for wrap layout.\n`
    );
    const targetFile = await ensureFile(
      targetNotePath,
      `# P95 same document target\n\nTarget pane. It should receive right/wrap alignment.\n\n<img src="${fixtureImageName}" alt="P95 target image" width="120">\n\nTrailing text for wrap layout.\n`
    );
    const otherFile = await ensureFile(
      otherNotePath,
      `# P95 same document other\n\nOther pane. It uses the same image file but must not receive the target note alignment.\n\n<img src="${fixtureImageName}" alt="P95 other image" width="120">\n\nTrailing text that should not wrap around a right-floated image.\n`
    );

    await app.plugins.enablePlugin(id);
    await wait(500);

    const pluginInstance = app.plugins.plugins[id];
    const manager = pluginInstance?.ImageAlignmentManager;
    if (!manager) throw new Error("Plugin did not expose ImageAlignmentManager after enablePlugin");
    manager.cache = {};
    await manager.saveCache?.();

    // Scenario 1: real popout document. Do not force global activeDocument; the check should prove the method reaches the popout leaf.
    if (typeof app.workspace.openPopoutLeaf !== "function") throw new Error("app.workspace.openPopoutLeaf is not available");
    popoutLeaf = app.workspace.openPopoutLeaf();
    await wait(700);
    await openLeafPreview(popoutLeaf, popoutFile, "popout");
    popoutDoc = popoutLeaf.view?.containerEl?.ownerDocument;
    mainDoc = app.workspace.containerEl?.ownerDocument ?? activeDocument;
    addDocument(popoutDoc);
    addDocument(mainDoc);
    metrics.popoutSeparateDocument = popoutDoc && mainDoc && popoutDoc !== mainDoc ? 1 : 0;
    const popoutImage = await waitForImage(popoutLeaf, "popout");
    if (!popoutImage) throw new Error("No image found in popout markdown view");
    manager.cache = {};
    await saveRightWrapAlignment(manager, popoutFile.path, popoutImage);
    removeAlignmentClassesInLeaf(popoutLeaf);
    await timedApply(manager, popoutFile.path, "popout");
    metrics.popoutApplyAlignedImages = countAlignedImagesInLeaf(popoutLeaf);
    metrics.popoutVisualLayoutFailures = countRightWrapVisualFailures(getImageFromLeaf(popoutLeaf));

    // Scenario 2: two note panes in the same active document with the same image file.
    targetLeaf = app.workspace.getLeaf(true);
    await openLeafPreview(targetLeaf, targetFile, "same-doc-target");
    otherLeaf = app.workspace.getLeaf("split", "vertical");
    await openLeafPreview(otherLeaf, otherFile, "same-doc-other");
    mainDoc = targetLeaf.view?.containerEl?.ownerDocument ?? app.workspace.containerEl?.ownerDocument ?? activeDocument;
    addDocument(mainDoc);
    const targetImage = await waitForImage(targetLeaf, "same-doc-target");
    const otherImage = await waitForImage(otherLeaf, "same-doc-other");
    if (!targetImage || !otherImage) throw new Error("No image found in one of the same-document markdown panes");
    metrics.sameDocumentLeafPairRendered = [targetImage, otherImage].filter(Boolean).length;
    notes.push({
      label: "same-doc-setup",
      targetLeafFile: getLeafFilePath(targetLeaf),
      otherLeafFile: getLeafFilePath(otherLeaf),
      sameOwnerDocument: targetLeaf.view?.containerEl?.ownerDocument === otherLeaf.view?.containerEl?.ownerDocument,
      targetContainerClass: targetLeaf.view?.containerEl?.className ?? null,
      otherContainerClass: otherLeaf.view?.containerEl?.className ?? null,
    });

    manager.cache = {};
    await saveRightWrapAlignment(manager, targetFile.path, targetImage);
    removeAlignmentClassesInLeaf(targetLeaf);
    removeAlignmentClassesInLeaf(otherLeaf);
    await timedApply(manager, targetFile.path, "same-doc");
    metrics.sameDocumentTargetAlignedImages = countAlignedImagesInLeaf(targetLeaf);
    metrics.sameDocumentWrongNoteAlignedImages = countAlignedImagesInLeaf(otherLeaf);
    metrics.sameDocumentWrongNoteVisualMutations = hasWrongNoteVisualMutation(getImageFromLeaf(otherLeaf)) ? 1 : 0;

    notes.push({
      label: "visual-states",
      popout: getVisualState(getImageFromLeaf(popoutLeaf)),
      target: getVisualState(getImageFromLeaf(targetLeaf)),
      other: getVisualState(getImageFromLeaf(otherLeaf)),
    });
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

    for (const leaf of [popoutLeaf, otherLeaf, targetLeaf]) {
      try { leaf?.detach?.(); }
      catch (error) { notes.push({ label: "cleanup:detach", message: String(error) }); }
    }

    for (const original of originalCacheFiles) {
      try {
        if (original.exists) await adapter.write(original.path, original.data);
        else if (await adapter.exists(original.path)) await adapter.remove(original.path);
      } catch (error) {
        notes.push({ label: `restore-cache:${original.path}`, message: String(error) });
      }
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

  metrics.p95ApplyMs = percentile(applyDurations, 95);
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
    fixture: { dir: fixtureDir, image: fixtureImagePath, popoutNote: popoutNotePath, targetNote: targetNotePath, otherNote: otherNotePath },
    config,
    targets: config.targetSpecs,
    metrics,
    samples: { applyDurations },
    summary: {
      pass: errors.length === 0,
      errorCount: errors.length,
      errors: errors.slice(0, 50),
      notes: notes.slice(0, 50),
      documentsSeen: collectDocuments().map((doc) => ({
        title: doc.title,
        url: doc.URL,
        alignedImages: [...doc.querySelectorAll("img")].filter(isAligned).length,
        imageCount: doc.querySelectorAll("img").length,
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
  console.log(`${name.padEnd(44)} ${formatValue(previous, suffix).padStart(12)} ${formatValue(current, suffix).padStart(12)} ${formatDelta(previous, current, suffix).padStart(12)} ${targetText.padStart(14)} ${status}`);
}

function printSummary(currentReport, previousReport) {
  const current = currentReport.metrics;
  const previous = previousReport?.metrics ?? null;

  console.log(`\nP95 ${CHECK_NAME}: ${currentReport.summary.pass ? "PASS" : "FAIL"}`);
  console.log("\nMetric                                        previous      current        delta         target status");
  console.log("---------------------------------------------------------------------------------------------------");
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
  const injected = `const CHECK_NAME = ${JSON.stringify(CHECK_NAME)};\n(${measureImageAlignmentPopoutScopeInObsidian.toString()})(${JSON.stringify(args)})`;

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
