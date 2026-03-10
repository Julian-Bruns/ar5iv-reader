import { buildUrlManifestFilename } from "./urlManifest";

export function isRecoveryFileSupported() {
  return typeof window !== "undefined" && typeof window.showSaveFilePicker === "function";
}

export async function createRecoveryFileHandle() {
  if (!isRecoveryFileSupported()) {
    throw new Error("Recovery files are not supported in this browser.");
  }

  return window.showSaveFilePicker({
    suggestedName: buildUrlManifestFilename(),
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

export async function writeRecoveryFile(handle, manifest) {
  if (!handle?.createWritable) {
    throw new Error("Recovery file handle is unavailable.");
  }

  const writable = await handle.createWritable();
  await writable.write(`${JSON.stringify(manifest, null, 2)}\n`);
  await writable.close();

  return {
    lastWrittenAt: new Date().toISOString(),
    filename: String(handle.name || buildUrlManifestFilename()).trim()
  };
}

export async function getRecoveryFilePermission(handle) {
  if (!handle?.queryPermission) {
    return "unknown";
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
