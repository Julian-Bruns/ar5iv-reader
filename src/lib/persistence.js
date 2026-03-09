export async function ensurePersistentStorage() {
  if (typeof navigator === "undefined" || !navigator.storage?.persist) {
    return {
      supported: false,
      persisted: false
    };
  }

  try {
    const alreadyPersisted = navigator.storage.persisted
      ? await navigator.storage.persisted()
      : false;

    if (alreadyPersisted) {
      return {
        supported: true,
        persisted: true
      };
    }

    const persisted = await navigator.storage.persist();
    return {
      supported: true,
      persisted: Boolean(persisted)
    };
  } catch {
    return {
      supported: true,
      persisted: false
    };
  }
}
