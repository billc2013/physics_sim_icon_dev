import { COLOR_RAMPS } from "../lib/constants.js";

// 8 color-ramp swatches plus the currently-selected ramp's hex values.
// Clicking a selected swatch unsets it (toggles to null).
export default function ColorPaletteTag({ selectedTag, onChange }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div
        style={{
          fontSize: 12,
          fontWeight: 500,
          color: "var(--color-text-secondary)",
          marginBottom: 6,
        }}
      >
        Color palette tag
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        {Object.entries(COLOR_RAMPS).map(([key, ramp]) => (
          <button
            key={key}
            onClick={() => onChange(selectedTag === key ? null : key)}
            title={ramp.n}
            style={{
              width: 28,
              height: 28,
              borderRadius: "50%",
              cursor: "pointer",
              padding: 0,
              background: `linear-gradient(135deg, ${ramp.l} 33%, ${ramp.m} 66%, ${ramp.d})`,
              border:
                selectedTag === key
                  ? "2px solid var(--color-text-primary)"
                  : "2px solid transparent",
              outline:
                selectedTag === key ? "2px solid var(--color-background-primary)" : "none",
            }}
          />
        ))}
        {selectedTag && (
          <span
            style={{
              fontSize: 11,
              color: "var(--color-text-tertiary)",
              marginLeft: 4,
            }}
          >
            {COLOR_RAMPS[selectedTag].n}: {COLOR_RAMPS[selectedTag].l} /{" "}
            {COLOR_RAMPS[selectedTag].m} / {COLOR_RAMPS[selectedTag].d}
          </span>
        )}
      </div>
    </div>
  );
}
