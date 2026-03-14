const listeners = new Set();
let currentSnapshot = {
  supported: typeof navigator !== "undefined" && "serviceWorker" in navigator,
  status: "idle"
};
let currentRegistration = null;
let shouldReloadOnControllerChange = false;
let didReloadForControllerChange = false;
let installListenerAttached = false;

export function subscribeServiceWorker(listener) {
  if (typeof listener !== "function") {
    return () => {};
  }

  listeners.add(listener);
  listener(currentSnapshot);
  return () => {
    listeners.delete(listener);
  };
}

export function registerAppServiceWorker() {
  if (typeof window === "undefined" || !("serviceWorker" in navigator) || installListenerAttached) {
    return;
  }

  installListenerAttached = true;
  if (document.readyState === "complete") {
    void registerWorkerAfterLoad();
    return;
  }

  window.addEventListener("load", () => {
    void registerWorkerAfterLoad();
  });
}

export function activateServiceWorkerUpdate() {
  if (!currentRegistration?.waiting) {
    return false;
  }

  shouldReloadOnControllerChange = true;
  updateSnapshot({
    supported: true,
    status: "activating"
  });
  currentRegistration.waiting.postMessage({
    type: "SKIP_WAITING"
  });
  return true;
}

async function registerWorkerAfterLoad() {
  try {
    navigator.serviceWorker.addEventListener("controllerchange", handleControllerChange);
    const registration = await navigator.serviceWorker.register("/sw.js");
    currentRegistration = registration;
    wireRegistration(registration);

    if (registration.waiting) {
      handleWaitingWorker(registration);
    } else {
      updateSnapshot({
        supported: true,
        status: "idle"
      });
    }

    try {
      await registration.update();
    } catch {
      // Ignore update polling failures and keep the current worker active.
    }
  } catch (error) {
    console.error("Service worker registration failed", error);
    updateSnapshot({
      supported: true,
      status: "error",
      error: stringifyError(error)
    });
  }
}

function wireRegistration(registration) {
  registration.addEventListener("updatefound", () => {
    const worker = registration.installing;
    if (!worker) {
      return;
    }

    worker.addEventListener("statechange", () => {
      if (worker.state === "installed") {
        if (registration.waiting) {
          handleWaitingWorker(registration);
        } else if (!navigator.serviceWorker.controller) {
          updateSnapshot({
            supported: true,
            status: "idle"
          });
        }
      }
    });
  });
}

function handleWaitingWorker(registration) {
  currentRegistration = registration;

  if (!navigator.serviceWorker.controller) {
    registration.waiting?.postMessage({
      type: "SKIP_WAITING"
    });
    return;
  }

  updateSnapshot({
    supported: true,
    status: "update-available"
  });
}

function handleControllerChange() {
  if (!shouldReloadOnControllerChange || didReloadForControllerChange) {
    return;
  }

  didReloadForControllerChange = true;
  window.location.reload();
}

function updateSnapshot(nextSnapshot) {
  currentSnapshot = {
    ...currentSnapshot,
    ...nextSnapshot
  };

  for (const listener of listeners) {
    listener(currentSnapshot);
  }
}

function stringifyError(error) {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
