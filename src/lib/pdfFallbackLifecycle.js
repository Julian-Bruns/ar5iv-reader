const PDF_MATH_MODEL_REVISION = "breezedeus-pix2text-v1";

export function isPdfFallbackPaper(paper) {
  return Boolean(paper && paper.view === "pdf" && paper.pdfState);
}

export function isPdfFallbackTab(tab) {
  return Boolean(tab?.key && isPdfFallbackPaper(tab.paper));
}

export function getPdfFallbackBlobUrl(tab) {
  return isPdfFallbackTab(tab) ? tab.paper.pdfState.blobUrl || "" : "";
}

export function getPdfMathStateFromServiceSnapshot(snapshot) {
  if (snapshot?.phase === "ready" && snapshot.enabled) {
    return {
      mathCopyStatus: "ready",
      mathCopyReason: ""
    };
  }

  if (snapshot?.phase === "disabled" || snapshot?.phase === "error") {
    return {
      mathCopyStatus: "disabled",
      mathCopyReason: snapshot?.reason || ""
    };
  }

  return {
    mathCopyStatus: "pending",
    mathCopyReason: ""
  };
}

export function createPrimedPdfFallbackPaper(paper, snapshot) {
  return {
    ...paper,
    pdfState: {
      ...paper.pdfState,
      documentUrl: String(paper?.pdfState?.documentUrl || paper?.pdfUrl || "").trim(),
      sourceMode: String(paper?.pdfState?.sourceMode || "remote-direct").trim(),
      loadStatus: "loading",
      ...getPdfMathStateFromServiceSnapshot(snapshot)
    }
  };
}

export function getSupersededPdfBlobUrls(currentTabs, nextTabs) {
  const nextTabsByKey = new Map(nextTabs.map((tab) => [tab.key, tab]));
  const superseded = new Set();

  for (const tab of currentTabs) {
    const currentBlobUrl = getPdfFallbackBlobUrl(tab);
    if (!currentBlobUrl) {
      continue;
    }

    const nextBlobUrl = getPdfFallbackBlobUrl(nextTabsByKey.get(tab.key));
    if (nextBlobUrl !== currentBlobUrl) {
      superseded.add(currentBlobUrl);
    }
  }

  return [...superseded];
}

export function reconcilePdfMathServiceTabs({
  tabs,
  acquiredTabKeys,
  service,
  onStatus
}) {
  const nextPdfTabKeys = new Set(
    tabs.filter((tab) => isPdfFallbackTab(tab)).map((tab) => tab.key)
  );

  for (const tabKey of [...acquiredTabKeys]) {
    if (nextPdfTabKeys.has(tabKey)) {
      continue;
    }

    acquiredTabKeys.delete(tabKey);
    service.release();
  }

  for (const tab of tabs) {
    if (!isPdfFallbackTab(tab) || acquiredTabKeys.has(tab.key)) {
      continue;
    }

    acquiredTabKeys.add(tab.key);
    onStatus(tab.key, service.status());

    void Promise.resolve(service.acquire())
      .then((snapshot) => {
        if (!acquiredTabKeys.has(tab.key)) {
          return;
        }

        onStatus(tab.key, snapshot);
      })
      .catch(() => {
        if (!acquiredTabKeys.has(tab.key)) {
          return;
        }

        onStatus(tab.key, {
          phase: "error",
          enabled: false,
          reason: "worker_error",
          benchmarkMs: null,
          modelRevision: PDF_MATH_MODEL_REVISION,
          refCount: service.status()?.refCount ?? 0
        });
      });
  }
}
