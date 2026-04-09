import {
  applyLibrarySnapshot,
  exportLibrarySnapshot,
  getPaper
} from "./db";
import { appVersion as defaultAppVersion, buildId as defaultBuildId } from "./appBuild";
import { createEmptyLibrarySnapshot, mergeLibrarySnapshots } from "./librarySnapshot";
import {
  buildUrlManifest,
  buildUrlManifestFingerprint,
  parseUrlManifest,
  restoreFromUrlManifest
} from "./urlManifest";

const BACKUP_FORMAT = "ar5iv-reader-backup";
const BACKUP_SCHEMA_VERSION = 2;
const FOLDER_EXPORT_FORMAT = "ar5iv-reader-folder-export";
const FOLDER_EXPORT_SCHEMA_VERSION = 1;

export async function exportPaperHtml(paperId) {
  const record = await getPaper(paperId);
  if (!record) {
    throw new Error(`Paper ${paperId} is not saved.`);
  }

  return new Blob([record.html], {
    type: "text/html;charset=utf-8"
  });
}

export async function createLibraryBackup(
  appVersion = defaultAppVersion,
  buildId = defaultBuildId
) {
  const snapshot = await exportLibrarySnapshot();
  const papers = (Array.isArray(snapshot.papers) ? snapshot.papers : []).filter(
    (paper) => !Number(paper?.deletedAtMs || 0)
  );
  const manifest = buildUrlManifest(papers, appVersion);
  const fingerprint = buildBackupFingerprint(manifest.papers);

  return {
    fingerprint,
    payload: {
      format: BACKUP_FORMAT,
      schemaVersion: BACKUP_SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      appVersion: String(appVersion || "").trim(),
      buildId: String(buildId || "").trim(),
      origin: typeof window === "undefined" ? "" : window.location.origin,
      paperCount: papers.length,
      fingerprint,
      librarySnapshot: snapshot,
      manifest
    }
  };
}

export async function exportLibraryBackup(appVersion = defaultAppVersion, buildId = defaultBuildId) {
  const { payload } = await createLibraryBackup(appVersion, buildId);
  return new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json;charset=utf-8"
  });
}

export function isFolderExportSupported() {
  return typeof window !== "undefined" && typeof window.showDirectoryPicker === "function";
}

export async function createFolderExportHandle() {
  if (!isFolderExportSupported()) {
    throw new Error("Folder export is not supported in this browser.");
  }

  return window.showDirectoryPicker({
    id: "ar5iv-reader-export",
    mode: "readwrite",
    startIn: "documents"
  });
}

export async function exportLibraryFolder(
  directoryHandle,
  {
    backupPayload,
    openTabs = [],
    appVersion = defaultAppVersion,
    buildId = defaultBuildId,
    exportedAt = new Date()
  } = {}
) {
  if (!directoryHandle?.getDirectoryHandle) {
    throw new Error("Export directory handle is unavailable.");
  }

  const normalizedExportedAt = normalizeExportDate(exportedAt);
  const folderName = buildFolderExportName(normalizedExportedAt);
  const exportDirectory = await directoryHandle.getDirectoryHandle(folderName, {
    create: true
  });
  const savedDirectory = await exportDirectory.getDirectoryHandle("saved", {
    create: true
  });
  const openTabsDirectory = await exportDirectory.getDirectoryHandle("open-tabs", {
    create: true
  });

  const savedPapers = getVisibleSnapshotPapers(backupPayload?.librarySnapshot?.papers);
  const savedEntries = savedPapers.map((paper, index) =>
    buildPaperExportEntry(paper, {
      index,
      collection: "saved"
    })
  );
  const openTabEntries = buildOpenTabExportEntries(openTabs);

  for (const entry of savedEntries) {
    await writePaperExportEntry(savedDirectory, entry);
  }

  for (const entry of openTabEntries) {
    await writePaperExportEntry(openTabsDirectory, entry);
  }

  const manifest = {
    format: FOLDER_EXPORT_FORMAT,
    schemaVersion: FOLDER_EXPORT_SCHEMA_VERSION,
    exportedAt: normalizedExportedAt.toISOString(),
    appVersion: String(appVersion || "").trim(),
    buildId: String(buildId || "").trim(),
    origin: typeof window === "undefined" ? "" : window.location.origin,
    backupFilename: buildBackupFilename(normalizedExportedAt),
    folderName,
    savedPaperCount: savedEntries.length,
    openTabCount: openTabEntries.length,
    savedPapers: savedEntries.map((entry) => buildManifestEntry(entry)),
    openTabs: openTabEntries.map((entry) => buildManifestEntry(entry))
  };

  await writeJsonFile(exportDirectory, "manifest.json", manifest);

  return {
    folderName,
    savedPaperCount: savedEntries.length,
    openTabCount: openTabEntries.length
  };
}

export async function inspectImportFile(file) {
  return inspectImportContents(await file.text());
}

export function inspectImportContents(contents) {
  const text = String(contents || "");

  try {
    const parsed = JSON.parse(text);

    if (isUnifiedBackupPayload(parsed)) {
      return {
        kind: "snapshot",
        source: "backup",
        snapshot: parsed.librarySnapshot,
        payload: parsed
      };
    }

    if (looksLikeLibrarySnapshot(parsed)) {
      return {
        kind: "snapshot",
        source: "snapshot",
        snapshot: parsed,
        payload: parsed
      };
    }
  } catch {
    // Fall back to URL-manifest detection below.
  }

  return {
    kind: "manifest",
    source: "manifest",
    manifest: parseUrlManifest(text)
  };
}

export async function importLibraryBackup(file, options = {}) {
  const contents = "contents" in options ? options.contents : await file.text();
  const parsedImport = inspectImportContents(contents);

  if (parsedImport.kind === "snapshot") {
    const currentSnapshot = options.currentSnapshot || (await exportLibrarySnapshot());
    const mergedSnapshot = mergeLibrarySnapshots(
      currentSnapshot || createEmptyLibrarySnapshot(),
      parsedImport.snapshot
    );
    await applyLibrarySnapshot(mergedSnapshot);
    return {
      kind: "snapshot",
      paperCount: countVisiblePapers(mergedSnapshot?.papers)
    };
  }

  const result = await restoreFromUrlManifest(parsedImport.manifest, options);
  return {
    kind: "manifest",
    ...result
  };
}

export function buildBackupFilename(date = new Date()) {
  return `ar5iv-reader-backup-${date.toISOString().slice(0, 10)}.json`;
}

export function buildFolderExportName(date = new Date()) {
  const normalizedDate = normalizeExportDate(date);
  return `ar5iv-reader-export-${formatExportTimestamp(normalizedDate)}`;
}

export function buildBackupFingerprint(papers) {
  return buildUrlManifestFingerprint(papers);
}

export function downloadBlob(blob, filename) {
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(objectUrl);
}

function isUnifiedBackupPayload(value) {
  return (
    value &&
    value.format === BACKUP_FORMAT &&
    Number(value.schemaVersion) >= 1 &&
    Number(value.schemaVersion) <= BACKUP_SCHEMA_VERSION &&
    value.librarySnapshot &&
    typeof value.librarySnapshot === "object"
  );
}

function looksLikeLibrarySnapshot(value) {
  return (
    value &&
    typeof value === "object" &&
    typeof value.schemaVersion === "number" &&
    Array.isArray(value.papers) &&
    Array.isArray(value.assets)
  );
}

function countVisiblePapers(papers) {
  return (Array.isArray(papers) ? papers : []).filter((paper) => !Number(paper?.deletedAtMs || 0)).length;
}

function getVisibleSnapshotPapers(papers) {
  return (Array.isArray(papers) ? papers : [])
    .filter((paper) => !Number(paper?.deletedAtMs || 0))
    .sort(comparePapersForExport);
}

function buildOpenTabExportEntries(openTabs) {
  return (Array.isArray(openTabs) ? openTabs : []).map((tab, index) => {
    const paper = tab?.paper && typeof tab.paper === "object" ? tab.paper : null;
    const title = String(
      paper?.title || paper?.titleHint || tab?.title || paper?.id || tab?.id || `Open tab ${index + 1}`
    ).trim();
    const id = String(paper?.id || tab?.id || "").trim();
    const html = paper?.view === "html" ? String(paper?.html || "") : "";

    return {
      folderName: buildPaperFolderName(id || title || `open-tab-${index + 1}`, index),
      index,
      collection: "open-tabs",
      itemType: "open-tab",
      id,
      title,
      status: String(tab?.status || (paper ? "ready" : "idle")).trim() || "idle",
      error: String(tab?.error || "").trim(),
      href: String(tab?.href || "").trim(),
      sourceUrl: String(paper?.sourceUrl || "").trim(),
      ar5ivUrl: String(paper?.ar5ivUrl || "").trim(),
      pdfUrl: String(paper?.pdfUrl || "").trim(),
      mode: String(paper?.mode || "").trim(),
      view: String(paper?.view || "").trim(),
      savedAt: String(paper?.savedAt || "").trim(),
      updatedAt: String(paper?.updatedAt || "").trim(),
      notice: String(paper?.notice || "").trim(),
      html,
      text: html ? extractTextFromHtml(html) : ""
    };
  });
}

function buildPaperExportEntry(paper, { index = 0, collection = "saved" } = {}) {
  const id = String(paper?.id || "").trim();
  const title = String(paper?.title || paper?.titleHint || id || `Paper ${index + 1}`).trim();
  const html = String(paper?.html || "");

  return {
    folderName: buildPaperFolderName(id || title || `paper-${index + 1}`, index),
    index,
    collection,
    itemType: "paper",
    id,
    title,
    status: "ready",
    error: "",
    href: "",
    sourceUrl: String(paper?.sourceUrl || "").trim(),
    ar5ivUrl: String(paper?.ar5ivUrl || "").trim(),
    pdfUrl: String(paper?.pdfUrl || "").trim(),
    mode: "saved",
    view: String(paper?.view || "html").trim() || "html",
    savedAt: String(paper?.savedAt || "").trim(),
    updatedAt: String(paper?.updatedAt || "").trim(),
    notice: String(paper?.notice || "").trim(),
    html,
    text: html ? extractTextFromHtml(html) : ""
  };
}

async function writePaperExportEntry(parentDirectory, entry) {
  const directory = await parentDirectory.getDirectoryHandle(entry.folderName, {
    create: true
  });
  const metadata = {
    collection: entry.collection,
    itemType: entry.itemType,
    index: entry.index,
    id: entry.id,
    title: entry.title,
    status: entry.status,
    error: entry.error,
    href: entry.href,
    sourceUrl: entry.sourceUrl,
    ar5ivUrl: entry.ar5ivUrl,
    pdfUrl: entry.pdfUrl,
    mode: entry.mode,
    view: entry.view,
    savedAt: entry.savedAt,
    updatedAt: entry.updatedAt,
    notice: entry.notice,
    hasHtml: Boolean(entry.html),
    hasText: Boolean(entry.text)
  };

  await writeJsonFile(directory, "meta.json", metadata);
  if (entry.html) {
    await writeTextFile(directory, "paper.html", entry.html);
  }
  if (entry.text) {
    await writeTextFile(directory, "paper.txt", entry.text);
  }
}

async function writeJsonFile(directoryHandle, filename, value) {
  await writeTextFile(directoryHandle, filename, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeTextFile(directoryHandle, filename, value) {
  const fileHandle = await directoryHandle.getFileHandle(filename, {
    create: true
  });
  const writable = await fileHandle.createWritable();
  await writable.write(String(value || ""));
  await writable.close();
}

function buildManifestEntry(entry) {
  return {
    folder: entry.folderName,
    id: entry.id,
    title: entry.title,
    status: entry.status,
    view: entry.view,
    mode: entry.mode,
    hasHtml: Boolean(entry.html),
    hasText: Boolean(entry.text)
  };
}

function buildPaperFolderName(seed, index) {
  const safeSeed = sanitizePathSegment(seed) || `item-${index + 1}`;
  return `${String(index + 1).padStart(3, "0")}-${safeSeed}`;
}

function sanitizePathSegment(value) {
  return String(value || "")
    .trim()
    .replace(/[/\\?%*:|"<>]+/g, "_")
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-_.]+|[-_.]+$/g, "");
}

function extractTextFromHtml(html) {
  const rawHtml = String(html || "");
  if (!rawHtml) {
    return "";
  }

  if (typeof DOMParser === "function") {
    const documentNode = new DOMParser().parseFromString(rawHtml, "text/html");
    const text = documentNode.body?.textContent || documentNode.documentElement?.textContent || "";
    return normalizeExtractedText(text);
  }

  const withoutScripts = rawHtml
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ");
  return normalizeExtractedText(decodeHtmlEntities(withoutScripts));
}

function normalizeExtractedText(text) {
  return String(text || "")
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function decodeHtmlEntities(text) {
  return String(text || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'");
}

function comparePapersForExport(left, right) {
  const leftTime = Number(Date.parse(left?.updatedAt || left?.savedAt || "")) || 0;
  const rightTime = Number(Date.parse(right?.updatedAt || right?.savedAt || "")) || 0;
  if (rightTime !== leftTime) {
    return rightTime - leftTime;
  }

  return String(left?.id || "").localeCompare(String(right?.id || ""));
}

function normalizeExportDate(value) {
  const date = value instanceof Date ? value : new Date(value || Date.now());
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function formatExportTimestamp(date) {
  return date.toISOString().replace(/[:.]/g, "-");
}
