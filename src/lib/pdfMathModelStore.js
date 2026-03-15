const DB_NAME = "ar5iv-reader";
const DB_VERSION = 5;
const ML_MODEL_STORE = "mlModels";
const ML_MODEL_META_STORE = "mlModelMeta";

let databasePromise = null;

export function buildMlModelRecordKey(revision, modelId, filename) {
  return `${String(revision || "").trim()}::${String(modelId || "").trim()}::${String(filename || "").trim()}`;
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

export async function deleteMlModelRecord(key) {
  const database = await openDatabase();
  const transaction = database.transaction([ML_MODEL_STORE], "readwrite");
  transaction.objectStore(ML_MODEL_STORE).delete(key);
  await transactionToPromise(transaction);
}

export async function getMlModelMetaRecord(key) {
  const database = await openDatabase();
  const transaction = database.transaction([ML_MODEL_META_STORE], "readonly");
  return requestToPromise(transaction.objectStore(ML_MODEL_META_STORE).get(key));
}

export async function putMlModelMetaRecord(record) {
  const database = await openDatabase();
  const transaction = database.transaction([ML_MODEL_META_STORE], "readwrite");
  transaction.objectStore(ML_MODEL_META_STORE).put({
    key: String(record?.key || record?.modelId || "").trim(),
    revision: String(record?.revision || "").trim(),
    modelId: String(record?.modelId || "").trim(),
    files: Array.isArray(record?.files)
      ? record.files.map((file) => String(file || "").trim()).filter(Boolean)
      : [],
    updatedAt: String(record?.updatedAt || new Date().toISOString())
  });
  await transactionToPromise(transaction);
}

async function openDatabase() {
  if (!databasePromise) {
    databasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        const database = request.result;
        const transaction = request.transaction;

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
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  return databasePromise;
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
    transaction.onabort = () => reject(transaction.error || new Error("IndexedDB transaction aborted."));
  });
}

