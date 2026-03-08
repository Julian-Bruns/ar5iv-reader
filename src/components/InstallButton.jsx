import { useEffect, useState } from "preact/hooks";

export default function InstallButton() {
  const [promptEvent, setPromptEvent] = useState(null);

  useEffect(() => {
    const beforeInstallPrompt = (event) => {
      event.preventDefault();
      setPromptEvent(event);
    };

    const handleInstalled = () => setPromptEvent(null);

    window.addEventListener("beforeinstallprompt", beforeInstallPrompt);
    window.addEventListener("appinstalled", handleInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", beforeInstallPrompt);
      window.removeEventListener("appinstalled", handleInstalled);
    };
  }, []);

  if (!promptEvent) {
    return null;
  }

  return (
    <button
      className="ghost-button"
      type="button"
      onClick={async () => {
        await promptEvent.prompt();
        await promptEvent.userChoice.catch(() => {});
        setPromptEvent(null);
      }}
    >
      Install App
    </button>
  );
}
