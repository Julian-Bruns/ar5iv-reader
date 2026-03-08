import { fetchBlobWithFallback } from "./fetchPaper";

const ASSET_FETCH_TIMEOUT_MS = 8_000;
const ASSET_FETCH_CONCURRENCY = 4;

export function collectAssetUrls(rawHtml, baseUrl) {
  if (!rawHtml || (!rawHtml.includes("<img") && !rawHtml.includes("srcset="))) {
    return [];
  }

  const documentNode = new DOMParser().parseFromString(rawHtml, "text/html");
  const article =
    documentNode.querySelector("article.ltx_document") ||
    documentNode.querySelector("article") ||
    documentNode.body;

  if (!article) {
    return [];
  }

  const urls = new Set();

  for (const image of article.querySelectorAll("img")) {
    const src = toAbsoluteHttpUrl(image.getAttribute("src"), baseUrl);
    if (src) {
      urls.add(src);
    }

    for (const candidate of parseSrcset(image.getAttribute("srcset"), baseUrl)) {
      urls.add(candidate);
    }
  }

  return [...urls];
}

export async function fetchAssetRecords(paperId, assetUrls) {
  const queue = [...assetUrls];
  const records = [];

  async function worker() {
    while (queue.length) {
      const assetUrl = queue.shift();
      if (!assetUrl) {
        return;
      }

      try {
        const { blob, contentType } = await fetchWithTimeout(
          fetchBlobWithFallback(assetUrl),
          ASSET_FETCH_TIMEOUT_MS,
          assetUrl
        );
        records.push({
          key: `${paperId}::${assetUrl}`,
          paperId,
          assetUrl,
          blob,
          contentType
        });
      } catch (error) {
        console.warn("Skipping asset during offline save", assetUrl, error);
      }
    }
  }

  await Promise.all(
    Array.from(
      {
        length: Math.min(ASSET_FETCH_CONCURRENCY, Math.max(queue.length, 1))
      },
      () => worker()
    )
  );

  return records;
}

export function rewriteHtmlAssetUrls(rawHtml, assetRecords, baseUrl) {
  if (!assetRecords.length) {
    return {
      html: rawHtml,
      revoke: () => {}
    };
  }

  const objectUrls = [];
  const assetMap = new Map();
  for (const record of assetRecords) {
    const objectUrl = URL.createObjectURL(record.blob);
    objectUrls.push(objectUrl);
    assetMap.set(record.assetUrl, objectUrl);
  }

  const documentNode = new DOMParser().parseFromString(rawHtml, "text/html");

  for (const image of documentNode.querySelectorAll("img")) {
    const src = toAbsoluteHttpUrl(image.getAttribute("src"), baseUrl);
    if (src && assetMap.has(src)) {
      image.setAttribute("src", assetMap.get(src));
    }

    const rewrittenSrcset = rewriteSrcset(image.getAttribute("srcset"), baseUrl, assetMap);
    if (rewrittenSrcset) {
      image.setAttribute("srcset", rewrittenSrcset);
    } else {
      image.removeAttribute("srcset");
    }
  }

  return {
    html: documentNode.documentElement.outerHTML,
    revoke: () => {
      for (const objectUrl of objectUrls) {
        URL.revokeObjectURL(objectUrl);
      }
    }
  };
}

function rewriteSrcset(srcset, baseUrl, assetMap) {
  if (!srcset) {
    return "";
  }

  return srcset
    .split(",")
    .map((candidate) => candidate.trim())
    .filter(Boolean)
    .map((candidate) => {
      const [rawUrl, descriptor] = candidate.split(/\s+/, 2);
      const absolute = toAbsoluteHttpUrl(rawUrl, baseUrl);
      const replacement = absolute ? assetMap.get(absolute) : null;
      return replacement ? `${replacement}${descriptor ? ` ${descriptor}` : ""}` : "";
    })
    .filter(Boolean)
    .join(", ");
}

function parseSrcset(srcset, baseUrl) {
  if (!srcset) {
    return [];
  }

  return srcset
    .split(",")
    .map((candidate) => candidate.trim())
    .filter(Boolean)
    .map((candidate) => candidate.split(/\s+/, 2)[0])
    .map((candidate) => toAbsoluteHttpUrl(candidate, baseUrl))
    .filter(Boolean);
}

function toAbsoluteHttpUrl(value, baseUrl) {
  if (!value) {
    return null;
  }

  try {
    const resolved = new URL(value, baseUrl);
    if (!["http:", "https:"].includes(resolved.protocol)) {
      return null;
    }
    return resolved.toString();
  } catch {
    return null;
  }
}

function fetchWithTimeout(promise, timeoutMs, assetUrl) {
  return new Promise((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      reject(new Error(`Timed out while fetching ${assetUrl}`));
    }, timeoutMs);

    promise
      .then((result) => {
        window.clearTimeout(timeoutId);
        resolve(result);
      })
      .catch((error) => {
        window.clearTimeout(timeoutId);
        reject(error);
      });
  });
}
