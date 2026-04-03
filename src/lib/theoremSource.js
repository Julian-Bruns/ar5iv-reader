import {
  buildArxivAbsUrl,
  buildArxivBibtexUrl,
  buildArxivSourceUrl,
  normalizeArxivId
} from "./arxiv";
import { fetchBlobWithFallback, fetchTextThroughRelays } from "./fetchPaper";

const SOURCE_PROJECT_CACHE = new Map();
const BIBTEX_CACHE = new Map();
const KNOWN_THEOREM_ENVIRONMENTS = new Set([
  "algorithm",
  "assumption",
  "axiom",
  "claim",
  "conjecture",
  "construction",
  "corollary",
  "definition",
  "example",
  "exercise",
  "fact",
  "hypothesis",
  "lemma",
  "notation",
  "observation",
  "problem",
  "proposition",
  "question",
  "remark",
  "theorem"
]);

export async function buildCopyableTheoremText(paper, theoremIndex, { includeProof = false } = {}) {
  const versionedId = extractVersionedArxivIdFromHtml(paper?.html, paper?.id) || paper?.id;
  const [project, bibtexEntry] = await Promise.all([
    loadSourceProject(versionedId),
    loadBibtexEntry(versionedId, paper?.title || versionedId)
  ]);
  const theoremEntry = project.theoremEntries[theoremIndex];

  if (!theoremEntry) {
    throw new Error("The source theorem could not be matched to this rendered block.");
  }

  return formatTheoremCopyText({
    theoremEntry,
    includeProof,
    bibtexEntry,
    versionedId
  });
}

export function extractVersionedArxivIdFromHtml(rawHtml, fallbackId = "") {
  const html = String(rawHtml || "");
  const patterns = [
    /<base[^>]+href=["'][^"']*\/html\/([^/"'#?]+)(?:\/|["'#?])/i,
    /<meta[^>]+name=["']citation_arxiv_id["'][^>]+content=["']([^"']+)["']/i,
    /<link[^>]+rel=["']canonical["'][^>]+href=["'][^"']*\/(?:abs|html)\/([^/"'#?]+)(?:["'#?]|$)/i
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern)?.[1];
    const normalized = normalizeArxivId(match);
    if (normalized) {
      return normalized;
    }
  }

  return normalizeArxivId(fallbackId) || "";
}

export function buildLatexProject(sourceText) {
  const normalizedSource = normalizeLineEndings(String(sourceText || ""));
  const commentlessSource = stripTexComments(normalizedSource);
  const preamble = extractPreamble(commentlessSource);
  const theoremDefinitions = extractTheoremDefinitions(preamble);
  const macros = extractMacroDefinitions(preamble);
  const theoremEntries = extractTheoremEntries(commentlessSource, {
    theoremDefinitions,
    macros
  });

  return {
    macros,
    preamble,
    theoremDefinitions,
    theoremEntries
  };
}

export function stripTexComments(sourceText) {
  return normalizeLineEndings(sourceText)
    .split("\n")
    .map(stripTexLineComment)
    .join("\n");
}

export function extractTheoremEntries(sourceText, { theoremDefinitions = new Map(), macros = new Map() } = {}) {
  const documentBody = extractDocumentBody(sourceText);
  const interestingRecords = extractInterestingEnvironmentRecords(documentBody, theoremDefinitions);
  const entries = [];

  for (let index = 0; index < interestingRecords.length; index += 1) {
    const record = interestingRecords[index];
    if (record.envName === "proof") {
      continue;
    }

    const nextRecord = interestingRecords[index + 1];
    const proofSource = nextRecord?.envName === "proof" ? nextRecord.source : "";
    const definition =
      theoremDefinitions.get(record.envName) ||
      theoremDefinitions.get(record.baseEnvName) ||
      null;

    entries.push({
      envName: record.envName,
      theoremSource: normalizeLatexBlock(expandCustomMacros(record.source, macros)),
      proofSource: proofSource ? normalizeLatexBlock(expandCustomMacros(proofSource, macros)) : "",
      headerCommands: buildHeaderCommands(record.envName, definition),
      definitionCommand: normalizeLatexBlock(definition?.command || "")
    });
  }

  return entries;
}

export function expandCustomMacros(sourceText, macroDefinitions) {
  let current = String(sourceText || "");
  let pass = 0;

  while (pass < 8) {
    const { changed, value } = expandCustomMacrosOnce(current, macroDefinitions);
    current = value;
    if (!changed) {
      break;
    }
    pass += 1;
  }

  return current;
}

export function formatTheoremCopyText({
  theoremEntry,
  includeProof = false,
  bibtexEntry = "",
  versionedId = ""
}) {
  const headerLines = buildCopyHeaderLines({
    headerCommands: theoremEntry?.headerCommands || [],
    bibtexEntry,
    versionedId
  });
  const proofSource =
    includeProof && theoremEntry?.proofSource
      ? theoremEntry.proofSource
      : buildReferenceProof(bibtexEntry);

  return [headerLines, theoremEntry?.theoremSource || "", proofSource]
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

async function loadSourceProject(versionedId) {
  const cacheKey = String(versionedId || "").trim();
  if (!cacheKey) {
    throw new Error("An arXiv identifier is required to load the source theorem.");
  }

  if (!SOURCE_PROJECT_CACHE.has(cacheKey)) {
    SOURCE_PROJECT_CACHE.set(
      cacheKey,
      (async () => {
        const { blob } = await fetchBlobWithFallback(buildArxivSourceUrl(cacheKey));
        const sourceText = await readLatexSourceFromBlob(blob);
        return buildLatexProject(sourceText);
      })()
    );
  }

  return SOURCE_PROJECT_CACHE.get(cacheKey);
}

async function loadBibtexEntry(versionedId, fallbackTitle) {
  const cacheKey = String(versionedId || "").trim();
  if (!cacheKey) {
    return buildFallbackBibtexEntry(fallbackTitle, "");
  }

  if (!BIBTEX_CACHE.has(cacheKey)) {
    BIBTEX_CACHE.set(
      cacheKey,
      (async () => {
        try {
          const response = await fetchTextThroughRelays(buildArxivBibtexUrl(cacheKey));
          const bibtex = normalizeLineEndings(response.body).trim();
          return bibtex || buildFallbackBibtexEntry(fallbackTitle, cacheKey);
        } catch {
          return buildFallbackBibtexEntry(fallbackTitle, cacheKey);
        }
      })()
    );
  }

  return BIBTEX_CACHE.get(cacheKey);
}

async function readLatexSourceFromBlob(blob) {
  const originalBytes = new Uint8Array(await blob.arrayBuffer());
  const archiveBytes = isGzip(originalBytes) ? await gunzipBytes(originalBytes) : originalBytes;

  if (looksLikeTarArchive(archiveBytes)) {
    const textFiles = decodeTarTextEntries(archiveBytes);
    const mainFilePath = pickMainTexFile(textFiles);
    if (!mainFilePath) {
      throw new Error("The downloaded arXiv source archive did not contain a TeX file.");
    }

    return inlineProjectFiles(mainFilePath, textFiles);
  }

  return decodeText(archiveBytes);
}

async function gunzipBytes(bytes) {
  if (typeof DecompressionStream !== "function") {
    throw new Error("This browser cannot decompress arXiv source archives.");
  }

  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  const buffer = await new Response(stream).arrayBuffer();
  return new Uint8Array(buffer);
}

function isGzip(bytes) {
  return bytes[0] === 0x1f && bytes[1] === 0x8b;
}

function looksLikeTarArchive(bytes) {
  if (bytes.length < 512) {
    return false;
  }

  return decodeText(bytes.slice(257, 262)) === "ustar";
}

function decodeTarTextEntries(bytes) {
  const files = new Map();
  let offset = 0;

  while (offset + 512 <= bytes.length) {
    const header = bytes.slice(offset, offset + 512);
    if (isZeroBlock(header)) {
      break;
    }

    const name = readTarString(header, 0, 100);
    const prefix = readTarString(header, 345, 155);
    const filePath = normalizeProjectPath(prefix ? `${prefix}/${name}` : name);
    const size = parseTarOctal(header.slice(124, 136));
    const typeFlag = readTarString(header, 156, 1) || "0";
    const contentStart = offset + 512;
    const contentEnd = contentStart + size;

    if (filePath && ["0", "\0", "", "7"].includes(typeFlag) && isTextProjectFile(filePath)) {
      files.set(filePath, decodeText(bytes.slice(contentStart, contentEnd)));
    }

    offset = contentStart + Math.ceil(size / 512) * 512;
  }

  return files;
}

function pickMainTexFile(textFiles) {
  const texFiles = [...textFiles.entries()].filter(([filePath]) => filePath.endsWith(".tex"));
  if (!texFiles.length) {
    return "";
  }

  const scoredFiles = texFiles.map(([filePath, contents]) => ({
    filePath,
    contents,
    score:
      (/\b\\documentclass\b/.test(contents) ? 100 : 0) +
      (/\b\\begin\s*\{\s*document\s*\}/.test(contents) ? 25 : 0) -
      filePath.split("/").length
  }));
  scoredFiles.sort((left, right) => right.score - left.score || left.filePath.localeCompare(right.filePath));

  return scoredFiles[0]?.filePath || "";
}

function inlineProjectFiles(entryPath, textFiles, visited = new Set()) {
  const normalizedEntryPath = normalizeProjectPath(entryPath);
  if (!normalizedEntryPath || visited.has(normalizedEntryPath)) {
    return "";
  }

  visited.add(normalizedEntryPath);
  const sourceText = textFiles.get(normalizedEntryPath) || "";
  const directoryPath = projectDirname(normalizedEntryPath);
  let expandedText = normalizeLineEndings(sourceText);

  expandedText = inlineLocalClassFile(expandedText, textFiles, directoryPath, visited);
  expandedText = inlineLocalPackageFiles(expandedText, textFiles, directoryPath, visited);

  return expandedText.replace(
    /\\(?:input|include)\s*(?:\{([^}]+)\}|([^\s%]+))/g,
    (_match, bracedPath, barePath) => {
      const reference = String(bracedPath || barePath || "").trim();
      const resolvedPath = resolveProjectReference(textFiles, directoryPath, reference, [".tex"]);
      if (!resolvedPath) {
        return "";
      }

      return `\n${inlineProjectFiles(resolvedPath, textFiles, visited)}\n`;
    }
  );
}

function inlineLocalClassFile(sourceText, textFiles, directoryPath, visited) {
  return sourceText.replace(
    /\\documentclass(?:\s*\[[^\]]*])?\s*\{([^}]+)\}/g,
    (match, classNames) => {
      const localContents = resolveLocalPackageList(textFiles, directoryPath, classNames, [".cls"], visited);
      return localContents ? `${localContents}\n${match}` : match;
    }
  );
}

function inlineLocalPackageFiles(sourceText, textFiles, directoryPath, visited) {
  return sourceText.replace(
    /\\usepackage(?:\s*\[[^\]]*])?\s*\{([^}]+)\}/g,
    (match, packageNames) => {
      const localContents = resolveLocalPackageList(textFiles, directoryPath, packageNames, [".sty"], visited);
      return localContents ? `${match}\n${localContents}` : match;
    }
  );
}

function resolveLocalPackageList(textFiles, directoryPath, packageNames, extensions, visited) {
  const blocks = [];

  for (const packageName of String(packageNames || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)) {
    const resolvedPath = resolveProjectReference(textFiles, directoryPath, packageName, extensions);
    if (!resolvedPath) {
      continue;
    }

    const contents = inlineProjectFiles(resolvedPath, textFiles, visited);
    if (contents) {
      blocks.push(contents);
    }
  }

  return blocks.join("\n");
}

function resolveProjectReference(textFiles, directoryPath, reference, extensions) {
  const trimmedReference = String(reference || "").trim();
  if (!trimmedReference) {
    return "";
  }

  const candidates = [];
  const hasExtension = /\.[a-z0-9]+$/i.test(trimmedReference);
  if (hasExtension) {
    candidates.push(trimmedReference);
  } else {
    candidates.push(trimmedReference);
    for (const extension of extensions) {
      candidates.push(`${trimmedReference}${extension}`);
    }
  }

  for (const candidate of candidates) {
    const resolvedPath = normalizeProjectPath(
      candidate.startsWith("/") ? candidate.slice(1) : joinProjectPath(directoryPath, candidate)
    );
    if (textFiles.has(resolvedPath)) {
      return resolvedPath;
    }
  }

  return "";
}

function extractPreamble(sourceText) {
  const match = String(sourceText || "").match(/[\s\S]*?\\begin\s*\{\s*document\s*\}/);
  return match ? match[0] : String(sourceText || "");
}

function extractDocumentBody(sourceText) {
  const source = String(sourceText || "");
  const startMatch = /\\begin\s*\{\s*document\s*\}/.exec(source);
  const endMatch = /\\end\s*\{\s*document\s*\}/.exec(source);
  const startIndex = startMatch ? startMatch.index + startMatch[0].length : 0;
  const endIndex = endMatch ? endMatch.index : source.length;
  return source.slice(startIndex, endIndex);
}

function extractTheoremDefinitions(preamble) {
  const definitions = new Map();
  const commandRegex =
    /\\(?:newtheorem\*?|declaretheorem\*?|spnewtheorem\*?)(?=\s|\{|\[|$)/g;
  let match;

  while ((match = commandRegex.exec(preamble))) {
    const commandName = match[0];
    let cursor = match.index + commandName.length;
    let envName = "";
    let title = "";

    if (commandName.startsWith("\\newtheorem")) {
      const envGroup = readRequiredGroup(preamble, cursor);
      if (!envGroup) {
        continue;
      }

      envName = envGroup.content.trim();
      cursor = envGroup.end;
      const sharedCounter = readOptionalBracket(preamble, cursor);
      if (sharedCounter) {
        cursor = sharedCounter.end;
      }

      const titleGroup = readRequiredGroup(preamble, cursor);
      if (!titleGroup) {
        continue;
      }

      title = titleGroup.content.trim();
      cursor = titleGroup.end;
      const withinCounter = readOptionalBracket(preamble, cursor);
      if (withinCounter) {
        cursor = withinCounter.end;
      }
    } else if (commandName.startsWith("\\declaretheorem")) {
      const optionsGroup = readOptionalBracket(preamble, cursor);
      if (optionsGroup) {
        cursor = optionsGroup.end;
        title = extractDeclareTheoremName(optionsGroup.content);
      }

      const envGroup = readRequiredGroup(preamble, cursor);
      if (!envGroup) {
        continue;
      }

      envName = envGroup.content.trim();
      cursor = envGroup.end;
    } else if (commandName.startsWith("\\spnewtheorem")) {
      const envGroup = readRequiredGroup(preamble, cursor);
      if (!envGroup) {
        continue;
      }

      envName = envGroup.content.trim();
      cursor = envGroup.end;
      const counterGroup = readOptionalBracket(preamble, cursor);
      if (counterGroup) {
        cursor = counterGroup.end;
      }
      const titleGroup = readRequiredGroup(preamble, cursor);
      if (!titleGroup) {
        continue;
      }

      title = titleGroup.content.trim();
      cursor = titleGroup.end;
    }

    if (!envName) {
      continue;
    }

    definitions.set(envName, {
      title,
      command: normalizeLatexBlock(preamble.slice(match.index, cursor))
    });
    KNOWN_THEOREM_ENVIRONMENTS.add(envName);
  }

  return definitions;
}

function extractMacroDefinitions(preamble) {
  const definitions = new Map();
  const commandRegex =
    /\\(?:newcommand\*?|renewcommand\*?|providecommand\*?|DeclareMathOperator\*?|def|let)(?=\s|\\|\{|\[|$)/g;
  let match;

  while ((match = commandRegex.exec(preamble))) {
    const commandName = match[0];
    let cursor = match.index + commandName.length;

    if (/^\\(?:newcommand|renewcommand|providecommand)/.test(commandName)) {
      const nameToken = readMacroNameArgument(preamble, cursor);
      if (!nameToken?.name) {
        continue;
      }

      cursor = nameToken.end;
      const argCountGroup = readOptionalBracket(preamble, cursor);
      const argCount = Number(argCountGroup?.content || 0) || 0;
      if (argCountGroup) {
        cursor = argCountGroup.end;
      }

      let defaultValue = "";
      const defaultGroup = readOptionalBracket(preamble, cursor);
      if (defaultGroup) {
        defaultValue = defaultGroup.content;
        cursor = defaultGroup.end;
      }

      const bodyGroup = readRequiredGroup(preamble, cursor);
      if (!bodyGroup) {
        continue;
      }

      cursor = bodyGroup.end;
      definitions.set(nameToken.name, {
        args: argCount,
        body: bodyGroup.content,
        defaultValue
      });
      continue;
    }

    if (/^\\DeclareMathOperator/.test(commandName)) {
      const starred = commandName.endsWith("*");
      const nameToken = readMacroNameArgument(preamble, cursor);
      if (!nameToken?.name) {
        continue;
      }

      cursor = nameToken.end;
      const bodyGroup = readRequiredGroup(preamble, cursor);
      if (!bodyGroup) {
        continue;
      }

      definitions.set(nameToken.name, {
        args: 0,
        body: `\\operatorname${starred ? "*" : ""}{${bodyGroup.content}}`
      });
      continue;
    }

    if (commandName === "\\def") {
      const nameToken = readControlSequence(preamble, skipWhitespace(preamble, cursor));
      if (!nameToken?.name) {
        continue;
      }

      cursor = nameToken.end;
      let argCount = 0;
      while (preamble.slice(cursor, cursor + 2) === `#${argCount + 1}`) {
        argCount += 1;
        cursor += 2;
      }

      const bodyGroup = readRequiredGroup(preamble, cursor);
      if (!bodyGroup) {
        continue;
      }

      definitions.set(nameToken.name, {
        args: argCount,
        body: bodyGroup.content
      });
      continue;
    }

    if (commandName === "\\let") {
      const targetToken = readControlSequence(preamble, skipWhitespace(preamble, cursor));
      if (!targetToken?.name) {
        continue;
      }

      cursor = skipWhitespace(preamble, targetToken.end);
      if (preamble[cursor] === "=") {
        cursor += 1;
      }
      const sourceToken = readControlSequence(preamble, skipWhitespace(preamble, cursor));
      if (!sourceToken?.name) {
        continue;
      }

      definitions.set(targetToken.name, {
        args: 0,
        body: `\\${sourceToken.name}`
      });
    }
  }

  return definitions;
}

function extractInterestingEnvironmentRecords(documentBody, theoremDefinitions) {
  const interestingNames = new Set([...KNOWN_THEOREM_ENVIRONMENTS, ...theoremDefinitions.keys(), "proof"]);
  const records = [];
  const stack = [];
  const tokenRegex = /\\(begin|end)\s*\{/g;
  let match;

  while ((match = tokenRegex.exec(documentBody))) {
    const kind = match[1];
    const group = readRequiredGroup(documentBody, tokenRegex.lastIndex - 1);
    if (!group) {
      continue;
    }

    const envName = group.content.trim();
    tokenRegex.lastIndex = group.end;

    if (kind === "begin") {
      stack.push({
        envName,
        start: match.index
      });
      continue;
    }

    const stackIndex = findMatchingEnvironmentIndex(stack, envName);
    if (stackIndex < 0) {
      continue;
    }

    const startRecord = stack.splice(stackIndex, 1)[0];
    const baseEnvName = envName.endsWith("*") ? envName.slice(0, -1) : envName;
    if (!interestingNames.has(envName) && !interestingNames.has(baseEnvName)) {
      continue;
    }

    records.push({
      envName,
      baseEnvName,
      start: startRecord.start,
      source: documentBody.slice(startRecord.start, group.end)
    });
  }

  records.sort((left, right) => left.start - right.start);
  return records;
}

function buildHeaderCommands(envName, definition) {
  const commands = ["\\usepackage{amsthm}"];
  if (definition?.command) {
    commands.push(definition.command);
    return commands;
  }

  const baseEnvName = envName.endsWith("*") ? envName.slice(0, -1) : envName;
  if (KNOWN_THEOREM_ENVIRONMENTS.has(baseEnvName)) {
    const title = sentenceCase(baseEnvName);
    commands.push(`\\newtheorem{${baseEnvName}}{${title}}`);
  }
  return commands;
}

function buildCopyHeaderLines({ headerCommands, bibtexEntry, versionedId }) {
  const lines = ["% Add to your preamble if needed:"];
  for (const command of dedupe(headerCommands.filter(Boolean))) {
    for (const line of normalizeLatexBlock(command).split("\n")) {
      lines.push(`% ${line}`);
    }
  }

  lines.push("%");
  lines.push("% Add this entry to your .bib file:");
  for (const line of normalizeLineEndings(bibtexEntry).trim().split("\n")) {
    lines.push(`% ${line}`);
  }

  if (versionedId) {
    lines.push(`% Exact arXiv version used for this excerpt: ${buildArxivAbsUrl(versionedId)}`);
  }

  return lines.join("\n");
}

function buildReferenceProof(bibtexEntry) {
  const bibtexKey = extractBibtexKey(bibtexEntry);
  const sourceReference = bibtexKey ? `\\cite{${bibtexKey}}` : "the source paper";

  return ["\\begin{proof}", `See ${sourceReference} for the original proof.`, "\\end{proof}"].join(
    "\n"
  );
}

function buildFallbackBibtexEntry(title, id) {
  const normalizedId = normalizeArxivId(id) || "";
  const citationKeyBase = normalizedId.replace(/[^\w]+/g, "") || "arxivsource";

  return [
    `@misc{${citationKeyBase},`,
    `  title={${escapeBibtexValue(title || normalizedId || "arXiv source")}},`,
    normalizedId ? `  eprint={${normalizedId.replace(/v\d+$/i, "")}},` : "",
    normalizedId ? "  archivePrefix={arXiv}," : "",
    normalizedId ? `  url={${buildArxivAbsUrl(normalizedId)}},` : "",
    "}"
  ]
    .filter(Boolean)
    .join("\n");
}

function expandCustomMacrosOnce(sourceText, macroDefinitions) {
  if (!macroDefinitions?.size) {
    return {
      changed: false,
      value: String(sourceText || "")
    };
  }

  const source = String(sourceText || "");
  let cursor = 0;
  let changed = false;
  let nextValue = "";

  while (cursor < source.length) {
    if (source[cursor] !== "\\") {
      nextValue += source[cursor];
      cursor += 1;
      continue;
    }

    const controlSequence = readControlSequence(source, cursor);
    if (!controlSequence?.name || !macroDefinitions.has(controlSequence.name)) {
      nextValue += source[cursor];
      cursor += 1;
      continue;
    }

    const definition = macroDefinitions.get(controlSequence.name);
    let replacementCursor = controlSequence.end;
    const argumentsList = [];

    if (definition.defaultValue) {
      const optionalGroup = readOptionalBracket(source, replacementCursor);
      if (optionalGroup) {
        argumentsList.push(optionalGroup.content);
        replacementCursor = optionalGroup.end;
      } else {
        argumentsList.push(definition.defaultValue);
      }
    }

    while (argumentsList.length < definition.args) {
      const argumentToken = readMacroArgumentToken(source, replacementCursor);
      if (!argumentToken) {
        nextValue += source[cursor];
        cursor += 1;
        replacementCursor = controlSequence.end;
        break;
      }

      argumentsList.push(argumentToken.content);
      replacementCursor = argumentToken.end;
    }

    if (argumentsList.length < definition.args) {
      continue;
    }

    nextValue += substituteMacroArguments(definition.body, argumentsList);
    cursor = replacementCursor;
    changed = true;
  }

  return {
    changed,
    value: nextValue
  };
}

function readMacroArgumentToken(sourceText, startIndex) {
  const cursor = skipWhitespace(sourceText, startIndex);
  const group = readRequiredGroup(sourceText, cursor);
  if (group) {
    return group;
  }

  const controlSequence = readControlSequence(sourceText, cursor);
  if (controlSequence) {
    return {
      content: `\\${controlSequence.name}`,
      end: controlSequence.end
    };
  }

  if (!sourceText[cursor]) {
    return null;
  }

  return {
    content: sourceText[cursor],
    end: cursor + 1
  };
}

function substituteMacroArguments(body, argumentsList) {
  let result = String(body || "");
  for (let index = 0; index < argumentsList.length; index += 1) {
    result = result.replace(new RegExp(`#${index + 1}`, "g"), argumentsList[index]);
  }
  return result;
}

function extractBibtexKey(bibtexEntry) {
  return String(bibtexEntry || "").match(/@\w+\{([^,]+),/)?.[1]?.trim() || "";
}

function readMacroNameArgument(sourceText, startIndex) {
  const cursor = skipWhitespace(sourceText, startIndex);
  const grouped = readRequiredGroup(sourceText, cursor);
  if (grouped) {
    const groupedControlSequence = readControlSequence(grouped.content.trim(), 0);
    if (groupedControlSequence?.name) {
      return {
        name: groupedControlSequence.name,
        end: grouped.end
      };
    }
  }

  return readControlSequence(sourceText, cursor);
}

function readControlSequence(sourceText, startIndex) {
  if (sourceText[startIndex] !== "\\") {
    return null;
  }

  const nameMatch = sourceText.slice(startIndex + 1).match(/^[A-Za-z@]+|^./);
  if (!nameMatch?.[0]) {
    return null;
  }

  return {
    name: nameMatch[0],
    end: startIndex + 1 + nameMatch[0].length
  };
}

function readRequiredGroup(sourceText, startIndex) {
  const cursor = skipWhitespace(sourceText, startIndex);
  if (sourceText[cursor] !== "{") {
    return null;
  }

  let depth = 0;
  for (let index = cursor; index < sourceText.length; index += 1) {
    const character = sourceText[index];
    if (character === "{" && !isEscaped(sourceText, index)) {
      depth += 1;
    } else if (character === "}" && !isEscaped(sourceText, index)) {
      depth -= 1;
      if (depth === 0) {
        return {
          content: sourceText.slice(cursor + 1, index),
          end: index + 1
        };
      }
    }
  }

  return null;
}

function readOptionalBracket(sourceText, startIndex) {
  const cursor = skipWhitespace(sourceText, startIndex);
  if (sourceText[cursor] !== "[") {
    return null;
  }

  let depth = 0;
  for (let index = cursor; index < sourceText.length; index += 1) {
    const character = sourceText[index];
    if (character === "[" && !isEscaped(sourceText, index)) {
      depth += 1;
    } else if (character === "]" && !isEscaped(sourceText, index)) {
      depth -= 1;
      if (depth === 0) {
        return {
          content: sourceText.slice(cursor + 1, index),
          end: index + 1
        };
      }
    }
  }

  return null;
}

function findMatchingEnvironmentIndex(stack, envName) {
  for (let index = stack.length - 1; index >= 0; index -= 1) {
    if (stack[index].envName === envName) {
      return index;
    }
  }

  return -1;
}

function extractDeclareTheoremName(optionsText) {
  const match = String(optionsText || "").match(/(?:^|,)\s*name\s*=\s*\{?([^,}]+)\}?/);
  return match?.[1]?.trim() || "";
}

function stripTexLineComment(line) {
  for (let index = 0; index < line.length; index += 1) {
    if (line[index] === "%" && !isEscaped(line, index)) {
      return line.slice(0, index);
    }
  }

  return line;
}

function skipWhitespace(sourceText, startIndex) {
  let cursor = startIndex;
  while (cursor < sourceText.length && /\s/.test(sourceText[cursor])) {
    cursor += 1;
  }
  return cursor;
}

function isEscaped(sourceText, index) {
  let backslashCount = 0;
  let cursor = index - 1;
  while (cursor >= 0 && sourceText[cursor] === "\\") {
    backslashCount += 1;
    cursor -= 1;
  }
  return backslashCount % 2 === 1;
}

function normalizeLatexBlock(sourceText) {
  return normalizeLineEndings(String(sourceText || ""))
    .replace(/^\s+|\s+$/g, "")
    .replace(/\n{3,}/g, "\n\n");
}

function normalizeLineEndings(sourceText) {
  return String(sourceText || "").replace(/\r\n?/g, "\n");
}

function dedupe(values) {
  return [...new Set(values)];
}

function sentenceCase(value) {
  const source = String(value || "");
  return source ? source[0].toUpperCase() + source.slice(1) : source;
}

function escapeBibtexValue(value) {
  return String(value || "").replace(/[{}]/g, (match) => `\\${match}`);
}

function decodeText(bytes) {
  return new TextDecoder("utf-8").decode(bytes);
}

function isZeroBlock(bytes) {
  return bytes.every((value) => value === 0);
}

function readTarString(header, start, length) {
  return decodeText(header.slice(start, start + length)).replace(/\0.*$/, "").trim();
}

function parseTarOctal(bytes) {
  const value = decodeText(bytes).replace(/\0.*$/, "").trim();
  return value ? Number.parseInt(value, 8) : 0;
}

function isTextProjectFile(filePath) {
  return /\.(tex|sty|cls|cfg|def)$/i.test(filePath);
}

function normalizeProjectPath(filePath) {
  const segments = [];

  for (const part of String(filePath || "")
    .replace(/\\/g, "/")
    .split("/")) {
    if (!part || part === ".") {
      continue;
    }

    if (part === "..") {
      segments.pop();
      continue;
    }

    segments.push(part);
  }

  return segments.join("/");
}

function projectDirname(filePath) {
  const normalizedPath = normalizeProjectPath(filePath);
  const slashIndex = normalizedPath.lastIndexOf("/");
  return slashIndex >= 0 ? normalizedPath.slice(0, slashIndex) : "";
}

function joinProjectPath(basePath, relativePath) {
  return [String(basePath || "").trim(), String(relativePath || "").trim()].filter(Boolean).join("/");
}
