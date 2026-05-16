import { collectAssetUrls, fetchAssetRecords } from "./assets";

const DB_NAME = "ar5iv-reader";
const DB_VERSION = 7;
const PAPER_STORE = "papers";
const ASSET_STORE = "assets";
const SETTING_STORE = "settings";
const LATEX_PROJECT_STORE = "latexProjects";
const ML_MODEL_STORE = "mlModels";
const ML_MODEL_META_STORE = "mlModelMeta";
const PDF_RENDER_CACHE_STORE = "pdfRenderCache";
const SNAPSHOT_SCHEMA_VERSION = 4;
const SYNCABLE_SETTINGS = new Set(["pdfFallbackNoticeEnabled", "theoremNotes"]);

export const SETTING_KEYS = Object.freeze({
  openFromArxivHelpDismissed: "openFromArxivHelpDismissed",
  deviceIdentity: "deviceIdentity",
  nearbySyncState: "nearbySyncState",
  pairedDevices: "pairedDevices",
  pdfFallbackNoticeEnabled: "pdfFallbackNoticeEnabled",
  theoremNotes: "theoremNotes",
  pdfMathCopyDisableNoticeShown: "pdfMathCopyDisableNoticeShown",
  pdfMathCopyCapability: "pdfMathCopyCapability",
  pdfMathCopyBenchmark: "pdfMathCopyBenchmark",
  pdfMathCopyModelRevision: "pdfMathCopyModelRevision",
  backupFileHandle: "backupFileHandle",
  backupState: "backupState",
  recoveryFileHandle: "recoveryFileHandle",
  recoveryFileState: "recoveryFileState",
  storageDiagnostics: "storageDiagnostics",
  installMeta: "installMeta",
  recoveryState: "recoveryState",
  openPaperSearchHistory: "openPaperSearchHistory"
});

let databasePromise;

export async function listPapers() {
  const records = await listAllPaperRecords();
  return records
    .filter((record) => !getDeletedAtMs(record))
    .map((record) => normalizePaperRecord(record))
    .sort((left, right) => getRecordRevisionMs(right) - getRecordRevisionMs(left));
}

export async function listPaperIds() {
  const papers = await listPapers();
  return papers.map((paper) => paper.id);
}

export async function listLatexProjects() {
  const records = await listAllLatexProjectRecords();
  return records
    .filter((record) => !getDeletedAtMs(record))
    .map((record) => normalizeLatexProjectRecord(record))
    .sort((left, right) => getRecordRevisionMs(right) - getRecordRevisionMs(left));
}

export async function getLatexProject(id) {
  const database = await openDatabase();
  const transaction = database.transaction([LATEX_PROJECT_STORE], "readonly");
  const record = await requestToPromise(transaction.objectStore(LATEX_PROJECT_STORE).get(id));
  if (!record || getDeletedAtMs(record)) {
    return null;
  }

  return normalizeLatexProjectRecord(record);
}

export async function hasPaper(id) {
  return Boolean(await getPaper(id));
}

export async function getPaper(id) {
  const database = await openDatabase();
  const transaction = database.transaction([PAPER_STORE], "readonly");
  const record = await requestToPromise(transaction.objectStore(PAPER_STORE).get(id));
  if (!record || getDeletedAtMs(record)) {
    return null;
  }

  return normalizePaperRecord(record);
}

export async function getAssetRecordsForPaper(paperId) {
  const database = await openDatabase();
  const transaction = database.transaction([ASSET_STORE], "readonly");
  return requestToPromise(
    transaction.objectStore(ASSET_STORE).index("paperId").getAll(IDBKeyRange.only(paperId))
  );
}

export async function getAssetRecord(key) {
  const database = await openDatabase();
  const transaction = database.transaction([ASSET_STORE], "readonly");
  return requestToPromise(transaction.objectStore(ASSET_STORE).get(key));
}

export async function putAssetRecord(record) {
  const database = await openDatabase();
  const transaction = database.transaction([ASSET_STORE], "readwrite");
  transaction.objectStore(ASSET_STORE).put({
    key: String(record?.key || "").trim(),
    paperId: String(record?.paperId || "").trim(),
    assetUrl: String(record?.assetUrl || "").trim(),
    contentType: String(record?.contentType || "").trim(),
    blob: record?.blob instanceof Blob ? record.blob : new Blob([])
  });
  await transactionToPromise(transaction);
}

export async function savePaper(sessionPaper, { deviceId = "local" } = {}) {
  const savedAt = new Date().toISOString();
  const existing = await getRawPaperRecord(sessionPaper.id);
  const revisionMs = await claimNextRevisionMs();
  const assetUrls = collectAssetUrls(sessionPaper.html, sessionPaper.ar5ivUrl);
  const assetRecords = await fetchAssetRecords(sessionPaper.id, assetUrls);

  const paperRecord = {
    id: sessionPaper.id,
    contentType: "html",
    sourceUrl: sessionPaper.sourceUrl,
    ar5ivUrl: sessionPaper.ar5ivUrl,
    title: String(sessionPaper.title || sessionPaper.titleHint || sessionPaper.id).trim(),
    savedAt: existing?.savedAt || savedAt,
    updatedAt: new Date(revisionMs).toISOString(),
    revisionMs,
    revisionDeviceId: deviceId,
    deletedAtMs: 0,
    deletedAt: "",
    html: sessionPaper.html,
    assetUrls,
    pdfUrl: "",
    pdfFingerprint: "",
    pdfByteLength: 0,
    pdfFetchStatus: ""
  };

  const database = await openDatabase();
  const transaction = database.transaction([PAPER_STORE, ASSET_STORE], "readwrite");
  const paperStore = transaction.objectStore(PAPER_STORE);
  const assetStore = transaction.objectStore(ASSET_STORE);

  await deleteAssetRows(assetStore, sessionPaper.id);
  paperStore.put(paperRecord);
  for (const record of assetRecords) {
    assetStore.put(record);
  }

  await transactionToPromise(transaction);
  return normalizePaperRecord(paperRecord);
}

export async function savePdfPaper(sessionPaper, { deviceId = "local" } = {}) {
  const savedAt = new Date().toISOString();
  const existing = await getRawPaperRecord(sessionPaper.id);
  const revisionMs = await claimNextRevisionMs();
  const pdfBlob = sessionPaper?.pdfState?.blob;
  const pdfUrl = String(sessionPaper?.pdfUrl || "").trim();
  if (!(pdfBlob instanceof Blob) || !pdfUrl) {
    throw new Error("PDF fallback paper is missing its PDF blob.");
  }

  const pdfFingerprint =
    String(sessionPaper?.pdfState?.pdfFingerprint || "").trim() || (await hashBlob(pdfBlob));
  const paperRecord = {
    id: sessionPaper.id,
    contentType: "pdf",
    sourceUrl: sessionPaper.sourceUrl,
    ar5ivUrl: "",
    title: String(sessionPaper.title || sessionPaper.titleHint || sessionPaper.id).trim(),
    savedAt: existing?.savedAt || savedAt,
    updatedAt: new Date(revisionMs).toISOString(),
    revisionMs,
    revisionDeviceId: deviceId,
    deletedAtMs: 0,
    deletedAt: "",
    html: "",
    assetUrls: [],
    pdfUrl,
    pdfFingerprint,
    pdfByteLength: Number(pdfBlob.size || 0),
    pdfFetchStatus: "ready"
  };

  const database = await openDatabase();
  const transaction = database.transaction([PAPER_STORE, ASSET_STORE], "readwrite");
  const paperStore = transaction.objectStore(PAPER_STORE);
  const assetStore = transaction.objectStore(ASSET_STORE);

  await deleteAssetRows(assetStore, sessionPaper.id);
  paperStore.put(paperRecord);
  assetStore.put({
    key: `${sessionPaper.id}::${pdfUrl}`,
    paperId: sessionPaper.id,
    assetUrl: pdfUrl,
    contentType: pdfBlob.type || "application/pdf",
    blob: pdfBlob
  });

  await transactionToPromise(transaction);
  return normalizePaperRecord(paperRecord);
}

export async function saveLatexProject(project, { deviceId = "local" } = {}) {
  const id = String(project?.id || "").trim();
  if (!id) {
    throw new Error("LaTeX project is missing an id.");
  }

  const savedAt = new Date().toISOString();
  const existing = await getRawLatexProjectRecord(id);
  const revisionMs = await claimNextRevisionMs();
  const projectRecord = {
    id,
    title: String(project?.title || id).trim() || id,
    source: String(project?.source || ""),
    createdAt: existing?.createdAt || project?.createdAt || savedAt,
    updatedAt: new Date(revisionMs).toISOString(),
    revisionMs,
    revisionDeviceId: deviceId,
    deletedAtMs: 0,
    deletedAt: ""
  };

  const database = await openDatabase();
  const transaction = database.transaction([LATEX_PROJECT_STORE], "readwrite");
  transaction.objectStore(LATEX_PROJECT_STORE).put(projectRecord);
  await transactionToPromise(transaction);
  return normalizeLatexProjectRecord(projectRecord);
}

export async function deletePaper(id, { deviceId = "local" } = {}) {
  const existing = await getRawPaperRecord(id);
  const deletedAtMs = await claimNextRevisionMs();
  const deletedAt = new Date(deletedAtMs).toISOString();
  const database = await openDatabase();
  const transaction = database.transaction([PAPER_STORE, ASSET_STORE], "readwrite");
  const paperStore = transaction.objectStore(PAPER_STORE);
  const assetStore = transaction.objectStore(ASSET_STORE);

  await deleteAssetRows(assetStore, id);
  paperStore.put({
    id,
    contentType: existing?.contentType || "html",
    title: existing?.title || id,
    sourceUrl: existing?.sourceUrl || "",
    ar5ivUrl: existing?.ar5ivUrl || "",
    savedAt: existing?.savedAt || deletedAt,
    updatedAt: deletedAt,
    revisionMs: deletedAtMs,
    revisionDeviceId: deviceId,
    deletedAtMs,
    deletedAt,
    html: "",
    assetUrls: [],
    pdfUrl: existing?.pdfUrl || "",
    pdfFingerprint: existing?.pdfFingerprint || "",
    pdfByteLength: Number(existing?.pdfByteLength || 0),
    pdfFetchStatus: ""
  });
  await transactionToPromise(transaction);
}

export async function deleteLatexProject(id, { deviceId = "local" } = {}) {
  const existing = await getRawLatexProjectRecord(id);
  const deletedAtMs = await claimNextRevisionMs();
  const deletedAt = new Date(deletedAtMs).toISOString();
  const database = await openDatabase();
  const transaction = database.transaction([LATEX_PROJECT_STORE], "readwrite");
  transaction.objectStore(LATEX_PROJECT_STORE).put({
    id,
    title: existing?.title || id,
    source: "",
    createdAt: existing?.createdAt || deletedAt,
    updatedAt: deletedAt,
    revisionMs: deletedAtMs,
    revisionDeviceId: deviceId,
    deletedAtMs,
    deletedAt
  });
  await transactionToPromise(transaction);
}

export async function getSetting(key) {
  const database = await openDatabase();
  const transaction = database.transaction([SETTING_STORE], "readonly");
  return requestToPromise(transaction.objectStore(SETTING_STORE).get(key));
}

export async function setSetting(key, value) {
  const database = await openDatabase();
  const transaction = database.transaction([SETTING_STORE], "readwrite");
  transaction.objectStore(SETTING_STORE).put({
    key,
    value,
    updatedAt: new Date().toISOString()
  });
  await transactionToPromise(transaction);
}

export async function getMlModelRecord(key) {
  const database = await openDatabase();
  const transaction = database.transaction([ML_MODEL_STORE], "readonly");
  return requestToPromise(transaction.objectStore(ML_MODEL_STORE).get(key));
}

export async function listMlModelRecords({ revision = "", modelId = "" } = {}) {
  const database = await openDatabase();
  const transaction = database.transaction([ML_MODEL_STORE], "readonly");
  const store = transaction.objectStore(ML_MODEL_STORE);

  if (revision) {
    const records = await requestToPromise(store.index("revision").getAll(IDBKeyRange.only(revision)));
    return modelId ? records.filter((record) => record.modelId === modelId) : records;
  }

  if (modelId) {
    return requestToPromise(store.index("modelId").getAll(IDBKeyRange.only(modelId)));
  }

  return requestToPromise(store.getAll());
}

export async function putMlModelRecord(record) {
  const database = await openDatabase();
  const transaction = database.transaction([ML_MODEL_STORE], "readwrite");
  transaction.objectStore(ML_MODEL_STORE).put({
    key: String(record?.key || "").trim(),
    revision: String(record?.revision || "").trim(),
    modelId: String(record?.modelId || "").trim(),
    filename: String(record?.filename || "").trim(),
    blob: record?.blob instanceof Blob ? record.blob : new Blob([]),
    size: Number(record?.size || 0),
    updatedAt: String(record?.updatedAt || new Date().toISOString())
  });
  await transactionToPromise(transaction);
}

export async function deleteMlModelRecords({ revision = "", modelId = "" } = {}) {
  if (!revision && !modelId) {
    return;
  }

  const records = await listMlModelRecords({
    revision,
    modelId
  });
  if (!records.length) {
    return;
  }

  const database = await openDatabase();
  const transaction = database.transaction([ML_MODEL_STORE], "readwrite");
  const store = transaction.objectStore(ML_MODEL_STORE);
  for (const record of records) {
    store.delete(record.key);
  }
  await transactionToPromise(transaction);
}

export async function getMlModelMetaRecord(key) {
  const database = await openDatabase();
  const transaction = database.transaction([ML_MODEL_META_STORE], "readonly");
  return requestToPromise(transaction.objectStore(ML_MODEL_META_STORE).get(key));
}

export async function listMlModelMetaRecords({ revision = "" } = {}) {
  const database = await openDatabase();
  const transaction = database.transaction([ML_MODEL_META_STORE], "readonly");
  const store = transaction.objectStore(ML_MODEL_META_STORE);
  if (revision) {
    return requestToPromise(store.index("revision").getAll(IDBKeyRange.only(revision)));
  }
  return requestToPromise(store.getAll());
}

export async function putMlModelMetaRecord(record) {
  const database = await openDatabase();
  const transaction = database.transaction([ML_MODEL_META_STORE], "readwrite");
  transaction.objectStore(ML_MODEL_META_STORE).put({
    key: String(record?.key || record?.modelId || "").trim(),
    revision: String(record?.revision || "").trim(),
    modelId: String(record?.modelId || "").trim(),
    files: Array.isArray(record?.files) ? record.files.map((file) => String(file || "").trim()).filter(Boolean) : [],
    updatedAt: String(record?.updatedAt || new Date().toISOString())
  });
  await transactionToPromise(transaction);
}

export async function putPaperRecord(record) {
  const database = await openDatabase();
  const transaction = database.transaction([PAPER_STORE], "readwrite");
  transaction.objectStore(PAPER_STORE).put(denormalizePaperRecord(normalizePaperRecord(record)));
  await transactionToPromise(transaction);
}

export async function putLatexProjectRecord(record) {
  const database = await openDatabase();
  const transaction = database.transaction([LATEX_PROJECT_STORE], "readwrite");
  transaction
    .objectStore(LATEX_PROJECT_STORE)
    .put(denormalizeLatexProjectRecord(normalizeLatexProjectRecord(record)));
  await transactionToPromise(transaction);
}

export async function getPdfRenderCacheRecord(key) {
  const database = await openDatabase();
  const transaction = database.transaction([PDF_RENDER_CACHE_STORE], "readonly");
  return requestToPromise(transaction.objectStore(PDF_RENDER_CACHE_STORE).get(key));
}

export async function listPdfRenderCacheRecords({ pdfFingerprint = "", paperId = "" } = {}) {
  const database = await openDatabase();
  const transaction = database.transaction([PDF_RENDER_CACHE_STORE], "readonly");
  const store = transaction.objectStore(PDF_RENDER_CACHE_STORE);

  if (pdfFingerprint) {
    const records = await requestToPromise(
      store.index("pdfFingerprint").getAll(IDBKeyRange.only(pdfFingerprint))
    );
    return paperId ? records.filter((record) => record.paperId === paperId) : records;
  }

  if (paperId) {
    return requestToPromise(store.index("paperId").getAll(IDBKeyRange.only(paperId)));
  }

  return requestToPromise(store.getAll());
}

export async function putPdfRenderCacheRecord(record) {
  const database = await openDatabase();
  const transaction = database.transaction([PDF_RENDER_CACHE_STORE], "readwrite");
  transaction.objectStore(PDF_RENDER_CACHE_STORE).put({
    key: String(record?.key || "").trim(),
    paperId: String(record?.paperId || "").trim(),
    pdfFingerprint: String(record?.pdfFingerprint || "").trim(),
    pageNumber: Number(record?.pageNumber || 0),
    width: Number(record?.width || 0),
    height: Number(record?.height || 0),
    quality: String(record?.quality || "").trim(),
    blob: record?.blob instanceof Blob ? record.blob : new Blob([]),
    byteSize: Number(record?.byteSize || record?.blob?.size || 0),
    updatedAt: String(record?.updatedAt || new Date().toISOString())
  });
  await transactionToPromise(transaction);
}

export async function deletePdfRenderCacheRecord(key) {
  const database = await openDatabase();
  const transaction = database.transaction([PDF_RENDER_CACHE_STORE], "readwrite");
  transaction.objectStore(PDF_RENDER_CACHE_STORE).delete(key);
  await transactionToPromise(transaction);
}

export async function getPaperManifestEntries() {
  const records = await listAllPaperRecords();
  return Promise.all(
    records
      .map((record) => normalizePaperRecord(record))
      .sort(compareById)
      .map(async (record) => ({
        id: record.id,
        contentType: record.contentType,
        revisionMs: record.revisionMs,
        revisionDeviceId: record.revisionDeviceId,
        deletedAtMs: record.deletedAtMs,
        assetKeys: record.assetUrls.map((assetUrl) => `${record.id}::${assetUrl}`),
        htmlHash: record.deletedAtMs ? "" : await hashText(record.html || ""),
        pdfByteLength: Number(record.pdfByteLength || 0),
        pdfFingerprint: String(record.pdfFingerprint || ""),
        pdfFetchStatus: String(record.pdfFetchStatus || "")
      }))
  );
}

export async function getLatexProjectManifestEntries() {
  const records = await listAllLatexProjectRecords();
  return records
    .map((record) => normalizeLatexProjectRecord(record))
    .sort(compareById)
    .map((record) => ({
      id: record.id,
      title: record.deletedAtMs ? "" : record.title,
      revisionMs: record.revisionMs,
      revisionDeviceId: record.revisionDeviceId,
      deletedAtMs: record.deletedAtMs,
      sourceHash: record.deletedAtMs ? "" : hashStringSync(record.source || "")
    }));
}

export async function exportPaperTransferPayload(paperId, { includeAssets = true } = {}) {
  const database = await openDatabase();
  const transaction = database.transaction([PAPER_STORE, ASSET_STORE], "readonly");
  const paperRecord = await requestToPromise(transaction.objectStore(PAPER_STORE).get(paperId));

  if (!paperRecord) {
    throw new Error(`Paper ${paperId} was not found.`);
  }

  const assetRecords = !includeAssets || getDeletedAtMs(paperRecord)
    ? []
    : await requestToPromise(
        transaction.objectStore(ASSET_STORE).index("paperId").getAll(IDBKeyRange.only(paperId))
      );

  return {
    paper: normalizePaperRecord(paperRecord),
    assets: await Promise.all(
      assetRecords.map(async (record) => ({
        key: record.key,
        paperId: record.paperId,
        assetUrl: record.assetUrl,
        contentType: record.contentType || "",
        data: await blobToBase64(record.blob)
      }))
    )
  };
}

export async function importPaperTransferPayload(payload) {
  const normalized = normalizeTransferPayload(payload);
  const current = await getRawPaperRecord(normalized.paper.id);

  if (current && comparePaperVersions(normalizePaperRecord(current), normalized.paper) >= 0) {
    return false;
  }

  const database = await openDatabase();
  const transaction = database.transaction([PAPER_STORE, ASSET_STORE], "readwrite");
  const paperStore = transaction.objectStore(PAPER_STORE);
  const assetStore = transaction.objectStore(ASSET_STORE);

  await deleteAssetRows(assetStore, normalized.paper.id);
  paperStore.put(denormalizePaperRecord(normalized.paper));

  for (const asset of normalized.assets) {
    assetStore.put({
      key: asset.key,
      paperId: asset.paperId,
      assetUrl: asset.assetUrl,
      contentType: asset.contentType,
      blob: base64ToBlob(asset.data, asset.contentType)
    });
  }

  await transactionToPromise(transaction);
  await updateLogicalClock(normalized.paper.revisionMs);
  return true;
}

export async function exportLatexProjectTransferPayload(projectId) {
  const database = await openDatabase();
  const transaction = database.transaction([LATEX_PROJECT_STORE], "readonly");
  const projectRecord = await requestToPromise(
    transaction.objectStore(LATEX_PROJECT_STORE).get(projectId)
  );

  if (!projectRecord) {
    throw new Error(`LaTeX project ${projectId} was not found.`);
  }

  return {
    project: normalizeLatexProjectRecord(projectRecord)
  };
}

export async function importLatexProjectTransferPayload(payload) {
  const normalized = normalizeLatexProjectTransferPayload(payload);
  const current = await getRawLatexProjectRecord(normalized.project.id);

  if (current && comparePaperVersions(normalizeLatexProjectRecord(current), normalized.project) >= 0) {
    return false;
  }

  const database = await openDatabase();
  const transaction = database.transaction([LATEX_PROJECT_STORE], "readwrite");
  transaction.objectStore(LATEX_PROJECT_STORE).put(denormalizeLatexProjectRecord(normalized.project));
  await transactionToPromise(transaction);
  await updateLogicalClock(normalized.project.revisionMs);
  return true;
}

export async function exportLibrarySnapshot() {
  const database = await openDatabase();
  const transaction = database.transaction(
    [PAPER_STORE, ASSET_STORE, SETTING_STORE, LATEX_PROJECT_STORE],
    "readonly"
  );
  const paperRecords = await requestToPromise(transaction.objectStore(PAPER_STORE).getAll());
  const assetRecords = await requestToPromise(transaction.objectStore(ASSET_STORE).getAll());
  const settingRecords = await requestToPromise(transaction.objectStore(SETTING_STORE).getAll());
  const latexProjectRecords = await requestToPromise(
    transaction.objectStore(LATEX_PROJECT_STORE).getAll()
  );

  const papers = paperRecords.map((record) => normalizePaperRecord(record)).sort(compareById);
  const latexProjects = latexProjectRecords
    .map((record) => normalizeLatexProjectRecord(record))
    .sort(compareById);
  const assets = await Promise.all(
    assetRecords
      .sort(compareById)
      .map(async (record) => ({
        key: record.key,
        paperId: record.paperId,
        assetUrl: record.assetUrl,
        contentType: record.contentType || "",
        data: await blobToBase64(record.blob)
      }))
  );
  const settings = settingRecords
    .filter((record) => SYNCABLE_SETTINGS.has(record.key))
    .map((record) => ({
      key: record.key,
      value: record.value,
      updatedAt: record.updatedAt || new Date(0).toISOString()
    }))
    .sort(compareById);

  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    papers,
    latexProjects,
    assets,
    settings
  };
}

export async function applyLibrarySnapshot(snapshot) {
  const normalized = normalizeSnapshot(snapshot);
  const database = await openDatabase();
  const transaction = database.transaction(
    [PAPER_STORE, ASSET_STORE, SETTING_STORE, LATEX_PROJECT_STORE],
    "readwrite"
  );
  const paperStore = transaction.objectStore(PAPER_STORE);
  const assetStore = transaction.objectStore(ASSET_STORE);
  const settingStore = transaction.objectStore(SETTING_STORE);
  const latexProjectStore = transaction.objectStore(LATEX_PROJECT_STORE);

  paperStore.clear();
  assetStore.clear();
  latexProjectStore.clear();

  for (const paper of normalized.papers) {
    paperStore.put(denormalizePaperRecord(paper));
  }

  for (const project of normalized.latexProjects) {
    latexProjectStore.put(denormalizeLatexProjectRecord(project));
  }

  for (const asset of normalized.assets) {
    assetStore.put({
      key: asset.key,
      paperId: asset.paperId,
      assetUrl: asset.assetUrl,
      contentType: asset.contentType,
      blob: base64ToBlob(asset.data, asset.contentType)
    });
  }

  for (const setting of normalized.settings) {
    settingStore.put({
      key: setting.key,
      value: setting.value,
      updatedAt: setting.updatedAt
    });
  }

  await transactionToPromise(transaction);

  const maxPaperRevisionMs = normalized.papers.reduce(
    (maxValue, paper) => Math.max(maxValue, paper.revisionMs || 0),
    0
  );
  const maxProjectRevisionMs = normalized.latexProjects.reduce(
    (maxValue, project) => Math.max(maxValue, project.revisionMs || 0),
    0
  );
  const maxRevisionMs = Math.max(maxPaperRevisionMs, maxProjectRevisionMs);
  await updateLogicalClock(maxRevisionMs);
}

export async function getNearbySyncState() {
  return (
    (await getSetting("nearbySyncState"))?.value || {
      websocketBackoffMs: 1000,
      lastRelayConnectAt: 0,
      localLogicalClock: 0
    }
  );
}

export async function setNearbySyncState(value) {
  await setSetting("nearbySyncState", value);
}

export async function claimNextRevisionMs() {
  const currentState = await getNearbySyncState();
  const revisionMs = Math.max(Date.now(), Number(currentState.localLogicalClock || 0) + 1);
  await setNearbySyncState({
    ...currentState,
    localLogicalClock: revisionMs
  });
  return revisionMs;
}

export async function updateLogicalClock(revisionMs) {
  const currentState = await getNearbySyncState();
  if (Number(currentState.localLogicalClock || 0) >= Number(revisionMs || 0)) {
    return;
  }

  await setNearbySyncState({
    ...currentState,
    localLogicalClock: Number(revisionMs || 0)
  });
}

function openDatabase() {
  if (!databasePromise) {
    databasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        const database = request.result;
        const transaction = request.transaction;
        if (!database.objectStoreNames.contains(PAPER_STORE)) {
          database.createObjectStore(PAPER_STORE, { keyPath: "id" });
        }

        if (!database.objectStoreNames.contains(ASSET_STORE)) {
          const nextAssetStore = database.createObjectStore(ASSET_STORE, {
            keyPath: "key"
          });
          nextAssetStore.createIndex("paperId", "paperId", { unique: false });
        } else if (transaction) {
          const assetStore = transaction.objectStore(ASSET_STORE);
          if (!assetStore.indexNames.contains("paperId")) {
            assetStore.createIndex("paperId", "paperId", { unique: false });
          }
        }

        if (!database.objectStoreNames.contains(SETTING_STORE)) {
          database.createObjectStore(SETTING_STORE, { keyPath: "key" });
        }

        if (!database.objectStoreNames.contains(LATEX_PROJECT_STORE)) {
          database.createObjectStore(LATEX_PROJECT_STORE, { keyPath: "id" });
        }

        if (!database.objectStoreNames.contains(ML_MODEL_STORE)) {
          const mlModelStore = database.createObjectStore(ML_MODEL_STORE, { keyPath: "key" });
          mlModelStore.createIndex("revision", "revision", { unique: false });
          mlModelStore.createIndex("modelId", "modelId", { unique: false });
        } else if (transaction) {
          const mlModelStore = transaction.objectStore(ML_MODEL_STORE);
          if (!mlModelStore.indexNames.contains("revision")) {
            mlModelStore.createIndex("revision", "revision", { unique: false });
          }
          if (!mlModelStore.indexNames.contains("modelId")) {
            mlModelStore.createIndex("modelId", "modelId", { unique: false });
          }
        }

        if (!database.objectStoreNames.contains(ML_MODEL_META_STORE)) {
          const mlModelMetaStore = database.createObjectStore(ML_MODEL_META_STORE, {
            keyPath: "key"
          });
          mlModelMetaStore.createIndex("revision", "revision", { unique: false });
        } else if (transaction) {
          const mlModelMetaStore = transaction.objectStore(ML_MODEL_META_STORE);
          if (!mlModelMetaStore.indexNames.contains("revision")) {
            mlModelMetaStore.createIndex("revision", "revision", { unique: false });
          }
        }

        if (!database.objectStoreNames.contains(PDF_RENDER_CACHE_STORE)) {
          const pdfRenderCacheStore = database.createObjectStore(PDF_RENDER_CACHE_STORE, {
            keyPath: "key"
          });
          pdfRenderCacheStore.createIndex("paperId", "paperId", { unique: false });
          pdfRenderCacheStore.createIndex("pdfFingerprint", "pdfFingerprint", {
            unique: false
          });
        } else if (transaction) {
          const pdfRenderCacheStore = transaction.objectStore(PDF_RENDER_CACHE_STORE);
          if (!pdfRenderCacheStore.indexNames.contains("paperId")) {
            pdfRenderCacheStore.createIndex("paperId", "paperId", { unique: false });
          }
          if (!pdfRenderCacheStore.indexNames.contains("pdfFingerprint")) {
            pdfRenderCacheStore.createIndex("pdfFingerprint", "pdfFingerprint", {
              unique: false
            });
          }
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  return databasePromise;
}

async function listAllPaperRecords() {
  const database = await openDatabase();
  const transaction = database.transaction([PAPER_STORE], "readonly");
  return requestToPromise(transaction.objectStore(PAPER_STORE).getAll());
}

async function listAllLatexProjectRecords() {
  const database = await openDatabase();
  const transaction = database.transaction([LATEX_PROJECT_STORE], "readonly");
  return requestToPromise(transaction.objectStore(LATEX_PROJECT_STORE).getAll());
}

async function getRawPaperRecord(id) {
  const database = await openDatabase();
  const transaction = database.transaction([PAPER_STORE], "readonly");
  return requestToPromise(transaction.objectStore(PAPER_STORE).get(id));
}

async function getRawLatexProjectRecord(id) {
  const database = await openDatabase();
  const transaction = database.transaction([LATEX_PROJECT_STORE], "readonly");
  return requestToPromise(transaction.objectStore(LATEX_PROJECT_STORE).get(id));
}

function normalizePaperRecord(record) {
  const revisionMs = getRecordRevisionMs(record);
  const deletedAtMs = getDeletedAtMs(record);

  return {
    id: String(record.id || "").trim(),
    contentType: normalizeContentType(record.contentType),
    title: String(record.title || record.id || "").trim(),
    sourceUrl: String(record.sourceUrl || "").trim(),
    ar5ivUrl: String(record.ar5ivUrl || "").trim(),
    savedAt: String(record.savedAt || new Date(revisionMs || Date.now()).toISOString()),
    updatedAt: String(record.updatedAt || new Date(revisionMs || Date.now()).toISOString()),
    revisionMs,
    revisionDeviceId: String(record.revisionDeviceId || "").trim(),
    deletedAtMs,
    deletedAt: deletedAtMs ? new Date(deletedAtMs).toISOString() : "",
    html: deletedAtMs ? "" : String(record.html || ""),
    assetUrls: deletedAtMs ? [] : Array.isArray(record.assetUrls) ? [...record.assetUrls] : [],
    pdfUrl: deletedAtMs ? "" : String(record.pdfUrl || "").trim(),
    pdfFingerprint: deletedAtMs ? "" : String(record.pdfFingerprint || "").trim(),
    pdfByteLength: deletedAtMs ? 0 : Number(record.pdfByteLength || 0),
    pdfFetchStatus: deletedAtMs ? "" : normalizePdfFetchStatus(record.pdfFetchStatus)
  };
}

function denormalizePaperRecord(record) {
  return {
    id: record.id,
    contentType: normalizeContentType(record.contentType),
    title: record.title,
    sourceUrl: record.sourceUrl,
    ar5ivUrl: record.ar5ivUrl,
    savedAt: record.savedAt,
    updatedAt: record.updatedAt || new Date(record.revisionMs || Date.now()).toISOString(),
    revisionMs: record.revisionMs || Date.parse(record.updatedAt || record.savedAt || "") || 0,
    revisionDeviceId: record.revisionDeviceId || "",
    deletedAtMs: record.deletedAtMs || 0,
    deletedAt: record.deletedAt || "",
    html: record.deletedAtMs ? "" : record.html || "",
    assetUrls: record.deletedAtMs ? [] : record.assetUrls || [],
    pdfUrl: record.deletedAtMs ? "" : record.pdfUrl || "",
    pdfFingerprint: record.deletedAtMs ? "" : record.pdfFingerprint || "",
    pdfByteLength: record.deletedAtMs ? 0 : Number(record.pdfByteLength || 0),
    pdfFetchStatus: record.deletedAtMs ? "" : normalizePdfFetchStatus(record.pdfFetchStatus)
  };
}

function normalizeLatexProjectRecord(record) {
  const revisionMs = getRecordRevisionMs(record);
  const deletedAtMs = getDeletedAtMs(record);
  const id = String(record?.id || "").trim();

  return {
    id,
    title: String(record?.title || id || "Untitled LaTeX Project").trim(),
    source: deletedAtMs ? "" : String(record?.source || ""),
    createdAt: String(record?.createdAt || record?.savedAt || new Date(revisionMs || Date.now()).toISOString()),
    updatedAt: String(record?.updatedAt || new Date(revisionMs || Date.now()).toISOString()),
    revisionMs,
    revisionDeviceId: String(record?.revisionDeviceId || "").trim(),
    deletedAtMs,
    deletedAt: deletedAtMs ? new Date(deletedAtMs).toISOString() : ""
  };
}

function denormalizeLatexProjectRecord(record) {
  return {
    id: record.id,
    title: record.title,
    source: record.deletedAtMs ? "" : record.source || "",
    createdAt: record.createdAt,
    updatedAt: record.updatedAt || new Date(record.revisionMs || Date.now()).toISOString(),
    revisionMs: record.revisionMs || Date.parse(record.updatedAt || record.createdAt || "") || 0,
    revisionDeviceId: record.revisionDeviceId || "",
    deletedAtMs: record.deletedAtMs || 0,
    deletedAt: record.deletedAt || ""
  };
}

function normalizeTransferPayload(payload) {
  if (!payload?.paper || typeof payload !== "object") {
    throw new Error("Incoming paper payload is invalid.");
  }

  const paper = normalizePaperRecord(payload.paper);
  const assets = Array.isArray(payload.assets)
    ? payload.assets
        .map((asset) => ({
          key: String(asset.key || "").trim(),
          paperId: String(asset.paperId || "").trim(),
          assetUrl: String(asset.assetUrl || "").trim(),
          contentType: String(asset.contentType || "").trim(),
          data: String(asset.data || "").trim()
        }))
        .filter(
          (asset) =>
            asset.key &&
            asset.paperId === paper.id &&
            asset.assetUrl &&
            asset.data &&
            !paper.deletedAtMs
        )
    : [];

  return {
    paper,
    assets
  };
}

function normalizeLatexProjectTransferPayload(payload) {
  if (!payload?.project || typeof payload !== "object") {
    throw new Error("Incoming LaTeX project payload is invalid.");
  }

  return {
    project: normalizeLatexProjectRecord(payload.project)
  };
}

function normalizeSnapshot(snapshot) {
  if (!snapshot || Number(snapshot.schemaVersion) < 1 || Number(snapshot.schemaVersion) > SNAPSHOT_SCHEMA_VERSION) {
    throw new Error("This backup file is not a supported ar5iv Reader backup.");
  }

  const papers = Array.isArray(snapshot.papers)
    ? snapshot.papers.map((paper) => normalizePaperRecord(paper)).sort(compareById)
    : [];
  const latexProjects = Array.isArray(snapshot.latexProjects)
    ? snapshot.latexProjects.map((project) => normalizeLatexProjectRecord(project)).sort(compareById)
    : [];

  const paperIds = new Set(papers.map((paper) => paper.id));
  const assets = Array.isArray(snapshot.assets)
    ? snapshot.assets
        .map((asset) => ({
          key: String(asset.key || "").trim(),
          paperId: String(asset.paperId || "").trim(),
          assetUrl: String(asset.assetUrl || "").trim(),
          contentType: String(asset.contentType || "").trim(),
          data: String(asset.data || "").trim()
        }))
        .filter((asset) => asset.key && paperIds.has(asset.paperId) && asset.assetUrl && asset.data)
        .sort(compareById)
    : [];

  const settings = Array.isArray(snapshot.settings)
    ? snapshot.settings
        .map((setting) => ({
          key: String(setting.key || "").trim(),
          value: setting.value,
          updatedAt: String(setting.updatedAt || new Date(0).toISOString())
        }))
        .filter((setting) => setting.key && SYNCABLE_SETTINGS.has(setting.key))
        .sort(compareById)
    : [];

  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    exportedAt: String(snapshot.exportedAt || new Date().toISOString()),
    papers,
    latexProjects,
    assets,
    settings
  };
}

function getRecordRevisionMs(record) {
  const revisionMs = Number(record.revisionMs || 0);
  if (Number.isFinite(revisionMs) && revisionMs > 0) {
    return revisionMs;
  }

  return Date.parse(record.updatedAt || record.deletedAt || record.savedAt || "") || 0;
}

function getDeletedAtMs(record) {
  const deletedAtMs = Number(record.deletedAtMs || 0);
  if (Number.isFinite(deletedAtMs) && deletedAtMs > 0) {
    return deletedAtMs;
  }

  return record.deletedAt ? Date.parse(record.deletedAt) || 0 : 0;
}

function comparePaperVersions(left, right) {
  if (left.revisionMs !== right.revisionMs) {
    return left.revisionMs - right.revisionMs;
  }

  return String(left.revisionDeviceId || "").localeCompare(String(right.revisionDeviceId || ""));
}

function deleteAssetRows(assetStore, paperId) {
  return new Promise((resolve, reject) => {
    const index = assetStore.index("paperId");
    const request = index.openKeyCursor(IDBKeyRange.only(paperId));

    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve();
        return;
      }

      assetStore.delete(cursor.primaryKey);
      cursor.continue();
    };
  });
}

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionToPromise(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () =>
      reject(transaction.error || new Error("IndexedDB transaction aborted"));
  });
}

function compareById(left, right) {
  return String(left.id || left.key).localeCompare(String(right.id || right.key));
}

async function blobToBase64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return bytesToBase64(bytes);
}

function base64ToBlob(value, contentType) {
  return new Blob([base64ToBytes(value)], {
    type: contentType || "application/octet-stream"
  });
}

function bytesToBase64(bytes) {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

async function hashText(text) {
  const buffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buffer)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 24);
}

function hashStringSync(text) {
  let hash = 2166136261;
  const normalized = String(text || "");
  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

async function hashBlob(blob) {
  const buffer = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return [...new Uint8Array(buffer)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function normalizeContentType(value) {
  return value === "pdf" ? "pdf" : "html";
}

function normalizePdfFetchStatus(value) {
  return value === "pending" || value === "ready" || value === "error" ? value : "";
}
