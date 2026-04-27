// Collider schema definition and validation for physics engine integration.
//
// All coordinates are in SVG viewBox space (0–64). The downstream physics
// engine scales to meters at load time.
//
// Three engines are targeted: matter.js, Planck.js, and Rapier 2D.
// Planck.js is the binding constraint: max 8 vertices per convex polygon.
//
// Collider data is stored in physics_svgs.physical_properties.collider.

// --- Collider types ---
//
// "circle"   — { type, center: [x,y], radius }
// "box"      — { type, center: [x,y], width, height, angle? }
// "convex"   — { type, vertices: [[x,y], ...] }  (≤ 8 vertices)
// "compound" — { type, parts: [convex_collider, ...] }

export const COLLIDER_TYPES = ["circle", "box", "convex", "compound"];

// Planck.js (Box2D) hard limit per convex polygon.
export const MAX_CONVEX_VERTICES = 8;

// Default SVG viewBox size for this project.
export const VIEWBOX_SIZE = 64;

/**
 * Validate a collider object. Returns { valid: true } or
 * { valid: false, error: string }.
 */
export function validateCollider(collider) {
  if (!collider || typeof collider !== "object") {
    return { valid: false, error: "Collider must be a non-null object." };
  }

  if (!COLLIDER_TYPES.includes(collider.type)) {
    return {
      valid: false,
      error: `Unknown collider type "${collider.type}". Expected: ${COLLIDER_TYPES.join(", ")}.`,
    };
  }

  switch (collider.type) {
    case "circle":
      return validateCircle(collider);
    case "box":
      return validateBox(collider);
    case "convex":
      return validateConvex(collider);
    case "compound":
      return validateCompound(collider);
    default:
      return { valid: false, error: `Unhandled type "${collider.type}".` };
  }
}

function validateCircle(c) {
  if (!isPoint(c.center)) return { valid: false, error: "Circle needs center: [x, y]." };
  if (typeof c.radius !== "number" || c.radius <= 0) {
    return { valid: false, error: "Circle needs a positive radius." };
  }
  return { valid: true };
}

function validateBox(c) {
  if (!isPoint(c.center)) return { valid: false, error: "Box needs center: [x, y]." };
  if (typeof c.width !== "number" || c.width <= 0) {
    return { valid: false, error: "Box needs a positive width." };
  }
  if (typeof c.height !== "number" || c.height <= 0) {
    return { valid: false, error: "Box needs a positive height." };
  }
  if (c.angle !== undefined && typeof c.angle !== "number") {
    return { valid: false, error: "Box angle must be a number (radians)." };
  }
  return { valid: true };
}

function validateConvex(c) {
  if (!Array.isArray(c.vertices) || c.vertices.length < 3) {
    return { valid: false, error: "Convex needs at least 3 vertices." };
  }
  if (c.vertices.length > MAX_CONVEX_VERTICES) {
    return {
      valid: false,
      error: `Convex polygon has ${c.vertices.length} vertices; max is ${MAX_CONVEX_VERTICES} (Planck.js limit).`,
    };
  }
  for (let i = 0; i < c.vertices.length; i++) {
    if (!isPoint(c.vertices[i])) {
      return { valid: false, error: `Vertex ${i} is not a valid [x, y] pair.` };
    }
  }
  return { valid: true };
}

function validateCompound(c) {
  if (!Array.isArray(c.parts) || c.parts.length < 1) {
    return { valid: false, error: "Compound needs at least 1 part." };
  }
  for (let i = 0; i < c.parts.length; i++) {
    const partResult = validateCollider(c.parts[i]);
    if (!partResult.valid) {
      return { valid: false, error: `Part ${i}: ${partResult.error}` };
    }
  }
  return { valid: true };
}

function isPoint(p) {
  return (
    Array.isArray(p) &&
    p.length === 2 &&
    typeof p[0] === "number" &&
    typeof p[1] === "number"
  );
}

// ---- Editing helpers ----

/**
 * Convert any collider type to an editable vertex array. The editor works
 * on polygon vertices uniformly; this converts circle/box to polygons first.
 *
 * Returns [[x,y], ...] or null if the collider can't be edited (e.g.,
 * compound — not yet supported in the vertex editor).
 */
export function colliderToEditableVertices(collider) {
  if (!collider) return null;

  switch (collider.type) {
    case "circle": {
      // Sample 8 points around the circle (Planck.js max).
      const [cx, cy] = collider.center;
      const r = collider.radius;
      const pts = [];
      for (let i = 0; i < MAX_CONVEX_VERTICES; i++) {
        const angle = (2 * Math.PI * i) / MAX_CONVEX_VERTICES;
        pts.push([round(cx + r * Math.cos(angle)), round(cy + r * Math.sin(angle))]);
      }
      return pts;
    }

    case "box": {
      const [cx, cy] = collider.center;
      const hw = collider.width / 2;
      const hh = collider.height / 2;
      const corners = [
        [cx - hw, cy - hh],
        [cx + hw, cy - hh],
        [cx + hw, cy + hh],
        [cx - hw, cy + hh],
      ];
      if (collider.angle) {
        const cos = Math.cos(collider.angle);
        const sin = Math.sin(collider.angle);
        return corners.map(([x, y]) => {
          const dx = x - cx;
          const dy = y - cy;
          return [round(cx + dx * cos - dy * sin), round(cy + dx * sin + dy * cos)];
        });
      }
      return corners.map(([x, y]) => [round(x), round(y)]);
    }

    case "convex":
      return collider.vertices.map(([x, y]) => [x, y]); // clone

    case "compound":
      return null; // not yet editable as a single polygon

    default:
      return null;
  }
}

/**
 * Check whether a polygon (vertex array) is convex.
 * All three target physics engines require convex polygons — a concave
 * result after editing needs decomposition or manual correction.
 */
export function isConvexPolygon(vertices) {
  const n = vertices.length;
  if (n < 3) return false;
  let sign = 0;
  for (let i = 0; i < n; i++) {
    const a = vertices[i];
    const b = vertices[(i + 1) % n];
    const c = vertices[(i + 2) % n];
    const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (cross !== 0) {
      if (sign === 0) sign = Math.sign(cross);
      else if (Math.sign(cross) !== sign) return false;
    }
  }
  return true;
}

function round(n) {
  return Math.round(n * 100) / 100;
}
