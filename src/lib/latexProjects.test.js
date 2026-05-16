import { describe, expect, it } from "vitest";
import { createLatexProjectDraft, renderLatexDocument } from "./latexProjects";

describe("latexProjects", () => {
  it("creates a starter project with a renderable document", () => {
    const project = createLatexProjectDraft({ title: "Spectral Sequences" });

    expect(project.id).toMatch(/^tex-/);
    expect(project.title).toBe("Spectral Sequences");
    expect(project.source).toContain("\\title{Spectral Sequences}");
    expect(project.source).toContain("\\begin{document}");
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
});
