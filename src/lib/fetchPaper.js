import { buildAr5ivUrl, buildArxivAbsUrl } from "./arxiv";

export const RELAYS = [
  "https://corsproxy.io/?",
  "https://api.allorigins.win/raw?url="
];

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
  const ar5ivUrl = buildAr5ivUrl(id);
  const { body, relay } = await fetchTextThroughRelays(ar5ivUrl);

  return {
    id,
    sourceUrl: sourceUrl || buildArxivAbsUrl(id),
    ar5ivUrl,
    html: body,
    relay,
    titleHint
  };
}

export async function fetchTextThroughRelays(targetUrl) {
  return fetchThroughRelays(targetUrl, async (requestUrl) => {
    const response = await fetch(requestUrl, {
      headers: {
        accept: "text/html,application/xhtml+xml,*/*"
      }
    });

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
  const attempts = [];

  for (const relay of RELAYS) {
    const requestUrl = `${relay}${encodeURIComponent(targetUrl)}`;

    try {
      const result = await reader(requestUrl);
      return {
        ...result,
        relay
      };
    } catch (error) {
      attempts.push({ relay, message: stringifyError(error) });
    }
  }

  throw new RelayFetchError(targetUrl, attempts);
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
