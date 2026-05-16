import katex from "katex";

export const LATEX_TEMPLATE_SOURCE = String.raw`\documentclass{article}
\usepackage{amsmath, amssymb, amsthm}

\title{Untitled Research Note}
\author{}
\date{\today}

\newtheorem{theorem}{Theorem}
\newtheorem{lemma}{Lemma}
\newtheorem{definition}{Definition}

\begin{document}
\maketitle

\begin{abstract}
State the problem, the main contribution, and the proof idea.
\end{abstract}

\section{Introduction}
Write the motivation and related context here. Inline math such as $f \colon X \to Y$ renders in the preview.

\section{Main Result}
\begin{theorem}
Let $G$ be a finite group. If $H \leq G$, then
\[
  |G| = [G:H]|H|.
\]
\end{theorem}

\begin{proof}
The left cosets of $H$ partition $G$, and each coset has cardinality $|H|$.
\end{proof}

\section{Next Steps}
\begin{itemize}
  \item Add definitions and assumptions.
  \item Track citations with \cite{sample}.
  \item Export the source when you are ready to compile elsewhere.
\end{itemize}

\begin{thebibliography}{9}
\bibitem{sample}
Author. Title. Journal, year.
\end{thebibliography}

\end{document}
`;

const SECTION_COMMANDS = new Map([
  ["part", { tagName: "h1", level: 1, label: "Part" }],
  ["chapter", { tagName: "h1", level: 1, label: "Chapter" }],
  ["section", { tagName: "h2", level: 2, label: "Section" }],
  ["subsection", { tagName: "h3", level: 3, label: "Subsection" }],
  ["subsubsection", { tagName: "h4", level: 4, label: "Subsubsection" }]
]);

const THEOREM_ENVIRONMENTS = new Map([
  ["theorem", "Theorem"],
  ["lemma", "Lemma"],
  ["proposition", "Proposition"],
  ["corollary", "Corollary"],
  ["definition", "Definition"],
  ["example", "Example"],
  ["remark", "Remark"],
  ["claim", "Claim"],
  ["conjecture", "Conjecture"],
  ["problem", "Problem"]
]);

const DISPLAY_MATH_ENVIRONMENTS = new Set([
  "align",
  "align*",
  "aligned",
  "equation",
  "equation*",
  "gather",
  "gather*",
  "multline",
  "multline*"
]);

const TEXT_STYLE_COMMANDS = new Map([
  ["emph", "em"],
  ["textit", "em"],
  ["textbf", "strong"],
  ["underline", "u"],
  ["texttt", "code"]
]);

const DIAGNOSTIC_LEVELS = new Set(["info", "warning", "error"]);

export function createLatexProjectDraft({ title = "", source = "" } = {}) {
  const normalizedTitle = String(title || "").trim() || "Untitled Research Note";
  const now = new Date().toISOString();

  return {
    id: buildLatexProjectId(),
    title: normalizedTitle,
    source: source || LATEX_TEMPLATE_SOURCE.replace(
      /\\title\{Untitled Research Note\}/,
      `\\title{${escapeLatexText(normalizedTitle)}}`
    ),
    createdAt: now,
    updatedAt: now,
    revisionMs: Date.now(),
    revisionDeviceId: "local",
    deletedAtMs: 0,
    deletedAt: ""
  };
}

export function renderLatexDocument(source, { projectTitle = "" } = {}) {
  const diagnostics = [];
  const outline = [];
  const strippedSource = stripLatexComments(String(source || ""));
  const metadata = extractLatexMetadata(strippedSource);
  const bodyInfo = extractDocumentBody(strippedSource);
  const body = removePreambleCommands(bodyInfo.body);
  const context = {
    diagnostics,
    outline,
    sectionIndex: 0
  };
  const title = metadata.title || String(projectTitle || "").trim();
  const titleHtml = title
    ? `<h1>${renderInline(title, context)}</h1>`
    : "<h1>Untitled LaTeX Project</h1>";
  const authorHtml = metadata.author ? `<p>${renderInline(metadata.author, context)}</p>` : "";
  const dateHtml = metadata.date ? `<p>${renderInline(metadata.date, context)}</p>` : "";
  const bodyHtml = renderBlocks(body, context);

  if (!bodyInfo.hasDocumentEnvironment) {
    addDiagnostic(diagnostics, {
      level: "warning",
      message: "No document environment found. Rendering the whole source as body content."
    });
  }

  return {
    title: title || "Untitled LaTeX Project",
    html: [
      '<article class="latex-preview-document">',
      '<header class="latex-preview-title">',
      titleHtml,
      authorHtml || dateHtml ? `<div class="latex-preview-byline">${authorHtml}${dateHtml}</div>` : "",
      "</header>",
      bodyHtml || '<p class="latex-preview-empty">Start writing to render the preview.</p>',
      "</article>"
    ].join(""),
    diagnostics: diagnostics.map(normalizeDiagnostic),
    outline
  };
}

export function exportLatexProjectSource(project) {
  const title = String(project?.title || "latex-project").trim() || "latex-project";
  const filename = `${slugifyFilename(title)}.tex`;
  return {
    filename,
    blob: new Blob([String(project?.source || "")], {
      type: "application/x-tex;charset=utf-8"
    })
  };
}

export function exportLatexProjectHtml(project, rendered) {
  const title = String(project?.title || rendered?.title || "latex-project").trim() || "latex-project";
  const filename = `${slugifyFilename(title)}.html`;
  const body = String(rendered?.html || renderLatexDocument(project?.source || "", { projectTitle: title }).html);
  const html = [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8" />',
    '<meta name="viewport" content="width=device-width, initial-scale=1" />',
    `<title>${escapeHtml(title)}</title>`,
    '<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.46/dist/katex.min.css" />',
    "<style>",
    "body{margin:0;background:#f5f6f8;color:#171717;font-family:Inter,system-ui,sans-serif;line-height:1.6}",
    ".latex-preview-document{max-width:820px;margin:0 auto;padding:48px 28px;background:#fff;min-height:100vh}",
    ".latex-preview-title{text-align:center;margin-bottom:2rem}.latex-preview-title h1{margin:0;font-size:2rem}",
    ".latex-display-math{overflow-x:auto;margin:1.2rem 0}.latex-env{border-left:3px solid #2563eb;padding:.8rem 1rem;margin:1rem 0;background:#f8fafc}.latex-env-label{margin:0 0 .35rem;font-weight:700}",
    "</style>",
    "</head>",
    "<body>",
    body,
    "</body>",
    "</html>"
  ].join("");

  return {
    filename,
    blob: new Blob([html], {
      type: "text/html;charset=utf-8"
    })
  };
}

function renderBlocks(input, context) {
  const text = String(input || "");
  let cursor = 0;
  let html = "";

  while (cursor < text.length) {
    const nextBlock = findNextBlock(text, cursor);
    if (!nextBlock) {
      html += renderTextBlocks(text.slice(cursor), context);
      break;
    }

    html += renderTextBlocks(text.slice(cursor, nextBlock.index), context);
    const rendered = renderBlockAt(text, nextBlock, context);
    html += rendered.html;
    cursor = rendered.endIndex;
  }

  return html;
}

function findNextBlock(text, startIndex) {
  const candidates = [];
  const sectionMatch = findRegex(text, /\\(part|chapter|section|subsection|subsubsection)\*?\s*\{/g, startIndex);
  if (sectionMatch) {
    candidates.push({
      type: "section",
      index: sectionMatch.index,
      command: sectionMatch.match[1],
      argumentStart: sectionMatch.index + sectionMatch.match[0].lastIndexOf("{")
    });
  }

  const environmentMatch = findRegex(text, /\\begin\{([A-Za-z*]+)\}/g, startIndex);
  if (environmentMatch) {
    candidates.push({
      type: "environment",
      index: environmentMatch.index,
      environmentName: environmentMatch.match[1],
      contentStart: environmentMatch.index + environmentMatch.match[0].length
    });
  }

  const bracketMathIndex = text.indexOf("\\[", startIndex);
  if (bracketMathIndex >= 0) {
    candidates.push({
      type: "displayMath",
      delimiter: "\\[",
      index: bracketMathIndex,
      contentStart: bracketMathIndex + 2
    });
  }

  const dollarMathIndex = findUnescaped(text, "$$", startIndex);
  if (dollarMathIndex >= 0) {
    candidates.push({
      type: "displayMath",
      delimiter: "$$",
      index: dollarMathIndex,
      contentStart: dollarMathIndex + 2
    });
  }

  return candidates.sort((left, right) => left.index - right.index)[0] || null;
}

function renderBlockAt(text, block, context) {
  if (block.type === "section") {
    const argument = readLatexArgument(text, block.argumentStart);
    if (!argument) {
      addDiagnostic(context.diagnostics, {
        level: "error",
        message: `Could not parse \\${block.command} title.`
      });
      return {
        html: renderTextBlocks(text.slice(block.index, block.index + block.command.length + 1), context),
        endIndex: block.index + block.command.length + 1
      };
    }

    const section = SECTION_COMMANDS.get(block.command) || SECTION_COMMANDS.get("section");
    const title = argument.value.trim();
    context.sectionIndex += 1;
    const id = `latex-section-${context.sectionIndex}-${slugifyText(latexToPlainText(title))}`;
    context.outline.push({
      id,
      level: section.level,
      title: latexToPlainText(title) || section.label
    });

    return {
      html: `<${section.tagName} id="${id}" class="latex-section-heading">${renderInline(title, context)}</${section.tagName}>`,
      endIndex: argument.endIndex
    };
  }

  if (block.type === "displayMath") {
    const closeDelimiter = block.delimiter === "\\[" ? "\\]" : "$$";
    const end = findUnescaped(text, closeDelimiter, block.contentStart);
    if (end < 0) {
      addDiagnostic(context.diagnostics, {
        level: "error",
        message: `Display math starting at character ${block.index + 1} is missing ${closeDelimiter}.`
      });
      return {
        html: renderMathBlock(text.slice(block.contentStart), context),
        endIndex: text.length
      };
    }

    return {
      html: renderMathBlock(text.slice(block.contentStart, end), context),
      endIndex: end + closeDelimiter.length
    };
  }

  const environment = readEnvironment(text, block.environmentName, block.contentStart);
  if (!environment.closed) {
    addDiagnostic(context.diagnostics, {
      level: "error",
      message: `Environment ${block.environmentName} is missing \\end{${block.environmentName}}.`
    });
  }

  return {
    html: renderEnvironment(block.environmentName, environment.content, context),
    endIndex: environment.endIndex
  };
}

function renderEnvironment(environmentName, content, context) {
  if (environmentName === "document") {
    return renderBlocks(content, context);
  }

  if (environmentName === "abstract") {
    return `<section class="latex-abstract"><h2>Abstract</h2>${renderBlocks(content, context)}</section>`;
  }

  if (DISPLAY_MATH_ENVIRONMENTS.has(environmentName)) {
    return renderMathBlock(content, context, { environmentName });
  }

  if (environmentName === "itemize" || environmentName === "enumerate") {
    return renderListEnvironment(content, context, {
      ordered: environmentName === "enumerate"
    });
  }

  if (environmentName === "proof") {
    return renderCalloutEnvironment("Proof", content, context, "proof");
  }

  if (THEOREM_ENVIRONMENTS.has(environmentName)) {
    return renderCalloutEnvironment(
      THEOREM_ENVIRONMENTS.get(environmentName),
      content,
      context,
      "theorem"
    );
  }

  if (environmentName === "thebibliography") {
    return renderBibliography(content, context);
  }

  if (environmentName === "center") {
    return `<div class="latex-center">${renderBlocks(content, context)}</div>`;
  }

  if (environmentName === "figure" || environmentName === "table") {
    return renderCalloutEnvironment(
      environmentName === "figure" ? "Figure" : "Table",
      content,
      context,
      environmentName
    );
  }

  addDiagnostic(context.diagnostics, {
    level: "warning",
    message: `Rendered unsupported environment ${environmentName} as structured text.`
  });
  return renderCalloutEnvironment(environmentName, content, context, "generic");
}

function renderCalloutEnvironment(label, content, context, kind) {
  return [
    `<section class="latex-env latex-env--${escapeAttribute(kind)}">`,
    `<p class="latex-env-label">${escapeHtml(label)}</p>`,
    '<div class="latex-env-body">',
    renderBlocks(content, context),
    "</div>",
    "</section>"
  ].join("");
}

function renderListEnvironment(content, context, { ordered }) {
  const items = splitLatexItems(content);
  if (!items.length) {
    return "";
  }

  const tagName = ordered ? "ol" : "ul";
  return `<${tagName} class="latex-list">${items
    .map((item) => `<li>${renderBlocks(item, context)}</li>`)
    .join("")}</${tagName}>`;
}

function renderBibliography(content, context) {
  const entries = [];
  const regex = /\\bibitem(?:\[[^\]]*\])?\{([^}]*)\}/g;
  let cursor = 0;
  let match = regex.exec(content);

  while (match) {
    if (entries.length) {
      entries[entries.length - 1].body = content.slice(cursor, match.index);
    }
    entries.push({
      key: match[1],
      body: ""
    });
    cursor = regex.lastIndex;
    match = regex.exec(content);
  }

  if (entries.length) {
    entries[entries.length - 1].body = content.slice(cursor);
  }

  if (!entries.length) {
    return renderCalloutEnvironment("References", content, context, "bibliography");
  }

  return [
    '<section class="latex-bibliography">',
    "<h2>References</h2>",
    "<ol>",
    entries
      .map(
        (entry) =>
          `<li id="bib-${escapeAttribute(entry.key)}">${renderInline(entry.body.replace(/\s+/g, " ").trim(), context)}</li>`
      )
      .join(""),
    "</ol>",
    "</section>"
  ].join("");
}

function renderTextBlocks(input, context) {
  return String(input || "")
    .split(/\n\s*\n/g)
    .map((block) => cleanTextBlock(block))
    .filter(Boolean)
    .map((block) => `<p>${renderInline(block.replace(/\s*\n\s*/g, " "), context)}</p>`)
    .join("");
}

function renderInline(input, context) {
  const text = String(input || "");
  let cursor = 0;
  let html = "";

  while (cursor < text.length) {
    const nextParenMath = text.indexOf("\\(", cursor);
    const nextDollarMath = findNextInlineDollar(text, cursor);
    const mathStart = chooseNearestIndex(nextParenMath, nextDollarMath);

    if (mathStart < 0) {
      html += renderTextInline(text.slice(cursor), context);
      break;
    }

    html += renderTextInline(text.slice(cursor, mathStart), context);

    if (mathStart === nextParenMath) {
      const end = text.indexOf("\\)", mathStart + 2);
      if (end < 0) {
        addDiagnostic(context.diagnostics, {
          level: "error",
          message: "Inline math is missing \\)."
        });
        html += renderTextInline(text.slice(mathStart), context);
        break;
      }

      html += renderMath(text.slice(mathStart + 2, end), false, context);
      cursor = end + 2;
      continue;
    }

    const end = findUnescaped(text, "$", mathStart + 1);
    if (end < 0) {
      addDiagnostic(context.diagnostics, {
        level: "error",
        message: "Inline math is missing a closing dollar delimiter."
      });
      html += renderTextInline(text.slice(mathStart), context);
      break;
    }

    html += renderMath(text.slice(mathStart + 1, end), false, context);
    cursor = end + 1;
  }

  return html;
}

function renderTextInline(input, context) {
  const text = String(input || "");
  let index = 0;
  let html = "";

  while (index < text.length) {
    const character = text[index];

    if (character !== "\\") {
      html += escapeInlineCharacter(character);
      index += 1;
      continue;
    }

    if (text[index + 1] === "\\") {
      html += "<br />";
      index += 2;
      continue;
    }

    const command = readCommandName(text, index + 1);
    if (!command.name) {
      html += escapeHtml(character);
      index += 1;
      continue;
    }

    const handled = renderTextCommand(text, command, context);
    if (handled) {
      html += handled.html;
      index = handled.endIndex;
      continue;
    }

    if (command.name.length === 1 && "%$#&_{}".includes(command.name)) {
      html += escapeHtml(command.name);
      index = command.endIndex;
      continue;
    }

    html += escapeHtml(`\\${command.name}`);
    index = command.endIndex;
  }

  return html.replace(/---/g, "&mdash;").replace(/--/g, "&ndash;");
}

function renderTextCommand(text, command, context) {
  if (TEXT_STYLE_COMMANDS.has(command.name)) {
    const argument = readLatexArgument(text, command.endIndex);
    if (!argument) {
      return null;
    }
    const tagName = TEXT_STYLE_COMMANDS.get(command.name);
    return {
      html: `<${tagName}>${renderInline(argument.value, context)}</${tagName}>`,
      endIndex: argument.endIndex
    };
  }

  if (command.name === "href") {
    const href = readLatexArgument(text, command.endIndex);
    const label = href ? readLatexArgument(text, href.endIndex) : null;
    if (!href || !label) {
      return null;
    }
    return {
      html: `<a href="${escapeAttribute(href.value)}" target="_blank" rel="noreferrer">${renderInline(label.value, context)}</a>`,
      endIndex: label.endIndex
    };
  }

  if (command.name === "url") {
    const argument = readLatexArgument(text, command.endIndex);
    if (!argument) {
      return null;
    }
    return {
      html: `<a href="${escapeAttribute(argument.value)}" target="_blank" rel="noreferrer">${escapeHtml(argument.value)}</a>`,
      endIndex: argument.endIndex
    };
  }

  if (["cite", "citet", "citep"].includes(command.name)) {
    const argument = readLatexArgument(text, command.endIndex);
    if (!argument) {
      return null;
    }
    return {
      html: `<span class="latex-citation">[${escapeHtml(argument.value)}]</span>`,
      endIndex: argument.endIndex
    };
  }

  if (command.name === "ref" || command.name === "eqref") {
    const argument = readLatexArgument(text, command.endIndex);
    if (!argument) {
      return null;
    }
    const label = escapeHtml(argument.value);
    return {
      html: command.name === "eqref" ? `(${label})` : label,
      endIndex: argument.endIndex
    };
  }

  if (command.name === "label") {
    const argument = readLatexArgument(text, command.endIndex);
    return {
      html: "",
      endIndex: argument?.endIndex || command.endIndex
    };
  }

  if (command.name === "LaTeX") {
    return {
      html: "LaTeX",
      endIndex: command.endIndex
    };
  }

  if (command.name === "TeX") {
    return {
      html: "TeX",
      endIndex: command.endIndex
    };
  }

  if (command.name === "today") {
    return {
      html: new Date().toLocaleDateString(),
      endIndex: command.endIndex
    };
  }

  if (["maketitle", "noindent", "quad", "qquad"].includes(command.name)) {
    return {
      html: command.name === "quad" || command.name === "qquad" ? "&nbsp;&nbsp;" : "",
      endIndex: command.endIndex
    };
  }

  return null;
}

function renderMathBlock(input, context, { environmentName = "" } = {}) {
  let source = normalizeMathSource(input);
  if (
    environmentName &&
    ["align", "align*", "aligned", "gather", "gather*", "multline", "multline*"].includes(environmentName)
  ) {
    source = `\\begin{aligned}${source}\\end{aligned}`;
  }

  return `<div class="latex-display-math">${renderMath(source, true, context)}</div>`;
}

function renderMath(input, displayMode, context) {
  const source = normalizeMathSource(input);
  if (!source) {
    return "";
  }

  try {
    return katex.renderToString(source, {
      displayMode,
      throwOnError: false,
      strict: false,
      trust: false,
      output: "html"
    });
  } catch (error) {
    addDiagnostic(context.diagnostics, {
      level: "error",
      message: `KaTeX could not render ${displayMode ? "display" : "inline"} math: ${error.message || error}`
    });
    return `<code class="latex-math-error">${escapeHtml(source)}</code>`;
  }
}

function normalizeMathSource(input) {
  return String(input || "")
    .replace(/\\label\s*\{[^}]*\}/g, "")
    .replace(/^\s+|\s+$/g, "");
}

function extractLatexMetadata(source) {
  return {
    title: readCommandArgumentByName(source, "title"),
    author: readCommandArgumentByName(source, "author"),
    date: readCommandArgumentByName(source, "date")
  };
}

function extractDocumentBody(source) {
  const beginMatch = /\\begin\{document\}/.exec(source);
  const endMatch = /\\end\{document\}/.exec(source);
  if (!beginMatch || !endMatch || endMatch.index <= beginMatch.index) {
    return {
      body: source,
      hasDocumentEnvironment: false
    };
  }

  return {
    body: source.slice(beginMatch.index + beginMatch[0].length, endMatch.index),
    hasDocumentEnvironment: true
  };
}

function removePreambleCommands(input) {
  return String(input || "")
    .replace(/\\documentclass(?:\[[^\]]*\])?\{[^}]*\}/g, "")
    .replace(/\\usepackage(?:\[[^\]]*\])?\{[^}]*\}/g, "")
    .replace(/\\newtheorem\{[^}]*\}\{[^}]*\}/g, "")
    .replace(/\\bibliographystyle\{[^}]*\}/g, "")
    .replace(/\\bibliography\{[^}]*\}/g, "");
}

function cleanTextBlock(input) {
  return String(input || "")
    .replace(/\\maketitle/g, "")
    .replace(/\\title\s*\{(?:[^{}]|\{[^{}]*\})*\}/g, "")
    .replace(/\\author\s*\{(?:[^{}]|\{[^{}]*\})*\}/g, "")
    .replace(/\\date\s*\{(?:[^{}]|\{[^{}]*\})*\}/g, "")
    .replace(/\\label\s*\{[^}]*\}/g, "")
    .trim();
}

function stripLatexComments(input) {
  return String(input || "")
    .split("\n")
    .map((line) => {
      for (let index = 0; index < line.length; index += 1) {
        if (line[index] === "%" && !isEscaped(line, index)) {
          return line.slice(0, index);
        }
      }
      return line;
    })
    .join("\n");
}

function readCommandArgumentByName(source, commandName) {
  const regex = new RegExp(`\\\\${commandName}\\s*\\{`, "g");
  const match = regex.exec(source);
  if (!match) {
    return "";
  }

  return readLatexArgument(source, match.index + match[0].lastIndexOf("{"))?.value.trim() || "";
}

function readLatexArgument(text, braceIndex) {
  let startIndex = braceIndex;
  while (/\s/.test(text[startIndex] || "")) {
    startIndex += 1;
  }

  if (text[startIndex] !== "{") {
    return null;
  }

  let depth = 0;
  let value = "";
  for (let index = startIndex; index < text.length; index += 1) {
    const character = text[index];
    if (character === "{" && !isEscaped(text, index)) {
      depth += 1;
      if (depth > 1) {
        value += character;
      }
      continue;
    }

    if (character === "}" && !isEscaped(text, index)) {
      depth -= 1;
      if (depth === 0) {
        return {
          value,
          endIndex: index + 1
        };
      }
      value += character;
      continue;
    }

    value += character;
  }

  return null;
}

function readEnvironment(text, environmentName, contentStart) {
  const escapedName = escapeRegExp(environmentName);
  const regex = new RegExp(`\\\\(begin|end)\\{${escapedName}\\}`, "g");
  regex.lastIndex = contentStart;
  let depth = 1;
  let match = regex.exec(text);

  while (match) {
    if (match[1] === "begin") {
      depth += 1;
    } else {
      depth -= 1;
    }

    if (depth === 0) {
      return {
        content: text.slice(contentStart, match.index),
        endIndex: regex.lastIndex,
        closed: true
      };
    }

    match = regex.exec(text);
  }

  return {
    content: text.slice(contentStart),
    endIndex: text.length,
    closed: false
  };
}

function splitLatexItems(content) {
  const parts = String(content || "").split(/\\item(?:\[[^\]]*\])?/g);
  return parts
    .slice(1)
    .map((item) => item.trim())
    .filter(Boolean);
}

function readCommandName(text, index) {
  const letterMatch = /^[A-Za-z]+/.exec(text.slice(index));
  if (letterMatch) {
    return {
      name: letterMatch[0],
      endIndex: index + letterMatch[0].length
    };
  }

  return {
    name: text[index] || "",
    endIndex: index + 1
  };
}

function findRegex(text, regex, startIndex) {
  regex.lastIndex = startIndex;
  const match = regex.exec(text);
  return match
    ? {
        index: match.index,
        match
      }
    : null;
}

function findNextInlineDollar(text, startIndex) {
  let index = findUnescaped(text, "$", startIndex);
  while (index >= 0 && text[index + 1] === "$") {
    index = findUnescaped(text, "$", index + 2);
  }
  return index;
}

function findUnescaped(text, needle, startIndex) {
  let index = text.indexOf(needle, startIndex);
  while (index >= 0) {
    if (!isEscaped(text, index)) {
      return index;
    }
    index = text.indexOf(needle, index + needle.length);
  }
  return -1;
}

function chooseNearestIndex(left, right) {
  if (left < 0) {
    return right;
  }
  if (right < 0) {
    return left;
  }
  return Math.min(left, right);
}

function isEscaped(text, index) {
  let slashCount = 0;
  for (let cursor = index - 1; cursor >= 0 && text[cursor] === "\\"; cursor -= 1) {
    slashCount += 1;
  }
  return slashCount % 2 === 1;
}

function latexToPlainText(input) {
  return String(input || "")
    .replace(/\\(textbf|textit|emph|underline|texttt)\{([^{}]*)\}/g, "$2")
    .replace(/\\(cite|citet|citep|ref|eqref|label)\{([^{}]*)\}/g, "$2")
    .replace(/\\(LaTeX|TeX|today)\b/g, "$1")
    .replace(/[{}]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function addDiagnostic(diagnostics, diagnostic) {
  diagnostics.push(normalizeDiagnostic(diagnostic));
}

function normalizeDiagnostic(diagnostic) {
  const level = DIAGNOSTIC_LEVELS.has(diagnostic?.level) ? diagnostic.level : "info";
  return {
    level,
    message: String(diagnostic?.message || "").trim()
  };
}

function buildLatexProjectId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `tex-${crypto.randomUUID()}`;
  }

  return `tex-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function escapeLatexText(input) {
  return String(input || "").replace(/[\\{}%$#&_]/g, (character) => `\\${character}`);
}

function escapeInlineCharacter(character) {
  if (character === "~") {
    return "&nbsp;";
  }

  return escapeHtml(character);
}

function escapeHtml(input) {
  return String(input || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttribute(input) {
  return escapeHtml(input).replace(/`/g, "&#96;");
}

function escapeRegExp(input) {
  return String(input || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function slugifyText(input) {
  return (
    String(input || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "section"
  );
}

function slugifyFilename(input) {
  return (
    String(input || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 72) || "latex-project"
  );
}
