import DOMPurify from "dompurify";

const purifier = DOMPurify(window);
const UNSAFE_TAGS = [
  "script",
  "iframe",
  "object",
  "embed",
  "portal",
  "base",
  "form"
];
const EXTRA_TAGS = [
  "foreignObject",
  "foreignobject",
  "math",
  "semantics",
  "annotation",
  "annotation-xml",
  "mrow",
  "mi",
  "mo",
  "mn",
  "msub",
  "msup",
  "msubsup",
  "mfrac",
  "msqrt",
  "mroot",
  "mtext",
  "mtable",
  "mtr",
  "mtd",
  "munder",
  "mover",
  "munderover",
  "mstyle",
  "mspace",
  "menclose",
  "mfenced",
  "mpadded",
  "mphantom"
];
const EXTRA_ATTRS = [
  "alttext",
  "encoding",
  "srcset",
  "tabindex",
  "role",
  "aria-label",
  "aria-hidden",
  "aria-describedby",
  "aria-labelledby",
  "rowspan",
  "colspan",
  "display",
  "displaystyle",
  "xmlns"
];
const URL_ATTRS = new Set(["href", "src", "poster", "xlink:href"]);
const TITLE_META_SELECTORS = [
  'meta[name="citation_title"]',
  'meta[property="og:title"]',
  'meta[name="twitter:title"]',
  'meta[name="dc.title"]',
  'meta[name="DC.title"]'
];
const TITLE_NOISE_SELECTORS = [
  "annotation",
  "annotation-xml",
  ".MJX_Assistive_MathML",
  "mjx-assistive-mml",
  "script",
  "style",
  "noscript"
];
const LATEX_SYMBOL_REPLACEMENTS = new Map([
  ["alpha", "alpha"],
  ["beta", "beta"],
  ["gamma", "gamma"],
  ["delta", "delta"],
  ["epsilon", "epsilon"],
  ["varepsilon", "epsilon"],
  ["theta", "theta"],
  ["vartheta", "theta"],
  ["lambda", "lambda"],
  ["mu", "mu"],
  ["nu", "nu"],
  ["pi", "pi"],
  ["varpi", "pi"],
  ["rho", "rho"],
  ["varrho", "rho"],
  ["sigma", "sigma"],
  ["varsigma", "sigma"],
  ["tau", "tau"],
  ["phi", "phi"],
  ["varphi", "phi"],
  ["chi", "chi"],
  ["psi", "psi"],
  ["omega", "omega"],
  ["Gamma", "Gamma"],
  ["Delta", "Delta"],
  ["Theta", "Theta"],
  ["Lambda", "Lambda"],
  ["Pi", "Pi"],
  ["Sigma", "Sigma"],
  ["Phi", "Phi"],
  ["Psi", "Psi"],
  ["Omega", "Omega"],
  ["to", "->"],
  ["rightarrow", "->"],
  ["leftarrow", "<-"],
  ["leftrightarrow", "<->"],
  ["mapsto", "->"],
  ["times", "x"],
  ["cdot", "·"],
  ["pm", "+/-"],
  ["mp", "-/+"],
  ["leq", "<="],
  ["geq", ">="],
  ["neq", "!="],
  ["infty", "infinity"],
  ["partial", "partial"],
  ["sum", "sum"],
  ["prod", "prod"],
  ["cup", "cup"],
  ["cap", "cap"],
  ["subset", "subset"],
  ["supset", "supset"],
  ["subseteq", "subseteq"],
  ["supseteq", "supseteq"],
  ["mathbbm", ""],
  ["displaystyle", ""],
  ["textstyle", ""],
  ["scriptstyle", ""],
  ["scriptscriptstyle", ""]
]);

let hooksInstalled = false;

export function sanitizePaperHtml(rawHtml, { baseUrl = "" } = {}) {
  ensurePurifierHooks();

  const documentNode = new DOMParser().parseFromString(rawHtml, "text/html");
  const article =
    documentNode.querySelector("article.ltx_document") ||
    documentNode.querySelector("article") ||
    documentNode.body;

  if (!article) {
    throw new Error("No renderable article content found in the fetched HTML.");
  }

  const fragment = article.cloneNode(true);
  absolutizeNodeUrls(fragment, baseUrl);
  tunePaperMarkup(fragment);

  const sanitizedHtml = purifier.sanitize(
    fragment.outerHTML,
    createSanitizeOptions({
      html: true,
      svg: true,
      mathMl: true
    })
  );

  return restoreForeignObjectContent(fragment, sanitizedHtml);
}

export function extractPaperMetadata(rawHtml, fallbackTitle = "") {
  const documentNode = new DOMParser().parseFromString(rawHtml, "text/html");
  const title = extractDocumentTitle(documentNode, fallbackTitle);

  return { title };
}

export function normalizePaperTitle(value, fallbackTitle = "") {
  const normalized = cleanPaperTitle(value);
  return normalized || cleanPaperTitle(fallbackTitle);
}

function absolutizeNodeUrls(root, baseUrl) {
  if (!baseUrl) {
    return;
  }

  for (const element of root.querySelectorAll("[href], [src], [poster], [xlink\\:href]")) {
    for (const attr of URL_ATTRS) {
      if (element.hasAttribute(attr)) {
        const rawValue = element.getAttribute(attr);
        const absolute = toAbsoluteUrl(rawValue, baseUrl);
        if (absolute) {
          element.setAttribute(attr, absolute);
        } else {
          element.removeAttribute(attr);
        }
      }
    }

    if (element.hasAttribute("srcset")) {
      const rewritten = rewriteSrcset(element.getAttribute("srcset"), baseUrl);
      if (rewritten) {
        element.setAttribute("srcset", rewritten);
      } else {
        element.removeAttribute("srcset");
      }
    }
  }
}

function extractDocumentTitle(documentNode, fallbackTitle) {
  for (const selector of TITLE_META_SELECTORS) {
    const value = documentNode.querySelector(selector)?.getAttribute("content");
    const normalized = normalizePaperTitle(value);
    if (normalized) {
      return normalized;
    }
  }

  const titleNode =
    documentNode.querySelector(".ltx_title_document") ||
    documentNode.querySelector(".ltx_title");
  const extractedTitle = normalizePaperTitle(extractVisibleTitleText(titleNode));
  if (extractedTitle) {
    return extractedTitle;
  }

  return normalizePaperTitle(documentNode.title, fallbackTitle);
}

function extractVisibleTitleText(node) {
  if (!node) {
    return "";
  }

  const clone = node.cloneNode(true);
  for (const selector of TITLE_NOISE_SELECTORS) {
    for (const noiseNode of clone.querySelectorAll(selector)) {
      noiseNode.remove();
    }
  }

  return normalizeWhitespace(clone.textContent || "");
}

function tunePaperMarkup(root) {
  for (const image of root.querySelectorAll("img")) {
    if (!image.hasAttribute("loading")) {
      image.setAttribute("loading", "lazy");
    }
    if (!image.hasAttribute("decoding")) {
      image.setAttribute("decoding", "async");
    }
    if (!image.hasAttribute("fetchpriority")) {
      image.setAttribute("fetchpriority", "low");
    }
  }
}

function rewriteSrcset(srcset, baseUrl) {
  if (!srcset) {
    return "";
  }

  return srcset
    .split(",")
    .map((candidate) => candidate.trim())
    .filter(Boolean)
    .map((candidate) => {
      const [urlPart, descriptor] = candidate.split(/\s+/, 2);
      const absolute = toAbsoluteUrl(urlPart, baseUrl);
      return absolute ? `${absolute}${descriptor ? ` ${descriptor}` : ""}` : "";
    })
    .filter(Boolean)
    .join(", ");
}

function toAbsoluteUrl(value, baseUrl) {
  if (!value) {
    return null;
  }

  if (value.startsWith("#") || value.startsWith("data:") || value.startsWith("blob:")) {
    return value;
  }

  try {
    const resolved = new URL(value, baseUrl);
    if (!["http:", "https:"].includes(resolved.protocol)) {
      return null;
    }
    return resolved.toString();
  } catch {
    return null;
  }
}

function ensurePurifierHooks() {
  if (hooksInstalled) {
    return;
  }

  purifier.addHook("uponSanitizeAttribute", (node, data) => {
    if (data.attrName.startsWith("on")) {
      data.keepAttr = false;
      return;
    }

    if (URL_ATTRS.has(data.attrName) && /^javascript:/i.test(data.attrValue || "")) {
      data.keepAttr = false;
    }
  });

  hooksInstalled = true;
}

function createSanitizeOptions(profiles) {
  return {
    USE_PROFILES: profiles,
    ADD_TAGS: EXTRA_TAGS,
    ADD_ATTR: EXTRA_ATTRS,
    FORBID_TAGS: UNSAFE_TAGS,
    FORBID_ATTR: ["style"],
    ALLOW_DATA_ATTR: true,
    KEEP_CONTENT: true
  };
}

function restoreForeignObjectContent(sourceRoot, sanitizedHtml) {
  const sourceForeignObjects = [...sourceRoot.querySelectorAll("foreignObject")];
  if (!sourceForeignObjects.length) {
    return sanitizedHtml;
  }

  const sanitizedDocument = new DOMParser().parseFromString(sanitizedHtml, "text/html");
  const sanitizedRoot =
    sanitizedDocument.querySelector("article.ltx_document") ||
    sanitizedDocument.querySelector("article") ||
    sanitizedDocument.body.firstElementChild;

  if (!sanitizedRoot) {
    return sanitizedHtml;
  }

  const sanitizedForeignObjects = [...sanitizedRoot.querySelectorAll("foreignObject")];
  const count = Math.min(sourceForeignObjects.length, sanitizedForeignObjects.length);

  for (let index = 0; index < count; index += 1) {
    const sanitizedForeignObject = sanitizedForeignObjects[index];
    sanitizedForeignObject.innerHTML = purifier.sanitize(
      sourceForeignObjects[index].innerHTML,
      createSanitizeOptions({
        html: true,
        mathMl: true
      })
    );
  }

  return sanitizedRoot.outerHTML;
}

function cleanPaperTitle(value) {
  let title = String(value || "").trim();
  if (!title) {
    return "";
  }

  title = title.replace(/^\[[^[\]]+\]\s*/, "");
  title = simplifyDelimitedLatex(title);
  title = stripTrailingLatexDuplicate(title);
  title = simplifyLatexExpression(title);
  title = normalizeWhitespace(title);

  return title;
}

function simplifyDelimitedLatex(value) {
  return String(value || "")
    .replace(/\$\$?([^$]+)\$\$?/g, (_, inner) => simplifyLatexExpression(inner))
    .replace(/\\\((.+?)\\\)/g, (_, inner) => simplifyLatexExpression(inner))
    .replace(/\\\[(.+?)\\\]/g, (_, inner) => simplifyLatexExpression(inner));
}

function stripTrailingLatexDuplicate(value) {
  return String(value || "").replace(
    /([^\s\\])(?:\s*\\(?:display|displaystyle|textstyle|scriptstyle|scriptscriptstyle|mathbb|mathbbm|mathbf|mathrm|mathcal|mathfrak|mathit|mathsf|text|texttt|operatorname|hat|widehat|bar|overline|tilde|widetilde|vec|dot|ddot|breve|check|acute|grave)\b(?:\s*\{[^{}]*\})?)+\s*$/g,
    "$1"
  );
}

function simplifyLatexExpression(value) {
  let result = String(value || "");
  if (!result) {
    return "";
  }

  result = result.replace(/\\frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, "$1/$2");
  result = result.replace(
    /\\(?:mathbb|mathbbm|mathbf|mathrm|mathcal|mathfrak|mathit|mathsf|text|texttt|operatorname|textrm|textsf)\s*\{([^{}]*)\}/g,
    "$1"
  );
  result = result.replace(
    /\\(?:hat|widehat|bar|overline|tilde|widetilde|vec|dot|ddot|breve|check|acute|grave)\s*\{([^{}]*)\}/g,
    "$1"
  );
  result = result.replace(/\\([#$%&_{}])/g, "$1");
  result = result.replace(/~/g, " ");
  result = result.replace(/\\,/g, " ");
  result = result.replace(/\\;/g, " ");
  result = result.replace(/\\:/g, " ");
  result = result.replace(/\\!/g, "");
  result = result.replace(/\\quad\b/g, " ");
  result = result.replace(/\\qquad\b/g, " ");

  for (const [command, replacement] of LATEX_SYMBOL_REPLACEMENTS) {
    result = result.replace(new RegExp(`\\\\${command}\\b`, "g"), replacement);
  }

  result = result.replace(/\\[a-zA-Z]+\*?/g, "");
  result = result.replace(/\\./g, "");
  result = result.replace(/[{}]/g, "");

  return normalizeWhitespace(result);
}

function normalizeWhitespace(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}
