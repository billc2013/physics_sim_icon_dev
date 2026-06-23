import { VIEWBOX_SIZE } from "../lib/colliderSchema.js";

// Renders a collider shape as a semi-transparent SVG overlay.
// Positioned absolutely over the parent container, which should be the
// same size as the SVG preview area in DetailModal.
//
// The overlay's viewBox matches the underlying SVG's viewBox so collider
// coordinates land exactly on the SVG content beneath. With non-square
// viewBoxes (e.g. 35×64 for a tall balloon after rescale), defaulting to
// 64×64 here would render the collider in a stretched coord space and
// it'd appear smaller and offset relative to the SVG.

const STROKE_COLOR = "#3B82F6"; // blue-500
const FILL_COLOR = "rgba(59, 130, 246, 0.15)";
const VERTEX_RADIUS = 1.5;

export default function ColliderPreview({
  collider,
  viewBoxWidth = VIEWBOX_SIZE,
  viewBoxHeight = VIEWBOX_SIZE,
}) {
  if (!collider) return null;

  return (
    <svg
      viewBox={`0 0 ${viewBoxWidth} ${viewBoxHeight}`}
      preserveAspectRatio="xMidYMid meet"
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        pointerEvents: "none",
      }}
    >
      {renderCollider(collider)}
    </svg>
  );
}

function renderCollider(collider, keyPrefix = "") {
  switch (collider.type) {
    case "circle":
      return (
        <circle
          key={`${keyPrefix}circle`}
          cx={collider.center[0]}
          cy={collider.center[1]}
          r={collider.radius}
          fill={FILL_COLOR}
          stroke={STROKE_COLOR}
          strokeWidth={0.8}
          strokeDasharray="2 1"
        />
      );

    case "box": {
      const x = collider.center[0] - collider.width / 2;
      const y = collider.center[1] - collider.height / 2;
      const transform = collider.angle
        ? `rotate(${(collider.angle * 180) / Math.PI} ${collider.center[0]} ${collider.center[1]})`
        : undefined;
      return (
        <rect
          key={`${keyPrefix}box`}
          x={x}
          y={y}
          width={collider.width}
          height={collider.height}
          transform={transform}
          fill={FILL_COLOR}
          stroke={STROKE_COLOR}
          strokeWidth={0.8}
          strokeDasharray="2 1"
        />
      );
    }

    case "convex": {
      const pts = collider.vertices.map((v) => v.join(",")).join(" ");
      return (
        <g key={`${keyPrefix}convex`}>
          <polygon
            points={pts}
            fill={FILL_COLOR}
            stroke={STROKE_COLOR}
            strokeWidth={0.8}
            strokeDasharray="2 1"
          />
          {collider.vertices.map(([x, y], i) => (
            <circle
              key={`${keyPrefix}v${i}`}
              cx={x}
              cy={y}
              r={VERTEX_RADIUS}
              fill={STROKE_COLOR}
            />
          ))}
        </g>
      );
    }

    case "compound":
      return (
        <g key={`${keyPrefix}compound`}>
          {collider.parts.map((part, i) =>
            renderCollider(part, `${keyPrefix}p${i}-`)
          )}
        </g>
      );

    default:
      return null;
  }
}
