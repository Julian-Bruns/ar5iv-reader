import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const readerViewPath = path.resolve(testDir, "./ReaderView.jsx");

describe("ReaderView Plan 4 integration", () => {
  it("replaces the PDF iframe with PdfReaderSurface", () => {
    const source = fs.readFileSync(readerViewPath, "utf8");

    expect(source).toMatch(/import PdfReaderSurface from "\.\/PdfReaderSurface";/);
    expect(source).toMatch(/paper\?\.view === "pdf"/);
    expect(source).toMatch(/<PdfReaderSurface/);
    expect(source).not.toMatch(/<iframe/);
  });

  it("keeps HTML math copy installation unchanged", () => {
    const source = fs.readFileSync(readerViewPath, "utf8");

    expect(source).toMatch(/import \{ installMathCopy \} from "\.\.\/lib\/mathCopy";/);
    expect(source).toMatch(/paper\?\.view !== "html"/);
    expect(source).toMatch(/installMathCopy\(articleRef\.current, \(message\) =>/);
  });

  it("forwards PDF math activation requests to the surface", () => {
    const source = fs.readFileSync(readerViewPath, "utf8");

    expect(source).toMatch(/onPdfMathActivationRequest/);
    expect(source).toMatch(/onEnsureMathReady=\{onPdfMathActivationRequest\}/);
  });

  it("surfaces a one-click BibTeX copy action in the reader toolbar", () => {
    const source = fs.readFileSync(readerViewPath, "utf8");

    expect(source).toMatch(/import \{ fetchPaperBibtex, primePaperBibtex \} from "\.\.\/lib\/citation";/);
    expect(source).toMatch(/void primePaperBibtex\(paper\.id\);/);
    expect(source).toMatch(/const bibtex = await fetchPaperBibtex\(paper\.id\);/);
    expect(source).toMatch(/showToastRef\.current\("Copied BibTeX\."\);/);
    expect(source).toMatch(/Copy BibTeX/);
  });
});
