import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("fetchPaperBibtex", () => {
  it("prefers the canonical DOI BibTeX endpoint and normalizes the cite key", async () => {
    const { fetchPaperBibtex } = await import("./citation");

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      if (
        url === "https://data.crosscite.org/application/x-bibtex/10.48550/arXiv.1706.03762"
      ) {
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          text: async () =>
            `@misc{https://doi.org/10.48550/arxiv.1706.03762,
  doi = {10.48550/ARXIV.1706.03762},
  url = {https://arxiv.org/abs/1706.03762},
  author = {Vaswani, Ashish and Shazeer, Noam},
  keywords = {Computation and Language (cs.CL)},
  title = {Attention Is All You Need},
  publisher = {arXiv},
  year = {2017},
  copyright = {arXiv.org perpetual, non-exclusive license}
}`
        };
      }

      throw new Error(`Unexpected URL: ${url}`);
    });

    await expect(fetchPaperBibtex("1706.03762v7")).resolves.toBe(`@misc{arxiv:1706.03762,
  author = {Vaswani, Ashish and Shazeer, Noam},
  title = {Attention Is All You Need},
  year = {2017},
  doi = {10.48550/ARXIV.1706.03762},
  url = {https://arxiv.org/abs/1706.03762},
  publisher = {arXiv}
}
`);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("falls back to arXiv API metadata when the DOI BibTeX endpoint is unavailable", async () => {
    const { fetchPaperBibtex } = await import("./citation");

    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      if (
        url === "https://data.crosscite.org/application/x-bibtex/10.48550/arXiv.hep-th/9901001"
      ) {
        throw new Error("network blocked");
      }

      if (url === "https://export.arxiv.org/api/query?id_list=hep-th%2F9901001") {
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          text: async () => `<?xml version='1.0' encoding='UTF-8'?>
<feed xmlns:arxiv="http://arxiv.org/schemas/atom" xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>http://arxiv.org/abs/hep-th/9901001v3</id>
    <title>String Junctions and Their Duals in Heterotic String Theory</title>
    <published>1999-01-01T01:01:10Z</published>
    <author>
      <name>Yosuke Imamura</name>
    </author>
    <arxiv:primary_category term="hep-th"/>
    <arxiv:journal_ref>Prog.Theor.Phys.101:1155-1164,1999</arxiv:journal_ref>
    <arxiv:doi>10.1143/PTP.101.1155</arxiv:doi>
  </entry>
</feed>`
        };
      }

      throw new Error(`Unexpected URL: ${url}`);
    });

    await expect(fetchPaperBibtex("hep-th/9901001v3")).resolves.toBe(`@misc{arxiv:hep-th-9901001,
  author = {Yosuke Imamura},
  title = {String Junctions and Their Duals in Heterotic String Theory},
  year = {1999},
  eprint = {hep-th/9901001},
  archivePrefix = {arXiv},
  primaryClass = {hep-th},
  doi = {10.1143/PTP.101.1155},
  url = {https://arxiv.org/abs/hep-th/9901001},
  note = {Published in Prog.Theor.Phys.101:1155-1164,1999}
}
`);
  });
});
