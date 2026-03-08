export function installMathCopy(root, showToast) {
  if (!root) {
    return () => {};
  }

  const selector = "math[alttext], .ltx_Math[alttext]";

  for (const node of root.querySelectorAll(selector)) {
    node.setAttribute("tabindex", "0");
    node.setAttribute("role", "button");
    node.setAttribute("aria-label", "Copy LaTeX");
    node.dataset.copyLatex = "true";
  }

  async function copyMathFromEvent(event) {
    const trigger =
      event.target instanceof Element ? event.target.closest(selector) : null;

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

async function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.top = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}
