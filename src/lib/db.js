import { collectAssetUrls, fetchAssetRecords } from "./assets";
import { extractPaperMetadata } from "./sanitizePaper";

const DB_NAME = "ar5iv-reader";
const DB_VERSION = 1;
const PAPER_STORE = "papers";
const ASSET_STORE = "assets";
const SETTING_STORE = "settings";

let databasePromise;

export async function listPapers() {
  const database = await openDatabase();
  const transaction = database.transaction([PAPER_STORE], "readonly");
  const records = await requestToPromise(
    transaction.objectStore(PAPER_STORE).getAll()
  );
  return records
    .map((record) => ({
      id: record.id,
      title: record.title,
      sourceUrl: record.sourceUrl,
      ar5ivUrl: record.ar5ivUrl,
      savedAt: record.savedAt,
      assetUrls: record.assetUrls
    }))
    .sort((left, right) => right.savedAt.localeCompare(left.savedAt));
}

export async function listPaperIds() {
  const papers = await listPapers();
  return papers.map((paper) => paper.id);
}

export async function hasPaper(id) {
  const database = await openDatabase();
  const transaction = database.transaction([PAPER_STORE], "readonly");
  const record = await requestToPromise(
    transaction.objectStore(PAPER_STORE).get(id)
  );
  return Boolean(record);
}

export async function getPaper(id) {
  const database = await openDatabase();
  const transaction = database.transaction([PAPER_STORE], "readonly");
  return requestToPromise(transaction.objectStore(PAPER_STORE).get(id));
}

export async function getAssetRecordsForPaper(paperId) {
  const database = await openDatabase();
  const transaction = database.transaction([ASSET_STORE], "readonly");
  return requestToPromise(
    transaction
      .objectStore(ASSET_STORE)
      .index("paperId")
      .getAll(IDBKeyRange.only(paperId))
  );
}

export async function savePaper(sessionPaper) {
  const savedAt = new Date().toISOString();
  const { title } = extractPaperMetadata(sessionPaper.html, sessionPaper.id);
  const assetUrls = collectAssetUrls(sessionPaper.html, sessionPaper.ar5ivUrl);
  const assetRecords = await fetchAssetRecords(sessionPaper.id, assetUrls);

  const paperRecord = {
    id: sessionPaper.id,
    sourceUrl: sessionPaper.sourceUrl,
    ar5ivUrl: sessionPaper.ar5ivUrl,
    title: title || sessionPaper.titleHint || sessionPaper.id,
    savedAt,
    html: sessionPaper.html,
    assetUrls
  };

  const database = await openDatabase();
  const transaction = database.transaction(
    [PAPER_STORE, ASSET_STORE],
    "readwrite"
  );
  const paperStore = transaction.objectStore(PAPER_STORE);
  const assetStore = transaction.objectStore(ASSET_STORE);

  await deleteAssetRows(assetStore, sessionPaper.id);
  paperStore.put(paperRecord);
  for (const record of assetRecords) {
    assetStore.put(record);
  }

  await transactionToPromise(transaction);
  return paperRecord;
}

export async function deletePaper(id) {
  const database = await openDatabase();
  const transaction = database.transaction(
    [PAPER_STORE, ASSET_STORE],
    "readwrite"
  );
  const paperStore = transaction.objectStore(PAPER_STORE);
  const assetStore = transaction.objectStore(ASSET_STORE);

  await deleteAssetRows(assetStore, id);
  paperStore.delete(id);
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
  transaction.objectStore(SETTING_STORE).put({ key, value });
  await transactionToPromise(transaction);
}

function openDatabase() {
  if (!databasePromise) {
    databasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        const database = request.result;

        if (!database.objectStoreNames.contains(PAPER_STORE)) {
          database.createObjectStore(PAPER_STORE, { keyPath: "id" });
        }

        if (!database.objectStoreNames.contains(ASSET_STORE)) {
          const assetStore = database.createObjectStore(ASSET_STORE, {
            keyPath: "key"
          });
          assetStore.createIndex("paperId", "paperId", { unique: false });
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
