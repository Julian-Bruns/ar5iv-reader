import { describe, expect, it } from "vitest";
import { buildArxivPdfUrl } from "./arxiv";

describe("buildArxivPdfUrl", () => {
  it("opens PDFs with a fit-to-width default zoom", () => {
    expect(buildArxivPdfUrl("2603.04211")).toBe(
      "https://arxiv.org/pdf/2603.04211#zoom=page-width"
    );
  });
});
