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
  const title =
    documentNode
      .querySelector('meta[name="citation_title"]')
      ?.getAttribute("content")
      ?.trim() ||
    documentNode.querySelector(".ltx_title")?.textContent?.trim() ||
    documentNode.title?.trim() ||
    fallbackTitle;

  return { title };
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
