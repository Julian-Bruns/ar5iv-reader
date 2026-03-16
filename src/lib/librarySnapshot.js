const SNAPSHOT_SCHEMA_VERSION = 3;

export function createEmptyLibrarySnapshot() {
  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    exportedAt: new Date(0).toISOString(),
    papers: [],
    assets: [],
    settings: []
  };
}

export function mergeLibrarySnapshots(leftSnapshot, rightSnapshot) {
  const left = normalizeSnapshot(leftSnapshot);
  const right = normalizeSnapshot(rightSnapshot);
  const leftAssetsByPaper = indexAssetsByPaper(left.assets);
  const rightAssetsByPaper = indexAssetsByPaper(right.assets);
  const papersById = new Map();

  for (const paper of left.papers) {
    papersById.set(paper.id, paper);
  }

  for (const paper of right.papers) {
    const current = papersById.get(paper.id);
    if (!current || comparePaperVersions(paper, current) > 0) {
      papersById.set(paper.id, paper);
    }
  }

  const papers = [...papersById.values()].sort(compareById);
  const assets = [];

  for (const paper of papers) {
    if (paper.deletedAtMs) {
      continue;
    }

    const currentLeft = left.papers.find((entry) => entry.id === paper.id);
    const winningAssets =
      currentLeft && comparePaperVersions(currentLeft, paper) === 0
        ? leftAssetsByPaper.get(paper.id) || []
        : rightAssetsByPaper.get(paper.id) || [];

    for (const asset of winningAssets) {
      assets.push(asset);
    }
  }

  const settingsByKey = new Map();
  for (const setting of left.settings) {
    settingsByKey.set(setting.key, setting);
  }
  for (const setting of right.settings) {
    const current = settingsByKey.get(setting.key);
    if (!current || getSettingTime(setting) >= getSettingTime(current)) {
      settingsByKey.set(setting.key, setting);
    }
  }

  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    papers,
    assets: assets.sort(compareById),
    settings: [...settingsByKey.values()].sort(compareById)
  };
}

export function snapshotsEqual(leftSnapshot, rightSnapshot) {
  return JSON.stringify(normalizeSnapshot(leftSnapshot)) === JSON.stringify(normalizeSnapshot(rightSnapshot));
}

function normalizeSnapshot(snapshot) {
  if (!snapshot) {
    return createEmptyLibrarySnapshot();
  }

  if (Number(snapshot.schemaVersion) < 1 || Number(snapshot.schemaVersion) > SNAPSHOT_SCHEMA_VERSION) {
    throw new Error("Unsupported library snapshot version.");
  }

  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    exportedAt: String(snapshot.exportedAt || new Date().toISOString()),
    papers: Array.isArray(snapshot.papers)
      ? snapshot.papers
          .map((paper) => ({
            id: String(paper.id || "").trim(),
            contentType: paper?.contentType === "pdf" ? "pdf" : "html",
            title: String(paper.title || paper.id || "").trim(),
            sourceUrl: String(paper.sourceUrl || "").trim(),
            ar5ivUrl: String(paper.ar5ivUrl || "").trim(),
            savedAt: String(paper.savedAt || new Date(0).toISOString()),
            updatedAt: String(paper.updatedAt || paper.savedAt || new Date(0).toISOString()),
            revisionMs:
              Number(paper.revisionMs || 0) ||
              Date.parse(paper.updatedAt || paper.deletedAt || paper.savedAt || "") ||
              0,
            revisionDeviceId: String(paper.revisionDeviceId || "").trim(),
            deletedAtMs:
              Number(paper.deletedAtMs || 0) ||
              (paper.deletedAt ? Date.parse(paper.deletedAt) || 0 : 0),
            deletedAt: String(paper.deletedAt || "").trim(),
            html:
              Number(paper.deletedAtMs || 0) || paper.deletedAt
                ? ""
                : String(paper.html || ""),
            assetUrls:
              Number(paper.deletedAtMs || 0) || paper.deletedAt
                ? []
                : Array.isArray(paper.assetUrls)
                  ? [...paper.assetUrls].sort()
                  : [],
            pdfUrl: Number(paper.deletedAtMs || 0) || paper.deletedAt ? "" : String(paper.pdfUrl || "").trim(),
            pdfFingerprint:
              Number(paper.deletedAtMs || 0) || paper.deletedAt ? "" : String(paper.pdfFingerprint || "").trim(),
            pdfByteLength: Number(paper.deletedAtMs || 0) || paper.deletedAt ? 0 : Number(paper.pdfByteLength || 0),
            pdfFetchStatus:
              Number(paper.deletedAtMs || 0) || paper.deletedAt
                ? ""
                : ["pending", "ready", "error"].includes(paper.pdfFetchStatus)
                  ? paper.pdfFetchStatus
                  : ""
          }))
          .filter((paper) => paper.id)
          .sort(compareById)
      : [],
    assets: Array.isArray(snapshot.assets)
      ? snapshot.assets
          .map((asset) => ({
            key: String(asset.key || "").trim(),
            paperId: String(asset.paperId || "").trim(),
            assetUrl: String(asset.assetUrl || "").trim(),
            contentType: String(asset.contentType || "").trim(),
            data: String(asset.data || "").trim()
          }))
          .filter((asset) => asset.key && asset.paperId && asset.assetUrl && asset.data)
          .sort(compareById)
      : [],
    settings: Array.isArray(snapshot.settings)
      ? snapshot.settings
          .map((setting) => ({
            key: String(setting.key || "").trim(),
            value: setting.value,
            updatedAt: String(setting.updatedAt || new Date(0).toISOString())
          }))
          .filter((setting) => setting.key)
          .sort(compareById)
      : []
  };
}

function indexAssetsByPaper(assets) {
  const map = new Map();
  for (const asset of assets) {
    const current = map.get(asset.paperId);
    if (current) {
      current.push(asset);
    } else {
      map.set(asset.paperId, [asset]);
    }
  }
  return map;
}

function comparePaperVersions(left, right) {
  if (left.revisionMs !== right.revisionMs) {
    return left.revisionMs - right.revisionMs;
  }

  return String(left.revisionDeviceId || "").localeCompare(String(right.revisionDeviceId || ""));
}

function getSettingTime(setting) {
  return Date.parse(setting.updatedAt || "") || 0;
}

function compareById(left, right) {
  return String(left.id || left.key).localeCompare(String(right.id || right.key));
}
