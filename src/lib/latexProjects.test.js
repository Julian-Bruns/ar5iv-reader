import { describe, expect, it } from "vitest";
import {
  createLatexProjectDraft,
  exportLatexProjectPdfBuild,
  renderLatexDocument
} from "./latexProjects";

describe("latexProjects", () => {
  it("creates a blank project with a renderable document", () => {
    const project = createLatexProjectDraft({ title: "Spectral Sequences" });
    const rendered = renderLatexDocument(project.source, { projectTitle: project.title });

    expect(project.id).toMatch(/^tex-/);
    expect(project.title).toBe("Spectral Sequences");
    expect(project.source).toContain("\\title{Spectral Sequences}");
    expect(project.source).toContain("\\begin{document}");
    expect(project.source).not.toContain("State the problem");
    expect(project.source).not.toContain("Main Result");
    expect(project.source).not.toContain("\\bibitem{sample}");
    expect(rendered.diagnostics).toEqual([]);
    expect(rendered.outline).toEqual([]);
  });

  it("renders sections, theorem environments, lists, citations, and KaTeX math", () => {
    const rendered = renderLatexDocument(String.raw`\title{A Note}
\begin{document}
\maketitle
\section{Main}
Let $x^2 + y^2 = z^2$ and cite \cite{pythagoras}.
\begin{theorem}
\[
  \frac{1}{2}
\]
\end{theorem}
\begin{itemize}
\item First
\item Second
\end{itemize}
\end{document}`);

    expect(rendered.title).toBe("A Note");
    expect(rendered.outline).toEqual([
      expect.objectContaining({
        title: "Main",
        level: 2
      })
    ]);
    expect(rendered.html).toContain("latex-env--theorem");
    expect(rendered.html).toContain("latex-citation");
    expect(rendered.html).toContain("katex");
    expect(rendered.html).toContain("<ul");
    expect(rendered.diagnostics).toEqual([]);
  });

  it("exports a PDF build kit with source and compile targets", async () => {
    const project = createLatexProjectDraft({ title: "Spectral Sequences" });
    const { blob, filename } = exportLatexProjectPdfBuild(project);
    const contents = new TextDecoder().decode(await blob.arrayBuffer());

    expect(filename).toBe("spectral-sequences-pdf-build.zip");
    expect(blob.type).toBe("application/zip");
    expect(contents).toContain("main.tex");
    expect(contents).toContain("Makefile");
    expect(contents).toContain("latexmkrc");
    expect(contents).toContain("README.md");
    expect(contents).toContain("\\title{Spectral Sequences}");
    expect(contents).toContain("latexmk -pdf -interaction=nonstopmode -halt-on-error $(TEX)");
    expect(contents).toContain("Use `make pdf` as the CI build step");
  });
});
