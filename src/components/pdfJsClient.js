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
  const pdfjs = pdfModule?.default || pdfModule;

  if (typeof pdfjs?.getDocument !== "function") {
    throw new Error("pdf.js is unavailable.");
  }

  return pdfjs;
}
