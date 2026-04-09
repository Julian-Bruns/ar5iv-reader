import {
  deletePdfRenderCacheRecord,
  getPdfRenderCacheRecord,
  listPdfRenderCacheRecords,
  putPdfRenderCacheRecord
} from "./db";

const PDF_RENDER_CACHE_MAX_BYTES = 256 * 1024 * 1024;

export function buildPdfRenderCacheKey(pdfFingerprint, pageNumber, quality = "low") {
  return `${String(pdfFingerprint || "").trim()}::${Number(pageNumber || 0)}::${String(quality || "").trim()}`;
}

export async function getCachedPdfRender({ pdfFingerprint, pageNumber, quality = "low" }) {
  const key = buildPdfRenderCacheKey(pdfFingerprint, pageNumber, quality);
  const record = await getPdfRenderCacheRecord(key);
  if (!record?.blob) {
    return null;
  }

  await putPdfRenderCacheRecord({
    ...record,
    updatedAt: new Date().toISOString()
  });
  return record;
}

export async function putCachedPdfRender({
  paperId,
  pdfFingerprint,
  pageNumber,
  quality = "low",
  width,
  height,
  blob
}) {
  if (!(blob instanceof Blob) || quality !== "low" || !pdfFingerprint) {
    return;
  }

  await putPdfRenderCacheRecord({
    key: buildPdfRenderCacheKey(pdfFingerprint, pageNumber, quality),
    paperId,
    pdfFingerprint,
    pageNumber,
    width,
    height,
    quality,
    blob,
    byteSize: blob.size,
    updatedAt: new Date().toISOString()
  });
  await prunePdfRenderCache();
}

export async function deleteCachedPdfRendersForFingerprint(pdfFingerprint) {
  const records = await listPdfRenderCacheRecords({
    pdfFingerprint
  });
  await Promise.all(records.map((record) => deletePdfRenderCacheRecord(record.key)));
}

async function prunePdfRenderCache() {
  const records = await listPdfRenderCacheRecords();
  const sortedRecords = records
    .map((record) => ({
      ...record,
      byteSize: Number(record.byteSize || record.blob?.size || 0),
      updatedAtMs: Date.parse(record.updatedAt || "") || 0
    }))
    .sort((left, right) => left.updatedAtMs - right.updatedAtMs);

  let totalBytes = sortedRecords.reduce((sum, record) => sum + record.byteSize, 0);
  for (const record of sortedRecords) {
    if (totalBytes <= PDF_RENDER_CACHE_MAX_BYTES) {
      break;
    }
    totalBytes -= record.byteSize;
    await deletePdfRenderCacheRecord(record.key);
  }
}
