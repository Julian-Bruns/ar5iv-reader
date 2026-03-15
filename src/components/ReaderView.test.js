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
});
