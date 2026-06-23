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
import {
  computeColliderForType,
  extractFilledVertices,
} from "./colliderGenerator.js";

// LLM collider type contract: the system prompt instructs Claude to pick
// from this set. Anything else (e.g. "compound", a typo, undefined) falls
// back to "convex" inside normalizeForInsert.
const ALLOWED_LLM_TYPES = ["circle", "box", "convex"];

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
 * Check whether the SVG's viewBox matches our convention: origin at (0, 0)
 * with the longer dimension equal to VIEWBOX_SIZE (64). The shorter
 * dimension may be smaller — that's how Rescale produces a tight viewBox
 * for non-square content (e.g. a horizontal arrow becomes 64×15).
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
  if (vb.width <= 0 || vb.height <= 0) {
    return {
      ok: false,
      reason: "size-mismatch",
      viewBox: vb,
      message: `viewBox dimensions must be positive (got ${vb.width}×${vb.height}).`,
    };
  }
  const maxDim = Math.max(vb.width, vb.height);
  if (Math.abs(maxDim - VIEWBOX_SIZE) > 0.5) {
    return {
      ok: false,
      reason: "size-mismatch",
      viewBox: vb,
      message: `viewBox is ${vb.width}×${vb.height}; longer side should equal ${VIEWBOX_SIZE}. Use "Rescale to fit" to normalize.`,
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
 * Apply a translate-and-scale transform to an SVG by wrapping its
 * renderable children in a single <g transform="translate(tx ty) scale(s)">.
 * Also sets viewBox to (0, 0, viewBoxWidth, viewBoxHeight) and removes
 * width/height (GIST and the in-app preview both rely on viewBox alone).
 *
 * Used both as the second half of rescaleToFitViewBox AND directly to
 * propagate a computed transform onto sibling/parent SVGs in a family
 * rescale, so all family members end up with the same transform applied
 * AND the same target viewBox.
 *
 * Pure function — no DOM mounting required.
 *
 * Returns the new SVG markup, or null if parsing failed or there were no
 * renderable children to transform.
 */
export function applyTransformToSvg(
  svgMarkup,
  scale,
  tx,
  ty,
  viewBoxWidth,
  viewBoxHeight
) {
  if (!svgMarkup) return null;
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgMarkup, "image/svg+xml");
  const svg = doc.querySelector("svg");
  if (!svg) return null;

  // Before adding our wrap, collapse any pre-existing chain of
  // single-renderable-child <g transform> wrappers into a single <g>.
  // Older rescale code (before getCTM-aware bbox) added a wrapper on
  // every click, leaving SVGs with three+ nested groups whose composed
  // scale drifted past 1 due to floating-point error — content then
  // rendered slightly outside viewBox. Flattening here keeps markup
  // clean and prevents future drift.
  collapseTransformChain(svg);

  const renderable = [];
  for (const child of Array.from(svg.children)) {
    if (!NON_RENDERING_TAGS.has(child.tagName)) renderable.push(child);
  }
  if (renderable.length === 0) return null;

  const round = (n) => Number(n.toFixed(4));

  // Skip wrapping when the transform is essentially identity. Avoids
  // accumulating no-op <g> wrappers across repeated rescales. We still
  // update viewBox/width/height because identity-transform doesn't imply
  // identity-viewBox (e.g. content already at origin but viewBox larger
  // than content needs to be tightened).
  const isIdentity =
    Math.abs(scale - 1) < 0.005 && Math.abs(tx) < 0.5 && Math.abs(ty) < 0.5;

  if (!isIdentity) {
    const transform = `translate(${round(tx)} ${round(ty)}) scale(${round(scale)})`;
    const SVG_NS = "http://www.w3.org/2000/svg";
    const g = doc.createElementNS(SVG_NS, "g");
    g.setAttribute("transform", transform);
    for (const el of renderable) {
      svg.removeChild(el);
      g.appendChild(el);
    }
    svg.appendChild(g);
  }

  svg.setAttribute(
    "viewBox",
    `0 0 ${round(viewBoxWidth)} ${round(viewBoxHeight)}`
  );
  svg.removeAttribute("width");
  svg.removeAttribute("height");

  return new XMLSerializer().serializeToString(svg);
}

// If the SVG's renderable content is a chain of <g transform> wrappers
// where each <g> has exactly one renderable child that is itself a
// <g transform>, replace the chain with a single <g transform="..."> whose
// transform attribute is the chain joined together. We don't compose into
// a matrix because the browser will compose at render time anyway, and
// keeping the original transforms preserves debuggability.
function collapseTransformChain(svg) {
  const directRenderable = Array.from(svg.children).filter(
    (c) => !NON_RENDERING_TAGS.has(c.tagName)
  );
  if (directRenderable.length !== 1) return;
  const top = directRenderable[0];
  if (top.tagName !== "g" || !top.hasAttribute("transform")) return;

  const transforms = [top.getAttribute("transform")];
  let current = top;
  while (true) {
    const childRenderable = Array.from(current.children).filter(
      (c) => !NON_RENDERING_TAGS.has(c.tagName)
    );
    if (childRenderable.length !== 1) break;
    const child = childRenderable[0];
    if (child.tagName !== "g" || !child.hasAttribute("transform")) break;
    transforms.push(child.getAttribute("transform"));
    current = child;
  }
  if (transforms.length < 2) return;

  // current is the innermost wrap. Move its children up to top and replace
  // top's transform with the joined chain.
  const innerChildren = Array.from(current.children);
  // Remove top from svg, build a fresh single <g> with composed transform,
  // append inner children to it, place back under svg.
  const SVG_NS = "http://www.w3.org/2000/svg";
  const replacement = svg.ownerDocument.createElementNS(SVG_NS, "g");
  replacement.setAttribute("transform", transforms.join(" "));
  for (const el of innerChildren) {
    current.removeChild(el);
    replacement.appendChild(el);
  }
  svg.removeChild(top);
  svg.appendChild(replacement);
}

/**
 * Scale the SVG so its longer content dimension fits the canonical
 * VIEWBOX_SIZE target (64), and collapse the viewBox to hug the content
 * tightly on the shorter axis. A horizontal arrow with content 80×20
 * becomes a 64×16 viewBox with content filling it; a vertical arrow with
 * content 20×80 becomes 16×64; a square shape stays 64×64.
 *
 * Bbox measurement combines getBBox() (local bbox ignoring own transform)
 * with getCTM() (matrix from local to viewport coords). Critical for
 * repeated rescales — an already-fit SVG measures correctly and produces
 * scale=1, no-op.
 *
 * Returns `{ svg, scale, tx, ty, viewBoxWidth, viewBoxHeight }` on
 * success, or null if the SVG had no measurable content.
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
      let local = null;
      try {
        local = el.getBBox();
      } catch {
        continue;
      }
      if (!local) continue;
      if (local.width === 0 && local.height === 0) continue;

      // Map the local bbox corners through the element's CTM to get the
      // bbox in viewport coords. CTM may be null for elements that
      // aren't yet rendered; fall back to local coords in that case.
      const ctm = el.getCTM();
      const corners = [
        [local.x, local.y],
        [local.x + local.width, local.y],
        [local.x + local.width, local.y + local.height],
        [local.x, local.y + local.height],
      ];
      for (const [lx, ly] of corners) {
        const vx = ctm ? ctm.a * lx + ctm.c * ly + ctm.e : lx;
        const vy = ctm ? ctm.b * lx + ctm.d * ly + ctm.f : ly;
        if (vx < minX) minX = vx;
        if (vy < minY) minY = vy;
        if (vx > maxX) maxX = vx;
        if (vy > maxY) maxY = vy;
      }
    }
    if (!Number.isFinite(minX)) return null;

    const w = maxX - minX;
    const h = maxY - minY;
    if (w <= 0 || h <= 0) return null;

    const scale = Math.min(VIEWBOX_SIZE / w, VIEWBOX_SIZE / h);
    // Translate so content's top-left lands at (0, 0) in the new tight
    // viewBox. The new viewBox is then (content_w * scale, content_h *
    // scale): one dim hits VIEWBOX_SIZE, the other shrinks to fit.
    const tx = -minX * scale;
    const ty = -minY * scale;
    const viewBoxWidth = w * scale;
    const viewBoxHeight = h * scale;

    const round = (n) => Number(n.toFixed(4));
    const newSvg = applyTransformToSvg(
      svgMarkup,
      scale,
      tx,
      ty,
      viewBoxWidth,
      viewBoxHeight
    );
    if (!newSvg) return null;
    return {
      svg: newSvg,
      scale: round(scale),
      tx: round(tx),
      ty: round(ty),
      viewBoxWidth: round(viewBoxWidth),
      viewBoxHeight: round(viewBoxHeight),
    };
  } finally {
    document.body.removeChild(host);
  }
}

/**
 * Normalize an LLM-generated SVG for insert: rescale to a tight *×64 or
 * 64×* viewBox, then compute a collider whose TYPE matches the LLM's
 * intent but whose geometry is deterministic. This is the "happy medium"
 * pipeline — LLM picks the physics-shape intent, code computes vertices.
 *
 * The "longer axis = VIEWBOX_SIZE" invariant required by GIST is enforced
 * here. rescaleToFitViewBox produces it by construction (scale =
 * min(64/w, 64/h)), but we re-check after the fact so a future bug in
 * rescale can't silently ship a non-conforming icon.
 *
 * `llmType` may be "circle" | "box" | "convex"; anything else (including
 * undefined or "compound") is coerced to "convex".
 *
 * Returns `{ svg, collider, debug }` on success — svg is normalized
 * markup, collider is in the new viewBox coord space, debug carries the
 * rescale params and which type was chosen for diagnostics.
 * Returns null if the SVG has no measurable content.
 */
export function normalizeForInsert(svgMarkup, llmType) {
  const rescaled = rescaleToFitViewBox(svgMarkup);
  if (!rescaled) return null;

  const maxDim = Math.max(rescaled.viewBoxWidth, rescaled.viewBoxHeight);
  if (Math.abs(maxDim - VIEWBOX_SIZE) > 0.5) {
    throw new Error(
      `normalizeForInsert: rescaled viewBox ${rescaled.viewBoxWidth}×${rescaled.viewBoxHeight} ` +
        `violates longer-axis=${VIEWBOX_SIZE} invariant.`
    );
  }

  const safeType = ALLOWED_LLM_TYPES.includes(llmType) ? llmType : "convex";
  const { collider, debug } = computeColliderForType(rescaled.svg, safeType);

  return {
    svg: rescaled.svg,
    collider,
    debug: {
      ...debug,
      llmType: llmType ?? null,
      typeUsed: safeType,
      rescale: {
        scale: rescaled.scale,
        tx: rescaled.tx,
        ty: rescaled.ty,
      },
      viewBox: {
        width: rescaled.viewBoxWidth,
        height: rescaled.viewBoxHeight,
      },
    },
  };
}

/**
 * SVG-only normalize for Flow D (color variants): rescale to tight
 * *×64 or 64×* viewBox; no collider computation since variants inherit
 * from the parent.
 *
 * Returns `{ svg, viewBox }` or null if no measurable content.
 */
export function normalizeSvgOnly(svgMarkup) {
  const rescaled = rescaleToFitViewBox(svgMarkup);
  if (!rescaled) return null;

  const maxDim = Math.max(rescaled.viewBoxWidth, rescaled.viewBoxHeight);
  if (Math.abs(maxDim - VIEWBOX_SIZE) > 0.5) {
    throw new Error(
      `normalizeSvgOnly: rescaled viewBox ${rescaled.viewBoxWidth}×${rescaled.viewBoxHeight} ` +
        `violates longer-axis=${VIEWBOX_SIZE} invariant.`
    );
  }

  return {
    svg: rescaled.svg,
    viewBox: {
      width: rescaled.viewBoxWidth,
      height: rescaled.viewBoxHeight,
    },
  };
}
