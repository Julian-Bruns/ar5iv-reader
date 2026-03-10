import {
  applyLibrarySnapshot,
  exportLibrarySnapshot,
  getPaper,
  listPapers
} from "./db";
import { mergeLibrarySnapshots } from "./librarySnapshot";
import {
  buildUrlManifest,
  parseUrlManifest
} from "./urlManifest";

export async function exportPaperHtml(paperId) {
  const record = await getPaper(paperId);
  if (!record) {
    throw new Error(`Paper ${paperId} is not saved.`);
  }

  return new Blob([record.html], {
    type: "text/html;charset=utf-8"
  });
}

export async function exportLibraryBackup() {
  const snapshot = await exportLibrarySnapshot();
  return new Blob([JSON.stringify(snapshot, null, 2)], {
    type: "application/json;charset=utf-8"
  });
}

export async function exportLibraryUrlManifest(appVersion = "") {
  const papers = await listPapers();
  const manifest = buildUrlManifest(papers, appVersion);
  return new Blob([JSON.stringify(manifest, null, 2)], {
    type: "application/json;charset=utf-8"
  });
}

export async function importLibraryBackup(file) {
  const contents = await file.text();
  const importedSnapshot = JSON.parse(contents);
  const localSnapshot = await exportLibrarySnapshot();
  const mergedSnapshot = mergeLibrarySnapshots(localSnapshot, importedSnapshot);
  await applyLibrarySnapshot(mergedSnapshot);
}

export async function importLibraryUrlManifest(file) {
  const contents = await file.text();
  return parseUrlManifest(contents);
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
