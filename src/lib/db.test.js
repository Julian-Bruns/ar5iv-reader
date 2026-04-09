import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./assets", () => ({
  collectAssetUrls: vi.fn(() => []),
  fetchAssetRecords: vi.fn(async () => [])
}));

describe("db v6 upgrade", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("preserves v4 paper data and adds local-only ML stores without changing snapshots", async () => {
    const fakeIdb = createIndexedDbMock();
    Object.defineProperty(globalThis, "indexedDB", {
      configurable: true,
      value: fakeIdb.indexedDB
    });
    Object.defineProperty(globalThis, "IDBKeyRange", {
      configurable: true,
      value: {
        only(value) {
          return {
            type: "only",
            value
          };
        }
      }
    });

    fakeIdb.seedDatabase("ar5iv-reader", 4, {
      papers: {
        keyPath: "id",
        records: [
          {
            id: "2401.00001",
            title: "Stored paper",
            sourceUrl: "https://arxiv.org/abs/2401.00001",
            ar5ivUrl: "https://arxiv.org/html/2401.00001",
            savedAt: "2026-03-14T10:00:00.000Z",
            updatedAt: "2026-03-14T10:00:00.000Z",
            revisionMs: 10,
            revisionDeviceId: "local",
            deletedAtMs: 0,
            deletedAt: "",
            html: "<article>stored</article>",
            assetUrls: ["https://cdn.example/figure.png"]
          }
        ],
        indexes: {}
      },
      assets: {
        keyPath: "key",
        records: [
          {
            key: "2401.00001::https://cdn.example/figure.png",
            paperId: "2401.00001",
            assetUrl: "https://cdn.example/figure.png",
            contentType: "image/png",
            blob: new Blob(["asset"], {
              type: "image/png"
            })
          }
        ],
        indexes: {
          paperId: {
            keyPath: "paperId",
            unique: false
          }
        }
      },
      settings: {
        keyPath: "key",
        records: [
          {
            key: "pdfFallbackNoticeEnabled",
            value: true,
            updatedAt: "2026-03-14T10:00:00.000Z"
          },
          {
            key: "theoremNotes",
            value: [
              {
                id: "note-1",
                theoremText: "Theorem 1",
                noteText: "Important"
              }
            ],
            updatedAt: "2026-03-14T10:05:00.000Z"
          }
        ],
        indexes: {}
      }
    });

    const db = await import("./db");

    await expect(db.getPaper("2401.00001")).resolves.toEqual(
      expect.objectContaining({
        id: "2401.00001",
        title: "Stored paper",
        revisionMs: 10
      })
    );
    await expect(db.getAssetRecordsForPaper("2401.00001")).resolves.toEqual([
      expect.objectContaining({
        key: "2401.00001::https://cdn.example/figure.png",
        paperId: "2401.00001"
      })
    ]);
    await expect(db.getSetting(db.SETTING_KEYS.pdfFallbackNoticeEnabled)).resolves.toEqual(
      expect.objectContaining({
        key: db.SETTING_KEYS.pdfFallbackNoticeEnabled,
        value: true
      })
    );

    await db.putMlModelRecord({
      key: "breezedeus-pix2text-v1::breezedeus/pix2text-mfd::model.onnx",
      revision: "breezedeus-pix2text-v1",
      modelId: "breezedeus/pix2text-mfd",
      filename: "model.onnx",
      blob: new Blob(["model"]),
      size: 5,
      updatedAt: "2026-03-15T10:00:00.000Z"
    });
    await db.putMlModelMetaRecord({
      key: "breezedeus/pix2text-mfd",
      revision: "breezedeus-pix2text-v1",
      modelId: "breezedeus/pix2text-mfd",
      files: ["model.onnx"],
      updatedAt: "2026-03-15T10:00:00.000Z"
    });
    await db.setSetting(db.SETTING_KEYS.pdfMathCopyCapability, {
      enabled: false,
      reason: "gpu_unavailable",
      checkedAt: "2026-03-15T10:00:00.000Z"
    });

    await expect(
      db.getMlModelRecord("breezedeus-pix2text-v1::breezedeus/pix2text-mfd::model.onnx")
    ).resolves.toEqual(
      expect.objectContaining({
        revision: "breezedeus-pix2text-v1",
        modelId: "breezedeus/pix2text-mfd",
        filename: "model.onnx",
        size: 5
      })
    );
    await expect(db.getMlModelMetaRecord("breezedeus/pix2text-mfd")).resolves.toEqual(
      expect.objectContaining({
        revision: "breezedeus-pix2text-v1",
        files: ["model.onnx"]
      })
    );

    const snapshot = await db.exportLibrarySnapshot();

    expect(snapshot).toEqual({
      schemaVersion: 3,
      exportedAt: expect.any(String),
      papers: [
        expect.objectContaining({
          id: "2401.00001",
          title: "Stored paper"
        })
      ],
      assets: [
        expect.objectContaining({
          key: "2401.00001::https://cdn.example/figure.png",
          paperId: "2401.00001"
        })
      ],
      settings: [
        expect.objectContaining({
          key: "pdfFallbackNoticeEnabled",
          value: true
        }),
        expect.objectContaining({
          key: "theoremNotes",
          value: [
            expect.objectContaining({
              id: "note-1",
              theoremText: "Theorem 1",
              noteText: "Important"
            })
          ]
        })
      ]
    });
  });
});

function createIndexedDbMock() {
  const databases = new Map();

  return {
    indexedDB: {
      open(name, version) {
        const request = createRequest();
        queueMicrotask(() => {
          try {
            const existing = databases.get(name);
            let databaseState = existing;
            const requestedVersion =
              version == null ? Number(existing?.version || 1) || 1 : Number(version || 1);
            const needsUpgrade = !databaseState || requestedVersion > Number(databaseState.version || 0);

            if (!databaseState) {
              databaseState = createDatabaseState(requestedVersion);
              databases.set(name, databaseState);
            }

            if (needsUpgrade) {
              const previousVersion = Number(databaseState.version || 0);
              const database = createDatabase(databaseState);
              const transaction = createTransaction(databaseState, Object.keys(databaseState.stores));
              request.result = database;
              request.transaction = transaction;
              request.oldVersion = previousVersion;
              request.newVersion = requestedVersion;
              request.onupgradeneeded?.({
                target: request,
                oldVersion: previousVersion,
                newVersion: requestedVersion
              });
              databaseState.version = requestedVersion;
            }

            request.result = createDatabase(databaseState);
            request.transaction = null;
            request.onsuccess?.({
              target: request
            });
          } catch (error) {
            request.error = error;
            request.onerror?.({
              target: request
            });
          }
        });
        return request;
      }
    },
    seedDatabase(name, version, stores) {
      const databaseState = createDatabaseState(version);
      for (const [storeName, definition] of Object.entries(stores)) {
        const store = createStoreState(definition.keyPath);
        for (const [indexName, indexDefinition] of Object.entries(definition.indexes || {})) {
          store.indexes[indexName] = {
            keyPath: indexDefinition.keyPath,
            unique: Boolean(indexDefinition.unique)
          };
        }
        for (const record of definition.records || []) {
          store.records.set(record[definition.keyPath], clone(record));
        }
        databaseState.stores[storeName] = store;
      }
      databases.set(name, databaseState);
    }
  };
}

function createDatabaseState(version) {
  return {
    version,
    stores: {}
  };
}

function createDatabase(state) {
  return {
    createObjectStore(name, options = {}) {
      state.stores[name] = state.stores[name] || createStoreState(options.keyPath || "id");
      return createObjectStore(state.stores[name], null);
    },
    transaction(storeNames) {
      return createTransaction(state, storeNames);
    },
    get objectStoreNames() {
      return createNameList(Object.keys(state.stores));
    }
  };
}

function createTransaction(state, storeNames) {
  const names = Array.isArray(storeNames) ? storeNames : [storeNames];
  const transaction = {
    error: null,
    oncomplete: null,
    onerror: null,
    onabort: null,
    _pending: 0,
    _completed: false,
    objectStore(name) {
      const store = state.stores[name];
      if (!store) {
        throw new Error(`Unknown object store: ${name}`);
      }
      return createObjectStore(store, transaction);
    }
  };

  for (const name of names) {
    if (!state.stores[name]) {
      throw new Error(`Unknown object store: ${name}`);
    }
  }

  queueMicrotask(() => maybeComplete(transaction));
  return transaction;
}

function createObjectStore(store, transaction) {
  return {
    createIndex(name, keyPath, options = {}) {
      store.indexes[name] = {
        keyPath,
        unique: Boolean(options.unique)
      };
      return createIndex(store, name, transaction);
    },
    get(key) {
      return createStoreRequest(transaction, () => clone(store.records.get(key) ?? undefined));
    },
    getAll(query) {
      return createStoreRequest(transaction, () => getAllFromStore(store, query));
    },
    put(record) {
      return createStoreRequest(transaction, () => {
        const key = record?.[store.keyPath];
        store.records.set(key, clone(record));
        return key;
      });
    },
    index(name) {
      if (!store.indexes[name]) {
        throw new Error(`Unknown index: ${name}`);
      }
      return createIndex(store, name, transaction);
    },
    get indexNames() {
      return createNameList(Object.keys(store.indexes));
    }
  };
}

function createIndex(store, name, transaction) {
  const definition = store.indexes[name];
  return {
    getAll(query) {
      return createStoreRequest(transaction, () => {
        const matcher = buildMatcher(query, definition.keyPath);
        return [...store.records.values()].filter(matcher).map((record) => clone(record));
      });
    }
  };
}

function createStoreState(keyPath) {
  return {
    keyPath,
    indexes: {},
    records: new Map()
  };
}

function createStoreRequest(transaction, executor) {
  const request = createRequest();

  if (transaction) {
    transaction._pending += 1;
  }

  queueMicrotask(() => {
    try {
      request.result = executor();
      request.onsuccess?.({
        target: request
      });
    } catch (error) {
      request.error = error;
      if (transaction) {
        transaction.error = error;
      }
      request.onerror?.({
        target: request
      });
      transaction?.onerror?.({
        target: transaction
      });
    } finally {
      if (transaction) {
        transaction._pending = Math.max(0, transaction._pending - 1);
        maybeComplete(transaction);
      }
    }
  });

  return request;
}

function maybeComplete(transaction) {
  if (transaction._completed || transaction._pending > 0 || transaction.error) {
    return;
  }

  transaction._completed = true;
  transaction.oncomplete?.({
    target: transaction
  });
}

function createRequest() {
  return {
    result: undefined,
    error: null,
    onsuccess: null,
    onerror: null,
    onupgradeneeded: null,
    transaction: null
  };
}

function getAllFromStore(store, query) {
  const matcher = buildMatcher(query, store.keyPath);
  return [...store.records.values()].filter(matcher).map((record) => clone(record));
}

function buildMatcher(query, keyPath) {
  if (!query || query.type !== "only") {
    return () => true;
  }

  return (record) => record?.[keyPath] === query.value;
}

function createNameList(values) {
  return {
    contains(name) {
      return values.includes(name);
    }
  };
}

function clone(value) {
  return structuredClone(value);
}
