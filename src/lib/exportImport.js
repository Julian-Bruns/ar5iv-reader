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
const BACKUP_SCHEMA_VERSION = 3;

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
