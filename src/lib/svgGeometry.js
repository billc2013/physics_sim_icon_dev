// SVG geometry utilities for verifying that a stored SVG's coordinate
// space matches our expected 64×64 viewBox, and for reporting content
// and collider bounds in that coordinate space.
//
// Why this matters: GIST imports an SVG + a collider and scales them
// together using the SVG's viewBox. If the SVG's viewBox is, say, 100×100
// while the collider is stored in 64×64 coords (our convention), the two
// will scale differently and the physics won't match the visuals.
//
// These helpers are pure functions; the display logic lives in
// GeometryInfo.jsx.

import { VIEWBOX_SIZE } from "./colliderSchema.js";
import { extractFilledVertices } from "./colliderGenerator.js";

/**
 * Parse the viewBox from SVG markup. Falls back to the width/height
 * attributes if viewBox isn't set (an SVG without viewBox effectively
 * uses its pixel dimensions as its coordinate system).
 *
 * Returns `{x, y, width, height, source}` where source is:
 *   "viewBox" — parsed from the viewBox attribute
 *   "size"    — inferred from width/height attributes
 *   null if neither is available or valid.
 */
export function parseViewBox(svgMarkup) {
  if (!svgMarkup) return null;
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgMarkup, "image/svg+xml");
  const svg = doc.querySelector("svg");
  if (!svg) return null;

  const vb = svg.getAttribute("viewBox");
  if (vb) {
    const parts = vb.trim().split(/[\s,]+/).map(Number);
    if (parts.length >= 4 && parts.every((n) => !isNaN(n))) {
      return {
        x: parts[0],
        y: parts[1],
        width: parts[2],
        height: parts[3],
        source: "viewBox",
      };
    }
  }

  // Fallback: infer from width/height. Strip unit suffixes like "px".
  const w = parseFloat(svg.getAttribute("width"));
  const h = parseFloat(svg.getAttribute("height"));
  if (w && h && !isNaN(w) && !isNaN(h)) {
    return { x: 0, y: 0, width: w, height: h, source: "size" };
  }

  return null;
}

/**
 * Check whether the SVG's viewBox matches our expected 64×64 standard.
 *
 * Returns:
 *   { ok: true, viewBox }                              — good
 *   { ok: false, reason, viewBox, message }            — bad, with details
 *
 * Reasons: "missing" | "size-mismatch" | "origin-mismatch"
 */
export function checkViewBoxMatch(svgMarkup) {
  const vb = parseViewBox(svgMarkup);
  if (!vb) {
    return {
      ok: false,
      reason: "missing",
      viewBox: null,
      message: "No viewBox or width/height found. GIST can't know the scale.",
    };
  }
  if (vb.width !== VIEWBOX_SIZE || vb.height !== VIEWBOX_SIZE) {
    return {
      ok: false,
      reason: "size-mismatch",
      viewBox: vb,
      message: `viewBox is ${vb.width}×${vb.height}, expected ${VIEWBOX_SIZE}×${VIEWBOX_SIZE}. Collider coords won't align.`,
    };
  }
  if (vb.x !== 0 || vb.y !== 0) {
    return {
      ok: false,
      reason: "origin-mismatch",
      viewBox: vb,
      message: `viewBox origin is (${vb.x}, ${vb.y}), expected (0, 0). Collider coords won't align.`,
    };
  }
  return { ok: true, viewBox: vb };
}

/**
 * Bounding box of all filled element geometry in the SVG, expressed in
 * the SVG's own coordinate space. Useful for answering "where is the
 * drawing actually sitting within the viewBox?"
 *
 * Returns `{ min: [x,y], max: [x,y] }` or null if no filled geometry.
 */
export function getContentBounds(svgMarkup) {
  const points = extractFilledVertices(svgMarkup);
  if (!points || points.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of points) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { min: [round1(minX), round1(minY)], max: [round1(maxX), round1(maxY)] };
}

/**
 * Bounding box of a collider, regardless of type. For compound colliders
 * this is the union of all parts' bounds.
 *
 * Returns `{ min: [x,y], max: [x,y] }` or null if the collider has no
 * well-defined bounds.
 */
export function getColliderBounds(collider) {
  if (!collider) return null;

  switch (collider.type) {
    case "circle": {
      const [cx, cy] = collider.center;
      const r = collider.radius;
      return {
        min: [round1(cx - r), round1(cy - r)],
        max: [round1(cx + r), round1(cy + r)],
      };
    }
    case "box": {
      const [cx, cy] = collider.center;
      const hw = collider.width / 2;
      const hh = collider.height / 2;
      return {
        min: [round1(cx - hw), round1(cy - hh)],
        max: [round1(cx + hw), round1(cy + hh)],
      };
    }
    case "convex":
      return boundsFromPoints(collider.vertices);
    case "compound": {
      const partBounds = collider.parts
        .map(getColliderBounds)
        .filter((b) => b !== null);
      if (partBounds.length === 0) return null;
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const b of partBounds) {
        if (b.min[0] < minX) minX = b.min[0];
        if (b.min[1] < minY) minY = b.min[1];
        if (b.max[0] > maxX) maxX = b.max[0];
        if (b.max[1] > maxY) maxY = b.max[1];
      }
      return {
        min: [round1(minX), round1(minY)],
        max: [round1(maxX), round1(maxY)],
      };
    }
    default:
      return null;
  }
}

function boundsFromPoints(points) {
  if (!points || points.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of points) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { min: [round1(minX), round1(minY)], max: [round1(maxX), round1(maxY)] };
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

// Container elements that don't render visible geometry on their own.
// We skip them when computing the rescale bbox AND we leave them as
// direct children of the <svg> rather than moving them into the transform
// group (transforming a <defs> would silently shift gradient/pattern
// coordinates that other elements reference).
const NON_RENDERING_TAGS = new Set([
  "defs",
  "style",
  "title",
  "desc",
  "metadata",
  "clipPath",
  "mask",
  "linearGradient",
  "radialGradient",
  "pattern",
  "filter",
  "marker",
  "symbol",
  "view",
  "hatch",
]);

/**
 * Scale and recenter the SVG's content so its rendered bounding box fills
 * the canonical 64×64 viewBox while preserving aspect ratio. Content is
 * wrapped in a single <g transform="translate(...) scale(...)"> and the
 * viewBox/width/height are normalized to 64.
 *
 * Why getBBox() and not vertex extraction: getBBox returns the true
 * rendered bbox including stroke widths, text glyphs, and the effect of
 * any pre-existing transforms on child elements. Vertex extraction
 * (extractFilledVertices) only sees path/shape geometry and would
 * mis-fit anything with strokes or text.
 *
 * Implementation note: getBBox() requires the element to be attached to
 * a Document, so we mount into a hidden host on document.body and tear
 * down before returning. Throws if called outside a browser environment.
 *
 * Returns `{ svg: newMarkup, scale, tx, ty }` on success, or null if the
 * SVG had no measurable content.
 */
export function rescaleToFitViewBox(svgMarkup) {
  if (typeof document === "undefined") {
    throw new Error("rescaleToFitViewBox requires a browser environment");
  }
  if (!svgMarkup) return null;

  const host = document.createElement("div");
  host.setAttribute("aria-hidden", "true");
  host.style.cssText =
    "position:absolute;left:-9999px;top:-9999px;width:0;height:0;visibility:hidden;";
  host.innerHTML = svgMarkup;
  const svg = host.querySelector("svg");
  if (!svg) return null;

  document.body.appendChild(host);
  try {
    const renderable = [];
    for (const child of Array.from(svg.children)) {
      if (!NON_RENDERING_TAGS.has(child.tagName)) renderable.push(child);
    }
    if (renderable.length === 0) return null;

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const el of renderable) {
      let b = null;
      try {
        b = el.getBBox();
      } catch {
        continue;
      }
      if (!b) continue;
      // Skip degenerate boxes (e.g. an empty <g>). 0×0 carries no info but
      // its x/y would distort the union toward (0,0).
      if (b.width === 0 && b.height === 0) continue;
      if (b.x < minX) minX = b.x;
      if (b.y < minY) minY = b.y;
      if (b.x + b.width > maxX) maxX = b.x + b.width;
      if (b.y + b.height > maxY) maxY = b.y + b.height;
    }
    if (!Number.isFinite(minX)) return null;

    const w = maxX - minX;
    const h = maxY - minY;
    if (w <= 0 || h <= 0) return null;

    const scale = Math.min(VIEWBOX_SIZE / w, VIEWBOX_SIZE / h);
    const tx = VIEWBOX_SIZE / 2 - (minX + w / 2) * scale;
    const ty = VIEWBOX_SIZE / 2 - (minY + h / 2) * scale;

    const round = (n) => Number(n.toFixed(4));
    const transform = `translate(${round(tx)} ${round(ty)}) scale(${round(scale)})`;

    // Wrap renderable children in a single transform group. defs/style
    // and friends remain in place as direct children of <svg>.
    const SVG_NS = "http://www.w3.org/2000/svg";
    const g = document.createElementNS(SVG_NS, "g");
    g.setAttribute("transform", transform);
    for (const el of renderable) {
      svg.removeChild(el);
      g.appendChild(el);
    }
    svg.appendChild(g);
    svg.setAttribute("viewBox", `0 0 ${VIEWBOX_SIZE} ${VIEWBOX_SIZE}`);
    // Drop any pre-existing width/height. They'd render the SVG at fixed
    // pixel size regardless of container (e.g. width="64" in a 180-px
    // preview makes the drawing look tiny), and downstream consumers
    // (GIST, the export zip) read viewBox, not width/height.
    svg.removeAttribute("width");
    svg.removeAttribute("height");

    const newMarkup = new XMLSerializer().serializeToString(svg);
    return { svg: newMarkup, scale: round(scale), tx: round(tx), ty: round(ty) };
  } finally {
    document.body.removeChild(host);
  }
}
