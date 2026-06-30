// Collider schema definition and validation for physics engine integration.
//
// All coordinates are in SVG viewBox space (0–64). The downstream physics
// engine scales to meters at load time.
//
// Two engines are targeted downstream: Planck.js and Rapier 2D. (matter.js was
// removed from gist on 2026-05-11; legacy configs coerce to Rapier.) The
// 8-vertex cap exists SOLELY for Planck, which consumes each convex polygon
// directly with a hard b2_maxPolygonVertices = 8 limit; Rapier re-hulls each
// part and has no such limit.
//
// CRUCIAL LAYERING: the 8-vertex limit is a per-convex-polygon, *post-
// decomposition* property. It applies to convex/box/circle shapes Planck eats
// directly — NOT to concave outlines, which gist decomposes into ≤8-vertex
// parts at load (via poly-decomp, a dependency we deliberately do NOT add
// here). So this repo enforces ≤8 only for genuinely-convex polygons; concave
// outlines (stored as type:"convex" — the accepted misnomer) are validated as
// simple closed rings, and the per-part limit is owned by gist where the
// decomposition actually runs. See Dev_Tasks.md → Task 12.
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
  for (let i = 0; i < c.vertices.length; i++) {
    if (!isPoint(c.vertices[i])) {
      return { valid: false, error: `Vertex ${i} is not a valid [x, y] pair.` };
    }
  }

  // The 8-vertex cap is the wrong layer for concave outlines (gist decomposes
  // those downstream into ≤8-vertex parts), so apply it only to genuinely-
  // convex polygons — the shapes Planck consumes directly. Concave outlines
  // just have to be a simple (non-self-intersecting) closed ring; the per-part
  // limit is gist's to enforce after decomposition. See the file header.
  if (isConvexPolygon(c.vertices)) {
    if (c.vertices.length > MAX_CONVEX_VERTICES) {
      return {
        valid: false,
        error: `Convex polygon has ${c.vertices.length} vertices; max is ${MAX_CONVEX_VERTICES} (Planck.js limit). Reshape into a concave outline to decompose downstream, or remove vertices.`,
      };
    }
  } else if (!isSimplePolygon(c.vertices)) {
    return {
      valid: false,
      error: "Concave outline self-intersects; it must be a simple closed ring for gist to decompose it.",
    };
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

/**
 * Check whether a polygon (vertex array) is "simple" — a closed ring whose
 * non-adjacent edges don't cross. This is the validity condition that matters
 * for concave outlines: poly-decomp (downstream in gist) can only decompose a
 * simple polygon. Convex polygons are always simple; this is the meaningful
 * gate for the concave outlines that bypass the 8-vertex cap.
 *
 * O(n²) proper-crossing test — fine for our ≤ ~30-vertex outlines. Shared
 * vertices between adjacent edges are not crossings, so adjacency is skipped.
 */
export function isSimplePolygon(vertices) {
  const n = vertices.length;
  if (n < 3) return false;
  for (let i = 0; i < n; i++) {
    const a1 = vertices[i];
    const a2 = vertices[(i + 1) % n];
    for (let j = i + 1; j < n; j++) {
      // Skip edges that share a vertex with edge i (adjacent, incl. wrap).
      if (j === i) continue;
      if ((i + 1) % n === j || (j + 1) % n === i) continue;
      const b1 = vertices[j];
      const b2 = vertices[(j + 1) % n];
      if (segmentsProperlyIntersect(a1, a2, b1, b2)) return false;
    }
  }
  return true;
}

function segmentsProperlyIntersect(p1, p2, p3, p4) {
  const d1 = Math.sign(orient(p3, p4, p1));
  const d2 = Math.sign(orient(p3, p4, p2));
  const d3 = Math.sign(orient(p1, p2, p3));
  const d4 = Math.sign(orient(p1, p2, p4));
  return d1 !== d2 && d3 !== d4;
}

function orient(p, q, r) {
  return (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
}

function round(n) {
  return Math.round(n * 100) / 100;
}

/**
 * Planck-readiness verdict for a collider, computed at AUTHORING time (here),
 * where only the raw outline is visible — gist runs poly-decomp, this repo
 * deliberately does not. Returns { level: "ok" | "warn" | "fail", message }.
 *
 * The ruleset is exact except for one deferred case, because quickDecomp
 * (Bayazit) only connects EXISTING vertices with diagonals — it never adds
 * Steiner points — so every decomposed part's vertices are a subset of the
 * outline's:
 *   - circle / box                 → ok   (Planck-native)
 *   - convex, ≤8 verts             → ok
 *   - convex, >8 verts             → fail (decomposition can't reduce a convex
 *                                    polygon; it stays one >8-gon)
 *   - concave outline, ≤8 verts    → ok   (every part is a subset ⇒ all ≤8)
 *   - concave outline, >8 verts    → warn (a part MIGHT exceed 8; only gist's
 *                                    dev build can confirm post-decomposition)
 *   - compound                     → worst part wins
 *
 * Planck silently accepts >8-vertex polygons (no throw) with undefined Box2D
 * behavior, so "fail" is a quiet correctness bug, not a crash — hence the
 * authoring-time warning. See Dev_Tasks.md → Task 12.
 */
export function planckReadiness(collider) {
  if (!collider || typeof collider !== "object") {
    return { level: "warn", message: "No collider." };
  }

  switch (collider.type) {
    case "circle":
    case "box":
      return { level: "ok", message: `Planck-safe (${collider.type}).` };

    case "convex": {
      const verts = Array.isArray(collider.vertices) ? collider.vertices : [];
      const n = verts.length;
      if (isConvexPolygon(verts)) {
        if (n > MAX_CONVEX_VERTICES) {
          return {
            level: "fail",
            message: `Planck: convex ${n}-gon exceeds the ${MAX_CONVEX_VERTICES}-vertex cap — decomposition won't help. Use a circle or a ≤${MAX_CONVEX_VERTICES}-vertex hull.`,
          };
        }
        return { level: "ok", message: `Planck-safe (convex, ${n} verts).` };
      }
      // Concave outline — gist decomposes it downstream.
      if (n <= MAX_CONVEX_VERTICES) {
        return {
          level: "ok",
          message: `Planck-safe (concave, ${n} verts — every decomposed part is ≤${MAX_CONVEX_VERTICES}).`,
        };
      }
      return {
        level: "warn",
        message: `Planck: concave outline with ${n} verts — a part may exceed ${MAX_CONVEX_VERTICES} after decomposition. Verify in gist's dev build.`,
      };
    }

    case "compound": {
      const parts = Array.isArray(collider.parts) ? collider.parts : [];
      const verdicts = parts.map(planckReadiness);
      if (verdicts.some((v) => v.level === "fail")) {
        return {
          level: "fail",
          message: `Planck: a compound part exceeds the ${MAX_CONVEX_VERTICES}-vertex cap.`,
        };
      }
      if (verdicts.some((v) => v.level === "warn")) {
        return {
          level: "warn",
          message: `Planck: a compound part may exceed ${MAX_CONVEX_VERTICES} verts — verify in gist's dev build.`,
        };
      }
      return { level: "ok", message: `Planck-safe (compound, ${parts.length} parts).` };
    }

    default:
      return { level: "warn", message: `Unknown collider type "${collider.type}".` };
  }
}

/**
 * Apply a uniform scale + translate to every coordinate in a collider.
 * Used by the SVG rescale-to-fit flow to keep an aligned collider aligned
 * after the SVG's content has been moved/scaled within its viewBox.
 *
 * Math: for any point p, p' = p * scale + (tx, ty). For circles/boxes the
 * size scales but the angle is preserved (uniform scale).
 *
 * Returns a new collider; does not mutate the input. Returns null for an
 * unrecognized type.
 */
export function transformCollider(collider, scale, tx, ty) {
  if (!collider) return null;
  const px = (x) => round(x * scale + tx);
  const py = (y) => round(y * scale + ty);
  const sz = (n) => round(n * scale);

  switch (collider.type) {
    case "circle":
      return {
        ...collider,
        center: [px(collider.center[0]), py(collider.center[1])],
        radius: sz(collider.radius),
      };
    case "box":
      return {
        ...collider,
        center: [px(collider.center[0]), py(collider.center[1])],
        width: sz(collider.width),
        height: sz(collider.height),
      };
    case "convex":
      return {
        ...collider,
        vertices: collider.vertices.map(([x, y]) => [px(x), py(y)]),
      };
    case "compound":
      return {
        ...collider,
        parts: collider.parts
          .map((p) => transformCollider(p, scale, tx, ty))
          .filter(Boolean),
      };
    default:
      return null;
  }
}
