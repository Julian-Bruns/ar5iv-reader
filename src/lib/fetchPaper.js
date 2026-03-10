import {
  buildAr5ivUrl,
  buildArxivAbsUrl,
  buildArxivHtmlUrl,
  buildArxivPdfUrl
} from "./arxiv";
import { extractPaperMetadata, normalizePaperTitle } from "./sanitizePaper";

export const RELAYS = [
  "https://corsproxy.io/?",
  "https://api.allorigins.win/raw?url="
];
const FETCH_TIMEOUT_MS = 6500;
const TITLE_FETCH_TIMEOUT_MS = 3500;

export class RelayFetchError extends Error {
  constructor(targetUrl, attempts) {
    super(buildRelayErrorMessage(targetUrl, attempts));
    this.name = "RelayFetchError";
    this.targetUrl = targetUrl;
    this.attempts = attempts;
  }
}

export async function fetchPaperById(
  id,
  { sourceUrl = "", titleHint = "" } = {}
) {
  const normalizedTitleHint = normalizePaperTitle(titleHint, id);

  try {
    const { body, relay, targetUrl } = await fetchPaperHtmlById(id);

    return {
      id,
      sourceUrl: sourceUrl || buildArxivAbsUrl(id),
      ar5ivUrl: targetUrl,
      html: body,
      relay,
      titleHint: normalizedTitleHint,
      view: "html"
    };
  } catch (error) {
    return buildPdfFallbackPaper(id, {
      sourceUrl,
      titleHint: normalizedTitleHint,
      reason: stringifyError(error)
    });
  }
}

export async function fetchPaperTitleById(id, { fallbackTitle = "" } = {}) {
  const normalizedFallback = normalizePaperTitle(fallbackTitle, id);

  try {
    const { body } = await fetchTextThroughRelays(buildArxivAbsUrl(id), {
      timeoutMs: TITLE_FETCH_TIMEOUT_MS
    });
    const { title } = extractPaperMetadata(body, normalizedFallback || id);
    return normalizePaperTitle(title, normalizedFallback || id);
  } catch {
    return normalizedFallback || id;
  }
}

export function buildPdfFallbackPaper(
  id,
  { sourceUrl = "", titleHint = "", reason = "" } = {}
) {
  return {
    id,
    sourceUrl: sourceUrl || buildArxivAbsUrl(id),
    pdfUrl: buildArxivPdfUrl(id),
    titleHint,
    view: "pdf",
    notice: buildPdfFallbackNotice(reason)
  };
}

async function fetchPaperHtmlById(id) {
  const targetUrls = [buildArxivHtmlUrl(id), buildAr5ivUrl(id)];
  try {
    return await Promise.any(
      targetUrls.map(async (targetUrl) => {
        const result = await fetchTextThroughRelays(targetUrl, {
          timeoutMs: FETCH_TIMEOUT_MS
        });
        assertLooksLikePaperHtml(result.body, targetUrl);
        return {
          ...result,
          targetUrl
        };
      })
    );
  } catch (error) {
    const summary =
      error instanceof AggregateError
        ? error.errors.map((entry) => stringifyError(entry)).join(" | ")
        : stringifyError(error);
    throw new Error(`Unable to fetch rendered paper HTML for ${id}. ${summary}`);
  }
}

export async function fetchTextThroughRelays(targetUrl, { timeoutMs = FETCH_TIMEOUT_MS } = {}) {
  try {
    const response = await fetchWithTimeout(
      targetUrl,
      {
        headers: {
          accept: "text/html,application/xhtml+xml,*/*"
        }
      },
      timeoutMs
    );

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`.trim());
    }

    return {
      body: await response.text(),
      contentType: response.headers.get("content-type") || "",
      response,
      relay: "direct"
    };
  } catch {
    // Fall through to relay fetches when direct cross-origin fetches are blocked.
  }

  return fetchThroughRelays(targetUrl, async (requestUrl) => {
    const response = await fetchWithTimeout(
      requestUrl,
      {
        headers: {
          accept: "text/html,application/xhtml+xml,*/*"
        }
      },
      timeoutMs
    );

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`.trim());
    }

    return {
      body: await response.text(),
      contentType: response.headers.get("content-type") || "",
      response
    };
  });
}

function assertLooksLikePaperHtml(rawHtml, targetUrl) {
  const documentNode = new DOMParser().parseFromString(rawHtml, "text/html");
  const paperArticle =
    documentNode.querySelector("article.ltx_document") ||
    documentNode.querySelector("main article");

  if (paperArticle) {
    return;
  }

  const pageTitle = documentNode.title?.trim() || targetUrl;
  throw new Error(`Fetched HTML did not contain a rendered paper article (${pageTitle}).`);
}

function buildPdfFallbackNotice(reason) {
  return "Showing the PDF because this paper does not currently have a usable HTML view. Math copy is disabled in PDF fallback.";
}

export async function fetchBlobWithFallback(targetUrl) {
  const attempts = [];

  try {
    const directResponse = await fetch(targetUrl);
    if (!directResponse.ok) {
      throw new Error(
        `HTTP ${directResponse.status} ${directResponse.statusText}`.trim()
      );
    }

    const blob = await directResponse.blob();
    if (!blob.size) {
      throw new Error("Empty asset response");
    }

    return {
      blob,
      contentType: blob.type || directResponse.headers.get("content-type") || "",
      relay: "direct"
    };
  } catch (error) {
    attempts.push({ relay: "direct", message: stringifyError(error) });
  }

  try {
    const relayed = await fetchThroughRelays(targetUrl, async (requestUrl) => {
      const response = await fetch(requestUrl);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`.trim());
      }

      const blob = await response.blob();
      if (!blob.size) {
        throw new Error("Empty asset response");
      }

      const contentType = blob.type || response.headers.get("content-type") || "";
      if (contentType.startsWith("text/html")) {
        throw new Error("Relay returned HTML instead of a binary asset");
      }

      return { body: blob, contentType, response };
    });

    return {
      blob: relayed.body,
      contentType: relayed.contentType,
      relay: relayed.relay
    };
  } catch (error) {
    if (error instanceof RelayFetchError) {
      error.attempts.unshift(...attempts);
    }
    throw error;
  }
}

async function fetchThroughRelays(targetUrl, reader) {
  try {
    return await Promise.any(
      RELAYS.map(async (relay) => {
        const requestUrl = `${relay}${encodeURIComponent(targetUrl)}`;

        try {
          const result = await reader(requestUrl);
          return {
            ...result,
            relay
          };
        } catch (error) {
          throw { relay, message: stringifyError(error) };
        }
      })
    );
  } catch (error) {
    const attempts =
      error instanceof AggregateError
        ? error.errors.map((entry) => ({
            relay: String(entry?.relay || "unknown"),
            message: String(entry?.message || "Request failed")
          }))
        : [{ relay: "unknown", message: stringifyError(error) }];
    throw new RelayFetchError(targetUrl, attempts);
  }
}

function buildRelayErrorMessage(targetUrl, attempts) {
  const summary = attempts
    .map((attempt) => `${attempt.relay}: ${attempt.message}`)
    .join(" | ");
  return `Unable to fetch ${targetUrl}. ${summary || "No relay succeeded."}`;
}

function stringifyError(error) {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal
    });
  } finally {
    window.clearTimeout(timeoutId);
  }
}
