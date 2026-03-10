import { useEffect, useState } from "preact/hooks";
import { buildBookmarkletHref } from "../lib/bookmarklet";

export default function BookmarkSetupPanel({ open, onClose }) {
  const [bookmarkletHref, setBookmarkletHref] = useState("");
  const [copyMessage, setCopyMessage] = useState("");

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    setBookmarkletHref(buildBookmarkletHref(window.location.origin));
  }, []);

  useEffect(() => {
    if (!copyMessage) {
      return undefined;
    }

    const timer = window.setTimeout(() => setCopyMessage(""), 2400);
    return () => window.clearTimeout(timer);
  }, [copyMessage]);

  async function handleCopyBookmarklet() {
    if (!bookmarkletHref) {
      return;
    }

    try {
      await navigator.clipboard.writeText(bookmarkletHref);
      setCopyMessage(
        "Copied. Create a bookmark and paste the copied text into the bookmark URL field."
      );
    } catch {
      setCopyMessage("Copy failed. Drag the button into the bookmarks bar instead.");
    }
  }

  function handleBookmarkletClick(event) {
    event.preventDefault();
    setCopyMessage("Drag this button into the bookmarks bar. Do not click it here.");
  }

  if (!open) {
    return null;
  }

  return (
    <section className="card setup-card">
      <div className="setup-header">
        <div className="section-heading">
          <h2>Set Up the Bookmark</h2>
          <p>One short setup, then one click from any arXiv abstract page.</p>
        </div>
        <button className="ghost-button" type="button" onClick={onClose}>
          Close
        </button>
      </div>

      <div className="setup-guide">
        <p>
          On phones, the more stable option is the system share sheet: open an arXiv
          page, tap Share, then choose ar5iv Reader.
        </p>
        <p>
          1. Install the reader if you want desktop bookmark launching too.
        </p>
        <p>
          2. Open a new tab. If you do not see the bookmarks bar, click the
          bookmarks bar area in the new tab to turn it on.
        </p>
        <p>
          3. Drag this button into the bookmarks bar:
        </p>
        <div className="setup-actions">
          <a
            className="primary-button"
            href={bookmarkletHref}
            onClick={handleBookmarkletClick}
          >
            Open in ar5iv Reader
          </a>
          <button className="ghost-button" type="button" onClick={handleCopyBookmarklet}>
            Copy Instead
          </button>
        </div>
        <p>
          4. If you already saved an older bookmark, replace it with this one so it
          picks up the latest launch behavior.
        </p>
        <p>
          5. Later, open any `arxiv.org/abs/...` page and press that bookmark. The
          current tab navigates through the app&apos;s `/receive` route. Installed
          browsers may hand that navigation to the app; otherwise the paper opens in
          skim mode in the browser tab.
        </p>
      </div>

      {copyMessage ? <p className="banner">{copyMessage}</p> : null}
    </section>
  );
}
