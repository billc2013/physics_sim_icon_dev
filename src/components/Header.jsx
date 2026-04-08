// Top header: title + object count + button cluster (Undo, Generate more,
// System prompt, Download approved). The action buttons are wired to
// handlers in App.jsx; in Task 2 the generation/download handlers are
// stubs that toast a "ships in Phase 3" message.
export default function Header({
  itemCount,
  hasUndo,
  onUndo,
  onGenerateMore,
  onShowSystemPrompt,
  onDownloadApproved,
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: 16,
        flexWrap: "wrap",
        gap: 8,
      }}
    >
      <div style={{ fontSize: 18, fontWeight: 500, color: "var(--color-text-primary)" }}>
        GIST physics SVG library
        <span
          style={{
            fontSize: 13,
            color: "var(--color-text-secondary)",
            marginLeft: 8,
          }}
        >
          {itemCount} objects
        </span>
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        {hasUndo && (
          <button
            onClick={onUndo}
            style={{ fontSize: 12, color: "var(--color-text-info)" }}
            title="Ctrl/Cmd+Z"
          >
            Undo
          </button>
        )}
        <button onClick={onGenerateMore} style={{ fontSize: 13 }}>
          Generate more &#8599;
        </button>
        <button onClick={onShowSystemPrompt} style={{ fontSize: 13 }}>
          System prompt
        </button>
        <button onClick={onDownloadApproved} style={{ fontSize: 13 }}>
          Download approved &#8599;
        </button>
      </div>
    </div>
  );
}
