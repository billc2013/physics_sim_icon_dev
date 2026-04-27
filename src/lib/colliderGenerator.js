// Programmatic SVG → collider polygon generator.
//
// Parses SVG markup in the browser via DOMParser, extracts filled shape
// outlines as vertex arrays, then picks the simplest collider that fits:
//   1. Circle — if the outline is roughly circular
//   2. Box — if the outline is roughly rectangular
//   3. Convex polygon — convex hull, simplified to ≤ 8 vertices
//
// No external dependencies. All geometry routines are inlined below.

import { MAX_CONVEX_VERTICES, VIEWBOX_SIZE } from "./colliderSchema.js";

// ---- Public API ----

/**
 * Generate a best-guess collider from SVG markup.
 *
 * @param {string} svgMarkup - The raw SVG string (64×64 viewBox expected).
 * @returns {{ collider: object, debug: object }} The collider object ready for
 *   storage in physical_properties, plus debug info for the preview overlay.
 */
export function generateCollider(svgMarkup) {
  const points = extractFilledVertices(svgMarkup);

  if (points.length < 3) {
    // Not enough geometry to form a collider — fallback to a bounding box
    // that covers the entire viewBox.
    return {
      collider: {
        type: "box",
        center: [VIEWBOX_SIZE / 2, VIEWBOX_SIZE / 2],
        width: VIEWBOX_SIZE,
        height: VIEWBOX_SIZE,
      },
      debug: { extractedPoints: points.length, strategy: "fallback-full-box" },
    };
  }

  const hull = convexHull(points);

  // Try fitting simple primitives first — cheaper at runtime and more
  // semantically correct for physics simulation.
  const circleFit = fitCircle(hull);
  if (circleFit) {
    return {
      collider: circleFit,
      debug: { extractedPoints: points.length, hullPoints: hull.length, strategy: "circle" },
    };
  }

  const boxFit = fitBox(hull);
  if (boxFit) {
    return {
      collider: boxFit,
      debug: { extractedPoints: points.length, hullPoints: hull.length, strategy: "box" },
    };
  }

  // General convex polygon, simplified to the Planck.js vertex limit.
  const simplified = simplifyPolygon(hull, MAX_CONVEX_VERTICES);
  return {
    collider: {
      type: "convex",
      vertices: simplified.map(([x, y]) => [round2(x), round2(y)]),
    },
    debug: {
      extractedPoints: points.length,
      hullPoints: hull.length,
      simplifiedTo: simplified.length,
      strategy: "convex-hull",
    },
  };
}

// ---- SVG Parsing ----

/**
 * Parse SVG markup and extract vertices from all filled shape elements.
 * Skips elements with fill="none" and <line> elements (stroke-only).
 *
 * Exported so svgGeometry.js can reuse it for content-bounds calculation.
 */
export function extractFilledVertices(svgMarkup) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgMarkup, "image/svg+xml");
  const svg = doc.querySelector("svg");
  if (!svg) return [];

  const points = [];
  const elements = svg.querySelectorAll("circle, ellipse, rect, polygon, path");

  for (const el of elements) {
    // Skip unfilled elements — they're typically decorative strokes.
    const fill = el.getAttribute("fill");
    if (fill === "none") continue;

    const tag = el.tagName.toLowerCase();
    let verts = [];

    switch (tag) {
      case "circle":
        verts = circleToVertices(el);
        break;
      case "ellipse":
        verts = ellipseToVertices(el);
        break;
      case "rect":
        verts = rectToVertices(el);
        break;
      case "polygon":
        verts = polygonToVertices(el);
        break;
      case "path":
        verts = pathToVertices(el);
        break;
    }

    // Apply transform if present (only simple rotate() used in this codebase).
    const transform = el.getAttribute("transform");
    if (transform) {
      verts = applyTransform(verts, transform);
    }

    points.push(...verts);
  }

  return points;
}

function circleToVertices(el, n = 16) {
  const cx = num(el, "cx");
  const cy = num(el, "cy");
  const r = num(el, "r");
  return sampleEllipse(cx, cy, r, r, n);
}

function ellipseToVertices(el, n = 16) {
  const cx = num(el, "cx");
  const cy = num(el, "cy");
  const rx = num(el, "rx");
  const ry = num(el, "ry");
  return sampleEllipse(cx, cy, rx, ry, n);
}

function sampleEllipse(cx, cy, rx, ry, n) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const angle = (2 * Math.PI * i) / n;
    pts.push([cx + rx * Math.cos(angle), cy + ry * Math.sin(angle)]);
  }
  return pts;
}

function rectToVertices(el) {
  const x = num(el, "x");
  const y = num(el, "y");
  const w = num(el, "width");
  const h = num(el, "height");
  return [
    [x, y],
    [x + w, y],
    [x + w, y + h],
    [x, y + h],
  ];
}

function polygonToVertices(el) {
  const raw = el.getAttribute("points") || "";
  return raw
    .trim()
    .split(/\s+/)
    .map((pair) => {
      const [x, y] = pair.split(",").map(Number);
      return [x, y];
    })
    .filter(([x, y]) => !isNaN(x) && !isNaN(y));
}

// ---- Path d-attribute parser ----
// Handles M, L, H, V, Q, C, Z (both absolute and relative).
// Bezier curves are flattened by sampling.

function pathToVertices(el) {
  const d = el.getAttribute("d") || "";
  return parsePath(d);
}

function parsePath(d) {
  // Tokenize: split into commands + numbers. Insert implicit separators
  // between a letter and a digit or sign.
  const tokens = [];
  const re = /([MmLlHhVvQqCcZz])|([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/g;
  let match;
  while ((match = re.exec(d)) !== null) {
    tokens.push(match[0]);
  }

  const points = [];
  let cx = 0,
    cy = 0; // current point
  let i = 0;

  function nextNum() {
    return i < tokens.length ? parseFloat(tokens[i++]) : 0;
  }

  while (i < tokens.length) {
    const cmd = tokens[i];
    // If token is not a command letter, it's an implicit repeat of the
    // previous command (common in SVG paths).
    if (/^[MmLlHhVvQqCcZz]$/.test(cmd)) {
      i++;
    } else {
      // Implicit lineto after moveto, or repeated command.
      // SVG spec: after M, implicit commands are L; after m, implicit l.
      // For simplicity, treat as lineto.
      const x = nextNum();
      const y = nextNum();
      cx = x;
      cy = y;
      points.push([cx, cy]);
      continue;
    }

    switch (cmd) {
      case "M":
        cx = nextNum();
        cy = nextNum();
        points.push([cx, cy]);
        // Subsequent coordinate pairs are implicit lineto.
        while (i < tokens.length && /^[+-.\d]/.test(tokens[i])) {
          cx = nextNum();
          cy = nextNum();
          points.push([cx, cy]);
        }
        break;
      case "m":
        cx += nextNum();
        cy += nextNum();
        points.push([cx, cy]);
        while (i < tokens.length && /^[+-.\d]/.test(tokens[i])) {
          cx += nextNum();
          cy += nextNum();
          points.push([cx, cy]);
        }
        break;
      case "L":
        while (i < tokens.length && /^[+-.\d]/.test(tokens[i])) {
          cx = nextNum();
          cy = nextNum();
          points.push([cx, cy]);
        }
        break;
      case "l":
        while (i < tokens.length && /^[+-.\d]/.test(tokens[i])) {
          cx += nextNum();
          cy += nextNum();
          points.push([cx, cy]);
        }
        break;
      case "H":
        while (i < tokens.length && /^[+-.\d]/.test(tokens[i])) {
          cx = nextNum();
          points.push([cx, cy]);
        }
        break;
      case "h":
        while (i < tokens.length && /^[+-.\d]/.test(tokens[i])) {
          cx += nextNum();
          points.push([cx, cy]);
        }
        break;
      case "V":
        while (i < tokens.length && /^[+-.\d]/.test(tokens[i])) {
          cy = nextNum();
          points.push([cx, cy]);
        }
        break;
      case "v":
        while (i < tokens.length && /^[+-.\d]/.test(tokens[i])) {
          cy += nextNum();
          points.push([cx, cy]);
        }
        break;
      case "Q": {
        // Quadratic Bezier: flatten to line segments.
        while (i < tokens.length && /^[+-.\d]/.test(tokens[i])) {
          const cpx = nextNum();
          const cpy = nextNum();
          const ex = nextNum();
          const ey = nextNum();
          flattenQuadratic(cx, cy, cpx, cpy, ex, ey, points);
          cx = ex;
          cy = ey;
        }
        break;
      }
      case "q": {
        while (i < tokens.length && /^[+-.\d]/.test(tokens[i])) {
          const cpx = cx + nextNum();
          const cpy = cy + nextNum();
          const ex = cx + nextNum();
          const ey = cy + nextNum();
          flattenQuadratic(cx, cy, cpx, cpy, ex, ey, points);
          cx = ex;
          cy = ey;
        }
        break;
      }
      case "C": {
        // Cubic Bezier: flatten to line segments.
        while (i < tokens.length && /^[+-.\d]/.test(tokens[i])) {
          const cp1x = nextNum();
          const cp1y = nextNum();
          const cp2x = nextNum();
          const cp2y = nextNum();
          const ex = nextNum();
          const ey = nextNum();
          flattenCubic(cx, cy, cp1x, cp1y, cp2x, cp2y, ex, ey, points);
          cx = ex;
          cy = ey;
        }
        break;
      }
      case "c": {
        while (i < tokens.length && /^[+-.\d]/.test(tokens[i])) {
          const cp1x = cx + nextNum();
          const cp1y = cy + nextNum();
          const cp2x = cx + nextNum();
          const cp2y = cy + nextNum();
          const ex = cx + nextNum();
          const ey = cy + nextNum();
          flattenCubic(cx, cy, cp1x, cp1y, cp2x, cp2y, ex, ey, points);
          cx = ex;
          cy = ey;
        }
        break;
      }
      case "Z":
      case "z":
        // Close path — no new vertices needed for collider purposes.
        break;
    }
  }

  return points;
}

/** Sample a quadratic Bezier into 4 line segments. */
function flattenQuadratic(x0, y0, cpx, cpy, x1, y1, out, segments = 4) {
  for (let s = 1; s <= segments; s++) {
    const t = s / segments;
    const mt = 1 - t;
    out.push([
      mt * mt * x0 + 2 * mt * t * cpx + t * t * x1,
      mt * mt * y0 + 2 * mt * t * cpy + t * t * y1,
    ]);
  }
}

/** Sample a cubic Bezier into 6 line segments. */
function flattenCubic(x0, y0, cp1x, cp1y, cp2x, cp2y, x1, y1, out, segments = 6) {
  for (let s = 1; s <= segments; s++) {
    const t = s / segments;
    const mt = 1 - t;
    out.push([
      mt * mt * mt * x0 + 3 * mt * mt * t * cp1x + 3 * mt * t * t * cp2x + t * t * t * x1,
      mt * mt * mt * y0 + 3 * mt * mt * t * cp1y + 3 * mt * t * t * cp2y + t * t * t * y1,
    ]);
  }
}

// ---- Transform handling ----
// Only handles rotate(angle) and rotate(angle, cx, cy) since that's all
// the seed data uses. Extend if other transforms appear.

function applyTransform(vertices, transformStr) {
  const rotateMatch = transformStr.match(
    /rotate\(\s*([+-]?\d+\.?\d*)\s*(?:,?\s*([+-]?\d+\.?\d*)\s*,?\s*([+-]?\d+\.?\d*))?\s*\)/
  );
  if (!rotateMatch) return vertices;

  const angleDeg = parseFloat(rotateMatch[1]);
  const pivotX = rotateMatch[2] !== undefined ? parseFloat(rotateMatch[2]) : 0;
  const pivotY = rotateMatch[3] !== undefined ? parseFloat(rotateMatch[3]) : 0;
  const rad = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  return vertices.map(([x, y]) => {
    const dx = x - pivotX;
    const dy = y - pivotY;
    return [pivotX + dx * cos - dy * sin, pivotY + dx * sin + dy * cos];
  });
}

// ---- Convex hull (Andrew's monotone chain) ----

function convexHull(points) {
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (sorted.length <= 2) return sorted;

  const cross = (o, a, b) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

  // Lower hull
  const lower = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }

  // Upper hull
  const upper = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }

  // Remove last point of each half because it's repeated.
  lower.pop();
  upper.pop();

  return lower.concat(upper);
}

// ---- Primitive fitting ----

/** Try to fit a circle collider. Returns the collider or null. */
function fitCircle(hull) {
  if (hull.length < 6) return null; // too few points to reliably detect a circle

  // Centroid
  let cx = 0,
    cy = 0;
  for (const [x, y] of hull) {
    cx += x;
    cy += y;
  }
  cx /= hull.length;
  cy /= hull.length;

  // Compute distances from centroid to each hull point.
  const distances = hull.map(([x, y]) => Math.hypot(x - cx, y - cy));
  const meanR = distances.reduce((a, b) => a + b, 0) / distances.length;
  if (meanR < 2) return null; // degenerate

  // Check if all distances are within 15% of the mean → roughly circular.
  const maxDeviation = Math.max(...distances.map((d) => Math.abs(d - meanR) / meanR));
  if (maxDeviation > 0.15) return null;

  return {
    type: "circle",
    center: [round2(cx), round2(cy)],
    radius: round2(meanR),
  };
}

/** Try to fit an axis-aligned box collider. Returns the collider or null. */
function fitBox(hull) {
  if (hull.length < 4) return null;

  // Bounding box of the hull.
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const [x, y] of hull) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }

  const bboxW = maxX - minX;
  const bboxH = maxY - minY;
  if (bboxW < 2 || bboxH < 2) return null;

  // Compute the area of the convex hull (Shoelace formula) and compare
  // to the bounding box area. If > 90% coverage → box is a good fit.
  const hullArea = polygonArea(hull);
  const bboxArea = bboxW * bboxH;
  const coverage = hullArea / bboxArea;

  if (coverage < 0.90) return null;

  return {
    type: "box",
    center: [round2((minX + maxX) / 2), round2((minY + maxY) / 2)],
    width: round2(bboxW),
    height: round2(bboxH),
  };
}

function polygonArea(vertices) {
  let area = 0;
  for (let i = 0; i < vertices.length; i++) {
    const j = (i + 1) % vertices.length;
    area += vertices[i][0] * vertices[j][1];
    area -= vertices[j][0] * vertices[i][1];
  }
  return Math.abs(area) / 2;
}

// ---- Polygon simplification (Ramer-Douglas-Peucker) ----

/**
 * Reduce a convex polygon to at most `maxVerts` vertices while preserving
 * the overall shape. Uses iterative RDP with increasing tolerance until
 * the vertex count is within the limit.
 */
function simplifyPolygon(hull, maxVerts) {
  if (hull.length <= maxVerts) return hull;

  // For a closed polygon, we run RDP on the point list and then check
  // the count. Increase tolerance until we're under the limit.
  let tolerance = 0.5;
  let result = hull;
  for (let attempt = 0; attempt < 20; attempt++) {
    result = rdpSimplify(hull, tolerance);
    if (result.length <= maxVerts) break;
    tolerance *= 1.5;
  }

  // If RDP still gives too many, evenly subsample.
  if (result.length > maxVerts) {
    result = evenSubsample(result, maxVerts);
  }

  return result;
}

function rdpSimplify(points, epsilon) {
  if (points.length <= 2) return points;

  // Find the point farthest from the line between first and last.
  const first = points[0];
  const last = points[points.length - 1];
  let maxDist = 0;
  let maxIndex = 0;

  for (let i = 1; i < points.length - 1; i++) {
    const d = pointToLineDist(points[i], first, last);
    if (d > maxDist) {
      maxDist = d;
      maxIndex = i;
    }
  }

  if (maxDist > epsilon) {
    const left = rdpSimplify(points.slice(0, maxIndex + 1), epsilon);
    const right = rdpSimplify(points.slice(maxIndex), epsilon);
    return left.slice(0, -1).concat(right);
  }
  return [first, last];
}

function pointToLineDist([px, py], [ax, ay], [bx, by]) {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function evenSubsample(points, n) {
  const result = [];
  for (let i = 0; i < n; i++) {
    const idx = Math.round((i * (points.length - 1)) / (n - 1));
    result.push(points[idx]);
  }
  return result;
}

// ---- Utilities ----

function num(el, attr) {
  return parseFloat(el.getAttribute(attr)) || 0;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}
