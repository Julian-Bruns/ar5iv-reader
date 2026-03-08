import { getSetting, setSetting } from "../db";

const DEVICE_IDENTITY_KEY = "deviceIdentity";

export async function getOrCreateDeviceIdentity() {
  const existing = (await getSetting(DEVICE_IDENTITY_KEY))?.value;
  if (existing?.deviceId) {
    return normalizeDeviceIdentity(existing);
  }

  const created = normalizeDeviceIdentity({
    deviceId: crypto.randomUUID(),
    label: buildDefaultDeviceLabel(),
    createdAt: new Date().toISOString()
  });
  await setSetting(DEVICE_IDENTITY_KEY, created);
  return created;
}

export async function updateDeviceIdentityLabel(label) {
  const identity = await getOrCreateDeviceIdentity();
  const nextIdentity = normalizeDeviceIdentity({
    ...identity,
    label
  });
  await setSetting(DEVICE_IDENTITY_KEY, nextIdentity);
  return nextIdentity;
}

function normalizeDeviceIdentity(value) {
  return {
    deviceId: String(value.deviceId || crypto.randomUUID()),
    label: String(value.label || buildDefaultDeviceLabel()).trim(),
    createdAt: String(value.createdAt || new Date().toISOString())
  };
}

function buildDefaultDeviceLabel() {
  const ua = navigator.userAgent || "";
  const platform =
    navigator.userAgentData?.platform ||
    navigator.platform ||
    "Device";

  if (/android/i.test(ua)) {
    return "Android phone";
  }

  if (/iphone|ipad|ipod/i.test(ua)) {
    return "iPhone";
  }

  if (/mac/i.test(platform)) {
    return "Mac";
  }

  if (/win/i.test(platform)) {
    return "Windows PC";
  }

  if (/linux/i.test(platform)) {
    return "Linux PC";
  }

  return "This device";
}
