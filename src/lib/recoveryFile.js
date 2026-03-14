import { buildBackupFilename } from "./exportImport";

export function isBackupFileSupported() {
  return typeof window !== "undefined" && typeof window.showSaveFilePicker === "function";
}

export async function createBackupFileHandle() {
  if (!isBackupFileSupported()) {
    throw new Error("Backup file updates are not supported in this browser.");
  }

  return window.showSaveFilePicker({
    suggestedName: buildBackupFilename(),
    excludeAcceptAllOption: false,
    types: [
      {
        description: "JSON files",
        accept: {
          "application/json": [".json"]
        }
      }
    ]
  });
}

export async function writeBackupFile(handle, payload) {
  if (!handle?.createWritable) {
    throw new Error("Backup file handle is unavailable.");
  }

  const writable = await handle.createWritable();
  await writable.write(`${JSON.stringify(payload, null, 2)}\n`);
  await writable.close();

  return {
    lastWrittenAt: new Date().toISOString(),
    filename: String(handle.name || buildBackupFilename()).trim()
  };
}

export async function readBackupFile(handle) {
  if (!handle?.getFile) {
    throw new Error("Backup file handle is unavailable.");
  }

  return handle.getFile();
}

export async function readBackupText(handle) {
  const file = await readBackupFile(handle);
  return file.text();
}

export async function getBackupFilePermission(handle) {
  if (!handle?.queryPermission) {
    return handle?.createWritable ? "granted" : "unknown";
  }

  try {
    const permission = await handle.queryPermission({
      mode: "readwrite"
    });
    return normalizePermission(permission);
  } catch {
    return "unknown";
  }
}

function normalizePermission(value) {
  return ["granted", "prompt", "denied"].includes(value) ? value : "unknown";
}
