// SVG Manager header: title + object count + button cluster
// (Generate one, Batch generate, Queue badge, System prompt, Download approved).
//
// User email + sign-out live in TabStrip now (they're tool-agnostic) so they
// don't need to be duplicated when we add sibling tools.
export default function Header({
  itemCount,
  onGenerateMore,
  onBatchGenerate,
  onShowQueue,
  queueCounts,
  onShowSystemPrompt,
  onDownloadApproved,
}) {
  const queueLabel = (() => {
    if (!queueCounts || !queueCounts.hasActivity) return null;
    const parts = [];
    if (queueCounts.generating) parts.push(`${queueCounts.generating} running`);
    if (queueCounts.queued) parts.push(`${queueCounts.queued} queued`);
    if (queueCounts.ready) parts.push(`${queueCounts.ready} ready`);
    if (queueCounts.errored) parts.push(`${queueCounts.errored} err`);
    return parts.join(", ");
  })();
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
        <button onClick={onGenerateMore} style={{ fontSize: 13 }}>
          Generate one &#8599;
        </button>
        <button onClick={onBatchGenerate} style={{ fontSize: 13 }}>
          Batch generate &#8599;
        </button>
        {queueLabel && (
          <button
            onClick={onShowQueue}
            style={{
              fontSize: 12,
              padding: "4px 10px",
              borderRadius: "var(--border-radius-md)",
              background: queueCounts.ready > 0 ? "#E1F5EE" : "#DBEAFE",
              color: queueCounts.ready > 0 ? "#085041" : "#1E3A8A",
              fontWeight: 500,
            }}
          >
            Queue ({queueLabel})
          </button>
        )}
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
