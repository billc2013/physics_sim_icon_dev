import {
  checkViewBoxMatch,
  getContentBounds,
  getColliderBounds,
} from "../lib/svgGeometry.js";

// Compact geometry summary shown below an SVG preview. When the SVG's
// viewBox matches our 64×64 standard, renders a subtle one-line status
// with content and collider bounds. When it doesn't, renders an amber
// warning box explaining the scale mismatch GIST would see.
//
// Props:
//   svg       string   SVG markup
//   collider  object?  collider object from physicalProperties.collider
//   compact   boolean  if true, omit the bounds details on the happy path
export default function GeometryInfo({ svg, collider, compact = false }) {
  const vbCheck = checkViewBoxMatch(svg);

  if (!vbCheck.ok) {
    return (
      <div
        style={{
          padding: "6px 10px",
          borderRadius: "var(--border-radius-md)",
          background: "#FEF3C7",
          color: "#92400E",
          fontSize: 11,
          marginBottom: 8,
        }}
      >
        <strong>Geometry mismatch:</strong> {vbCheck.message}
        <div style={{ marginTop: 2, color: "#78350F" }}>
          Fix by regenerating the SVG or editing it to use{" "}
          <code>viewBox=&quot;0 0 64 64&quot;</code>.
        </div>
      </div>
    );
  }

  if (compact) {
    return (
      <div
        style={{
          fontSize: 11,
          color: "var(--color-text-tertiary)",
          textAlign: "center",
          marginBottom: 6,
        }}
      >
        viewBox {vbCheck.viewBox.width}×{vbCheck.viewBox.height} &check;
      </div>
    );
  }

  const content = getContentBounds(svg);
  const colBounds = collider ? getColliderBounds(collider) : null;

  const parts = [`viewBox ${vbCheck.viewBox.width}×${vbCheck.viewBox.height} ✓`];
  if (content) {
    parts.push(
      `content (${content.min[0]}, ${content.min[1]})→(${content.max[0]}, ${content.max[1]})`
    );
  }
  if (colBounds) {
    parts.push(
      `collider (${colBounds.min[0]}, ${colBounds.min[1]})→(${colBounds.max[0]}, ${colBounds.max[1]})`
    );
  }

  return (
    <div
      style={{
        fontSize: 11,
        color: "var(--color-text-tertiary)",
        textAlign: "center",
        marginBottom: 8,
        lineHeight: 1.4,
      }}
    >
      {parts.join(" · ")}
    </div>
  );
}
