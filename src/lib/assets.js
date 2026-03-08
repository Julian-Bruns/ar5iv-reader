import { fetchBlobWithFallback } from "./fetchPaper";

export function collectAssetUrls(rawHtml, baseUrl) {
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
  const records = [];

  for (const assetUrl of assetUrls) {
    const { blob, contentType } = await fetchBlobWithFallback(assetUrl);
    records.push({
      key: `${paperId}::${assetUrl}`,
      paperId,
      assetUrl,
      blob,
      contentType
    });
  }

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
