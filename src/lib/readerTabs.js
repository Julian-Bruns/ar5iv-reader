export function upsertReaderTab(currentTabs, nextTab, { insert = "end" } = {}) {
  const existingIndex = currentTabs.findIndex((tab) => tab.key === nextTab.key);

  if (existingIndex === -1) {
    return insert === "start" ? [nextTab, ...currentTabs] : [...currentTabs, nextTab];
  }

  return currentTabs.map((tab, index) =>
    index === existingIndex
      ? {
          ...tab,
          ...nextTab
        }
      : tab
  );
}

export function reorderReaderTabs(currentTabs, draggedKey, targetKey, placement = "before") {
  if (!draggedKey || !targetKey || draggedKey === targetKey) {
    return currentTabs;
  }

  const draggedIndex = currentTabs.findIndex((tab) => tab.key === draggedKey);
  const targetIndex = currentTabs.findIndex((tab) => tab.key === targetKey);

  if (draggedIndex === -1 || targetIndex === -1) {
    return currentTabs;
  }

  const nextTabs = [...currentTabs];
  const [draggedTab] = nextTabs.splice(draggedIndex, 1);
  const adjustedTargetIndex = nextTabs.findIndex((tab) => tab.key === targetKey);
  const insertionIndex =
    placement === "after" ? adjustedTargetIndex + 1 : adjustedTargetIndex;

  nextTabs.splice(insertionIndex, 0, draggedTab);
  return nextTabs;
}

export function getNextTabAfterClose(currentTabs, closingKey) {
  const closingIndex = currentTabs.findIndex((tab) => tab.key === closingKey);
  if (closingIndex === -1) {
    return null;
  }

  return currentTabs[closingIndex + 1] || currentTabs[closingIndex - 1] || null;
}
