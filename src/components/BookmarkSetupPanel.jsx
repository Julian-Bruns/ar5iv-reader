import { useEffect, useState } from "preact/hooks";
import { buildBookmarkletHref } from "../lib/bookmarklet";

export default function BookmarkSetupPanel({
  inline = false,
  onDismiss = null
}) {
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
      setCopyMessage("Copied. Paste it into a bookmark URL on desktop.");
    } catch {
      setCopyMessage("Copy failed. Drag the button into the bookmarks bar instead.");
    }
  }

  function handleBookmarkletClick(event) {
    event.preventDefault();
    setCopyMessage("Drag this button into the bookmarks bar. Do not click it here.");
  }

  return (
    <section className={`card setup-card${inline ? " setup-card--inline" : ""}`}>
      <div className="setup-header">
        <div className="section-heading">
          <h2>Bookmarklet</h2>
          <p>
            On phones, use Share. On desktop, save the bookmark once and launch the
            reader from any arXiv abstract page.
          </p>
        </div>
        {onDismiss ? (
          <button className="ghost-button" type="button" onClick={onDismiss}>
            Dismiss
          </button>
        ) : null}
      </div>

      <div className="setup-guide">
        <p>
          On phones, open an arXiv page, tap Share, then choose ar5iv Reader.
        </p>
        <p>
          On desktop, drag this button into the bookmarks bar or copy it into a
          bookmark URL:
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
            Copy Bookmark
          </button>
        </div>
        <p>
          Later, open any <code>arxiv.org/abs/...</code> page and use that bookmark to
          jump straight into the reader.
        </p>
      </div>

      {copyMessage ? <p className="banner">{copyMessage}</p> : null}
    </section>
  );
}
