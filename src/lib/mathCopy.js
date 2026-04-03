import { copyText } from "./clipboard";

export function installMathCopy(root, showToast) {
  if (!root) {
    return () => {};
  }

  const copyableSelector = "math[alttext], .ltx_Math[alttext]";
  const copyRootSelector = '[data-copy-latex-root="true"]';

  for (const node of root.querySelectorAll(copyableSelector)) {
    if (node.parentElement?.closest(copyableSelector)) {
      continue;
    }

    node.setAttribute("tabindex", "0");
    node.setAttribute("role", "button");
    node.setAttribute("aria-label", "Copy LaTeX");
    node.dataset.copyLatexRoot = "true";
  }

  async function copyMathFromEvent(event) {
    const trigger =
      event.target instanceof Element ? event.target.closest(copyRootSelector) : null;

    if (!trigger) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const latex =
      trigger.getAttribute("alttext")?.trim() ||
      trigger
        .querySelector('annotation[encoding="application/x-tex"]')
        ?.textContent?.trim();

    if (!latex) {
      return;
    }

    try {
      await copyText(latex);
      showToast("Copied!");
    } catch (error) {
      console.error("Clipboard copy failed", error);
      showToast("Clipboard copy failed.");
    }
  }

  const keydownHandler = (event) => {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }

    void copyMathFromEvent(event);
  };

  root.addEventListener("click", copyMathFromEvent);
  root.addEventListener("keydown", keydownHandler);

  return () => {
    root.removeEventListener("click", copyMathFromEvent);
    root.removeEventListener("keydown", keydownHandler);
  };
}
