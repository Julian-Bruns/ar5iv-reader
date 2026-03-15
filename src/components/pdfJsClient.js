let pdfJsPromise = null;

export async function loadPdfJs() {
  if (!pdfJsPromise) {
    pdfJsPromise = importPdfJs().catch((error) => {
      pdfJsPromise = null;
      throw error;
    });
  }

  return pdfJsPromise;
}

async function importPdfJs() {
  const pdfModule = await import("pdfjs-dist/build/pdf.mjs");
  const workerModule = await import("pdfjs-dist/build/pdf.worker.min.mjs?url").catch(() => null);
  const pdfjs = pdfModule?.default || pdfModule;
  const workerSrc = workerModule?.default || workerModule;

  if (workerSrc && pdfjs?.GlobalWorkerOptions) {
    pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;
  }

  if (typeof pdfjs?.getDocument !== "function") {
    throw new Error("pdf.js is unavailable.");
  }

  return pdfjs;
}
