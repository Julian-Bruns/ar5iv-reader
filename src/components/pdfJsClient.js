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
  const pdfModuleSpecifier = "pdfjs-dist/build/pdf.mjs";
  const workerSpecifier = "pdfjs-dist/build/pdf.worker.min.mjs?url";
  const pdfModule = await import(/* @vite-ignore */ pdfModuleSpecifier);
  const workerModule = await import(/* @vite-ignore */ workerSpecifier).catch(() => null);
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
