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
      setCopyMessage("Copy failed. Drag the bookmark into the bookmarks bar instead.");
    }
  }

  function handleBookmarkletClick(event) {
    event.preventDefault();
    void handleCopyBookmarklet();
  }

  function handleBookmarkletDragStart(event) {
    if (!bookmarkletHref) {
      return;
    }

    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData("text/uri-list", bookmarkletHref);
    event.dataTransfer.setData("text/plain", bookmarkletHref);
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
          On desktop, drag the bookmark below into the bookmarks bar or click it to
          copy its URL:
        </p>
        <div className="setup-actions setup-actions--bookmarklet">
          <div className="bookmarklet-drag-stage">
            <div className="bookmarklet-browser-bar" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
            <BookmarkletDragArrow />
            <a
              className="bookmarklet-chip"
              draggable="true"
              href={bookmarkletHref}
              title="Drag to your bookmarks bar or click to copy"
              aria-label="Drag Open in ar5iv Reader to your bookmarks bar, or click to copy the bookmarklet"
              onClick={handleBookmarkletClick}
              onDragStart={handleBookmarkletDragStart}
            >
              <DragHandleIcon />
              <span className="bookmarklet-chip-icon" aria-hidden="true">
                <BookmarkIcon />
              </span>
              <span className="bookmarklet-chip-label">Open in ar5iv Reader</span>
              <span className="bookmarklet-copy-icon" aria-hidden="true">
                <CopyIcon />
              </span>
            </a>
          </div>
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

function BookmarkletDragArrow() {
  return (
    <svg
      className="bookmarklet-drag-arrow"
      viewBox="0 0 80 56"
      fill="none"
      stroke="currentColor"
      strokeWidth="3.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M8 48c30 0 50-12 50-36" />
      <path d="m46 24 12-12 12 12" />
    </svg>
  );
}

function DragHandleIcon() {
  return (
    <svg
      className="bookmarklet-grip-icon"
      viewBox="0 0 16 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <circle cx="5" cy="6" r="1.4" />
      <circle cx="11" cy="6" r="1.4" />
      <circle cx="5" cy="12" r="1.4" />
      <circle cx="11" cy="12" r="1.4" />
      <circle cx="5" cy="18" r="1.4" />
      <circle cx="11" cy="18" r="1.4" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden="true">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9 8.2V6.6c0-.9.7-1.6 1.6-1.6h6.8c.9 0 1.6.7 1.6 1.6v6.8c0 .9-.7 1.6-1.6 1.6h-1.6"
      />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M5 10.6C5 9.7 5.7 9 6.6 9h6.8c.9 0 1.6.7 1.6 1.6v6.8c0 .9-.7 1.6-1.6 1.6H6.6c-.9 0-1.6-.7-1.6-1.6v-6.8Z"
      />
    </svg>
  );
}

function BookmarkIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden="true">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M7 4.8c0-.9.7-1.6 1.6-1.6h6.8c.9 0 1.6.7 1.6 1.6v15l-5-3-5 3v-15Z"
      />
    </svg>
  );
}
