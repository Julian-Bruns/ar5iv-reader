import { getSetting, setSetting } from "../db";

const PAIRED_DEVICES_KEY = "pairedDevices";

export async function listPairedDevices() {
  const stored = (await getSetting(PAIRED_DEVICES_KEY))?.value;
  return Array.isArray(stored) ? stored.map(normalizePairRecord).sort(comparePairs) : [];
}

export async function getPairedDevice(peerDeviceId) {
  const devices = await listPairedDevices();
  return devices.find((record) => record.peerDeviceId === peerDeviceId) || null;
}

export async function upsertPairedDevice(record) {
  const devices = await listPairedDevices();
  const normalized = normalizePairRecord(record);
  const nextDevices = devices.filter((entry) => entry.peerDeviceId !== normalized.peerDeviceId);
  nextDevices.push(normalized);
  await setSetting(PAIRED_DEVICES_KEY, nextDevices.sort(comparePairs));
  return normalized;
}

export async function renamePairedDevice(peerDeviceId, peerLabel) {
  const record = await getPairedDevice(peerDeviceId);
  if (!record) {
    throw new Error("Paired device not found.");
  }

  return upsertPairedDevice({
    ...record,
    peerLabel
  });
}

export async function forgetPairedDevice(peerDeviceId) {
  const devices = await listPairedDevices();
  await setSetting(
    PAIRED_DEVICES_KEY,
    devices.filter((entry) => entry.peerDeviceId !== peerDeviceId)
  );
}

export async function touchPairedDevice(peerDeviceId, updates = {}) {
  const record = await getPairedDevice(peerDeviceId);
  if (!record) {
    return null;
  }

  return upsertPairedDevice({
    ...record,
    ...updates
  });
}

export async function pairDevices(localDevice, remoteDevice, pairSecret) {
  return upsertPairedDevice({
    peerDeviceId: remoteDevice.deviceId,
    peerLabel: remoteDevice.label,
    pairId: await buildPairId(localDevice.deviceId, remoteDevice.deviceId),
    pairSecret,
    addedAt: new Date().toISOString(),
    lastSeenAt: Date.now(),
    lastSyncedAt: 0,
    lastSyncStatus: "paired"
  });
}

export function normalizePairRecord(value) {
  return {
    peerDeviceId: String(value.peerDeviceId || "").trim(),
    peerLabel: String(value.peerLabel || value.peerDeviceId || "Nearby device").trim(),
    pairId: String(value.pairId || "").trim(),
    pairSecret: String(value.pairSecret || "").trim(),
    addedAt: String(value.addedAt || new Date().toISOString()),
    lastSeenAt: Number(value.lastSeenAt || 0),
    lastSyncedAt: Number(value.lastSyncedAt || 0),
    lastSyncStatus: String(value.lastSyncStatus || "").trim()
  };
}

async function buildPairId(leftDeviceId, rightDeviceId) {
  const value = [leftDeviceId, rightDeviceId].sort().join("::");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function comparePairs(left, right) {
  const leftTime = Number(left.lastSyncedAt || left.lastSeenAt || 0);
  const rightTime = Number(right.lastSyncedAt || right.lastSeenAt || 0);
  if (leftTime !== rightTime) {
    return rightTime - leftTime;
  }

  return left.peerLabel.localeCompare(right.peerLabel);
}
