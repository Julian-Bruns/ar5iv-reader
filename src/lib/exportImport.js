import {
  applyLibrarySnapshot,
  exportLibrarySnapshot,
  getPaper
} from "./db";
import {
  buildUrlManifest,
  buildUrlManifestFingerprint,
  parseUrlManifest,
  restoreFromUrlManifest
} from "./urlManifest";

const BACKUP_FORMAT = "ar5iv-reader-backup";
const BACKUP_SCHEMA_VERSION = 1;

export async function exportPaperHtml(paperId) {
  const record = await getPaper(paperId);
  if (!record) {
    throw new Error(`Paper ${paperId} is not saved.`);
  }

  return new Blob([record.html], {
    type: "text/html;charset=utf-8"
  });
}

export async function createLibraryBackup(appVersion = "") {
  const snapshot = await exportLibrarySnapshot();
  const manifest = buildUrlManifest(
    (Array.isArray(snapshot.papers) ? snapshot.papers : []).filter(
      (paper) => !Number(paper?.deletedAtMs || 0)
    ),
    appVersion
  );

  return {
    fingerprint: buildBackupFingerprint(manifest.papers),
    payload: {
      format: BACKUP_FORMAT,
      schemaVersion: BACKUP_SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      appVersion: String(appVersion || "").trim(),
      origin: typeof window === "undefined" ? "" : window.location.origin,
      librarySnapshot: snapshot,
      manifest
    }
  };
}

export async function exportLibraryBackup(appVersion = "") {
  const { payload } = await createLibraryBackup(appVersion);
  return new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json;charset=utf-8"
  });
}

export async function importLibraryBackup(file, options = {}) {
  const contents = await file.text();
  const parsed = JSON.parse(contents);

  if (isUnifiedBackupPayload(parsed)) {
    await applyLibrarySnapshot(parsed.librarySnapshot);
    return {
      kind: "snapshot",
      paperCount: countVisiblePapers(parsed.librarySnapshot?.papers)
    };
  }

  if (looksLikeLibrarySnapshot(parsed)) {
    await applyLibrarySnapshot(parsed);
    return {
      kind: "snapshot",
      paperCount: countVisiblePapers(parsed?.papers)
    };
  }

  const manifest = parseUrlManifest(contents);
  const result = await restoreFromUrlManifest(manifest, options);
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
    Number(value.schemaVersion) === BACKUP_SCHEMA_VERSION &&
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
