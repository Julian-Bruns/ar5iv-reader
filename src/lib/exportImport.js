import { fetchPaperById } from "./fetchPaper";
import { getPaper, listPaperIds, savePaper } from "./db";

export async function exportPaperHtml(paperId) {
  const record = await getPaper(paperId);
  if (!record) {
    throw new Error(`Paper ${paperId} is not saved.`);
  }

  return new Blob([record.html], {
    type: "text/html;charset=utf-8"
  });
}

export async function exportLibraryIds() {
  const ids = await listPaperIds();
  return new Blob([JSON.stringify(ids, null, 2)], {
    type: "application/json;charset=utf-8"
  });
}

export async function importLibraryIds(file) {
  const contents = await file.text();
  const parsed = JSON.parse(contents);

  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string")) {
    throw new Error("Import file must be a JSON array of arXiv ID strings.");
  }

  const existing = new Set(await listPaperIds());
  const importedIds = [];
  const failedIds = [];

  for (const rawId of parsed) {
    const id = rawId.trim();
    if (!id || existing.has(id)) {
      continue;
    }

    try {
      const sessionPaper = await fetchPaperById(id);
      if (sessionPaper.view !== "html") {
        throw new Error("Rendered HTML unavailable");
      }
      await savePaper(sessionPaper);
      existing.add(id);
      importedIds.push(id);
    } catch {
      failedIds.push(id);
    }
  }

  return { importedIds, failedIds };
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
