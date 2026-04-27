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
