const URL_MANIFEST_SCHEMA_VERSION = 1;

export function buildUrlManifest(papers, appVersion = "") {
  const normalizedPapers = normalizeManifestPapers(papers);

  return {
    schemaVersion: URL_MANIFEST_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    appVersion: String(appVersion || "").trim(),
    origin: typeof window === "undefined" ? "" : window.location.origin,
    papers: normalizedPapers
  };
}

export function parseUrlManifest(text) {
  const parsed = JSON.parse(String(text || ""));
  return normalizeManifest(parsed);
}

export async function restoreFromUrlManifest(manifestValue, options = {}) {
  const manifest =
    typeof manifestValue === "string" ? parseUrlManifest(manifestValue) : normalizeManifest(manifestValue);
  const getExistingPaper = options.getExistingPaper || getPaperRecord;
  const fetchPaper = options.fetchPaper || fetchPaperById;
  const savePaperRecord = options.savePaperRecord || persistPaperRecord;
  const deviceId = String(options.deviceId || "local").trim() || "local";
  const onProgress = typeof options.onProgress === "function" ? options.onProgress : null;
  const concurrency = Math.max(1, Number(options.concurrency || 2) || 2);
  const result = {
    restoredIds: [],
    skippedIds: [],
    failed: []
  };
  let completed = 0;
  let nextIndex = 0;

  onProgress?.({
    total: manifest.papers.length,
    completed,
    currentId: "",
    result: cloneRestoreResult(result)
  });

  async function runWorker() {
    while (true) {
      const currentIndex = nextIndex;
      nextIndex += 1;

      if (currentIndex >= manifest.papers.length) {
        return;
      }

      const paper = manifest.papers[currentIndex];

      try {
        const existing = await getExistingPaper(paper.id);
        if (existing && Number(existing.revisionMs || 0) >= Number(paper.revisionMs || 0)) {
          result.skippedIds.push(paper.id);
        } else {
          const fetched = await fetchPaper(paper.id, {
            sourceUrl: paper.sourceUrl,
            titleHint: paper.title
          });

          if (!fetched || fetched.view === "pdf") {
            result.failed.push({
              id: paper.id,
              reason: "html_unavailable"
            });
          } else {
            await savePaperRecord(
              {
                ...fetched,
                title: paper.title || fetched.titleHint || fetched.id
              },
              {
                deviceId
              }
            );
            result.restoredIds.push(paper.id);
          }
        }
      } catch (error) {
        result.failed.push({
          id: paper.id,
          reason: stringifyError(error)
        });
      }

      completed += 1;
      onProgress?.({
        total: manifest.papers.length,
        completed,
        currentId: paper.id,
        result: cloneRestoreResult(result)
      });
    }
  }

  await Promise.all(
    Array.from({
      length: Math.min(concurrency, manifest.papers.length || 1)
    }, () => runWorker())
  );

  result.restoredIds.sort();
  result.skippedIds.sort();
  result.failed.sort((left, right) => left.id.localeCompare(right.id));

  return result;
}

export function buildUrlManifestFilename(date = new Date()) {
  return `ar5iv-reader-urls-${date.toISOString().slice(0, 10)}.json`;
}

export function buildUrlManifestFingerprint(papers) {
  return normalizeManifestPapers(papers)
    .map((paper) => `${paper.id}|${paper.updatedAt}|${paper.sourceUrl}`)
    .join("\n");
}

function normalizeManifest(manifest) {
  if (!manifest || Number(manifest.schemaVersion) !== URL_MANIFEST_SCHEMA_VERSION) {
    throw new Error("This URL recovery file is not a supported ar5iv Reader manifest.");
  }

  return {
    schemaVersion: URL_MANIFEST_SCHEMA_VERSION,
    exportedAt: String(manifest.exportedAt || new Date().toISOString()),
    appVersion: String(manifest.appVersion || "").trim(),
    origin: String(manifest.origin || "").trim(),
    papers: normalizeManifestPapers(manifest.papers)
  };
}

function normalizeManifestPapers(papers) {
  const papersById = new Map();

  for (const paper of Array.isArray(papers) ? papers : []) {
    const normalized = normalizeManifestPaper(paper);
    if (!normalized) {
      continue;
    }

    const current = papersById.get(normalized.id);
    if (!current || compareManifestPapers(normalized, current) > 0) {
      papersById.set(normalized.id, normalized);
    }
  }

  return [...papersById.values()].sort(compareById);
}

function normalizeManifestPaper(paper) {
  const id = String(paper?.id || "").trim();
  if (!id) {
    return null;
  }

  const updatedAt = String(paper?.updatedAt || paper?.savedAt || new Date(0).toISOString());
  const revisionMs =
    Number(paper?.revisionMs || 0) || Date.parse(updatedAt || paper?.savedAt || "") || 0;

  return {
    id,
    title: String(paper?.title || id).trim(),
    sourceUrl: String(paper?.sourceUrl || "").trim(),
    ar5ivUrl: String(paper?.ar5ivUrl || "").trim(),
    savedAt: String(paper?.savedAt || updatedAt || new Date(0).toISOString()),
    updatedAt,
    revisionMs
  };
}

function compareManifestPapers(left, right) {
  if (left.revisionMs !== right.revisionMs) {
    return left.revisionMs - right.revisionMs;
  }

  const leftUpdatedAtMs = Date.parse(left.updatedAt || "") || 0;
  const rightUpdatedAtMs = Date.parse(right.updatedAt || "") || 0;
  if (leftUpdatedAtMs !== rightUpdatedAtMs) {
    return leftUpdatedAtMs - rightUpdatedAtMs;
  }

  return JSON.stringify(left).localeCompare(JSON.stringify(right));
}

function compareById(left, right) {
  return left.id.localeCompare(right.id);
}

function cloneRestoreResult(result) {
  return {
    restoredIds: [...result.restoredIds],
    skippedIds: [...result.skippedIds],
    failed: result.failed.map((entry) => ({
      id: entry.id,
      reason: entry.reason
    }))
  };
}

function stringifyError(error) {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

async function fetchPaperById(...args) {
  const module = await import("./fetchPaper");
  return module.fetchPaperById(...args);
}

async function getPaperRecord(...args) {
  const module = await import("./db");
  return module.getPaper(...args);
}

async function persistPaperRecord(...args) {
  const module = await import("./db");
  return module.savePaper(...args);
}
