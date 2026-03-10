export async function ensurePersistentStorage() {
  if (typeof navigator === "undefined" || !navigator.storage?.persist) {
    return {
      supported: false,
      persisted: false,
      quota: 0,
      usage: 0
    };
  }

  try {
    const estimate = navigator.storage.estimate ? await navigator.storage.estimate() : null;
    const alreadyPersisted = navigator.storage.persisted
      ? await navigator.storage.persisted()
      : false;

    if (alreadyPersisted) {
      return {
        supported: true,
        persisted: true,
        quota: Number(estimate?.quota || 0),
        usage: Number(estimate?.usage || 0)
      };
    }

    const persisted = await navigator.storage.persist();
    return {
      supported: true,
      persisted: Boolean(persisted),
      quota: Number(estimate?.quota || 0),
      usage: Number(estimate?.usage || 0)
    };
  } catch {
    return {
      supported: true,
      persisted: false,
      quota: 0,
      usage: 0
    };
  }
}
