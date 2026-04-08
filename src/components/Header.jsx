// Top header: title + object count + user info + button cluster
// (Generate more, System prompt, Download approved, Sign out).
//
// The "Generate more" and "Download approved" buttons are stubs in Task 3
// that toast a "ships in Phase 3/4" message until the GeneratePanel UI and
// zip exporter are built.
export default function Header({
  itemCount,
  userEmail,
  onSignOut,
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
        <button onClick={onGenerateMore} style={{ fontSize: 13 }}>
          Generate more &#8599;
        </button>
        <button onClick={onShowSystemPrompt} style={{ fontSize: 13 }}>
          System prompt
        </button>
        <button onClick={onDownloadApproved} style={{ fontSize: 13 }}>
          Download approved &#8599;
        </button>
        <span
          style={{
            fontSize: 11,
            color: "var(--color-text-tertiary)",
            marginLeft: 6,
          }}
        >
          {userEmail}
        </span>
        <button
          onClick={onSignOut}
          style={{ fontSize: 12, color: "var(--color-text-secondary)" }}
        >
          Sign out
        </button>
      </div>
    </div>
  );
}
