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

/**
 * Compute a collider of a caller-specified type from SVG markup. Unlike
 * generateCollider (which auto-detects), this trusts the caller's chosen
 * type and produces deterministic geometry fit to the content.
 *
 * Use when the LLM provides a collider TYPE intent (circle/box/convex)
 * but you want code-controlled geometry — LLM coordinate precision is not
 * reliable for physics-grade alignment.
 *
 * Types:
 *   "circle" — centroid + max-distance bounding circle of the convex hull
 *   "box"    — axis-aligned bounding rect of the convex hull
 *   "convex" — convex hull simplified to ≤ MAX_CONVEX_VERTICES
 * Anything else falls back to "convex".
 *
 * Returns { collider, debug } in the same shape as generateCollider.
 */
export function computeColliderForType(svgMarkup, type) {
  const points = extractFilledVertices(svgMarkup);

  if (points.length < 3) {
    return {
      collider: {
        type: "box",
        center: [VIEWBOX_SIZE / 2, VIEWBOX_SIZE / 2],
        width: VIEWBOX_SIZE,
        height: VIEWBOX_SIZE,
      },
      debug: {
        extractedPoints: points.length,
        strategy: "fallback-full-box",
        requestedType: type,
      },
    };
  }

  const hull = convexHull(points);

  switch (type) {
    case "circle": {
      // Centroid + max-distance bounding circle. Strictly contains every
      // hull vertex — slightly larger than Welzl's smallest-enclosing, but
      // simpler and safer for physics (collider always covers content).
      let cx = 0;
      let cy = 0;
      for (const [x, y] of hull) {
        cx += x;
        cy += y;
      }
      cx /= hull.length;
      cy /= hull.length;
      let maxR = 0;
      for (const [x, y] of hull) {
        const d = Math.hypot(x - cx, y - cy);
        if (d > maxR) maxR = d;
      }
      return {
        collider: {
          type: "circle",
          center: [round2(cx), round2(cy)],
          radius: round2(maxR),
        },
        debug: {
          extractedPoints: points.length,
          hullPoints: hull.length,
          strategy: "type-circle",
        },
      };
    }
    case "box": {
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const [x, y] of hull) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
      return {
        collider: {
          type: "box",
          center: [round2((minX + maxX) / 2), round2((minY + maxY) / 2)],
          width: round2(maxX - minX),
          height: round2(maxY - minY),
        },
        debug: {
          extractedPoints: points.length,
          hullPoints: hull.length,
          strategy: "type-box",
        },
      };
    }
    case "convex":
    default: {
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
          strategy: "type-convex",
          requestedType: type,
        },
      };
    }
  }
}

// ---- Concave outer-boundary extraction (native path metrics) ----
//
// Task 12 SPIKE — the convex-hull path above fills the mouth of a cup/wagon
// because extractFilledVertices returns an UNORDERED point cloud. This route
// instead samples the dominant filled element's boundary IN ORDER, so the
// result preserves concavity. It emits a `type:"convex"` collider (the
// accepted-concave misnomer; gist decomposes it downstream) with the raw
// ordered ring and NO convex hull.
//
// Native getTotalLength()/getPointAtLength() need a RENDERED element, so we
// mount the SVG offscreen in the live document, sample, then remove it. This is
// browser-only (no-op without `document`). getCTM() maps each sampled point
// from the element's local space into viewBox units, so element transforms
// (rotate(), nested groups) are handled for free.
//
// LIMITATION (single-path spike): a filled <path> with multiple subpaths (e.g.
// a cup drawn as outer-rect + inner-rect hole under even-odd fill) traces as
// one chain that jumps between subpaths, producing a self-intersecting ring.
// We detect and report subpath count in debug; the multi-shape boolean-union
// route (polygon-clipping) is the planned follow-up. The editor's validation
// (isSimplePolygon) blocks saving a self-intersecting trace, so a bad case
// fails loud, not silent.

/**
 * Extract an ORDERED outline ring of the dominant filled element by sampling
 * its boundary via native SVG path metrics. Returns
 * { ring: [[x,y], ...], debug }. `ring` is [] if nothing usable was found or
 * if called without a DOM.
 *
 * @param {string} svgMarkup
 * @param {{ sampleStep?: number }} [opts] sampleStep = viewBox units between
 *   boundary samples (default 1.5).
 */
export function extractOrderedOutline(svgMarkup, opts = {}) {
  const { sampleStep = 1.5 } = opts;

  if (typeof document === "undefined") {
    return { ring: [], debug: { strategy: "ordered-outline", error: "no-dom" } };
  }

  // Mount offscreen so getTotalLength/getPointAtLength/getCTM are live. Using
  // innerHTML (not DOMParser) lets the HTML parser render inline SVG directly,
  // sidestepping cross-document namespace pitfalls.
  const host = document.createElement("div");
  host.setAttribute("aria-hidden", "true");
  host.style.cssText =
    "position:absolute;left:-99999px;top:-99999px;width:0;height:0;overflow:hidden;";
  host.innerHTML = svgMarkup;
  document.body.appendChild(host);

  try {
    const svg = host.querySelector("svg");
    if (!svg) {
      return { ring: [], debug: { strategy: "ordered-outline", error: "no-svg" } };
    }

    const candidates = [...svg.querySelectorAll("path, polygon, rect, circle, ellipse")].filter(
      (el) =>
        el.getAttribute("fill") !== "none" &&
        typeof el.getTotalLength === "function"
    );

    // Pick the filled element whose sampled ring encloses the most area — the
    // silhouette for this single-path spike.
    let best = null;
    for (const el of candidates) {
      const ring = sampleElementOutline(el, sampleStep);
      if (ring.length < 3) continue;
      const area = Math.abs(signedArea(ring));
      if (!best || area > best.area) best = { el, ring, area };
    }

    if (!best) {
      return {
        ring: [],
        debug: {
          strategy: "ordered-outline",
          error: "no-filled-geometry",
          candidates: candidates.length,
        },
      };
    }

    return {
      ring: best.ring,
      debug: {
        strategy: "ordered-outline",
        candidates: candidates.length,
        chosenTag: best.el.tagName.toLowerCase(),
        subpaths: countSubpaths(best.el),
        sampledPoints: best.ring.length,
        area: round2(best.area),
      },
    };
  } finally {
    document.body.removeChild(host);
  }
}

/**
 * Compute a concave outer-boundary collider from SVG markup via the ordered
 * sampling route, RDP-simplified to a clean ring. Emits `type:"convex"` with
 * NO convex hull (gist decomposes the concave outline downstream).
 *
 * Returns { collider, debug } like the other generators; `collider` is null if
 * extraction failed.
 *
 * @param {string} svgMarkup
 * @param {{ sampleStep?: number, epsilon?: number }} [opts] epsilon = RDP
 *   tolerance in viewBox units (default 0.6).
 */
export function computeConcaveOutline(svgMarkup, opts = {}) {
  const { sampleStep = 1.5, epsilon = 0.6 } = opts;
  const { ring, debug } = extractOrderedOutline(svgMarkup, { sampleStep });

  if (ring.length < 3) {
    return { collider: null, debug: { ...debug, strategy: "concave-outline-failed" } };
  }

  // RDP preserves order AND concavity (it never adds the cross-cuts a hull
  // would). First/last samples are distinct ring vertices, so no dup endpoint.
  const simplified = rdpSimplify(ring, epsilon);

  return {
    collider: {
      type: "convex",
      vertices: simplified.map(([x, y]) => [round2(x), round2(y)]),
    },
    debug: {
      ...debug,
      strategy: "concave-outline",
      sampledPoints: ring.length,
      simplifiedTo: simplified.length,
    },
  };
}

/** Sample an SVGGeometryElement's boundary into ordered viewBox-space points. */
function sampleElementOutline(el, step) {
  const total = el.getTotalLength();
  if (!total || !isFinite(total)) return [];

  const ctm = el.getCTM(); // element local units → viewBox units (excludes viewBox→px)
  const n = Math.max(8, Math.ceil(total / step));
  const pts = [];
  for (let i = 0; i < n; i++) {
    let p = el.getPointAtLength((i / n) * total);
    if (ctm) p = p.matrixTransform(ctm);
    pts.push([round2(p.x), round2(p.y)]);
  }
  return pts;
}

/** Signed area (shoelace) — sign encodes winding; magnitude is the area. */
function signedArea(vertices) {
  let area = 0;
  for (let i = 0; i < vertices.length; i++) {
    const j = (i + 1) % vertices.length;
    area += vertices[i][0] * vertices[j][1] - vertices[j][0] * vertices[i][1];
  }
  return area / 2;
}

/** Count subpaths in a <path> (each M/m starts one). 1 for non-path elements. */
function countSubpaths(el) {
  if (el.tagName.toLowerCase() !== "path") return 1;
  const d = el.getAttribute("d") || "";
  const m = d.match(/[Mm]/g);
  return m ? m.length : 1;
}

// ---- Raster silhouette trace (multi-shape concave outer boundary) ----
//
// Task 12 — the structure-agnostic capture tool. Where the ordered-outline
// route above traces ONE filled element, this renders the WHOLE SVG to an
// offscreen canvas and boundary-traces the rendered alpha silhouette. It does
// not care how the art is built — N filled shapes, group transforms, rounded
// corners, overlapping tones — so it captures the entire outer boundary
// "arms and all" for connected multi-shape sprites (e.g. a cactus = trunk +
// arms). Emits a `type:"convex"` collider with the raw ordered ring, NO hull.
//
// Tradeoff: the raw contour is pixel-stepped, so we supersample (default 4×)
// and RDP-simplify. For axis-aligned art the steps land on the real edges;
// rounded corners become a couple of chamfer segments after RDP. Browser-only
// (canvas + Image); no-op without a DOM. The render path is the same one the
// browser uses to paint the icon, so it's the true silhouette, not an
// approximation of the source geometry.

/**
 * Trace the rendered alpha silhouette of an SVG into an ordered ring of the
 * largest connected blob. Returns a Promise<{ ring: [[x,y],...], debug }>.
 *
 * @param {string} svgMarkup
 * @param {{ supersample?: number, alphaThreshold?: number }} [opts]
 */
export async function traceSilhouetteRaster(svgMarkup, opts = {}) {
  const { supersample = 4, alphaThreshold = 32 } = opts;

  if (typeof document === "undefined" || typeof Image === "undefined") {
    return { ring: [], debug: { strategy: "raster-silhouette", error: "no-dom" } };
  }

  const vb = readViewBox(svgMarkup);
  const W = Math.max(1, Math.round(vb.width * supersample));
  const H = Math.max(1, Math.round(vb.height * supersample));

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });

  // The Image needs an intrinsic size or some browsers paint nothing from a
  // viewBox-only SVG — give the root explicit width/height.
  const sized = withExplicitSize(svgMarkup, vb.width, vb.height);
  const blob = new Blob([sized], { type: "image/svg+xml" });
  const url = URL.createObjectURL(blob);

  try {
    const img = new Image();
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = () => reject(new Error("SVG image failed to load"));
      img.src = url;
    });
    ctx.drawImage(img, 0, 0, W, H);

    let data;
    try {
      data = ctx.getImageData(0, 0, W, H).data;
    } catch {
      return { ring: [], debug: { strategy: "raster-silhouette", error: "canvas-tainted" } };
    }

    const grid = new Uint8Array(W * H);
    let filled = 0;
    for (let i = 0; i < W * H; i++) {
      if (data[i * 4 + 3] > alphaThreshold) {
        grid[i] = 1;
        filled++;
      }
    }
    if (filled < 9) {
      return { ring: [], debug: { strategy: "raster-silhouette", error: "empty-render", filled } };
    }

    // Trace only the largest blob so stray AA speckle / detached marks don't
    // hijack the start pixel.
    const { keep, components, largest } = largestComponent(grid, W, H);
    const contourPx = mooreTrace(keep, W, H);
    if (contourPx.length < 3) {
      return { ring: [], debug: { strategy: "raster-silhouette", error: "no-contour" } };
    }

    // Pixel centers → viewBox units.
    const ring = contourPx.map(([x, y]) => [(x + 0.5) / supersample, (y + 0.5) / supersample]);

    return {
      ring,
      debug: {
        strategy: "raster-silhouette",
        supersample,
        components,
        largestPixels: largest,
        contourPixels: contourPx.length,
      },
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Compute a concave outer-boundary collider via the raster silhouette route,
 * RDP-simplified. Emits `type:"convex"` with NO hull. Returns a
 * Promise<{ collider, debug }>; collider is null on failure.
 *
 * @param {string} svgMarkup
 * @param {{ supersample?: number, alphaThreshold?: number, epsilon?: number }} [opts]
 *   epsilon = RDP tolerance in viewBox units (default 0.8).
 */
export async function computeSilhouetteOutline(svgMarkup, opts = {}) {
  const { epsilon = 0.8 } = opts;
  const { ring, debug } = await traceSilhouetteRaster(svgMarkup, opts);

  if (ring.length < 3) {
    return { collider: null, debug: { ...debug, strategy: "silhouette-failed" } };
  }

  const simplified = rdpSimplify(ring, epsilon);

  return {
    collider: {
      type: "convex",
      vertices: simplified.map(([x, y]) => [round2(x), round2(y)]),
    },
    debug: {
      ...debug,
      strategy: "raster-silhouette",
      contourPixels: ring.length,
      simplifiedTo: simplified.length,
    },
  };
}

/** Read viewBox (or width/height) without importing svgGeometry (avoids a
 *  circular import — svgGeometry imports extractFilledVertices from here). */
function readViewBox(markup) {
  const vb = markup.match(
    /viewBox\s*=\s*["']\s*[-\d.eE]+\s+[-\d.eE]+\s+([-\d.eE]+)\s+([-\d.eE]+)/
  );
  if (vb) return { width: parseFloat(vb[1]), height: parseFloat(vb[2]) };
  const wm = markup.match(/\bwidth\s*=\s*["']?([\d.]+)/);
  const hm = markup.match(/\bheight\s*=\s*["']?([\d.]+)/);
  return { width: wm ? parseFloat(wm[1]) : 64, height: hm ? parseFloat(hm[1]) : 64 };
}

/** Add explicit width/height to the root <svg> so an Image has intrinsic size. */
function withExplicitSize(markup, w, h) {
  try {
    const doc = new DOMParser().parseFromString(markup, "image/svg+xml");
    const svg = doc.querySelector("svg");
    if (!svg) return markup;
    svg.setAttribute("width", String(w));
    svg.setAttribute("height", String(h));
    return new XMLSerializer().serializeToString(svg);
  } catch {
    return markup;
  }
}

/** Keep only the largest 8-connected component; return its mask + stats. */
function largestComponent(grid, w, h) {
  const labels = new Int32Array(w * h);
  let cur = 0;
  let best = 0;
  let bestSize = 0;
  const stack = [];

  for (let i = 0; i < w * h; i++) {
    if (!grid[i] || labels[i] !== 0) continue;
    cur++;
    let size = 0;
    stack.length = 0;
    stack.push(i);
    labels[i] = cur;
    while (stack.length) {
      const idx = stack.pop();
      size++;
      const x = idx % w;
      const y = (idx / w) | 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const nidx = ny * w + nx;
          if (grid[nidx] && labels[nidx] === 0) {
            labels[nidx] = cur;
            stack.push(nidx);
          }
        }
      }
    }
    if (size > bestSize) {
      bestSize = size;
      best = cur;
    }
  }

  const keep = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) if (labels[i] === best) keep[i] = 1;
  return { keep, components: cur, largest: bestSize };
}

/**
 * Moore-neighbor boundary tracing of the outer contour of a binary blob.
 * Returns an ordered list of boundary pixels [[x,y], ...]. Simple
 * return-to-start stop — fine for thick (supersampled) blobs with no 1px
 * pinch points.
 */
function mooreTrace(grid, w, h) {
  const at = (x, y) => x >= 0 && y >= 0 && x < w && y < h && grid[y * w + x] === 1;

  // First filled pixel in raster scan — a convex corner of the outer contour.
  let sx = -1;
  let sy = -1;
  for (let y = 0; y < h && sy < 0; y++) {
    for (let x = 0; x < w; x++) {
      if (grid[y * w + x]) {
        sx = x;
        sy = y;
        break;
      }
    }
  }
  if (sx < 0) return [];

  // 8 neighbors clockwise from East.
  const dirs = [
    [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1],
  ];

  const contour = [[sx, sy]];
  let cx = sx;
  let cy = sy;
  let backDir = 4; // came from the West (raster scan order)
  const maxSteps = 8 * w * h;

  for (let step = 0; step < maxSteps; step++) {
    // Sweep clockwise starting just past the backtrack; first filled neighbor
    // is the next boundary pixel.
    let nd = -1;
    for (let i = 1; i <= 8; i++) {
      const d = (backDir + i) % 8;
      if (at(cx + dirs[d][0], cy + dirs[d][1])) {
        nd = d;
        break;
      }
    }
    if (nd < 0) break; // isolated pixel
    cx += dirs[nd][0];
    cy += dirs[nd][1];
    backDir = (nd + 4) % 8; // direction from the new pixel back to the old
    if (cx === sx && cy === sy) break;
    contour.push([cx, cy]);
  }

  return contour;
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
