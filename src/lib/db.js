import { collectAssetUrls, fetchAssetRecords } from "./assets";

const DB_NAME = "ar5iv-reader";
const DB_VERSION = 4;
const PAPER_STORE = "papers";
const ASSET_STORE = "assets";
const SETTING_STORE = "settings";
const SNAPSHOT_SCHEMA_VERSION = 2;
const SYNCABLE_SETTINGS = new Set(["pdfFallbackNoticeEnabled"]);

export const SETTING_KEYS = Object.freeze({
  openFromArxivHelpDismissed: "openFromArxivHelpDismissed",
  deviceIdentity: "deviceIdentity",
  nearbySyncState: "nearbySyncState",
  pairedDevices: "pairedDevices",
  pdfFallbackNoticeEnabled: "pdfFallbackNoticeEnabled",
  backupFileHandle: "backupFileHandle",
  backupState: "backupState",
  recoveryFileHandle: "recoveryFileHandle",
  recoveryFileState: "recoveryFileState",
  storageDiagnostics: "storageDiagnostics",
  installMeta: "installMeta",
  recoveryState: "recoveryState"
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

export async function savePaper(sessionPaper, { deviceId = "local" } = {}) {
  const savedAt = new Date().toISOString();
  const existing = await getRawPaperRecord(sessionPaper.id);
  const revisionMs = await claimNextRevisionMs();
  const assetUrls = collectAssetUrls(sessionPaper.html, sessionPaper.ar5ivUrl);
  const assetRecords = await fetchAssetRecords(sessionPaper.id, assetUrls);

  const paperRecord = {
    id: sessionPaper.id,
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
    assetUrls
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
    assetUrls: []
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

export async function getPaperManifestEntries() {
  const records = await listAllPaperRecords();
  return Promise.all(
    records
      .map((record) => normalizePaperRecord(record))
      .sort(compareById)
      .map(async (record) => ({
        id: record.id,
        revisionMs: record.revisionMs,
        revisionDeviceId: record.revisionDeviceId,
        deletedAtMs: record.deletedAtMs,
        assetKeys: record.assetUrls.map((assetUrl) => `${record.id}::${assetUrl}`),
        htmlHash: record.deletedAtMs ? "" : await hashText(record.html || "")
      }))
  );
}

export async function exportPaperTransferPayload(paperId) {
  const database = await openDatabase();
  const transaction = database.transaction([PAPER_STORE, ASSET_STORE], "readonly");
  const paperRecord = await requestToPromise(transaction.objectStore(PAPER_STORE).get(paperId));

  if (!paperRecord) {
    throw new Error(`Paper ${paperId} was not found.`);
  }

  const assetRecords = getDeletedAtMs(paperRecord)
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

export async function exportLibrarySnapshot() {
  const database = await openDatabase();
  const transaction = database.transaction([PAPER_STORE, ASSET_STORE, SETTING_STORE], "readonly");
  const paperRecords = await requestToPromise(transaction.objectStore(PAPER_STORE).getAll());
  const assetRecords = await requestToPromise(transaction.objectStore(ASSET_STORE).getAll());
  const settingRecords = await requestToPromise(transaction.objectStore(SETTING_STORE).getAll());

  const papers = paperRecords.map((record) => normalizePaperRecord(record)).sort(compareById);
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
    assets,
    settings
  };
}

export async function applyLibrarySnapshot(snapshot) {
  const normalized = normalizeSnapshot(snapshot);
  const database = await openDatabase();
  const transaction = database.transaction([PAPER_STORE, ASSET_STORE, SETTING_STORE], "readwrite");
  const paperStore = transaction.objectStore(PAPER_STORE);
  const assetStore = transaction.objectStore(ASSET_STORE);
  const settingStore = transaction.objectStore(SETTING_STORE);

  paperStore.clear();
  assetStore.clear();

  for (const paper of normalized.papers) {
    paperStore.put(denormalizePaperRecord(paper));
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

  const maxRevisionMs = normalized.papers.reduce(
    (maxValue, paper) => Math.max(maxValue, paper.revisionMs || 0),
    0
  );
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

async function getRawPaperRecord(id) {
  const database = await openDatabase();
  const transaction = database.transaction([PAPER_STORE], "readonly");
  return requestToPromise(transaction.objectStore(PAPER_STORE).get(id));
}

function normalizePaperRecord(record) {
  const revisionMs = getRecordRevisionMs(record);
  const deletedAtMs = getDeletedAtMs(record);

  return {
    id: String(record.id || "").trim(),
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
    assetUrls: deletedAtMs ? [] : Array.isArray(record.assetUrls) ? [...record.assetUrls] : []
  };
}

function denormalizePaperRecord(record) {
  return {
    id: record.id,
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
    assetUrls: record.deletedAtMs ? [] : record.assetUrls || []
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

function normalizeSnapshot(snapshot) {
  if (!snapshot || Number(snapshot.schemaVersion) < 1 || Number(snapshot.schemaVersion) > SNAPSHOT_SCHEMA_VERSION) {
    throw new Error("This backup file is not a supported ar5iv Reader backup.");
  }

  const papers = Array.isArray(snapshot.papers)
    ? snapshot.papers.map((paper) => normalizePaperRecord(paper)).sort(compareById)
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
