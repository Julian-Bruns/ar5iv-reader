import { copyText } from "./clipboard";
import { buildCopyableTheoremText } from "./theoremSource";

const THEOREM_SELECTOR = ".ltx_theorem";

export function installTheoremCopy(root, paper, showToast) {
  if (!root || !paper?.html) {
    return () => {};
  }

  const theoremNodes = [...root.querySelectorAll(THEOREM_SELECTOR)];
  if (!theoremNodes.length) {
    return () => {};
  }

  theoremNodes.forEach((node, index) => {
    node.dataset.copyTheoremIndex = String(index);
    node.dataset.copyTheoremRoot = "true";
  });

  const menu = createMenu(root.ownerDocument, {
    onCopy: async (includeProof) => {
      if (!activeTheoremNode) {
        return;
      }

      const theoremIndex = Number.parseInt(activeTheoremNode.dataset.copyTheoremIndex || "", 10);
      if (!Number.isInteger(theoremIndex) || theoremIndex < 0) {
        return;
      }

      closeMenu();
      showToast(includeProof ? "Preparing theorem+proof…" : "Preparing theorem…");

      try {
        const latex = await buildCopyableTheoremText(paper, theoremIndex, {
          includeProof
        });
        await copyText(latex);
        showToast(includeProof ? "Copied theorem+proof." : "Copied theorem.");
      } catch (error) {
        console.error("Theorem copy failed", error);
        showToast("Theorem copy failed.");
      }
    }
  });

  let activeTheoremNode = null;

  function closeMenu() {
    activeTheoremNode?.classList.remove("paper-theorem-copy-target--active");
    activeTheoremNode = null;
    menu.remove();
  }

  function openMenu(event, theoremNode) {
    event.preventDefault();
    event.stopPropagation();

    activeTheoremNode?.classList.remove("paper-theorem-copy-target--active");
    activeTheoremNode = theoremNode;
    theoremNode.classList.add("paper-theorem-copy-target--active");

    root.ownerDocument.body.appendChild(menu);
    positionMenu(menu, theoremNode, event);
  }

  function handleContextMenu(event) {
    const theoremNode =
      event.target instanceof Element ? event.target.closest("[data-copy-theorem-root=\"true\"]") : null;
    if (!theoremNode || !root.contains(theoremNode)) {
      closeMenu();
      return;
    }

    openMenu(event, theoremNode);
  }

  function handlePointerDown(event) {
    const target = event.target;
    if (target instanceof Element && target.closest(".theorem-copy-menu")) {
      return;
    }

    if (target instanceof Element && target.closest("[data-copy-theorem-root=\"true\"]")) {
      return;
    }

    closeMenu();
  }

  function handleEscape(event) {
    if (event.key === "Escape") {
      closeMenu();
    }
  }

  function handleViewportChange() {
    closeMenu();
  }

  root.addEventListener("contextmenu", handleContextMenu);
  document.addEventListener("pointerdown", handlePointerDown);
  document.addEventListener("keydown", handleEscape);
  window.addEventListener("scroll", handleViewportChange, true);
  window.addEventListener("resize", handleViewportChange);

  return () => {
    closeMenu();
    root.removeEventListener("contextmenu", handleContextMenu);
    document.removeEventListener("pointerdown", handlePointerDown);
    document.removeEventListener("keydown", handleEscape);
    window.removeEventListener("scroll", handleViewportChange, true);
    window.removeEventListener("resize", handleViewportChange);
  };
}

function createMenu(documentNode, { onCopy }) {
  const menu = documentNode.createElement("div");
  menu.className = "theorem-copy-menu";
  menu.setAttribute("role", "menu");
  menu.setAttribute("aria-label", "Theorem copy actions");

  const copyTheoremButton = createMenuButton(documentNode, "copy theorem", async () => {
    await onCopy(false);
  });
  const copyTheoremProofButton = createMenuButton(documentNode, "copy theorem+proof", async () => {
    await onCopy(true);
  });

  menu.append(copyTheoremButton, copyTheoremProofButton);
  return menu;
}

function createMenuButton(documentNode, label, onClick) {
  const button = documentNode.createElement("button");
  button.type = "button";
  button.setAttribute("role", "menuitem");
  button.textContent = label;
  button.addEventListener("click", () => {
    void onClick();
  });
  return button;
}

function positionMenu(menu, theoremNode, event) {
  const menuMargin = 12;
  const theoremRect = theoremNode.getBoundingClientRect();
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  menu.style.left = "0px";
  menu.style.top = "0px";
  const menuRect = menu.getBoundingClientRect();
  const anchorX = event.clientX || theoremRect.left + 12;
  const anchorY = event.clientY || theoremRect.top + 12;
  const left = Math.min(
    Math.max(menuMargin, anchorX),
    Math.max(menuMargin, viewportWidth - menuRect.width - menuMargin)
  );
  const top = Math.min(
    Math.max(menuMargin, anchorY),
    Math.max(menuMargin, viewportHeight - menuRect.height - menuMargin)
  );

  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
}
