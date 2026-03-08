export default function Toast({ message }) {
  return (
    <div className={`toast ${message ? "toast--visible" : ""}`} aria-live="polite">
      {message}
    </div>
  );
}
