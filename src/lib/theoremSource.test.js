import { describe, expect, it } from "vitest";
import {
  buildLatexProject,
  extractVersionedArxivIdFromHtml,
  formatTheoremCopyText,
  stripTexComments
} from "./theoremSource";

describe("theoremSource", () => {
  it("extracts the exact rendered arXiv version from paper HTML", () => {
    const html = '<base href="/html/2402.00012v5/"><title>Sample</title>';

    expect(extractVersionedArxivIdFromHtml(html, "2402.00012")).toBe("2402.00012v5");
  });

  it("extracts theorem and proof environments and expands custom macros", () => {
    const source = String.raw`
\documentclass{article}
\usepackage{amsthm}
\newtheorem{prop}{Proposition}
\newcommand{\R}{\mathbb{R}}
\newcommand{\norm}[1]{\lVert #1 \rVert}
\begin{document}
\begin{prop}
For every \(x \in \R\), we have \(\norm{x} \ge 0\).
\end{prop}
\begin{proof}
Use the usual norm on \(\R\).
\end{proof}
\end{document}
`;

    const project = buildLatexProject(source);

    expect(project.theoremEntries).toHaveLength(1);
    expect(project.theoremEntries[0]).toMatchObject({
      envName: "prop",
      headerCommands: ["\\usepackage{amsthm}", "\\newtheorem{prop}{Proposition}"]
    });
    expect(project.theoremEntries[0].theoremSource).toContain("\\begin{prop}");
    expect(project.theoremEntries[0].theoremSource).toContain("\\mathbb{R}");
    expect(project.theoremEntries[0].theoremSource).toContain("\\lVert x \\rVert");
    expect(project.theoremEntries[0].proofSource).toContain("\\begin{proof}");
  });

  it("formats copied output with preamble and BibTeX comments", () => {
    const output = formatTheoremCopyText({
      theoremEntry: {
        theoremSource: "\\begin{lemma}\nBody.\n\\end{lemma}",
        proofSource: "\\begin{proof}\nOriginal.\n\\end{proof}",
        headerCommands: ["\\usepackage{amsthm}", "\\newtheorem{lemma}{Lemma}"]
      },
      includeProof: false,
      versionedId: "2402.00012v5",
      bibtexEntry: "@misc{sample,\n  title={Sample}\n}"
    });

    expect(output).toContain("% \\usepackage{amsthm}");
    expect(output).toContain("% \\newtheorem{lemma}{Lemma}");
    expect(output).toContain("% @misc{sample,");
    expect(output).toContain("% Exact arXiv version used for this excerpt: https://arxiv.org/abs/2402.00012v5");
    expect(output).toContain("\\begin{lemma}");
    expect(output).toContain("See \\cite{sample} for the original proof.");
    expect(output).not.toContain("Original.");
  });

  it("removes real comments while preserving escaped percent signs", () => {
    const stripped = stripTexComments(String.raw`value \% ok % remove me`);

    expect(stripped).toBe(String.raw`value \% ok `);
  });
});
