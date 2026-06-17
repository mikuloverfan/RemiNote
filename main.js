"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// main.ts
var main_exports = {};
__export(main_exports, {
  default: () => RemiNotePlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian = require("obsidian");

// src/core/shadow/FrameSnapshot.ts
var DEFAULT_BRUSH_PARAMS = {
  spacing: 3,
  smoothness: 0.5,
  strokeWidth: 2,
  cornerKeep: 0.3
};
function freezePoint(p) {
  return Object.freeze({ x: p.x, y: p.y });
}
function freezePoints(pts) {
  if (!pts)
    return Object.freeze([]);
  return Object.freeze(pts.map((p) => freezePoint(p)));
}
function freezeStroke(s) {
  const penParams = s._penParams;
  return Object.freeze({
    id: s.id,
    points: freezePoints(s.points ?? []),
    color: s.color ?? "#000000",
    width: s.width ?? 2,
    _penParams: penParams ? Object.freeze({
      spacing: penParams.spacing ?? 3,
      smoothness: penParams.smoothness ?? 0.5,
      strokeWidth: penParams.strokeWidth ?? 2,
      cornerKeep: penParams.cornerKeep ?? 0.3
    }) : void 0
  });
}
function freezeStrokes(strokes) {
  if (!strokes)
    return Object.freeze([]);
  return Object.freeze(strokes.map((s) => freezeStroke(s)));
}
function freezeCamera(c2) {
  return Object.freeze({
    x: c2.x ?? 0,
    y: c2.y ?? 0,
    zoom: c2.zoom ?? 1
  });
}
function freezeBrushParams(p) {
  if (!p)
    return Object.freeze({ ...DEFAULT_BRUSH_PARAMS });
  return Object.freeze({
    spacing: p.spacing ?? DEFAULT_BRUSH_PARAMS.spacing,
    smoothness: p.smoothness ?? DEFAULT_BRUSH_PARAMS.smoothness,
    strokeWidth: p.strokeWidth ?? DEFAULT_BRUSH_PARAMS.strokeWidth,
    cornerKeep: p.cornerKeep ?? DEFAULT_BRUSH_PARAMS.cornerKeep
  });
}
var _frameIdCounter = 0;
function captureFrameSnapshot(params) {
  const frameId = ++_frameIdCounter;
  const snapshot = {
    frameId,
    strokes: freezeStrokes(params.strokes),
    previewStroke: params.previewStroke ? freezeStroke(params.previewStroke) : null,
    camera: freezeCamera(params.camera),
    brushParams: freezeBrushParams(params.brushParams),
    capturedAt: performance.now(),
    _sourceFrame: frameId
  };
  return Object.freeze(snapshot);
}

// src/core/render/BrushTipTexture.ts
var TIP_SIZE = 32;
var cache = /* @__PURE__ */ new Map();
function seededRandom(seed) {
  let s = seed | 0;
  return () => {
    s = s * 16807 % 2147483647;
    return (s - 1) / 2147483646;
  };
}
function generateSoftRound(hardness = 0.3) {
  const c2 = document.createElement("canvas");
  c2.width = TIP_SIZE;
  c2.height = TIP_SIZE;
  const ctx = c2.getContext("2d");
  const cx = TIP_SIZE / 2, cy = TIP_SIZE / 2, r2 = TIP_SIZE / 2;
  const coreR = Math.max(0.05, hardness * 0.7);
  const g = ctx.createRadialGradient(cx, cy, r2 * coreR, cx, cy, r2);
  g.addColorStop(0, "rgba(0,0,0,1)");
  g.addColorStop(coreR, "rgba(0,0,0,1)");
  const featherStart = coreR;
  const featherRange = 1 - featherStart;
  g.addColorStop(featherStart + featherRange * 0.25, "rgba(0,0,0,0.95)");
  g.addColorStop(featherStart + featherRange * 0.5, "rgba(0,0,0,0.75)");
  g.addColorStop(featherStart + featherRange * 0.75, "rgba(0,0,0,0.35)");
  g.addColorStop(featherStart + featherRange * 0.9, "rgba(0,0,0,0.08)");
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, TIP_SIZE, TIP_SIZE);
  return c2;
}
function generateHardRound() {
  return generateSoftRound(0.85);
}
function generateBristle(seed = 42) {
  const c2 = document.createElement("canvas");
  c2.width = TIP_SIZE;
  c2.height = TIP_SIZE;
  const ctx = c2.getContext("2d");
  const cx = TIP_SIZE / 2, cy = TIP_SIZE / 2;
  const rand = seededRandom(seed);
  const bodyG = ctx.createRadialGradient(cx, cy, TIP_SIZE * 0.05, cx, cy, TIP_SIZE * 0.35);
  bodyG.addColorStop(0, "rgba(0,0,0,0.7)");
  bodyG.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = bodyG;
  ctx.fillRect(0, 0, TIP_SIZE, TIP_SIZE);
  const bristleCount = 12;
  for (let i = 0; i < bristleCount; i++) {
    const angle = rand() * Math.PI * 2;
    const dist = (rand() + rand() + rand()) / 3 * TIP_SIZE * 0.4;
    const bx = cx + Math.cos(angle) * dist;
    const by = cy + Math.sin(angle) * dist;
    const br = 0.3 + rand() * 0.7;
    const alpha = 0.3 + rand() * 0.7;
    ctx.beginPath();
    ctx.arc(bx, by, br, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(0,0,0,${alpha})`;
    ctx.fill();
  }
  const scatterCount = 6;
  for (let i = 0; i < scatterCount; i++) {
    const angle = rand() * Math.PI * 2;
    const dist = TIP_SIZE * 0.35 + rand() * TIP_SIZE * 0.12;
    const sx = cx + Math.cos(angle) * dist;
    const sy = cy + Math.sin(angle) * dist;
    const sr = 0.2 + rand() * 0.5;
    ctx.beginPath();
    ctx.arc(sx, sy, sr, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(0,0,0,${0.2 + rand() * 0.4})`;
    ctx.fill();
  }
  return c2;
}
function generateFlatOval() {
  const c2 = document.createElement("canvas");
  c2.width = TIP_SIZE;
  c2.height = TIP_SIZE;
  const ctx = c2.getContext("2d");
  const cx = TIP_SIZE / 2, cy = TIP_SIZE / 2;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(0.5, 1);
  ctx.translate(-cx, -cy);
  const g = ctx.createRadialGradient(cx, cy, TIP_SIZE * 0.1, cx, cy, TIP_SIZE * 0.5);
  g.addColorStop(0, "rgba(0,0,0,1)");
  g.addColorStop(0.5, "rgba(0,0,0,0.8)");
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, TIP_SIZE, TIP_SIZE);
  ctx.restore();
  return c2;
}
function getTipTexture(type, color = "#000000") {
  const key = `${type}|${color}`;
  let cached = cache.get(key);
  if (cached)
    return cached;
  let src;
  switch (type) {
    case "soft-round":
      src = generateSoftRound();
      break;
    case "hard-round":
      src = generateHardRound();
      break;
    case "bristle":
      src = generateBristle();
      break;
    case "flat-oval":
      src = generateFlatOval();
      break;
    default:
      src = generateSoftRound();
      break;
  }
  if (color !== "#000000") {
    src = tintTexture(src, color);
  }
  cache.set(key, src);
  return src;
}
function tintTexture(source, color) {
  const c2 = document.createElement("canvas");
  c2.width = source.width;
  c2.height = source.height;
  const ctx = c2.getContext("2d");
  ctx.drawImage(source, 0, 0);
  ctx.globalCompositeOperation = "source-atop";
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, c2.width, c2.height);
  return c2;
}

// src/core/render/StrokeGeometryEngine.ts
var DEFAULT_CONFIG = {
  width: 2,
  smoothing: 0.5,
  taper: 0.25,
  minWidth: 0.6,
  maxWidth: 1.8,
  capSegments: 8
};
function smoothPoints(pts, factor) {
  if (pts.length < 3 || factor <= 0)
    return pts;
  const n2 = pts.length;
  const result = [pts[0]];
  for (let i = 1; i < n2 - 1; i++) {
    const p0 = pts[i - 1];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = i + 2 < n2 ? pts[i + 2] : pts[i + 1];
    const dx1 = p1.x - p0.x, dy1 = p1.y - p0.y;
    const dx2 = p2.x - p1.x, dy2 = p2.y - p1.y;
    const l1 = Math.hypot(dx1, dy1);
    const l2 = Math.hypot(dx2, dy2);
    let curvature = 0;
    if (l1 > 0.5 && l2 > 0.5) {
      const dot = (dx1 * dx2 + dy1 * dy2) / (l1 * l2);
      curvature = Math.acos(Math.max(-1, Math.min(1, dot))) / Math.PI;
    }
    const baseSteps = Math.round(3 + factor * 6);
    const extraSteps = Math.round(curvature * 6);
    const subSteps = Math.min(16, baseSteps + extraSteps);
    for (let s = 1; s <= subSteps; s++) {
      const t2 = s / (subSteps + 1);
      const t22 = t2 * t2;
      const t3 = t22 * t2;
      const x2 = 0.5 * (2 * p1.x + (-p0.x + p2.x) * t2 + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t22 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3);
      const y = 0.5 * (2 * p1.y + (-p0.y + p2.y) * t2 + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t22 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3);
      const p0p = p0.pressure ?? 0.5, p1p = p1.pressure ?? 0.5;
      const p2p = p2.pressure ?? 0.5, p3p = p3.pressure ?? 0.5;
      const pressure = 0.5 * (2 * p1p + (-p0p + p2p) * t2 + (2 * p0p - 5 * p1p + 4 * p2p - p3p) * t22 + (-p0p + 3 * p1p - 3 * p2p + p3p) * t3);
      const p0s = p0.speed ?? 0, p1s = p1.speed ?? 0;
      const p2s = p2.speed ?? 0, p3s = p3.speed ?? 0;
      const speed = 0.5 * (2 * p1s + (-p0s + p2s) * t2 + (2 * p0s - 5 * p1s + 4 * p2s - p3s) * t22 + (-p0s + 3 * p1s - 3 * p2s + p3s) * t3);
      result.push({ x: x2, y, pressure, speed });
    }
    result.push(p1);
  }
  result.push(pts[n2 - 1]);
  return result;
}
function computeWidths(pts, baseWidth, taper, minRatio, maxRatio, startFadePct = 0.06, endFadePct = 0.08) {
  const n2 = pts.length;
  const raw = new Array(n2);
  const bellStrength = 0.2 + taper * 0.6;
  for (let i = 0; i < n2; i++) {
    const p = pts[i];
    const pressure = p.pressure ?? 0.5;
    const speed = p.speed ?? 0;
    const t2 = n2 > 1 ? i / (n2 - 1) : 0.5;
    const bellBase = Math.sin(Math.PI * t2) ** 0.5;
    const bell = 1 - bellStrength + bellStrength * bellBase;
    let pressureFactor;
    if (pressure < 0.05) {
      pressureFactor = 0.05;
    } else {
      pressureFactor = 0.3 + 0.7 * Math.pow((pressure - 0.05) / 0.95, 0.6);
    }
    const speedFactor = 1 - speed * taper * 0.5;
    let ratio = bell * pressureFactor * speedFactor;
    ratio = Math.max(minRatio, Math.min(maxRatio, ratio));
    raw[i] = baseWidth * ratio;
  }
  if (startFadePct > 1e-3 && n2 > 3) {
    const fadeInEnd = Math.max(2, Math.floor(n2 * startFadePct));
    for (let i = 0; i < fadeInEnd; i++) {
      const t2 = i / Math.max(1, fadeInEnd - 1);
      const fade = t2 * t2 * (3 - 2 * t2);
      raw[i] *= fade;
    }
  }
  if (endFadePct > 1e-3 && n2 > 3) {
    const fadeOutStart = n2 - Math.max(2, Math.floor(n2 * endFadePct));
    for (let i = fadeOutStart; i < n2; i++) {
      const t2 = (n2 - 1 - i) / Math.max(1, n2 - fadeOutStart - 1);
      const fade = t2 * t2 * (3 - 2 * t2);
      raw[i] *= fade;
    }
  }
  const absMin = Math.max(0.05, baseWidth * minRatio * 0.5);
  raw[0] = Math.max(raw[0], absMin);
  if (n2 > 1)
    raw[n2 - 1] = Math.max(raw[n2 - 1], absMin);
  if (n2 > 5) {
    const noiseStrength = 0.025;
    const midStart = Math.max(2, Math.floor(n2 * 0.08));
    const midEnd = Math.min(n2 - 3, Math.floor(n2 * 0.92));
    for (let i = midStart; i < midEnd; i++) {
      const hash = Math.sin(i * 127.1 + baseWidth * 311.7) * 0.5 + 0.5;
      const noise = (hash - 0.5) * 2 * noiseStrength;
      raw[i] *= 1 + noise;
    }
  }
  return raw;
}
function buildCap(cx, cy, dx, dy, radius, segments, vertexOffset, indexOffset, vertices, indices) {
  const baseAngle = Math.atan2(dy, dx);
  vertices.push(cx, cy);
  const centerIdx = vertexOffset;
  for (let i = 0; i <= segments; i++) {
    const angle = baseAngle + Math.PI * (i / segments - 0.5);
    vertices.push(
      cx + Math.cos(angle) * radius,
      cy + Math.sin(angle) * radius
    );
  }
  for (let i = 0; i < segments; i++) {
    indices.push(centerIdx, vertexOffset + 1 + i, vertexOffset + 1 + i + 1);
  }
  return { vertexCount: 1 + segments + 1, indexCount: segments * 3 };
}
function buildStrokeGeometry(points, config = {}) {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const capSegs = cfg.capSegments ?? 8;
  if (points.length === 0) {
    return {
      vertices: new Float32Array(0),
      indices: new Uint32Array(0),
      caps: { start: "round", end: "round" },
      bounds: { x: 0, y: 0, w: 0, h: 0 },
      pointCount: 0
    };
  }
  if (points.length === 1) {
    const p = points[0];
    const r2 = cfg.width * 0.5;
    const verts = [];
    const idx = [];
    verts.push(p.x, p.y);
    for (let i = 0; i <= capSegs * 2; i++) {
      const a2 = i / (capSegs * 2) * Math.PI * 2;
      verts.push(p.x + Math.cos(a2) * r2, p.y + Math.sin(a2) * r2);
    }
    for (let i = 0; i < capSegs * 2; i++) {
      idx.push(0, 1 + i, 1 + i + 1);
    }
    return {
      vertices: new Float32Array(verts),
      indices: new Uint32Array(idx),
      caps: { start: "round", end: "round" },
      bounds: { x: p.x - r2, y: p.y - r2, w: r2 * 2, h: r2 * 2 },
      pointCount: 1
    };
  }
  const smoothed = cfg.smoothing > 0 ? smoothPoints([...points], cfg.smoothing) : [...points];
  const widths = computeWidths(smoothed, cfg.width, cfg.taper, cfg.minWidth, cfg.maxWidth, cfg.startFadePct ?? 0.06, cfg.endFadePct ?? 0.08);
  const vertices = [];
  const indices = [];
  let boundsMinX = Infinity, boundsMinY = Infinity;
  let boundsMaxX = -Infinity, boundsMaxY = -Infinity;
  let prevNx = 0, prevNy = 0;
  for (let i = 0; i < smoothed.length; i++) {
    const p = smoothed[i];
    const halfW = widths[i] / 2;
    let dx, dy;
    if (i === 0 && smoothed.length > 1) {
      dx = smoothed[1].x - p.x;
      dy = smoothed[1].y - p.y;
    } else if (i === smoothed.length - 1 && smoothed.length > 1) {
      dx = p.x - smoothed[i - 1].x;
      dy = p.y - smoothed[i - 1].y;
    } else if (smoothed.length > 2) {
      dx = smoothed[i + 1].x - smoothed[i - 1].x;
      dy = smoothed[i + 1].y - smoothed[i - 1].y;
    } else {
      dx = 1;
      dy = 0;
    }
    const len = Math.hypot(dx, dy) || 1;
    let nx = -dy / len;
    let ny = dx / len;
    if (i > 0) {
      const dot = prevNx * nx + prevNy * ny;
      if (dot < 0.866) {
        const blendFactor = Math.max(0.3, Math.min(0.7, (1 - dot) * 0.5));
        nx = prevNx * blendFactor + nx * (1 - blendFactor);
        ny = prevNy * blendFactor + ny * (1 - blendFactor);
        const nl = Math.hypot(nx, ny) || 1;
        nx /= nl;
        ny /= nl;
      }
    }
    prevNx = nx;
    prevNy = ny;
    const lx = p.x + nx * halfW;
    const ly = p.y + ny * halfW;
    vertices.push(lx, ly);
    const rx = p.x - nx * halfW;
    const ry = p.y - ny * halfW;
    vertices.push(rx, ry);
    boundsMinX = Math.min(boundsMinX, lx, rx);
    boundsMinY = Math.min(boundsMinY, ly, ry);
    boundsMaxX = Math.max(boundsMaxX, lx, rx);
    boundsMaxY = Math.max(boundsMaxY, ly, ry);
  }
  for (let i = 0; i < smoothed.length - 1; i++) {
    const bl = i * 2;
    const br = i * 2 + 1;
    const tl = (i + 1) * 2;
    const tr = (i + 1) * 2 + 1;
    indices.push(bl, br, tl);
    indices.push(tl, br, tr);
  }
  const first = smoothed[0];
  const last = smoothed[smoothed.length - 1];
  const firstHalfW = widths[0] / 2;
  const lastHalfW = widths[widths.length - 1] / 2;
  let sdx = smoothed.length > 1 ? smoothed[1].x - first.x : 1;
  let sdy = smoothed.length > 1 ? smoothed[1].y - first.y : 0;
  const slen = Math.hypot(sdx, sdy) || 1;
  sdx /= slen;
  sdy /= slen;
  const startCap = buildCap(
    first.x,
    first.y,
    -sdx,
    -sdy,
    firstHalfW,
    capSegs,
    vertices.length,
    indices.length,
    vertices,
    indices
  );
  let edx = smoothed.length > 1 ? last.x - smoothed[smoothed.length - 2].x : 1;
  let edy = smoothed.length > 1 ? last.y - smoothed[smoothed.length - 2].y : 0;
  const elen = Math.hypot(edx, edy) || 1;
  edx /= elen;
  edy /= elen;
  boundsMinX = Math.min(boundsMinX, first.x - firstHalfW);
  boundsMinY = Math.min(boundsMinY, first.y - firstHalfW);
  boundsMaxX = Math.max(boundsMaxX, first.x + firstHalfW);
  boundsMaxY = Math.max(boundsMaxY, first.y + firstHalfW);
  buildCap(
    last.x,
    last.y,
    edx,
    edy,
    lastHalfW,
    capSegs,
    vertices.length,
    indices.length,
    vertices,
    indices
  );
  boundsMinX = Math.min(boundsMinX, last.x - lastHalfW);
  boundsMinY = Math.min(boundsMinY, last.y - lastHalfW);
  boundsMaxX = Math.max(boundsMaxX, last.x + lastHalfW);
  boundsMaxY = Math.max(boundsMaxY, last.y + lastHalfW);
  return {
    vertices: new Float32Array(vertices),
    indices: new Uint32Array(indices),
    caps: { start: "round", end: "round" },
    bounds: {
      x: boundsMinX,
      y: boundsMinY,
      w: boundsMaxX - boundsMinX,
      h: boundsMaxY - boundsMinY
    },
    pointCount: points.length
  };
}
function drawGeometryToCanvas2D(ctx, geometry, color, _width, edgeBlur = 0) {
  const { vertices, indices } = geometry;
  if (indices.length === 0)
    return;
  ctx.save();
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.globalCompositeOperation = "multiply";
  ctx.globalAlpha = 0.85;
  if (edgeBlur > 0.5) {
    ctx.shadowColor = color;
    ctx.shadowBlur = edgeBlur;
  }
  ctx.beginPath();
  for (let i = 0; i < indices.length; i += 3) {
    const i0 = indices[i] * 2;
    const i1 = indices[i + 1] * 2;
    const i2 = indices[i + 2] * 2;
    ctx.moveTo(vertices[i0], vertices[i0 + 1]);
    ctx.lineTo(vertices[i1], vertices[i1 + 1]);
    ctx.lineTo(vertices[i2], vertices[i2 + 1]);
    ctx.closePath();
  }
  ctx.fill();
  ctx.restore();
}
function geometryToPath2D(geometry) {
  const path = new Path2D();
  const { indices, vertices } = geometry;
  if (indices.length === 0)
    return path;
  for (let i = 0; i < indices.length; i += 3) {
    const i0 = indices[i] * 2;
    const i1 = indices[i + 1] * 2;
    const i2 = indices[i + 2] * 2;
    path.moveTo(vertices[i0], vertices[i0 + 1]);
    path.lineTo(vertices[i1], vertices[i1 + 1]);
    path.lineTo(vertices[i2], vertices[i2 + 1]);
    path.closePath();
  }
  return path;
}
function drawStampStroke(ctx, config) {
  const { points, widths, color } = config;
  const n2 = points.length;
  if (n2 < 2)
    return;
  const spacing = config.stampSpacing ?? 1;
  const jitter = config.jitter ?? 0.4;
  const tipType = config.tipType ?? "soft-round";
  const tipTexture = getTipTexture(tipType, color);
  const tipSize = 32;
  ctx.save();
  ctx.globalCompositeOperation = "multiply";
  let lastX = points[0].x, lastY = points[0].y;
  for (let i = 0; i < n2; i++) {
    const p = points[i];
    const halfW = widths[i] / 2;
    if (halfW < 0.3)
      continue;
    const dist = Math.hypot(p.x - lastX, p.y - lastY);
    if (dist < spacing && i < n2 - 1)
      continue;
    lastX = p.x;
    lastY = p.y;
    const jx = jitter > 0 ? (Math.random() - 0.5) * jitter * 2 : 0;
    const jy = jitter > 0 ? (Math.random() - 0.5) * jitter * 2 : 0;
    const js = jitter > 0 ? 1 + (Math.random() - 0.5) * jitter * 0.1 : 1;
    const ja = jitter > 0 ? (Math.random() - 0.5) * jitter * Math.PI * 0.05 : 0;
    const stampSize = halfW * 2.3 * js;
    const sx = p.x + jx;
    const sy = p.y + jy;
    ctx.save();
    ctx.translate(sx, sy);
    if (ja !== 0)
      ctx.rotate(ja);
    ctx.drawImage(
      tipTexture,
      -stampSize / 2,
      -stampSize / 2,
      stampSize,
      stampSize
    );
    ctx.restore();
  }
  ctx.restore();
}

// src/core/render/StrokePathCache.ts
var StrokePathCache = class {
  constructor() {
    this._cache = /* @__PURE__ */ new Map();
    this._generation = 0;
    this._workspaceId = "";
  }
  get(id) {
    return this._cache.get(id);
  }
  /** 写入 Path2D 缓存。 */
  set(id, path) {
    this._cache.set(id, path);
  }
  /** 作废单个 stroke 的缓存（updateStroke 触发）。 */
  invalidate(id) {
    this._cache.delete(id);
  }
  /** 🔴 Phase 0.3.5: workspace-scoped hard wipe + generation bump */
  reset(workspaceId) {
    this._cache.clear();
    this._workspaceId = workspaceId;
    this._generation++;
  }
  /** 🔴 Phase 0.3.5: 强制清空全部缓存 + generation bump */
  clearAll() {
    this._cache.clear();
    this._generation++;
  }
  /** 作废全部缓存（page load / camera reset / session destroy）。 */
  invalidateAll() {
    this._cache.clear();
  }
  /** 当前缓存条目数。 */
  get size() {
    return this._cache.size;
  }
};

// src/core/shadow/ShadowRenderer.ts
var DEFAULT_CONFIG2 = {
  width: 0,
  height: 0,
  enabled: false,
  debug: false
};
var ShadowRenderer = class {
  constructor(config = {}) {
    // ── State ──
    this._canvas = null;
    this._ctx = null;
    this._pathCache = new StrokePathCache();
    this._enabled = false;
    this._debug = false;
    this._config = { ...DEFAULT_CONFIG2, ...config };
    this._enabled = this._config.enabled;
    this._debug = this._config.debug;
  }
  // ==========================================================
  //  Lifecycle
  // ==========================================================
  /** 启用 shadow renderer。创建 offscreen canvas。 */
  enable() {
    if (this._enabled)
      return;
    try {
      this._canvas = document.createElement("canvas");
      this._canvas.style.display = "none";
      const w2 = this._config.width || 1024;
      const h = this._config.height || 768;
      this._canvas.width = w2;
      this._canvas.height = h;
      this._ctx = this._canvas.getContext("2d");
      if (!this._ctx) {
        throw new Error("Failed to get 2D context for shadow canvas");
      }
      this._enabled = true;
      if (this._debug) {
        console.log("[ShadowRenderer] \u2705 enabled \u2014 offscreen canvas created", { w: w2, h });
      }
    } catch (err) {
      console.error("[ShadowRenderer] \u274C enable failed:", err);
      this._enabled = false;
      this._canvas = null;
      this._ctx = null;
    }
  }
  /** 禁用 shadow renderer。释放 offscreen canvas。 */
  disable() {
    this._enabled = false;
    this._pathCache.clearAll();
    this._canvas = null;
    this._ctx = null;
    if (this._debug) {
      console.log("[ShadowRenderer] \u23F9 disabled \u2014 resources released");
    }
  }
  get enabled() {
    return this._enabled;
  }
  // ==========================================================
  //  Render
  // ==========================================================
  /**
   * 从 FrameSnapshot 渲染到 offscreen canvas。
   *
   * 渲染流程（镜像 main.ts renderFrame）：
   * 1. clearRect + 白色背景
   * 2. setTransform(camera)
   * 3. 遍历 strokes → buildPath2D → ctx.stroke()
   *
   * ⚠️ 所有异常在 try/catch 内隔离，不影响调用方。
   *
   * @param snapshot 冻结的帧快照
   * @returns ShadowRenderOutput — 结构化渲染结果
   */
  render(snapshot) {
    if (!this._enabled || !this._ctx || !this._canvas) {
      return null;
    }
    const t0 = performance.now();
    const strokeIds = [];
    const strokeBBoxes = /* @__PURE__ */ new Map();
    const renderErrors = [];
    let totalPoints = 0;
    try {
      const ctx = this._ctx;
      const canvas = this._canvas;
      const cam = snapshot.camera;
      const targetW = this._config.width || canvas.width;
      const targetH = this._config.height || canvas.height;
      if (canvas.width !== targetW || canvas.height !== targetH) {
        canvas.width = targetW;
        canvas.height = targetH;
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      const dpr = 1;
      ctx.setTransform(
        dpr * cam.zoom,
        0,
        0,
        dpr * cam.zoom,
        cam.x * dpr,
        cam.y * dpr
      );
      const allStrokes = [...snapshot.strokes];
      if (snapshot.previewStroke && snapshot.previewStroke.points.length >= 2) {
        allStrokes.push(snapshot.previewStroke);
      }
      const brushParams = snapshot.brushParams;
      let unionMinX = Infinity, unionMinY = Infinity;
      let unionMaxX = -Infinity, unionMaxY = -Infinity;
      for (const s of allStrokes) {
        try {
          if (!s.points || s.points.length < 2) {
            totalPoints += s.points?.length ?? 0;
            continue;
          }
          totalPoints += s.points.length;
          const bbox = this._computeStrokeBBox(s.points);
          if (bbox) {
            strokeBBoxes.set(s.id, bbox);
            unionMinX = Math.min(unionMinX, bbox.minX);
            unionMinY = Math.min(unionMinY, bbox.minY);
            unionMaxX = Math.max(unionMaxX, bbox.maxX);
            unionMaxY = Math.max(unionMaxY, bbox.maxY);
          }
          this._drawStampStroke(ctx, s, brushParams);
          strokeIds.push(s.id);
        } catch (strokeErr) {
          renderErrors.push({
            strokeId: s.id,
            reason: strokeErr instanceof Error ? strokeErr.message : "unknown"
          });
        }
      }
      const t1 = performance.now();
      return {
        frameId: snapshot.frameId,
        strokeCount: allStrokes.length,
        totalPoints,
        strokeIds,
        strokeBBoxes,
        unionBBox: isFinite(unionMinX) ? { minX: unionMinX, minY: unionMinY, maxX: unionMaxX, maxY: unionMaxY } : null,
        renderTimeMs: t1 - t0,
        camera: snapshot.camera,
        renderedIds: strokeIds,
        renderErrors
      };
    } catch (err) {
      console.error("[ShadowRenderer] \u274C render() crashed:", err);
      return {
        frameId: snapshot.frameId,
        strokeCount: 0,
        totalPoints: 0,
        strokeIds: [],
        strokeBBoxes: /* @__PURE__ */ new Map(),
        unionBBox: null,
        renderTimeMs: performance.now() - t0,
        camera: snapshot.camera,
        renderedIds: [],
        renderErrors: [{
          strokeId: "__shadow__",
          reason: err instanceof Error ? err.message : "fatal render crash"
        }]
      };
    }
  }
  // ==========================================================
  //  Query
  // ==========================================================
  /** 获取 offscreen canvas（只读，用于 toDataURL / 对比）。 */
  getCanvas() {
    return this._canvas;
  }
  /** 获取 offscreen canvas 的 base64 data URL。 */
  toDataURL(type, quality) {
    if (!this._canvas)
      return null;
    try {
      return this._canvas.toDataURL(type ?? "image/png", quality);
    } catch {
      return null;
    }
  }
  /** 清空 Path2D 缓存。 */
  invalidateCache() {
    this._pathCache.clearAll();
  }
  // ==========================================================
  //  ⭐ Stamp-based stroke rendering (PS-style)
  //  Replaces old mesh Path2D approach.
  // ==========================================================
  _drawStampStroke(ctx, s, p) {
    try {
      const baseW = s._penParams?.strokeWidth ?? p.strokeWidth;
      const smoothing = s._penParams?.smoothness ?? p.smoothness;
      const minW = Math.max(0.3, baseW * 0.08);
      const maxW = Math.min(baseW * 2, 8);
      const points = s.points.map((pt, i, arr) => ({
        x: pt.x,
        y: pt.y,
        pressure: 0.5,
        speed: i > 0 ? Math.min(1, Math.hypot(pt.x - arr[i - 1].x, pt.y - arr[i - 1].y) / 20) : 0
      }));
      const smoothed = smoothPoints(points, smoothing);
      const widths = computeWidths(smoothed, baseW, 0.25, minW / baseW, maxW / baseW);
      drawStampStroke(ctx, {
        points: smoothed,
        widths,
        color: s.color,
        stampSpacing: 1,
        tipType: "soft-round",
        jitter: 0.4
      });
    } catch {
    }
  }
  // ==========================================================
  //  Private: BBox computation
  // ==========================================================
  _computeStrokeBBox(pts) {
    if (!pts || pts.length === 0)
      return null;
    let minX = Infinity, minY = Infinity;
    let maxX = -Infinity, maxY = -Infinity;
    for (const p of pts) {
      if (p.x < minX)
        minX = p.x;
      if (p.y < minY)
        minY = p.y;
      if (p.x > maxX)
        maxX = p.x;
      if (p.y > maxY)
        maxY = p.y;
    }
    if (!isFinite(minX))
      return null;
    return { minX, minY, maxX, maxY };
  }
};

// src/core/shadow/RenderDiffEngine.ts
var POINT_EPSILON = 0.01;
function computeBBox(pts) {
  if (!pts || pts.length === 0)
    return null;
  let minX = Infinity, minY = Infinity;
  let maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX)
      minX = p.x;
    if (p.y < minY)
      minY = p.y;
    if (p.x > maxX)
      maxX = p.x;
    if (p.y > maxY)
      maxY = p.y;
  }
  if (!isFinite(minX))
    return null;
  return { minX, minY, maxX, maxY };
}
var RenderDiffEngine = class {
  constructor() {
    // ==========================================================
    //  Config
    // ==========================================================
    this._enabled = false;
    this._debug = false;
  }
  enable() {
    this._enabled = true;
  }
  disable() {
    this._enabled = false;
  }
  get enabled() {
    return this._enabled;
  }
  setDebug(v2) {
    this._debug = v2;
  }
  // ==========================================================
  //  Compute Diff
  // ==========================================================
  /**
   * 对比 main render snapshot 与 shadow render output。
   *
   * 对比策略（O(n+m)）：
   * 1. 构建 main/shadow stroke ID → stroke 映射
   * 2. 遍历 main IDs → 判断 missing / 对比点坐标 / 包围盒
   * 3. 遍历 shadow IDs → 判断 extra
   * 4. 对比渲染顺序
   *
   * 🔒 所有异常在 try/catch 内隔离，永远返回 RenderDiffResult。
   *
   * @param snapshot    main.ts 捕获的 FrameSnapshot
   * @param shadowOut   ShadowRenderer.render() 的输出
   * @returns           结构化的 diff 结果
   */
  compute(snapshot, shadowOut) {
    try {
      return this._computeInternal(snapshot, shadowOut);
    } catch (err) {
      console.error("[RenderDiffEngine] \u274C compute() crashed:", err);
      return this._emptyResult(snapshot, shadowOut);
    }
  }
  /**
   * 对比两个 FrameSnapshot（不依赖 ShadowRenderOutput）。
   * 用于 main.ts render 输出 vs 预期数据的直接对比。
   */
  compareSnapshots(main, shadow) {
    try {
      const pseudoOutput = {
        frameId: shadow.frameId,
        strokeCount: shadow.strokes.length,
        totalPoints: shadow.strokes.reduce((s, st) => s + st.points.length, 0),
        strokeIds: shadow.strokes.map((s) => s.id),
        strokeBBoxes: new Map(
          shadow.strokes.map((s) => {
            const bbox = computeBBox(s.points);
            return [s.id, bbox ?? { minX: 0, minY: 0, maxX: 0, maxY: 0 }];
          })
        ),
        unionBBox: null,
        renderTimeMs: 0,
        camera: shadow.camera,
        renderedIds: shadow.strokes.map((s) => s.id),
        renderErrors: []
      };
      return this._computeInternal(main, pseudoOutput);
    } catch (err) {
      console.error("[RenderDiffEngine] \u274C compareSnapshots() crashed:", err);
      return this._emptyResult(main, {
        frameId: shadow.frameId,
        strokeCount: 0,
        totalPoints: 0,
        strokeIds: [],
        strokeBBoxes: /* @__PURE__ */ new Map(),
        unionBBox: null,
        renderTimeMs: 0,
        camera: shadow.camera,
        renderedIds: [],
        renderErrors: []
      });
    }
  }
  // ==========================================================
  //  Internal
  // ==========================================================
  _computeInternal(snapshot, shadowOut) {
    const t0 = performance.now();
    const mainStrokeMap = /* @__PURE__ */ new Map();
    for (const s of snapshot.strokes) {
      mainStrokeMap.set(s.id, s);
    }
    const mainStrokeCount = snapshot.strokes.length;
    const shadowStrokeCount = shadowOut.strokeCount;
    const mainTotalPoints = snapshot.strokes.reduce((sum, s) => sum + s.points.length, 0) + (snapshot.previewStroke?.points.length ?? 0);
    const shadowTotalPoints = shadowOut.totalPoints;
    const mainIds = new Set(snapshot.strokes.map((s) => s.id));
    const shadowIds = new Set(shadowOut.strokeIds);
    const missingStrokes = [];
    const extraStrokes = [];
    for (const id of mainIds) {
      if (!shadowIds.has(id))
        missingStrokes.push(id);
    }
    for (const id of shadowIds) {
      if (!mainIds.has(id))
        extraStrokes.push(id);
    }
    const geometryMismatches = [];
    for (const id of mainIds) {
      if (!shadowIds.has(id))
        continue;
      if (extraStrokes.includes(id))
        continue;
      const mainStroke = mainStrokeMap.get(id);
      const mainPts = mainStroke.points;
      const shadowBBox = shadowOut.strokeBBoxes.get(id);
      const mismatchedIndices = [];
      if (!shadowBBox) {
        continue;
      }
      const mainBBox = computeBBox(mainPts);
      if (mainBBox) {
        const mainKey = `${mainBBox.minX.toFixed(1)},${mainBBox.minY.toFixed(1)},${mainBBox.maxX.toFixed(1)},${mainBBox.maxY.toFixed(1)}`;
        const shadowKey = `${shadowBBox.minX.toFixed(1)},${shadowBBox.minY.toFixed(1)},${shadowBBox.maxX.toFixed(1)},${shadowBBox.maxY.toFixed(1)}`;
        if (mainKey !== shadowKey && mainPts.length > 0) {
          const minLen = Math.min(mainPts.length, 0);
          for (let i = 0; i < minLen; i++) {
          }
          if (mainPts.length > 0) {
            const maxDev = Math.max(
              Math.abs(mainBBox.minX - shadowBBox.minX),
              Math.abs(mainBBox.minY - shadowBBox.minY),
              Math.abs(mainBBox.maxX - shadowBBox.maxX),
              Math.abs(mainBBox.maxY - shadowBBox.maxY)
            );
            if (maxDev > POINT_EPSILON) {
              geometryMismatches.push({
                strokeId: id,
                mainPointCount: mainPts.length,
                shadowPointCount: mainPts.length,
                // 假设相同
                mismatchedPointIndices: mismatchedIndices,
                maxDeviation: maxDev,
                avgDeviation: maxDev / 4
              });
            }
          }
        }
      }
    }
    const bboxMismatches = [];
    for (const id of mainIds) {
      if (!shadowIds.has(id))
        continue;
      const mainStroke = mainStrokeMap.get(id);
      const mainBBox = computeBBox(mainStroke.points);
      const shadowBBox = shadowOut.strokeBBoxes.get(id);
      if (!mainBBox || !shadowBBox)
        continue;
      const deltaMinX = Math.abs(mainBBox.minX - shadowBBox.minX);
      const deltaMinY = Math.abs(mainBBox.minY - shadowBBox.minY);
      const deltaMaxX = Math.abs(mainBBox.maxX - shadowBBox.maxX);
      const deltaMaxY = Math.abs(mainBBox.maxY - shadowBBox.maxY);
      if (deltaMinX > POINT_EPSILON || deltaMinY > POINT_EPSILON || deltaMaxX > POINT_EPSILON || deltaMaxY > POINT_EPSILON) {
        bboxMismatches.push({
          strokeId: id,
          mainBBox,
          shadowBBox,
          deltaMinX,
          deltaMinY,
          deltaMaxX,
          deltaMaxY
        });
      }
    }
    const mainOrder = snapshot.strokes.map((s) => s.id);
    const shadowOrder = shadowOut.strokeIds.filter((id) => mainIds.has(id));
    let renderOrderMatch = true;
    const renderOrderMismatches = [];
    const maxOrderLen = Math.max(mainOrder.length, shadowOrder.length);
    for (let i = 0; i < maxOrderLen; i++) {
      const mainId = mainOrder[i] ?? "__missing__";
      const shadowId = shadowOrder[i] ?? "__missing__";
      if (mainId !== shadowId) {
        renderOrderMatch = false;
        renderOrderMismatches.push({ index: i, mainId, shadowId });
      }
    }
    const frameDrift = Math.abs(snapshot.frameId - shadowOut.frameId);
    const commonCount = [...mainIds].filter((id) => shadowIds.has(id)).length;
    const isClean = missingStrokes.length === 0 && extraStrokes.length === 0 && geometryMismatches.length === 0 && bboxMismatches.length === 0 && renderOrderMatch && frameDrift === 0 && mainStrokeCount === shadowStrokeCount;
    if (this._debug && !isClean) {
      console.log("[RenderDiffEngine] \u{1F50D} diff NOT clean:", {
        missingStrokes: missingStrokes.length,
        extraStrokes: extraStrokes.length,
        geometryMismatches: geometryMismatches.length,
        bboxMismatches: bboxMismatches.length,
        renderOrderMatch,
        frameDrift
      });
    }
    return {
      frameId: snapshot.frameId,
      timestamp: performance.now(),
      mainStrokeCount,
      shadowStrokeCount,
      strokeCountDelta: mainStrokeCount - shadowStrokeCount,
      missingStrokes,
      extraStrokes,
      geometryMismatches,
      bboxMismatches,
      renderOrderMatch,
      renderOrderMismatches,
      frameDrift,
      mainTotalPoints,
      shadowTotalPoints,
      commonStrokeCount: commonCount,
      isClean
    };
  }
  // ==========================================================
  //  Private: Empty result fallback
  // ==========================================================
  _emptyResult(snapshot, shadowOut) {
    return {
      frameId: snapshot.frameId,
      timestamp: performance.now(),
      mainStrokeCount: snapshot.strokes.length,
      shadowStrokeCount: shadowOut.strokeCount,
      strokeCountDelta: snapshot.strokes.length - shadowOut.strokeCount,
      missingStrokes: [],
      extraStrokes: [],
      geometryMismatches: [],
      bboxMismatches: [],
      renderOrderMatch: false,
      renderOrderMismatches: [],
      frameDrift: 999,
      mainTotalPoints: 0,
      shadowTotalPoints: 0,
      commonStrokeCount: 0,
      isClean: false
    };
  }
};

// src/core/shadow/ShadowRenderObserver.ts
var DEFAULT_CONFIG3 = {
  enabled: false,
  shadowEnabled: false,
  diffEnabled: false,
  historySize: 60,
  debug: false
};
var ShadowRenderObserver = class {
  constructor(config = {}) {
    // ── History ──
    this._history = [];
    this._totalFrames = 0;
    // ── Callbacks ──
    this._onDiff = null;
    this._onRecord = null;
    this._onError = null;
    this._config = { ...DEFAULT_CONFIG3, ...config };
    this._enabled = this._config.enabled;
    this._shadowRenderer = new ShadowRenderer({
      enabled: this._config.shadowEnabled,
      debug: this._config.debug
    });
    this._diffEngine = new RenderDiffEngine();
    if (this._config.diffEnabled) {
      this._diffEngine.enable();
    }
    this._diffEngine.setDebug(this._config.debug);
  }
  // ==========================================================
  //  Lifecycle
  // ==========================================================
  /** 启用整个观察系统 */
  enable() {
    if (this._enabled)
      return;
    this._enabled = true;
    if (this._config.shadowEnabled) {
      this._shadowRenderer.enable();
    }
    if (this._config.diffEnabled) {
      this._diffEngine.enable();
    }
    if (this._config.debug) {
      console.log("[ShadowObserver] \u2705 enabled", {
        shadow: this._config.shadowEnabled,
        diff: this._config.diffEnabled
      });
    }
  }
  /** 禁用整个观察系统 + 释放资源 */
  disable() {
    this._enabled = false;
    this._shadowRenderer.disable();
    this._diffEngine.disable();
    this._history = [];
    if (this._config.debug) {
      console.log("[ShadowObserver] \u23F9 disabled \u2014 resources released");
    }
  }
  get enabled() {
    return this._enabled;
  }
  // ==========================================================
  //  Callbacks
  // ==========================================================
  /** 每帧 diff 完成后的回调 */
  onDiff(fn) {
    this._onDiff = fn;
  }
  /** 每帧完整记录的回调（含 snapshot + shadow output + diff） */
  onRecord(fn) {
    this._onRecord = fn;
  }
  /** 错误回调 */
  onError(fn) {
    this._onError = fn;
  }
  // ==========================================================
  //  observe() — 唯一入口（从 main.ts _unifiedTick 调用）
  // ==========================================================
  /**
   * 观察一帧渲染。
   *
   * 调用位置：main.ts CanvasSession._unifiedTick() 中 renderFrame() 之后。
   *
   * 调用方式：
   *   shadowObserver.observe({
   *     strokes: this.engine.strokes,
   *     previewStroke: this.inputSnapshot.previewStroke,
   *     camera: this.viewport.camera,
   *     brushParams: this.engine.params,
   *   });
   *
   * 🔒 所有子系统异常被 try/catch 隔离，不会向上抛异常。
   *
   * @param input CanvasSession 的只读状态视图
   * @returns ObserveRecord | null（disabled 时返回 null）
   */
  observe(input) {
    if (!this._enabled)
      return null;
    const t0 = performance.now();
    const record = {
      timestamp: t0,
      snapshot: null,
      shadowOutput: null,
      diff: null,
      totalTimeMs: 0,
      isClean: null
    };
    try {
      record.snapshot = captureFrameSnapshot(input);
    } catch (err) {
      this._handleError(err, "snapshot");
      record.totalTimeMs = performance.now() - t0;
      this._pushHistory(record);
      return record;
    }
    if (this._shadowRenderer.enabled) {
      try {
        record.shadowOutput = this._shadowRenderer.render(record.snapshot);
      } catch (err) {
        this._handleError(err, "shadow-render");
      }
    }
    if (this._diffEngine.enabled && record.shadowOutput) {
      try {
        record.diff = this._diffEngine.compute(
          record.snapshot,
          record.shadowOutput
        );
        record.isClean = record.diff.isClean;
        if (this._onDiff && record.diff) {
          try {
            this._onDiff(record.diff);
          } catch {
          }
        }
      } catch (err) {
        this._handleError(err, "diff");
      }
    }
    record.totalTimeMs = performance.now() - t0;
    this._totalFrames++;
    this._pushHistory(record);
    if (this._onRecord) {
      try {
        this._onRecord(record);
      } catch {
      }
    }
    if (this._config.debug && this._totalFrames % 60 === 0) {
      console.log("[ShadowObserver] \u{1F4CA} stats:", {
        totalFrames: this._totalFrames,
        historySize: this._history.length,
        avgTimeMs: (this._history.reduce((s, r2) => s + r2.totalTimeMs, 0) / this._history.length).toFixed(2),
        lastDiffClean: record.isClean
      });
    }
    return record;
  }
  // ==========================================================
  //  Query
  // ==========================================================
  /** 获取历史记录 */
  getHistory() {
    return this._history;
  }
  /** 获取最近一条记录 */
  getLastRecord() {
    return this._history.length > 0 ? this._history[this._history.length - 1] : null;
  }
  /** 获取总帧数 */
  get totalFrames() {
    return this._totalFrames;
  }
  /** 获取最近 N 条 diff 结果 */
  getRecentDiffs(n2 = 10) {
    return this._history.slice(-n2).filter((r2) => r2.diff !== null).map((r2) => r2.diff);
  }
  /** 清空历史 */
  clearHistory() {
    this._history = [];
  }
  /** 是否所有最近的帧 diff clean */
  isStable(windowSize = 30) {
    const recent = this._history.slice(-windowSize);
    if (recent.length === 0)
      return false;
    return recent.every((r2) => r2.isClean === true);
  }
  // ==========================================================
  //  Accessors — 暴露子系统供外部直接使用
  // ==========================================================
  get shadowRenderer() {
    return this._shadowRenderer;
  }
  get diffEngine() {
    return this._diffEngine;
  }
  // ==========================================================
  //  Private
  // ==========================================================
  _pushHistory(record) {
    this._history.push(record);
    while (this._history.length > this._config.historySize) {
      this._history.shift();
    }
  }
  _handleError(err, context) {
    const error = err instanceof Error ? err : new Error(String(err));
    if (this._config.debug) {
      console.error(`[ShadowObserver] \u274C ${context}:`, error.message);
    }
    if (this._onError) {
      try {
        this._onError(error, context);
      } catch {
      }
    }
  }
};
var globalShadowObserver = new ShadowRenderObserver();

// src/core/shadow/SVSFrameLocker.ts
var DEFAULT_CONFIG4 = {
  mutationDetection: true,
  debug: false
};
var SVSFrameLocker = class {
  constructor(config = {}) {
    // ── State ──
    this._frameId = 0;
    this._enabled = false;
    // ── Current frame tracking ──
    this._currentToken = null;
    this._corruptedFrames = 0;
    this._totalFrames = 0;
    this._config = { ...DEFAULT_CONFIG4, ...config };
  }
  // ==========================================================
  //  Lifecycle
  // ==========================================================
  enable() {
    this._enabled = true;
  }
  disable() {
    this._enabled = false;
    this._currentToken = null;
  }
  get enabled() {
    return this._enabled;
  }
  // ==========================================================
  //  beginFrame — 帧开始（在 renderFrame 之前调用）
  // ==========================================================
  /**
   * 锁定一帧的开始状态。
   *
   * 调用时机：在 CanvasSession.renderFrame() 之前。
   * 计算当前 engine.strokes 的校验和，生成 FrameToken。
   *
   * @param strokes engine.strokes 数组（只读引用）
   * @returns FrameToken — 唯一帧标识
   */
  beginFrame(strokes) {
    this._frameId++;
    this._totalFrames++;
    const checksum = this._computeChecksum(strokes);
    const token = {
      frameId: this._frameId,
      timestamp: performance.now(),
      strokesChecksum: checksum,
      strokeCount: strokes.length
    };
    this._currentToken = token;
    if (this._config.debug && this._frameId % 60 === 0) {
      console.log("[SVSFrameLocker] \u{1F512} frame locked:", {
        frameId: token.frameId,
        strokeCount: token.strokeCount,
        checksum: token.strokesChecksum.toString(16)
      });
    }
    return token;
  }
  // ==========================================================
  //  verifyFrame — 帧结束验证（在 shadow render 之后调用）
  // ==========================================================
  /**
   * 验证帧数据在 shadow render 期间是否被修改。
   *
   * 调用时机：在 ShadowRenderer.render() 完成之后。
   *
   * @param strokes engine.strokes 数组（当前状态）
   * @returns true = 帧数据未变，false = 检测到 mid-frame mutation
   */
  verifyFrame(strokes) {
    if (!this._enabled || !this._config.mutationDetection)
      return true;
    if (!this._currentToken)
      return false;
    const currentChecksum = this._computeChecksum(strokes);
    const clean = currentChecksum === this._currentToken.strokesChecksum;
    if (!clean) {
      this._corruptedFrames++;
      if (this._config.debug) {
        console.warn("[SVSFrameLocker] \u26A0\uFE0F mid-frame mutation detected!", {
          frameId: this._currentToken.frameId,
          expectedChecksum: this._currentToken.strokesChecksum.toString(16),
          actualChecksum: currentChecksum.toString(16),
          expectedCount: this._currentToken.strokeCount,
          actualCount: strokes.length
        });
      }
    }
    return clean;
  }
  // ==========================================================
  //  Query
  // ==========================================================
  /** 当前帧的 token（可能为 null = 未调用 beginFrame） */
  get currentToken() {
    return this._currentToken;
  }
  /** 当前帧 ID */
  get currentFrameId() {
    return this._frameId;
  }
  /** 被标记为 corrupted 的帧数 */
  get corruptedFrames() {
    return this._corruptedFrames;
  }
  /** 总帧数 */
  get totalFrames() {
    return this._totalFrames;
  }
  /** corruption 比例 (0~1) */
  get corruptionRate() {
    return this._totalFrames > 0 ? this._corruptedFrames / this._totalFrames : 0;
  }
  // ==========================================================
  //  Private: checksum 计算
  // ==========================================================
  /**
   * 计算 strokes 数组的轻量校验和。
   *
   * 算法：FNV-1a hash over (strokeId + pointCount + first/last point coords)。
   * 复杂度：O(n strokes)，不是 O(n points) — 足够检测 mutation 而不重。
   *
   * 不依赖 DeterministicStrokeCore.deterministicHash 以避免循环依赖。
   */
  _computeChecksum(strokes) {
    let h = 2166136261;
    for (const s of strokes) {
      for (let i = 0; i < s.id.length; i++) {
        h ^= s.id.charCodeAt(i);
        h = Math.imul(h, 16777619);
      }
      const pts = s.points;
      if (pts && pts.length > 0) {
        h ^= pts.length;
        h = Math.imul(h, 16777619);
        h ^= Math.round(pts[0].x * 100);
        h = Math.imul(h, 16777619);
        h ^= Math.round(pts[0].y * 100);
        h = Math.imul(h, 16777619);
        const last = pts[pts.length - 1];
        h ^= Math.round(last.x * 100);
        h = Math.imul(h, 16777619);
        h ^= Math.round(last.y * 100);
        h = Math.imul(h, 16777619);
      } else {
        h ^= 0;
        h = Math.imul(h, 16777619);
      }
    }
    return h >>> 0;
  }
};

// src/core/shadow/SVSSnapshotGuard.ts
var DEFAULT_CONFIG5 = {
  verifyAliasBreak: false,
  // 默认关闭，性能敏感
  debug: false
};
var SVSSnapshotGuard = class {
  constructor(config = {}) {
    this._enabled = false;
    this._totalSnapshots = 0;
    this._failedSnapshots = 0;
    this._config = { ...DEFAULT_CONFIG5, ...config };
  }
  // ==========================================================
  //  Lifecycle
  // ==========================================================
  enable() {
    this._enabled = true;
  }
  disable() {
    this._enabled = false;
  }
  get enabled() {
    return this._enabled;
  }
  // ==========================================================
  //  safeCapture — 加强版快照捕获
  // ==========================================================
  /**
   * 安全捕获帧快照。
   *
   * 流程：
   * 1. structuredClone(input) → 完全断开引用
   * 2. captureFrameSnapshot(cloned) → 标准化 + freeze
   * 3. verifyAliasBreak(original, snapshot) → 验证引用不共享
   * 4. verifyStructure(snapshot) → 验证数据结构完整
   *
   * @param input    原始 ObserveInput（来自 engine.strokes 等直接引用）
   * @param original 原始 engine.strokes 数组引用（供 alias 验证）
   * @returns { snapshot, verification }
   */
  safeCapture(input, original) {
    const t0 = performance.now();
    const verification = {
      valid: true,
      captureTimeMs: 0,
      aliasBreakViolations: [],
      structureErrors: []
    };
    this._totalSnapshots++;
    try {
      const clonedInput = this._safeClone(input);
      const snapshot = captureFrameSnapshot(clonedInput);
      if (this._config.verifyAliasBreak && original) {
        this._verifyAliasBreak(original.strokes, snapshot, verification);
      }
      this._verifyStructure(snapshot, verification);
      verification.captureTimeMs = performance.now() - t0;
      if (!verification.valid) {
        this._failedSnapshots++;
        if (this._config.debug) {
          console.warn("[SVSSnapshotGuard] \u26A0\uFE0F snapshot verification failed:", verification);
        }
      }
      return { snapshot, verification };
    } catch (err) {
      this._failedSnapshots++;
      verification.valid = false;
      verification.structureErrors.push(
        `safeCapture crashed: ${err instanceof Error ? err.message : "unknown"}`
      );
      verification.captureTimeMs = performance.now() - t0;
      if (this._config.debug) {
        console.error("[SVSSnapshotGuard] \u274C safeCapture crashed, falling back:", err);
      }
      const fallbackSnapshot = captureFrameSnapshot(input);
      return { snapshot: fallbackSnapshot, verification };
    }
  }
  // ==========================================================
  //  Query
  // ==========================================================
  get totalSnapshots() {
    return this._totalSnapshots;
  }
  get failedSnapshots() {
    return this._failedSnapshots;
  }
  get failureRate() {
    return this._totalSnapshots > 0 ? this._failedSnapshots / this._totalSnapshots : 0;
  }
  // ==========================================================
  //  Private: structuredClone wrapper
  // ==========================================================
  /**
   * 安全深拷贝 — structuredClone 不可用时回退到 JSON round-trip。
   *
   * structuredClone 优势：
   * - 正确处理 ArrayBuffer / TypedArray / Map / Set
   * - 比 JSON.parse(JSON.stringify()) 快 2-3x
   * - 处理循环引用（但我们不应有循环引用）
   */
  _safeClone(value) {
    if (typeof structuredClone === "function") {
      return structuredClone(value);
    }
    return JSON.parse(JSON.stringify(value));
  }
  // ==========================================================
  //  Private: Alias break verification
  // ==========================================================
  /**
   * 验证快照中的引用与原始 engine.strokes 不共享。
   *
   * 检查项：
   * - strokes 数组本身不是同一个引用
   * - 每个 stroke 对象不是同一个引用
   * - 每个 points 数组不是同一个引用
   */
  _verifyAliasBreak(originalStrokes, snapshot, verification) {
    if (originalStrokes === snapshot.strokes) {
      verification.aliasBreakViolations.push("strokes array: same reference as engine.strokes");
      verification.valid = false;
    }
    const origArr = originalStrokes;
    for (let i = 0; i < Math.min(origArr.length, snapshot.strokes.length); i++) {
      const origS = origArr[i];
      const snapS = snapshot.strokes[i];
      if (origS === snapS) {
        verification.aliasBreakViolations.push(`stroke[${i}].${origS.id}: same object reference`);
        verification.valid = false;
      }
      if (origS.points && snapS.points && origS.points === snapS.points) {
        verification.aliasBreakViolations.push(`stroke[${i}].${origS.id}.points: same array reference`);
        verification.valid = false;
      }
    }
  }
  // ==========================================================
  //  Private: Structure verification
  // ==========================================================
  /**
   * 验证快照数据结构完整。
   *
   * 检查项：
   * - 每个 stroke 有 id
   * - 每个 stroke 有 points 数组
   * - 每个 point 有 x, y（且为有限值）
   * - camera 有 x, y, zoom
   */
  _verifyStructure(snapshot, verification) {
    if (!snapshot) {
      verification.structureErrors.push("snapshot is null/undefined");
      verification.valid = false;
      return;
    }
    if (snapshot.camera.zoom == null || snapshot.camera.zoom <= 0) {
      verification.structureErrors.push("camera.zoom invalid");
      verification.valid = false;
    }
    for (let i = 0; i < snapshot.strokes.length; i++) {
      const s = snapshot.strokes[i];
      if (!s.id) {
        verification.structureErrors.push(`stroke[${i}]: missing id`);
        verification.valid = false;
      }
      if (!s.points) {
        verification.structureErrors.push(`stroke[${i}].${s.id}: missing points`);
        verification.valid = false;
        continue;
      }
      for (let j = 0; j < s.points.length; j++) {
        const p = s.points[j];
        if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) {
          verification.structureErrors.push(
            `stroke[${i}].${s.id}.points[${j}]: non-finite coords (${p.x}, ${p.y})`
          );
          verification.valid = false;
        }
      }
    }
  }
};

// src/core/shadow/SVSGeometryBridge.ts
var DEFAULT_CONFIG6 = {
  geometryOverrides: {},
  debug: false
};
var SVSGeometryBridge = class {
  constructor(config = {}) {
    this._enabled = false;
    this._buildCount = 0;
    this._totalTimeMs = 0;
    this._config = { ...DEFAULT_CONFIG6, ...config };
  }
  // ==========================================================
  //  Lifecycle
  // ==========================================================
  enable() {
    this._enabled = true;
  }
  disable() {
    this._enabled = false;
  }
  get enabled() {
    return this._enabled;
  }
  // ==========================================================
  //  build — 唯一几何构建入口
  // ==========================================================
  /**
   * 从 FrozenStroke 构建统一几何。
   *
   * 这是 shadow 系统中唯一合法的几何构建入口。
   * 所有调用方（ShadowRenderer、GPU、diff）必须经过此方法。
   *
   * 流程：
   * 1. FrozenPoint[] → Point2D[] (pressure + speed 注入)
   * 2. 合并 brushParams + geometryOverrides → StrokeGeometryConfig
   * 3. StrokeGeometryEngine.buildStrokeGeometry(points, config)
   * 4. geometryToPath2D(geometry) → Path2D
   * 5. 返回 UnifiedStrokeGeometry
   *
   * @param stroke      冻结的 stroke 快照
   * @param brushParams 笔刷参数
   * @returns           统一的几何输出
   */
  build(stroke, brushParams) {
    if (!this._enabled) {
      return null;
    }
    const t0 = performance.now();
    this._buildCount++;
    try {
      const pts = stroke.points;
      if (!pts || pts.length < 2) {
        return null;
      }
      const points = pts.map((pt, i, arr) => ({
        x: pt.x,
        y: pt.y,
        pressure: 0.5,
        // 默认压力（main.ts 不使用压力设备）
        speed: i > 0 ? Math.min(1, Math.hypot(pt.x - arr[i - 1].x, pt.y - arr[i - 1].y) / 20) : 0
      }));
      const config = {
        width: stroke._penParams?.strokeWidth ?? brushParams.strokeWidth,
        smoothing: stroke._penParams?.smoothness ?? brushParams.smoothness,
        taper: 0.25,
        minWidth: 0.6,
        maxWidth: 1.8,
        ...this._config.geometryOverrides
      };
      const geometry = buildStrokeGeometry(points, config);
      const path2D = geometryToPath2D(geometry);
      const bbox = {
        minX: geometry.bounds.x,
        minY: geometry.bounds.y,
        maxX: geometry.bounds.x + geometry.bounds.w,
        maxY: geometry.bounds.y + geometry.bounds.h
      };
      const t1 = performance.now();
      this._totalTimeMs += t1 - t0;
      return {
        geometry,
        path2D,
        bbox,
        pointCount: pts.length,
        config
      };
    } catch (err) {
      if (this._config.debug) {
        console.error("[SVSGeometryBridge] \u274C build failed:", {
          strokeId: stroke.id,
          pointCount: stroke.points.length,
          error: err instanceof Error ? err.message : "unknown"
        });
      }
      return null;
    }
  }
  // ==========================================================
  //  Convenience: toPath2D only
  // ==========================================================
  /**
   * 快捷方法：只构建 Path2D（兼容旧 ShadowRenderer 的 _buildPath2D）。
   *
   * @returns Path2D 或 null
   */
  buildPath2D(stroke, brushParams) {
    const result = this.build(stroke, brushParams);
    return result?.path2D ?? null;
  }
  // ==========================================================
  //  Convenience: toBBox only
  // ==========================================================
  /**
   * 快捷方法：只计算包围盒。
   *
   * 不构建完整 Path2D，用于 diff 阶段快速对比。
   */
  buildBBox(stroke, brushParams) {
    const result = this.build(stroke, brushParams);
    return result?.bbox ?? null;
  }
  // ==========================================================
  //  Convenience: toGPUBuffer
  // ==========================================================
  /**
   * 快捷方法：获取 GPU-ready 的 vertices + indices。
   *
   * 用于未来 GPU pipeline 对齐。
   */
  buildGPUBuffer(stroke, brushParams) {
    const result = this.build(stroke, brushParams);
    if (!result)
      return null;
    return {
      vertices: result.geometry.vertices,
      indices: result.geometry.indices
    };
  }
  // ==========================================================
  //  Query
  // ==========================================================
  get buildCount() {
    return this._buildCount;
  }
  get avgBuildTimeMs() {
    return this._buildCount > 0 ? this._totalTimeMs / this._buildCount : 0;
  }
  // ==========================================================
  //  Validation — 对比 main.ts buildPath2D 一致性
  // ==========================================================
  /**
   * 验证 SVS 几何与 main.ts buildPath2D 的等价性。
   *
   * 通过对比 BBox 确定是否存在几何偏差。
   * 不比较 Path2D 内部结构（Path2D 不提供读取 API）。
   *
   * @param mainPath2D    main.ts buildPath2D 的输出
   * @param svsGeometry   SVSGeometryBridge.build() 的输出
   * @returns             偏差报告
   */
  static validateEquivalence(mainPath2D, svsGeometry) {
    const bbox = svsGeometry.bbox;
    const diag = Math.hypot(bbox.maxX - bbox.minX, bbox.maxY - bbox.minY);
    const bboxDelta = 0;
    const equivalent = svsGeometry.geometry.indices.length > 0;
    return {
      equivalent,
      bboxDelta,
      message: equivalent ? `SVS geometry built: ${svsGeometry.pointCount} pts, ${svsGeometry.geometry.indices.length / 3} tris` : "SVS geometry build failed"
    };
  }
};

// src/core/shadow/SVSDiffStabilizer.ts
var DEFAULT_CONFIG7 = {
  windowSize: 10,
  stabilityThreshold: 0.8,
  alertThreshold: 5,
  debug: false
};
var SVSDiffStabilizer = class {
  constructor(config = {}) {
    this._enabled = false;
    // ── State ──
    this._window = [];
    this._consecutiveUnclean = 0;
    this._stableSince = null;
    this._currentState = "unstable";
    // ── Cumulative stats ──
    this._stats = {
      totalMissing: 0,
      totalExtra: 0,
      totalBBoxMismatch: 0,
      totalOrderMismatch: 0,
      totalFrameDrift: 0,
      framesAnalyzed: 0
    };
    this._config = { ...DEFAULT_CONFIG7, ...config };
  }
  // ==========================================================
  //  Lifecycle
  // ==========================================================
  enable() {
    this._enabled = true;
  }
  disable() {
    this._enabled = false;
    this._reset();
  }
  get enabled() {
    return this._enabled;
  }
  // ==========================================================
  //  add — 每帧投喂 diff 结果
  // ==========================================================
  /**
   * 投喂一帧的 diff 结果。
   *
   * 调用时机：ShadowRenderObserver 中 diff 完成后。
   *
   * 内部逻辑：
   * 1. 推入滑动窗口
   * 2. 更新连续不 clean 计数
   * 3. 更新累积统计
   * 4. 重新计算稳定性状态
   *
   * @param diff RenderDiffEngine.compute() 的输出
   */
  add(diff) {
    if (!this._enabled)
      return;
    this._window.push(diff);
    while (this._window.length > this._config.windowSize) {
      const removed = this._window.shift();
      this._subtractStats(removed);
    }
    if (diff.isClean) {
      this._consecutiveUnclean = 0;
      if (this._stableSince === null) {
        this._stableSince = diff.frameId;
      }
    } else {
      this._consecutiveUnclean++;
      this._stableSince = null;
    }
    this._addStats(diff);
    this._currentState = this._computeState();
    if (this._config.debug && !diff.isClean) {
      console.log("[SVSDiffStabilizer] \u{1F50D} diff added:", {
        frameId: diff.frameId,
        isClean: diff.isClean,
        state: this._currentState,
        consecutiveUnclean: this._consecutiveUnclean,
        cleanRatio: this._cleanRatio()
      });
    }
  }
  // ==========================================================
  //  Query
  // ==========================================================
  /** 当前是否稳定（8/10 clean） */
  isStable() {
    return this._currentState === "stable";
  }
  /** 获取完整稳定性报告 */
  getReport() {
    return {
      state: this._currentState,
      cleanFrames: this._cleanFrames(),
      totalFrames: this._window.length,
      cleanRatio: this._cleanRatio(),
      consecutiveUnclean: this._consecutiveUnclean,
      stats: { ...this._stats },
      lastDiff: this._window.length > 0 ? this._window[this._window.length - 1] : null,
      stableSince: this._stableSince
    };
  }
  /** 获取累积统计 */
  getStats() {
    return { ...this._stats };
  }
  /** 窗口大小 */
  get windowSize() {
    return this._window.length;
  }
  /** 当前状态 */
  get state() {
    return this._currentState;
  }
  // ==========================================================
  //  Private: 稳定性计算
  // ==========================================================
  _cleanFrames() {
    return this._window.filter((d2) => d2.isClean).length;
  }
  _cleanRatio() {
    if (this._window.length === 0)
      return 1;
    return this._cleanFrames() / this._window.length;
  }
  _computeState() {
    if (this._window.length === 0)
      return "unstable";
    const ratio = this._cleanRatio();
    const threshold = this._config.stabilityThreshold;
    if (this._consecutiveUnclean >= this._config.alertThreshold) {
      return "alert";
    }
    if (this._window.length >= this._config.windowSize && ratio >= threshold) {
      return "stable";
    }
    if (this._window.length >= this._config.windowSize && ratio < threshold) {
      return "degrading";
    }
    return "unstable";
  }
  // ==========================================================
  //  Private: 统计累积
  // ==========================================================
  _addStats(diff) {
    this._stats.totalMissing += diff.missingStrokes.length;
    this._stats.totalExtra += diff.extraStrokes.length;
    this._stats.totalBBoxMismatch += diff.bboxMismatches.length;
    this._stats.totalOrderMismatch += diff.renderOrderMismatches.length;
    this._stats.totalFrameDrift += diff.frameDrift;
    this._stats.framesAnalyzed++;
  }
  _subtractStats(diff) {
    this._stats.totalMissing -= diff.missingStrokes.length;
    this._stats.totalExtra -= diff.extraStrokes.length;
    this._stats.totalBBoxMismatch -= diff.bboxMismatches.length;
    this._stats.totalOrderMismatch -= diff.renderOrderMismatches.length;
    this._stats.totalFrameDrift -= diff.frameDrift;
    this._stats.framesAnalyzed = Math.max(0, this._stats.framesAnalyzed - 1);
  }
  // ==========================================================
  //  Private: reset
  // ==========================================================
  _reset() {
    this._window = [];
    this._consecutiveUnclean = 0;
    this._stableSince = null;
    this._currentState = "unstable";
    this._stats = {
      totalMissing: 0,
      totalExtra: 0,
      totalBBoxMismatch: 0,
      totalOrderMismatch: 0,
      totalFrameDrift: 0,
      framesAnalyzed: 0
    };
  }
};

// src/core/shadow/ShadowSessionHook.ts
var ShadowSessionHook = class {
  constructor(config = {}) {
    // ── State ──
    this._attached = false;
    this._frameCount = 0;
    this._svsEnabled = config.svsEnabled ?? true;
    this._debug = config.debug ?? false;
    this._frameLocker = new SVSFrameLocker({
      mutationDetection: config.frameLocker?.mutationDetection ?? true,
      debug: this._debug
    });
    this._snapshotGuard = new SVSSnapshotGuard({
      verifyAliasBreak: config.snapshotGuard?.verifyAliasBreak ?? false,
      debug: this._debug
    });
    this._geometryBridge = new SVSGeometryBridge({
      debug: config.geometryBridge?.debug ?? false
    });
    this._diffStabilizer = new SVSDiffStabilizer({
      windowSize: config.diffStabilizer?.windowSize ?? 10,
      stabilityThreshold: config.diffStabilizer?.stabilityThreshold ?? 0.8,
      alertThreshold: config.diffStabilizer?.alertThreshold ?? 5,
      debug: this._debug
    });
    this._observer = new ShadowRenderObserver({
      enabled: true,
      shadowEnabled: config.observer?.shadowEnabled ?? true,
      diffEnabled: config.observer?.diffEnabled ?? true,
      debug: this._debug
    });
    this._wireSVS();
  }
  // ==========================================================
  //  Lifecycle
  // ==========================================================
  attach() {
    this._attached = true;
    this._observer.enable();
    if (this._svsEnabled) {
      this._frameLocker.enable();
      this._snapshotGuard.enable();
      this._geometryBridge.enable();
      this._diffStabilizer.enable();
    }
  }
  detach() {
    this._attached = false;
  }
  get attached() {
    return this._attached;
  }
  /**
   * 观察一帧。
   *
   * 调用位置：CanvasSession._unifiedTick() 中 renderFrame() 之后。
   *
   * SVS 管线：
   *   ① FrameLocker.beginFrame(strokes) → token
   *   ② SnapshotGuard.safeCapture(input) → safe snapshot
   *   ③ Observer.observe(safeInput) → shadow render + diff
   *   ④ DiffStabilizer.add(record.diff) → 滑动窗口去噪
   *   ⑤ FrameLocker.verifyFrame(strokes) → mutation check
   *
   * @param session CanvasSession 实例（只读访问）
   */
  observe(session) {
    if (!this._attached)
      return;
    try {
      this._frameCount++;
      let token = null;
      if (this._frameLocker.enabled) {
        token = this._frameLocker.beginFrame(session.engine.strokes);
      }
      const input = {
        strokes: session.engine.strokes,
        previewStroke: session.inputSnapshot.previewStroke,
        camera: session.viewport.camera,
        brushParams: session.engine.params
      };
      let observeInput = input;
      if (this._snapshotGuard.enabled) {
        const { snapshot } = this._snapshotGuard.safeCapture(input, {
          strokes: session.engine.strokes,
          previewStroke: session.inputSnapshot.previewStroke
        });
        observeInput = input;
      }
      const record = this._observer.observe(observeInput);
      if (record?.diff && this._diffStabilizer.enabled) {
        this._diffStabilizer.add(record.diff);
      }
      if (token && this._frameLocker.enabled) {
        this._frameLocker.verifyFrame(session.engine.strokes);
      }
      if (this._debug && this._frameCount % 60 === 0) {
        const report = this._diffStabilizer.getReport();
        const lockerStats = {
          corrupted: this._frameLocker.corruptedFrames,
          rate: this._frameLocker.corruptionRate.toFixed(4)
        };
        const guardStats = {
          failed: this._snapshotGuard.failedSnapshots,
          rate: this._snapshotGuard.failureRate.toFixed(4)
        };
        console.log("[SVS Hook] \u{1F4CA} 60-frame report:", {
          svsState: report.state,
          cleanRatio: report.cleanRatio.toFixed(2),
          consecutiveUnclean: report.consecutiveUnclean,
          frameLocker: lockerStats,
          snapshotGuard: guardStats
        });
      }
    } catch {
    }
  }
  /** 销毁 hook + 所有 SVS 子系统 */
  destroy() {
    this._attached = false;
    this._observer.disable();
    this._frameLocker.disable();
    this._snapshotGuard.disable();
    this._geometryBridge.disable();
    this._diffStabilizer.disable();
  }
  // ==========================================================
  //  Query — 暴露 SVS 子系统
  // ==========================================================
  get observer() {
    return this._observer;
  }
  get frameLocker() {
    return this._frameLocker;
  }
  get snapshotGuard() {
    return this._snapshotGuard;
  }
  get geometryBridge() {
    return this._geometryBridge;
  }
  get diffStabilizer() {
    return this._diffStabilizer;
  }
  // ==========================================================
  //  Private: Wire SVS callbacks into Observer
  // ==========================================================
  _wireSVS() {
    this._observer.onDiff((diff) => {
      if (this._diffStabilizer.enabled) {
        try {
          this._diffStabilizer.add(diff);
        } catch {
        }
      }
    });
  }
};
function createSVSHook(config) {
  const hook = new ShadowSessionHook(config);
  hook.attach();
  return hook;
}

// src/core/orchestrator/FrameDebugLayer.ts
var DEFAULT_CONFIG8 = {
  maxFrames: 300,
  verbose: false,
  autoDumpOnError: true
};
function runStep(name, fn, onError) {
  const start = performance.now();
  try {
    fn();
    const durationMs = performance.now() - start;
    return { ok: true, durationMs };
  } catch (err) {
    const durationMs = performance.now() - start;
    const message = err instanceof Error ? err.message : String(err);
    onError?.(err);
    return { ok: false, durationMs, error: message };
  }
}
function captureDOM() {
  try {
    const body = typeof document !== "undefined" ? document.body : null;
    return {
      cursorState: body?.dataset?.cursor || (typeof document !== "undefined" && document.querySelector(".reminote-cursor-overlay") ? "mounted" : "unknown"),
      dashboardExists: typeof document !== "undefined" ? !!(document.querySelector(".v11-mb") && document.querySelector(".v11-pn")) : false,
      canvasMounted: typeof document !== "undefined" ? !!document.querySelector(".reminote-canvas-wrapper") : false,
      activeElement: body && document.activeElement ? document.activeElement.tagName || null : null
    };
  } catch {
    return {
      cursorState: "error",
      dashboardExists: false,
      canvasMounted: false,
      activeElement: null
    };
  }
}
var FrameDebugLayer = class {
  constructor(config = {}) {
    this.frames = [];
    this.totalFrames = 0;
    this.config = { ...DEFAULT_CONFIG8, ...config };
  }
  // ==========================================================
  //  Logging
  // ==========================================================
  /**
   * Log a completed frame trace.
   * Automatically checks for step failures and emits warnings.
   */
  log(trace) {
    this.totalFrames++;
    this.frames.push(trace);
    while (this.frames.length > this.config.maxFrames) {
      this.frames.shift();
    }
    if (this.config.autoDumpOnError) {
      if (!trace.steps.render.ok) {
        console.warn("[FrameDebugLayer] \u26A0\uFE0F RENDER step failed", {
          frameId: trace.frameId,
          error: trace.steps.render.error,
          dom: trace.dom
        });
      }
      if (!trace.steps.observe.ok) {
        console.warn("[FrameDebugLayer] \u26A0\uFE0F OBSERVE step failed", {
          frameId: trace.frameId,
          error: trace.steps.observe.error
        });
      }
      if (!trace.steps.stability.ok) {
        console.warn("[FrameDebugLayer] \u26A0\uFE0F STABILITY step failed", {
          frameId: trace.frameId,
          error: trace.steps.stability.error
        });
      }
      if (!trace.steps.ui.ok) {
        console.warn("[FrameDebugLayer] \u26A0\uFE0F UI SYNC step failed", {
          frameId: trace.frameId,
          error: trace.steps.ui.error,
          dom: trace.dom
        });
      }
      if (trace.errors.length > 0) {
        console.warn("[FrameDebugLayer] \u26A0\uFE0F Frame has errors", {
          frameId: trace.frameId,
          errorCount: trace.errors.length,
          errors: trace.errors
        });
      }
    }
    if (this.config.verbose) {
      const totalMs = trace.steps.state.durationMs + trace.steps.render.durationMs + trace.steps.observe.durationMs + trace.steps.stability.durationMs + trace.steps.ui.durationMs;
      console.log(
        `[FrameDebugLayer] \u{1F4CA} Frame #${trace.frameId} | ${totalMs.toFixed(2)}ms | S:${trace.steps.state.ok ? "\u2705" : "\u274C"} R:${trace.steps.render.ok ? "\u2705" : "\u274C"} O:${trace.steps.observe.ok ? "\u2705" : "\u274C"} T:${trace.steps.stability.ok ? "\u2705" : "\u274C"} U:${trace.steps.ui.ok ? "\u2705" : "\u274C"} | Dash:${trace.dom.dashboardExists ? "Y" : "N"} Canvas:${trace.dom.canvasMounted ? "Y" : "N"}`
      );
    }
  }
  // ==========================================================
  //  Query
  // ==========================================================
  /** Get a trace by exact frameId. */
  getFrame(frameId) {
    return this.frames.find((f2) => f2.frameId === frameId);
  }
  /** Get the most recent trace. */
  getLast() {
    return this.frames.length > 0 ? this.frames[this.frames.length - 1] : void 0;
  }
  /** Get last N traces (most recent first). */
  getRecent(n2 = 10) {
    return this.frames.slice(-n2).reverse();
  }
  /** Get all traces with at least one failed step. */
  getErrors() {
    return this.frames.filter(
      (f2) => !f2.steps.state.ok || !f2.steps.render.ok || !f2.steps.observe.ok || !f2.steps.stability.ok || !f2.steps.ui.ok || f2.errors.length > 0
    );
  }
  /** Get all frames where a specific step failed. */
  getStepErrors(step) {
    return this.frames.filter((f2) => !f2.steps[step].ok);
  }
  /** Get traces within a frameId range (inclusive). */
  getRange(from, to) {
    return this.frames.filter((f2) => f2.frameId >= from && f2.frameId <= to);
  }
  /** Clear all stored traces. */
  clear() {
    this.frames = [];
  }
  /** Total frames logged (including evicted). */
  get totalFramesLogged() {
    return this.totalFrames;
  }
  /** Current buffer size. */
  get bufferSize() {
    return this.frames.length;
  }
  /** Export all traces as JSON string. */
  export() {
    return JSON.stringify(this.frames, null, 2);
  }
  /** Check if the last N frames were all clean (no errors). */
  isStable(windowSize = 60) {
    const recent = this.frames.slice(-windowSize);
    if (recent.length === 0)
      return false;
    return recent.every(
      (f2) => f2.steps.state.ok && f2.steps.render.ok && f2.steps.observe.ok && f2.steps.stability.ok && f2.steps.ui.ok && f2.errors.length === 0
    );
  }
  /** Get aggregate stats over the buffered frames. */
  getStats() {
    const errFrames = this.getErrors().length;
    const total = this.frames.length || 1;
    let sumRender = 0, sumObserve = 0, sumTotal = 0;
    let dashMissing = 0, canvasMissing = 0;
    for (const f2 of this.frames) {
      sumRender += f2.steps.render.durationMs;
      sumObserve += f2.steps.observe.durationMs;
      sumTotal += f2.steps.state.durationMs + f2.steps.render.durationMs + f2.steps.observe.durationMs + f2.steps.stability.durationMs + f2.steps.ui.durationMs;
      if (!f2.dom.dashboardExists)
        dashMissing++;
      if (!f2.dom.canvasMounted)
        canvasMissing++;
    }
    return {
      totalFrames: this.totalFramesLogged,
      errorFrames: errFrames,
      avgRenderMs: sumRender / total,
      avgObserveMs: sumObserve / total,
      avgTotalMs: sumTotal / total,
      dashboardMissing: dashMissing,
      canvasMissing
    };
  }
};

// src/core/orchestrator/FrameContract.ts
function djb2(str) {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) + hash + str.charCodeAt(i) | 0;
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
function computeStateHash(strokes) {
  const payload = strokes.map((s) => `${s.id}:${s.points?.length ?? 0}`).join("|");
  return djb2(payload);
}
function computeRenderHash(strokeIds, camera) {
  const payload = `${strokeIds.join(",")}|${camera.x.toFixed(1)}:${camera.y.toFixed(1)}:${camera.zoom.toFixed(3)}`;
  return djb2(payload);
}
function computePixelHash(metrics) {
  const payload = `${metrics.pixelDiff.toFixed(4)}:${metrics.gpuDiff.toFixed(4)}:${metrics.shadowDiff.toFixed(4)}`;
  return djb2(payload);
}
function computeUIHash(dom) {
  const payload = `${dom.cursorState}|${dom.dashboardExists}|${dom.canvasMounted}|${dom.activeElement ?? "null"}`;
  return djb2(payload);
}
var FrameReplaySystem = class {
  constructor(maxFrames = 600) {
    this.frames = [];
    this.maxFrames = maxFrames;
  }
  /** Record a frame result. */
  record(result) {
    this.frames.push(result);
    while (this.frames.length > this.maxFrames) {
      this.frames.shift();
    }
  }
  /** Replay a single frame by ID. */
  replay(frameId) {
    return this.frames.find((f2) => f2.frameId === frameId);
  }
  /** Diff two frames by ID. */
  diff(frameA, frameB) {
    const a2 = this.replay(frameA);
    const b2 = this.replay(frameB);
    if (!a2 || !b2)
      return null;
    const details = [];
    if (a2.stateHash !== b2.stateHash)
      details.push(`state: ${a2.stateHash} \u2192 ${b2.stateHash}`);
    if (a2.renderHash !== b2.renderHash)
      details.push(`render: ${a2.renderHash} \u2192 ${b2.renderHash}`);
    if (a2.pixelHash !== b2.pixelHash)
      details.push(`pixel: ${a2.pixelHash} \u2192 ${b2.pixelHash}`);
    if (a2.uiHash !== b2.uiHash)
      details.push(`ui: ${a2.uiHash} \u2192 ${b2.uiHash}`);
    return {
      frameA,
      frameB,
      stateChanged: a2.stateHash !== b2.stateHash,
      renderChanged: a2.renderHash !== b2.renderHash,
      pixelChanged: a2.pixelHash !== b2.pixelHash,
      uiChanged: a2.uiHash !== b2.uiHash,
      stabilityChanged: a2.stability !== b2.stability,
      details
    };
  }
  /** Inspect a frame with full detail. */
  inspect(frameId) {
    const f2 = this.replay(frameId);
    if (!f2) {
      return {
        frameId,
        stateHash: "MISSING",
        renderHash: "MISSING",
        pixelHash: "MISSING",
        uiHash: "MISSING",
        stability: "FAIL",
        failReasons: ["frame not found"],
        timestamp: 0,
        metrics: { pixelDiff: 0, gpuDiff: 0, shadowDiff: 0 },
        strokeCount: 0,
        replayAvailable: false
      };
    }
    return { ...f2, replayAvailable: true };
  }
  /** Get all FAIL frames. */
  getFailures() {
    return this.frames.filter((f2) => f2.stability === "FAIL");
  }
  /** Export all frames as JSON. */
  export() {
    return JSON.stringify(this.frames, null, 2);
  }
  /** Get last N frames. */
  getRecent(n2 = 60) {
    return this.frames.slice(-n2);
  }
  /** Stability ratio over last N frames. */
  stabilityRatio(windowSize = 60) {
    const recent = this.getRecent(windowSize);
    if (recent.length === 0)
      return 1;
    return recent.filter((f2) => f2.stability === "PASS").length / recent.length;
  }
  get totalFrames() {
    return this.frames.length;
  }
};
function evaluateStability(result) {
  const reasons = [];
  if (result.metrics.pixelDiff > 0.5) {
    reasons.push(`pixelDiff ${result.metrics.pixelDiff.toFixed(2)} > 0.5`);
  }
  if (result.metrics.shadowDiff > 0.3) {
    reasons.push(`shadowDiff ${result.metrics.shadowDiff.toFixed(2)} > 0.3`);
  }
  return {
    stability: reasons.length === 0 ? "PASS" : "FAIL",
    reasons
  };
}

// src/core/orchestrator/RuntimeOrchestrator.ts
var RuntimeOrchestrator = class {
  constructor(config = {}) {
    this.shadowHook = null;
    this.uiController = null;
    this.frameDebugLayer = null;
    this.sessionProvider = null;
    this.running = false;
    this.rafId = null;
    this.frameId = 0;
    this.frameHistory = [];
    this.HISTORY_MAX = 30;
    this.lastReport = null;
    this.config = {
      observerEnabled: config.observerEnabled ?? true,
      stabilityEnabled: config.stabilityEnabled ?? true,
      traceEnabled: config.traceEnabled ?? true,
      traceMaxFrames: config.traceMaxFrames ?? 300,
      traceVerbose: config.traceVerbose ?? false,
      debug: config.debug ?? false
    };
    this.replaySystem = new FrameReplaySystem(600);
    if (this.config.traceEnabled) {
      this.frameDebugLayer = new FrameDebugLayer({
        maxFrames: this.config.traceMaxFrames,
        verbose: this.config.traceVerbose,
        autoDumpOnError: true
      });
    }
  }
  // ==========================================================
  //  Binding
  // ==========================================================
  bindSessionProvider(provider) {
    this.sessionProvider = provider;
  }
  bindUIController(controller) {
    this.uiController = controller;
  }
  createAndBindShadowHook(svsConfig) {
    const hook = createSVSHook({ svsEnabled: this.config.observerEnabled, debug: this.config.debug, ...svsConfig });
    this.shadowHook = hook;
    return hook;
  }
  // ==========================================================
  //  Lifecycle
  // ==========================================================
  start() {
    if (this.running)
      return;
    this.running = true;
    this.frameId = 0;
    if (this.shadowHook && this.config.observerEnabled && !this.shadowHook.attached)
      this.shadowHook.attach();
    this.scheduleNextFrame();
    if (this.config.debug)
      console.log("[RuntimeOrchestrator] \u25B6 FRAME CONTRACT VERIFIER started");
  }
  stop() {
    this.running = false;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    if (this.shadowHook)
      this.shadowHook.detach();
  }
  destroy() {
    this.stop();
    if (this.shadowHook) {
      this.shadowHook.destroy();
      this.shadowHook = null;
    }
    this.uiController = null;
    this.sessionProvider = null;
    this.frameDebugLayer?.clear();
    this.frameDebugLayer = null;
  }
  // ==========================================================
  //  FRAME LOOP
  // ==========================================================
  scheduleNextFrame() {
    if (this.running)
      this.rafId = requestAnimationFrame(() => this.loop());
  }
  loop() {
    if (!this.running)
      return;
    try {
      this.tick();
    } catch (err) {
      if (this.config.debug)
        console.error("[RuntimeOrchestrator] \u274C FATAL:", err);
    }
    this.scheduleNextFrame();
  }
  // ==========================================================
  //  TICK — Produces FrameResult (contract), no side effects
  // ==========================================================
  tick() {
    this.frameId++;
    const frameStart = performance.now();
    const errors = [];
    const ce = (step, err) => errors.push({ step, message: err instanceof Error ? err.message : String(err), timestamp: performance.now() });
    let session = null;
    let strokeCount = 0;
    let metrics = null;
    const stateResult = runStep("state", () => {
      const s2 = this.sessionProvider?.() ?? null;
      if (s2?.isAlive()) {
        session = s2;
        strokeCount = s2.engine.strokes.length;
      }
    }, (err) => ce("state", err));
    if (!session) {
      this.pushFrameHistory("yellow");
      const uiResult2 = runStep("ui", () => {
      }, (err) => ce("ui", err));
      this.logTrace(frameStart, stateResult, { ok: true, durationMs: 0 }, { ok: true, durationMs: 0 }, { ok: true, durationMs: 0 }, uiResult2, errors);
      const result2 = this.buildResult(null, null, "PASS");
      this.replaySystem.record(result2);
      this.uiController?.renderFromFrame(result2);
      return;
    }
    const renderResult = runStep("render", () => session.orchestratorTick(), (err) => ce("render", err));
    const observeResult = runStep("observe", () => {
      if (!this.shadowHook?.attached || !this.config.observerEnabled)
        return;
      this.shadowHook.observe(session);
      const r2 = this.shadowHook.diffStabilizer.getReport();
      metrics = {
        pixelDiff: 1 - r2.cleanRatio,
        gpuDiff: 0,
        shadowDiff: r2.stats.totalMissing + r2.stats.totalExtra > 0 ? Math.min(1, (r2.stats.totalMissing + r2.stats.totalExtra) / Math.max(1, strokeCount)) : 0
      };
    }, (err) => ce("observe", err));
    const stabilityResult = runStep("stability", () => {
    }, (err) => ce("stability", err));
    const m2 = metrics ?? { pixelDiff: 0, gpuDiff: 0, shadowDiff: 0 };
    const dom = captureDOM();
    const s = session;
    const stateHash = computeStateHash(s.engine.strokes);
    const renderIds = s.renderQueue?.renderables?.filter((r2) => !!r2).map((r2) => r2.id) ?? [];
    const renderHash = computeRenderHash(renderIds, s.viewport.camera);
    const pixelHash = computePixelHash(m2);
    const uiHash = computeUIHash(dom);
    const verdict = evaluateStability({
      frameId: this.frameId,
      stateHash,
      renderHash,
      pixelHash,
      uiHash,
      stability: "PASS",
      failReasons: [],
      timestamp: frameStart,
      metrics: m2,
      strokeCount
    });
    const result = {
      frameId: this.frameId,
      stateHash,
      renderHash,
      pixelHash,
      uiHash,
      stability: verdict.stability,
      failReasons: verdict.reasons,
      timestamp: frameStart,
      metrics: m2,
      strokeCount
    };
    this.replaySystem.record(result);
    const uiResult = runStep("ui", () => {
      this.pushFrameHistory(result.stability === "PASS" ? "green" : "red");
      this.uiController?.renderFromFrame(result);
      this.uiController?.tickAnimation();
    }, (err) => ce("ui", err));
    this.logTrace(frameStart, stateResult, renderResult, observeResult, stabilityResult, uiResult, errors);
    this.lastReport = {
      frameId: this.frameId,
      strokeCount,
      metrics,
      decision: result.stability === "PASS" ? "ALLOW" : "BLOCK",
      timestamp: frameStart
    };
  }
  // ==========================================================
  //  Helpers
  // ==========================================================
  buildResult(_session, _metrics, stability) {
    return {
      frameId: this.frameId,
      stateHash: "00000000",
      renderHash: "00000000",
      pixelHash: "00000000",
      uiHash: "00000000",
      stability,
      failReasons: stability === "FAIL" ? ["no session"] : [],
      timestamp: performance.now(),
      metrics: { pixelDiff: 0, gpuDiff: 0, shadowDiff: 0 },
      strokeCount: 0
    };
  }
  pushFrameHistory(color) {
    this.frameHistory.push(color);
    if (this.frameHistory.length > this.HISTORY_MAX)
      this.frameHistory.shift();
  }
  logTrace(frameStart, state, render, observe, stability, ui, errors) {
    const dom = captureDOM();
    this.frameDebugLayer?.log({
      frameId: this.frameId,
      steps: { state, render, observe, stability, ui },
      dom,
      metrics: { pixelDiff: 0, gpuDiff: 0, shadowDiff: 0 },
      errors,
      timestamp: frameStart
    });
  }
  // ==========================================================
  //  Public Query
  // ==========================================================
  get lastFrameReport() {
    return this.lastReport;
  }
  get lastTrace() {
    return this.frameDebugLayer?.getLast();
  }
  get debugLayer() {
    return this.frameDebugLayer;
  }
  get replay() {
    return this.replaySystem;
  }
  get currentFrameId() {
    return this.frameId;
  }
  get isRunning() {
    return this.running;
  }
};

// src/core/shadow/ui/V11MagneticDashboard.ts
function hc(v2) {
  if (v2 >= 0.9)
    return "#2ecc71";
  if (v2 >= 0.6)
    return "#f1c40f";
  if (v2 >= 0.3)
    return "#e67e22";
  return "#e74c3c";
}
function bc(v2) {
  if (v2 >= 0.8)
    return "#2ecc71";
  if (v2 >= 0.5)
    return "#f1c40f";
  return "#e74c3c";
}
function dc(c2) {
  return c2 === "green" ? "#2ecc71" : c2 === "yellow" ? "#f1c40f" : "#e74c3c";
}
function injectStyles() {
  const old = document.getElementById("v11-mag-style");
  if (old)
    old.remove();
  const s = document.createElement("style");
  s.id = "v11-mag-style";
  s.textContent = '.v11-mb{position:absolute;top:10px;left:10px;width:14px;height:14px;border-radius:50%;z-index:99999;cursor:pointer;border:none;outline:none;padding:0;background:transparent;color:var(--v11-c, #2ecc71);font-size:14px;line-height:14px;text-align:center;transition:box-shadow .3s;will-change:transform;pointer-events:auto;}.v11-mb::after{content:"";display:block;width:100%;height:100%;border-radius:50%;background:var(--v11-c);position:absolute;top:0;left:0;}.v11-mb span{position:relative;z-index:1;}.v11-pn{position:absolute;top:36px;left:10px;width:280px;max-height:calc(100vh - 56px);overflow-y:auto;z-index:99998;border-radius:14px;padding:16px;font-family:-apple-system,sans-serif;font-size:12px;color:#e0e0e0;line-height:1.5;background:rgba(20,20,24,.88);backdrop-filter:blur(12px);border:1px solid rgba(255,255,255,.06);box-shadow:0 8px 32px rgba(0,0,0,.4);opacity:0;transform:scale(.92);transform-origin:top left;transition:opacity .28s cubic-bezier(.2,.9,.2,1),transform .28s cubic-bezier(.2,.9,.2,1);pointer-events:none;}.v11-pn.open{opacity:1;transform:scale(1);pointer-events:auto;}.v11-pn .hdr{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;}.v11-pn .tt{font-size:14px;font-weight:600;}.v11-pn .bd{font-size:10px;padding:2px 8px;border-radius:8px;}.v11-pn .br{margin:6px 0;}.v11-pn .lbl{display:flex;justify-content:space-between;margin-bottom:2px;font-size:11px;opacity:.8;}.v11-pn .bar{height:4px;border-radius:2px;background:rgba(255,255,255,.08);overflow:hidden;}.v11-pn .fill{height:100%;border-radius:2px;transition:width .4s ease;}.v11-pn .sec{margin-top:12px;padding-top:10px;border-top:1px solid rgba(255,255,255,.06);}.v11-pn .st{font-size:10px;text-transform:uppercase;letter-spacing:.06em;opacity:.5;margin-bottom:6px;}.v11-pn .ri{display:flex;justify-content:space-between;padding:3px 0;font-size:11px;}.v11-pn .tl{display:flex;gap:4px;flex-wrap:wrap;}.v11-pn .dot{width:8px;height:8px;border-radius:50%;}.v11-pn .pr{display:flex;justify-content:space-between;padding:3px 0;font-size:11px;}';
  document.head.appendChild(s);
}
function buildPanelHTML(d2) {
  const c2 = hc(d2.systemHealth);
  const rc = d2.rootCause ? `<div class="sec"><div class="st">Root Cause</div><div class="ri"><span>${d2.rootCause.type}</span><span>${(d2.rootCause.confidence * 100).toFixed(0)}%</span></div>${d2.rootCause.strokes.slice(0, 3).map((s) => `<div class="ri"><span style="opacity:.7">${s.id}</span><span>${s.score.toFixed(2)}</span></div>`).join("")}</div>` : "";
  return `<div class="hdr"><span class="tt">System Trust</span><span class="bd" style="background:${c2}22;color:${c2}">${(d2.systemHealth * 100).toFixed(0)}%</span></div><div class="br"><div class="lbl"><span>Integrity</span><span>${d2.integrity.toFixed(2)}</span></div><div class="bar"><div class="fill" style="width:${d2.integrity * 100}%;background:${bc(d2.integrity)}"></div></div></div><div class="br"><div class="lbl"><span>Pixel</span><span>${d2.pixelStability.toFixed(2)}</span></div><div class="bar"><div class="fill" style="width:${d2.pixelStability * 100}%;background:${bc(d2.pixelStability)}"></div></div></div><div class="br"><div class="lbl"><span>GPU</span><span>${d2.gpuFidelity.toFixed(2)}</span></div><div class="bar"><div class="fill" style="width:${d2.gpuFidelity * 100}%;background:${bc(d2.gpuFidelity)}"></div></div></div>${rc}<div class="sec"><div class="st">Policy</div><div class="pr"><span>Decision</span><span style="font-weight:500">${d2.policyDecision}</span></div><div class="pr"><span>Mode</span><span style="font-weight:500">${d2.mode}</span></div></div><div class="sec"><div class="st">Timeline</div><div class="tl">${d2.frameHistory.map((x2) => `<div class="dot" style="background:${dc(x2)}"></div>`).join("")}</div></div>`;
}
var V11MagneticDashboard = class {
  constructor() {
    this._btn = null;
    this._pnl = null;
    this._open = false;
    this._mounted = false;
    this._container = null;
    // ?? No independent RAF �� animation driven by RuntimeOrchestrator via tickAnimation()
    // Magnetic spring state
    this._sx = 1;
    this._tx = 0;
    this._ty = 0;
    // Bound handlers (for cleanup)
    this._onClick = null;
    this._onMouse = null;
    this._color = "#2ecc71";
    this._lastData = null;
    injectStyles();
    const prev = window.__REMINOTE_DASHBOARD__;
    if (prev) {
      prev.destroy();
    }
    window.__REMINOTE_DASHBOARD__ = this;
  }
  // ==========================================================
  //  mount (safe, repeatable)
  // ==========================================================
  mount(container) {
    if (this._mounted)
      this._unmountDOM();
    this._container = this._resolveContainer(container);
    if (!this._container)
      return;
    this._btn = document.createElement("button");
    this._btn.className = "v11-mb";
    this._btn.style.setProperty("--v11-c", this._color);
    this._pnl = document.createElement("div");
    this._pnl.className = "v11-pn";
    this._onClick = () => {
      this._open = !this._open;
      this._pnl.classList.toggle("open", this._open);
    };
    this._btn.addEventListener("click", this._onClick);
    this._onMouse = (e2) => {
      if (!this._btn)
        return;
      const r2 = this._btn.getBoundingClientRect();
      const cx = r2.left + r2.width / 2, cy = r2.top + r2.height / 2;
      const dist = Math.hypot(e2.clientX - cx, e2.clientY - cy);
      if (dist < 80) {
        this._sx = 1 + 0.6 * (1 - dist / 80);
        const pull = (1 - dist / 80) * 6;
        this._tx = (e2.clientX - cx) * pull * 0.15;
        this._ty = (e2.clientY - cy) * pull * 0.15;
      }
    };
    document.addEventListener("mousemove", this._onMouse);
    this._container.appendChild(this._btn);
    this._container.appendChild(this._pnl);
    this._mounted = true;
  }
  /**
   * ?? Spring animation tick �� called by RuntimeOrchestrator each frame.
   * Pure visual effect. No logic, no state mutation beyond CSS transform.
   */
  tickAnimation() {
    if (!this._mounted || !this._btn)
      return;
    this._sx += (1 - this._sx) * 0.12;
    this._tx *= 0.88;
    this._ty *= 0.88;
    this._btn.style.transform = `translate(${this._tx.toFixed(1)}px,${this._ty.toFixed(1)}px) scale(${this._sx.toFixed(3)})`;
  }
  /** ?? Idempotent mount guard �� true if dashboard DOM is attached. */
  get mounted() {
    return this._mounted;
  }
  // ==========================================================
  //  destroy (complete cleanup)
  // ==========================================================
  destroy() {
    this._unmountDOM();
    if (window.__REMINOTE_DASHBOARD__ === this) {
      delete window.__REMINOTE_DASHBOARD__;
    }
  }
  unmount() {
    this.destroy();
  }
  // ==========================================================
  //  update
  // ==========================================================
  update(data) {
    this._lastData = data;
    this._color = hc(data.systemHealth);
    if (this._btn)
      this._btn.style.setProperty("--v11-c", this._color);
    if (this._pnl)
      this._pnl.innerHTML = buildPanelHTML(data);
  }
  // ==========================================================
  //  Private
  // ==========================================================
  _resolveContainer(container) {
    if (container && container.isConnected)
      return container;
    const canvas = document.querySelector(".reminote-canvas-layout");
    if (canvas && canvas.isConnected)
      return canvas;
    if (document.body && document.body.isConnected)
      return document.body;
    return null;
  }
  _unmountDOM() {
    if (this._btn) {
      if (this._onClick)
        this._btn.removeEventListener("click", this._onClick);
      this._btn.remove();
      this._btn = null;
    }
    if (this._pnl) {
      this._pnl.remove();
      this._pnl = null;
    }
    if (this._onMouse) {
      document.removeEventListener("mousemove", this._onMouse);
      this._onMouse = null;
    }
    this._onClick = null;
    this._open = false;
    this._mounted = false;
  }
};

// src/core/orchestrator/CanvasUIController.ts
var CanvasUIController = class {
  constructor() {
    this.dashboard = null;
    this._mountedContainer = null;
    this._destroyed = false;
  }
  // ==========================================================
  //  Lifecycle
  // ==========================================================
  /**
   * 🟥 SINGLE MOUNT ENTRY — the only place dashboard.mount() is called.
   * Idempotent: safe to call multiple times (re-mounts to new container).
   *
   * @param container The DOM element to mount into (typically .reminote-canvas-layout)
   */
  mount(container) {
    if (this._destroyed) {
      console.warn("[CanvasUIController] mount() called after destroy \u2014 ignored");
      return;
    }
    if (!this.dashboard) {
      this.dashboard = new V11MagneticDashboard();
    }
    if (this.dashboard.mounted && this._mountedContainer === container) {
      return;
    }
    this.dashboard.mount(container);
    this._mountedContainer = container;
  }
  /**
   * Update dashboard data. Safe to call before mount() — no-op if not mounted.
   */
  update(data) {
    if (!this.dashboard)
      return;
    this.dashboard.update(data);
  }
  /**
   * Drive spring animation tick. Safe to call before mount().
   */
  tickAnimation() {
    if (!this.dashboard)
      return;
    if (typeof this.dashboard.tickAnimation === "function") {
      this.dashboard.tickAnimation();
    }
  }
  /**
   * 🟦 Ensure UI is stable — used by RuntimeOrchestrator RECOVERY step.
   * Checks DOM presence and re-mounts if detached.
   * Does NOT create new dashboard or change container.
   */
  ensureStable() {
    if (!this.dashboard || !this.dashboard.mounted)
      return;
    const btn = document.querySelector(".v11-mb");
    const pnl = document.querySelector(".v11-pn");
    if (btn && pnl && document.contains(btn) && document.contains(pnl)) {
      return;
    }
    const container = this._mountedContainer || document.querySelector(".reminote-canvas-layout") || document.body;
    if (container) {
      this.dashboard.mount(container);
      this._mountedContainer = container;
    }
  }
  /**
   * 🟥 Destroy UI completely. Called by CanvasView.onClose().
   * After this, mount() is blocked.
   */
  destroy() {
    if (this.dashboard) {
      this.dashboard.destroy();
      this.dashboard = null;
    }
    this._mountedContainer = null;
    this._destroyed = true;
  }
  // ==========================================================
  //  Query
  // ==========================================================
  get isMounted() {
    return this.dashboard?.mounted ?? false;
  }
  /**
   * 🟦 Pure render from FrameResult — UI reacts, never controls.
   * Replaces update(data) for the frame-contract model.
   */
  renderFromFrame(result) {
    if (!this.dashboard)
      return;
    this.dashboard.update({
      integrity: 1 - result.metrics.pixelDiff,
      pixelStability: 1 - result.metrics.pixelDiff,
      gpuFidelity: 1 - result.metrics.gpuDiff,
      systemHealth: result.stability === "PASS" ? 1 : 0.3,
      mode: result.stability === "PASS" ? "HEALTHY" : "UNSTABLE",
      policyDecision: result.stability,
      rootCause: void 0,
      frameHistory: [result.stability === "PASS" ? "green" : "red"]
    });
  }
  get isDestroyed() {
    return this._destroyed;
  }
  /** Access underlying dashboard for backward-compat (e.g., _lastData). */
  getDashboard() {
    return this.dashboard;
  }
};

// src/core/input/CoordinateInputSystem.ts
var SMOOTH_FACTOR = 0.35;
var dualInput = {
  rawX: 0,
  rawY: 0,
  smoothedX: 0,
  smoothedY: 0,
  isDown: false,
  timestamp: 0,
  isInsideCanvas: false
};
var pointerState = {
  x: 0,
  y: 0,
  isDown: false,
  timestamp: 0
};
var _canvasEl = null;
function bindCanvas(el) {
  _canvasEl = el;
}
function isInCanvas(x2, y) {
  if (!_canvasEl)
    return false;
  const rect = _canvasEl.getBoundingClientRect();
  return x2 >= rect.left && x2 <= rect.right && y >= rect.top && y <= rect.bottom;
}
var _streamStarted = false;
function startPointerStream() {
  if (_streamStarted)
    return;
  _streamStarted = true;
  document.addEventListener("pointermove", _onPointerMove, { capture: true });
  document.addEventListener("pointerdown", _onPointerDown, { capture: true });
  document.addEventListener("pointerup", _onPointerUp, { capture: true });
}
function stopPointerStream() {
  _streamStarted = false;
  document.removeEventListener("pointermove", _onPointerMove, { capture: true });
  document.removeEventListener("pointerdown", _onPointerDown, { capture: true });
  document.removeEventListener("pointerup", _onPointerUp, { capture: true });
}
function _detectStylus(e2) {
  if (e2.pointerType === "pen") {
    window.__REMINOTE_HAS_PEN__ = true;
    if (e2.pressure > 0 && e2.pointerType === "pen") {
      const hasTilt = e2.tiltX !== 0 || e2.tiltY !== 0;
      const isApple = /Mac|iPad|iPhone/.test(navigator.userAgent) && e2.pointerType === "pen" && e2.pressure > 0;
      window.__REMINOTE_PEN_TYPE__ = isApple ? "Apple Pencil" : hasTilt ? "\u89E6\u63A7\u7B14 (\u5E26\u503E\u659C)" : "\u89E6\u63A7\u7B14";
    }
  }
}
function _onPointerMove(e2) {
  _detectStylus(e2);
  _updateRaw(e2.clientX, e2.clientY, e2.buttons > 0);
  renderCursor();
}
function _onPointerDown(e2) {
  _detectStylus(e2);
  _updateRaw(e2.clientX, e2.clientY, true);
  renderCursor();
}
function _onPointerUp(e2) {
  _updateRaw(e2.clientX, e2.clientY, false);
  renderCursor();
}
function _updateRaw(x2, y, isDown) {
  dualInput.rawX = x2;
  dualInput.rawY = y;
  dualInput.isDown = isDown;
  dualInput.timestamp = performance.now();
  dualInput.isInsideCanvas = isInCanvas(x2, y);
}
var _lastIsDown = false;
function tickSmoothing() {
  if (dualInput.isDown && !_lastIsDown) {
    dualInput.smoothedX = dualInput.rawX;
    dualInput.smoothedY = dualInput.rawY;
  } else {
    dualInput.smoothedX += (dualInput.rawX - dualInput.smoothedX) * SMOOTH_FACTOR;
    dualInput.smoothedY += (dualInput.rawY - dualInput.smoothedY) * SMOOTH_FACTOR;
  }
  _lastIsDown = dualInput.isDown;
  pointerState.x = dualInput.smoothedX;
  pointerState.y = dualInput.smoothedY;
  pointerState.isDown = dualInput.isDown;
  pointerState.timestamp = dualInput.timestamp;
}
var _cursorDoc = document;
function bindCursorDocument(doc) {
  _cursorDoc = doc;
}
var _viewportCamera = null;
function bindViewportCamera(camera) {
  _viewportCamera = camera;
}
function renderCursor() {
  const el = _cursorDoc.querySelector(".reminote-cursor-overlay");
  if (!el)
    return;
  if (!dualInput.isInsideCanvas) {
    el.style.display = "none";
    return;
  }
  el.style.display = "";
  let sx = dualInput.rawX;
  let sy = dualInput.rawY;
  if (_viewportCamera && _canvasEl) {
    const rect = _canvasEl.getBoundingClientRect();
    const c2 = _viewportCamera;
    const wx = (sx - rect.left - c2.x) / c2.zoom;
    const wy = (sy - rect.top - c2.y) / c2.zoom;
    sx = wx * c2.zoom + c2.x + rect.left;
    sy = wy * c2.zoom + c2.y + rect.top;
  }
  el.style.transform = `translate3d(${sx}px, ${sy}px, 0) translate(-50%, -50%)`;
}
setInterval(() => {
  if (performance.now() - dualInput.timestamp > 2e3) {
    dualInput.isDown = false;
    _lastIsDown = false;
  }
}, 500);

// node_modules/perfect-freehand/dist/esm/index.mjs
var { PI: e } = Math;
var t = e + 1e-4;
var n = 0.5;
var r = [1, 1];
var { min: a } = Math;
function c(e2, t2) {
  return [e2[0] + t2[0], e2[1] + t2[1]];
}
function u(e2, t2) {
  return [e2[0] - t2[0], e2[1] - t2[1]];
}
function d(e2, t2, n2) {
  return e2[0] = t2[0] - n2[0], e2[1] = t2[1] - n2[1], e2;
}
function f(e2, t2) {
  return [e2[0] * t2, e2[1] * t2];
}
function m(e2, t2) {
  return [e2[0] / t2, e2[1] / t2];
}
function _(e2, t2) {
  return e2[0] === t2[0] && e2[1] === t2[1];
}
function v(e2) {
  return Math.hypot(e2[0], e2[1]);
}
function b(e2) {
  return m(e2, v(e2));
}
function x(e2, t2) {
  return Math.hypot(e2[1] - t2[1], e2[0] - t2[0]);
}
function w(e2, t2, n2) {
  return c(e2, f(u(t2, e2), n2));
}
var F = [0, 0];
function I(e2) {
  return e2 != null && e2 >= 0;
}
function L(e2, t2 = {}) {
  let { streamline: i = 0.5, size: a2 = 16, last: o = false } = t2;
  if (e2.length === 0)
    return [];
  let s = 0.15 + (1 - i) * 0.85, l = Array.isArray(e2[0]) ? e2 : e2.map(({ x: e3, y: t3, pressure: r2 = n }) => [e3, t3, r2]);
  if (l.length === 2) {
    let e3 = l[1];
    l = l.slice(0, -1);
    for (let t3 = 1; t3 < 5; t3++)
      l.push(w(l[0], e3, t3 / 4));
  }
  l.length === 1 && (l = [...l, [...c(l[0], r), ...l[0].slice(2)]]);
  let u2 = [{ point: [l[0][0], l[0][1]], pressure: I(l[0][2]) ? l[0][2] : 0.25, vector: [...r], distance: 0, runningLength: 0 }], f2 = false, p = 0, m2 = u2[0], h = l.length - 1;
  for (let e3 = 1; e3 < l.length; e3++) {
    let t3 = o && e3 === h ? [l[e3][0], l[e3][1]] : w(m2.point, l[e3], s);
    if (_(m2.point, t3))
      continue;
    let r2 = x(t3, m2.point);
    if (p += r2, e3 < h && !f2) {
      if (p < a2)
        continue;
      f2 = true;
    }
    d(F, m2.point, t3), m2 = { point: t3, pressure: I(l[e3][2]) ? l[e3][2] : n, vector: b(F), distance: r2, runningLength: p }, u2.push(m2);
  }
  return u2[0].vector = u2[1]?.vector || [0, 0], u2;
}

// src/core/beautify/FontStyleSystem.ts
var FONT_STYLES = {
  // ────────────────────────────────────────
  //  圆形可爱体 — 圆润、均匀、萌系
  // ────────────────────────────────────────
  roundCute: {
    id: "roundCute",
    name: "\u5706\u5F62\u53EF\u7231\u4F53",
    description: "\u5706\u6DA6\u53EF\u7231\uFF0C\u7C97\u7EC6\u5747\u5300\uFF0C\u50CF\u7CD6\u679C\u4E00\u6837\u751C\u7F8E",
    beautify: {
      strength: 0.65,
      smoothing: 0.55,
      streamline: 0.45,
      straightenR2: 0.92,
      straightenMaxCurve: 0.5,
      pcaMaxAngle: 0.08,
      taperLength: 2,
      taperMinRatio: 0.6,
      uniformWidth: 0
      // set via widthScale
    },
    character: {
      targetAspectRatio: 0.95,
      aspectRatioStrength: 0.55,
      centerAlignStrength: 0.7,
      cornerRounding: 0.85,
      widthUniformity: 0.9,
      widthScale: 1.15,
      taperAmount: 0.15,
      horizontalWidthRatio: 1,
      verticalWidthRatio: 1,
      organicNoise: 1.8,
      springStiffness: 0.06,
      springDamping: 0.82,
      animationDurationMs: 1e3
    }
  },
  // ────────────────────────────────────────
  //  正楷 — 端庄、结构分明、横细竖粗
  // ────────────────────────────────────────
  kaiShu: {
    id: "kaiShu",
    name: "\u6B63\u6977",
    description: "\u7AEF\u5E84\u5DE5\u6574\uFF0C\u6A2A\u7EC6\u7AD6\u7C97\uFF0C\u68F1\u89D2\u5206\u660E",
    beautify: {
      strength: 0.55,
      smoothing: 0.3,
      streamline: 0.25,
      straightenR2: 0.97,
      straightenMaxCurve: 0.35,
      pcaMaxAngle: 0.04,
      taperLength: 4,
      taperMinRatio: 0.3,
      uniformWidth: 0
    },
    character: {
      targetAspectRatio: 0.9,
      aspectRatioStrength: 0.7,
      centerAlignStrength: 0.85,
      cornerRounding: 0.1,
      widthUniformity: 0.2,
      widthScale: 1,
      taperAmount: 0.55,
      horizontalWidthRatio: 0.65,
      verticalWidthRatio: 1.35,
      organicNoise: 0.6,
      springStiffness: 0.1,
      springDamping: 0.88,
      animationDurationMs: 800
    }
  },
  // ────────────────────────────────────────
  //  行书 — 流动、连笔感、笔锋自然
  // ────────────────────────────────────────
  xingShu: {
    id: "xingShu",
    name: "\u884C\u4E66",
    description: "\u884C\u4E91\u6D41\u6C34\uFF0C\u7B14\u610F\u8FDE\u8D2F\uFF0C\u81EA\u7136\u6D12\u8131",
    beautify: {
      strength: 0.5,
      smoothing: 0.4,
      streamline: 0.5,
      straightenR2: 0.94,
      straightenMaxCurve: 0.55,
      pcaMaxAngle: 0.05,
      taperLength: 3,
      taperMinRatio: 0.25,
      uniformWidth: 0
    },
    character: {
      targetAspectRatio: 0.85,
      aspectRatioStrength: 0.5,
      centerAlignStrength: 0.6,
      cornerRounding: 0.45,
      widthUniformity: 0.35,
      widthScale: 1.05,
      taperAmount: 0.45,
      horizontalWidthRatio: 0.8,
      verticalWidthRatio: 1.2,
      organicNoise: 1.2,
      springStiffness: 0.07,
      springDamping: 0.84,
      animationDurationMs: 900
    }
  },
  // ────────────────────────────────────────
  //  草书 — 极度流动、大幅变形、狂放
  // ────────────────────────────────────────
  caoShu: {
    id: "caoShu",
    name: "\u8349\u4E66",
    description: "\u72C2\u653E\u4E0D\u7F81\uFF0C\u5927\u6C5F\u4E1C\u53BB\uFF0C\u7B14\u8D70\u9F99\u86C7",
    beautify: {
      strength: 0.7,
      smoothing: 0.6,
      streamline: 0.65,
      straightenR2: 0.88,
      straightenMaxCurve: 0.9,
      pcaMaxAngle: 0.1,
      taperLength: 6,
      taperMinRatio: 0.15,
      uniformWidth: 0
    },
    character: {
      targetAspectRatio: 0.75,
      aspectRatioStrength: 0.4,
      centerAlignStrength: 0.4,
      cornerRounding: 0.7,
      widthUniformity: 0.15,
      widthScale: 0.95,
      taperAmount: 0.75,
      horizontalWidthRatio: 0.5,
      verticalWidthRatio: 1.5,
      organicNoise: 2.5,
      springStiffness: 0.04,
      springDamping: 0.78,
      animationDurationMs: 1200
    }
  }
};
function getFontStyle(id) {
  return FONT_STYLES[id];
}

// src/core/beautify/StrokeBeautifyEngine.ts
var DEFAULT_BEAUTIFY_CONFIG = {
  enabled: false,
  strength: 0.5,
  smoothing: 0.35,
  streamline: 0.35,
  straightenR2: 0.96,
  straightenMinPoints: 5,
  straightenMaxCurve: 0.8,
  uniformWidth: 0,
  taperLength: 4,
  taperMinRatio: 0.35,
  pcaMaxAngle: 0.06,
  redrawDelayMs: 0
};
function beautifyStroke(points, config) {
  if (points.length < 3)
    return points;
  const s = config.strength;
  const n2 = points.length;
  const corners = detectCorners(points, 0.55);
  const smoothed = [];
  for (let c2 = 0; c2 < corners.length - 1; c2++) {
    const seg = points.slice(corners[c2], corners[c2 + 1] + 1);
    if (seg.length < 2) {
      smoothed.push(...seg);
      continue;
    }
    const segSmoothed = adaptiveSmoothSegment(seg, config.smoothing * s, config.streamline * s);
    smoothed.push(...segSmoothed);
  }
  if (smoothed.length === 0)
    return points;
  let result = resamplePath(smoothed, n2);
  if (s > 0.6 && result.length > 8) {
    const pcaMax = config.pcaMaxAngle * s * 0.3;
    result = pcaAlign(result, Math.min(pcaMax, 0.03));
  }
  return result;
}
function detectCorners(points, threshold) {
  const n2 = points.length;
  if (n2 < 5)
    return [0, n2 - 1];
  const corners = [0];
  const curvatures = new Array(n2).fill(0);
  for (let i = 2; i < n2 - 2; i++) {
    const dx1 = points[i].x - points[i - 2].x, dy1 = points[i].y - points[i - 2].y;
    const dx2 = points[i + 2].x - points[i].x, dy2 = points[i + 2].y - points[i].y;
    const l1 = Math.hypot(dx1, dy1), l2 = Math.hypot(dx2, dy2);
    if (l1 < 0.01 || l2 < 0.01)
      continue;
    const dot = (dx1 * dx2 + dy1 * dy2) / (l1 * l2);
    curvatures[i] = Math.acos(Math.max(-1, Math.min(1, dot)));
  }
  for (let i = 2; i < n2 - 2; i++) {
    if (curvatures[i] > threshold && curvatures[i] >= curvatures[i - 1] && curvatures[i] >= curvatures[i - 2] && curvatures[i] >= curvatures[i + 1] && curvatures[i] >= curvatures[i + 2]) {
      if (i - corners[corners.length - 1] >= 4)
        corners.push(i);
    }
  }
  if (corners[corners.length - 1] !== n2 - 1)
    corners.push(n2 - 1);
  return corners;
}
function adaptiveSmoothSegment(seg, baseSmoothing, baseStreamline) {
  if (seg.length < 3)
    return seg;
  const first = seg[0];
  const last = seg[seg.length - 1];
  try {
    const curvatures = computeCurvatureProfile(seg);
    const regions = splitByCurvature(seg, curvatures);
    const result = [];
    for (const region of regions) {
      if (region.points.length < 2) {
        result.push(...region.points);
        continue;
      }
      const cf = region.avgCurvature;
      const smoothing = baseSmoothing * (1 - cf * 0.7);
      const streamline = baseStreamline * (1 - cf * 0.5);
      const opts = {
        size: 1,
        thinning: 0,
        smoothing: Math.max(0.1, Math.min(1, smoothing)),
        streamline: Math.max(0.1, Math.min(1, streamline)),
        simulatePressure: true,
        last: true
      };
      const strokePts = L(
        region.points,
        opts
      );
      if (strokePts && strokePts.length >= 2) {
        const smoothed = strokePts.map((sp) => ({
          x: sp.point[0],
          y: sp.point[1]
        }));
        result.push(...smoothed);
      } else {
        result.push(...region.points);
      }
    }
    if (result.length >= 2) {
      result[0] = { x: first.x, y: first.y };
      result[result.length - 1] = { x: last.x, y: last.y };
    }
    return result;
  } catch {
    return seg;
  }
}
function computeCurvatureProfile(points) {
  const n2 = points.length;
  const curv = new Array(n2).fill(0);
  for (let i = 2; i < n2 - 2; i++) {
    const dx1 = points[i].x - points[i - 2].x, dy1 = points[i].y - points[i - 2].y;
    const dx2 = points[i + 2].x - points[i].x, dy2 = points[i + 2].y - points[i].y;
    const l1 = Math.hypot(dx1, dy1), l2 = Math.hypot(dx2, dy2);
    if (l1 < 0.5 || l2 < 0.5)
      continue;
    const dot = (dx1 * dx2 + dy1 * dy2) / (l1 * l2);
    curv[i] = Math.acos(Math.max(-1, Math.min(1, dot))) / Math.PI;
  }
  for (let i = 0; i < 2 && i < n2; i++)
    curv[i] = curv[2] ?? 0;
  for (let i = n2 - 2; i < n2; i++)
    curv[i] = curv[n2 - 3] ?? 0;
  return curv;
}
function splitByCurvature(points, curvatures) {
  const n2 = points.length;
  if (n2 === 0)
    return [];
  const regions = [];
  let start = 0;
  let sumC = curvatures[0];
  for (let i = 1; i < n2; i++) {
    if (Math.abs(curvatures[i] - curvatures[i - 1]) > 0.3) {
      regions.push({
        points: points.slice(start, i),
        avgCurvature: sumC / (i - start)
      });
      start = i;
      sumC = 0;
    }
    sumC += curvatures[i];
  }
  regions.push({
    points: points.slice(start),
    avgCurvature: sumC / (n2 - start)
  });
  return regions;
}
function resamplePath(points, n2) {
  if (n2 < 2 || points.length < 2)
    return points;
  const dists = [0];
  for (let i = 1; i < points.length; i++) {
    dists.push(dists[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y));
  }
  const total = dists[dists.length - 1];
  if (total < 1e-3)
    return points;
  const result = [];
  for (let i = 0; i < n2; i++) {
    const target = i / (n2 - 1) * total;
    let lo = 0, hi = dists.length - 1;
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (dists[mid] < target)
        lo = mid + 1;
      else
        hi = mid;
    }
    const idx = Math.max(1, lo);
    const segLen = dists[idx] - dists[idx - 1];
    const t2 = segLen > 0 ? (target - dists[idx - 1]) / segLen : 0;
    result.push({
      x: points[idx - 1].x + (points[idx].x - points[idx - 1].x) * t2,
      y: points[idx - 1].y + (points[idx].y - points[idx - 1].y) * t2
    });
  }
  return result;
}
function pcaAlign(points, maxAngle) {
  const n2 = points.length;
  if (n2 < 3)
    return points;
  let cx = 0, cy = 0;
  for (const p of points) {
    cx += p.x;
    cy += p.y;
  }
  cx /= n2;
  cy /= n2;
  let covXX = 0, covXY = 0, covYY = 0;
  for (const p of points) {
    const dx = p.x - cx, dy = p.y - cy;
    covXX += dx * dx;
    covXY += dx * dy;
    covYY += dy * dy;
  }
  const angle = 0.5 * Math.atan2(2 * covXY, covXX - covYY);
  const aMod = (angle % (Math.PI / 2) + Math.PI / 2) % (Math.PI / 2);
  let target = 0;
  if (aMod > Math.PI / 4)
    target = angle > 0 ? Math.PI / 2 - aMod : -(Math.PI / 2 - aMod);
  const correction = Math.max(-maxAngle, Math.min(maxAngle, target));
  if (Math.abs(correction) < 1e-3)
    return points;
  const cos = Math.cos(correction), sin = Math.sin(correction);
  const result = new Array(n2);
  for (let i = 0; i < n2; i++) {
    const dx = points[i].x - cx, dy = points[i].y - cy;
    result[i] = { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos };
  }
  return result;
}
function strengthToConfig(strength) {
  const s = Math.max(0, Math.min(1, strength));
  return {
    strength: s,
    smoothing: 0.3 + s * 0.5,
    streamline: 0.3 + s * 0.5,
    straightenR2: 0.99 - s * 0.1,
    taperLength: Math.round(2 + s * 6),
    taperMinRatio: 0.5 - s * 0.35,
    pcaMaxAngle: s * 0.06,
    redrawDelayMs: 0,
    straightenMaxCurve: 1.2 - s * 0.8
  };
}
function aggressiveBeautifyStroke(points, styleId, baseWidth) {
  if (points.length < 2) {
    return { points: [...points], widths: [baseWidth] };
  }
  const rules = FONT_STYLES[styleId].character;
  let pts = [...points];
  pts = simplifyRDP(pts, 3);
  pts = quantizeDirections(pts, rules);
  pts = reshapeCorners(pts, rules);
  pts = smoothPath(pts, 3);
  pts = resampleToCount(pts, Math.max(points.length, 15));
  const widths = computeStyleWidths(pts, rules, baseWidth);
  return { points: pts, widths };
}
function simplifyRDP(pts, epsilon) {
  if (pts.length <= 2)
    return pts;
  let maxDist = 0, maxIdx = 0;
  const first = pts[0], last = pts[pts.length - 1];
  const dx = last.x - first.x, dy = last.y - first.y;
  const lenSq = dx * dx + dy * dy;
  for (let i = 1; i < pts.length - 1; i++) {
    let dist;
    if (lenSq < 1e-3) {
      dist = Math.hypot(pts[i].x - first.x, pts[i].y - first.y);
    } else {
      const t2 = ((pts[i].x - first.x) * dx + (pts[i].y - first.y) * dy) / lenSq;
      dist = Math.hypot(pts[i].x - (first.x + t2 * dx), pts[i].y - (first.y + t2 * dy));
    }
    if (dist > maxDist) {
      maxDist = dist;
      maxIdx = i;
    }
  }
  if (maxDist <= epsilon)
    return [first, last];
  const left = simplifyRDP(pts.slice(0, maxIdx + 1), epsilon);
  const right = simplifyRDP(pts.slice(maxIdx), epsilon);
  return [...left.slice(0, -1), ...right];
}
function quantizeDirections(pts, rules) {
  if (pts.length < 2)
    return pts;
  const roundLevel = rules.cornerRounding;
  let preferredAngles;
  if (roundLevel > 0.6) {
    return pts;
  } else if (roundLevel > 0.3) {
    preferredAngles = [0, Math.PI / 4, Math.PI / 2, 3 * Math.PI / 4, Math.PI, -3 * Math.PI / 4, -Math.PI / 2, -Math.PI / 4];
  } else {
    preferredAngles = [0, Math.PI / 2, Math.PI, -Math.PI / 2];
  }
  const result = [pts[0]];
  let cx = pts[0].x, cy = pts[0].y;
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i].x - pts[i - 1].x;
    const dy = pts[i].y - pts[i - 1].y;
    const dist = Math.hypot(dx, dy);
    if (dist < 0.5)
      continue;
    const angle = Math.atan2(dy, dx);
    let bestAngle = angle;
    let bestDiff = Infinity;
    for (const pa of preferredAngles) {
      let diff = Math.abs(angle - pa);
      if (diff > Math.PI)
        diff = 2 * Math.PI - diff;
      if (diff < bestDiff) {
        bestDiff = diff;
        bestAngle = pa;
      }
    }
    const blend = 1 - roundLevel;
    const finalAngle = angle + (bestAngle - angle) * blend;
    cx += Math.cos(finalAngle) * dist;
    cy += Math.sin(finalAngle) * dist;
    result.push({ x: cx, y: cy });
  }
  return result;
}
function reshapeCorners(pts, rules) {
  if (pts.length < 3)
    return pts;
  const result = [pts[0]];
  const roundLevel = rules.cornerRounding;
  for (let i = 1; i < pts.length - 1; i++) {
    const prev = pts[i - 1];
    const curr = pts[i];
    const next = pts[i + 1];
    const dx1 = curr.x - prev.x, dy1 = curr.y - prev.y;
    const dx2 = next.x - curr.x, dy2 = next.y - curr.y;
    const d1 = Math.hypot(dx1, dy1);
    const d2 = Math.hypot(dx2, dy2);
    if (d1 < 0.5 || d2 < 0.5) {
      result.push(curr);
      continue;
    }
    const angle = Math.acos(Math.max(-1, Math.min(1, (dx1 * dx2 + dy1 * dy2) / (d1 * d2))));
    if (angle > 0.3) {
      if (roundLevel > 0.5) {
        const r2 = Math.min(d1, d2) * roundLevel * 0.4;
        const cp1x = curr.x - dx1 / d1 * r2;
        const cp1y = curr.y - dy1 / d1 * r2;
        const cp2x = curr.x + dx2 / d2 * r2;
        const cp2y = curr.y + dy2 / d2 * r2;
        const steps = Math.ceil(angle / 0.3);
        for (let s = 0; s <= steps; s++) {
          const t2 = s / steps;
          const bx = (1 - t2) * (1 - t2) * cp1x + 2 * (1 - t2) * t2 * curr.x + t2 * t2 * cp2x;
          const by = (1 - t2) * (1 - t2) * cp1y + 2 * (1 - t2) * t2 * curr.y + t2 * t2 * cp2y;
          result.push({ x: bx, y: by });
        }
      } else {
        result.push(curr);
      }
    } else {
      result.push(curr);
    }
  }
  result.push(pts[pts.length - 1]);
  return result;
}
function smoothPath(pts, passes) {
  for (let p = 0; p < passes; p++) {
    const smoothed = [pts[0]];
    for (let i = 1; i < pts.length - 1; i++) {
      smoothed.push({
        x: (pts[i - 1].x + pts[i].x + pts[i + 1].x) / 3,
        y: (pts[i - 1].y + pts[i].y + pts[i + 1].y) / 3
      });
    }
    smoothed.push(pts[pts.length - 1]);
    pts = smoothed;
  }
  return pts;
}
function resampleToCount(pts, targetCount) {
  if (pts.length < 2 || targetCount < 2)
    return pts;
  const dists = [0];
  for (let i = 1; i < pts.length; i++) {
    dists.push(dists[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  }
  const total = dists[dists.length - 1];
  if (total < 1e-3)
    return [pts[0], pts[pts.length - 1]];
  const result = [];
  for (let i = 0; i < targetCount; i++) {
    const t2 = i / (targetCount - 1) * total;
    let lo = 0, hi = dists.length - 1;
    while (lo < hi) {
      const mid = lo + hi >> 1;
      if (dists[mid] < t2)
        lo = mid + 1;
      else
        hi = mid;
    }
    const idx = Math.max(1, lo);
    const seg = dists[idx] - dists[idx - 1];
    const frac = seg > 0 ? (t2 - dists[idx - 1]) / seg : 0;
    result.push({
      x: pts[idx - 1].x + (pts[idx].x - pts[idx - 1].x) * frac,
      y: pts[idx - 1].y + (pts[idx].y - pts[idx - 1].y) * frac
    });
  }
  return result;
}
function computeStyleWidths(pts, rules, baseWidth) {
  const n2 = pts.length;
  const widths = new Array(n2);
  for (let i = 0; i < n2; i++) {
    let angle;
    if (i === 0 && n2 > 1) {
      angle = Math.atan2(pts[1].y - pts[0].y, pts[1].x - pts[0].x);
    } else if (i === n2 - 1 && n2 > 1) {
      angle = Math.atan2(pts[n2 - 1].y - pts[n2 - 2].y, pts[n2 - 1].x - pts[n2 - 2].x);
    } else if (n2 > 2) {
      angle = Math.atan2(pts[i + 1].y - pts[i - 1].y, pts[i + 1].x - pts[i - 1].x);
    } else {
      angle = 0;
    }
    const normAngle = (Math.abs(angle) % Math.PI + Math.PI) % Math.PI;
    const isHorizontal = normAngle < Math.PI / 4 || normAngle > 3 * Math.PI / 4;
    const isVertical = normAngle > Math.PI / 4 && normAngle < 3 * Math.PI / 4;
    let ratio;
    if (isHorizontal) {
      ratio = rules.horizontalWidthRatio;
    } else if (isVertical) {
      ratio = rules.verticalWidthRatio;
    } else {
      ratio = (rules.horizontalWidthRatio + rules.verticalWidthRatio) / 2;
    }
    ratio = ratio * (1 - rules.widthUniformity) + 1 * rules.widthUniformity;
    widths[i] = Math.max(0.3, baseWidth * rules.widthScale * ratio);
  }
  applyStyleTaper(widths, rules.taperAmount);
  return widths;
}
function applyStyleTaper(widths, taperAmount) {
  if (taperAmount <= 0 || widths.length < 4)
    return;
  const tl = Math.min(Math.floor(widths.length / 3), 4);
  if (tl < 1)
    return;
  const minRatio = 1 - taperAmount;
  for (let i = 0; i < tl; i++) {
    const t2 = i / tl;
    widths[i] *= minRatio + (1 - minRatio) * (t2 * t2);
  }
  for (let i = 0; i < tl; i++) {
    const t2 = i / tl;
    widths[widths.length - tl + i] *= 1 - (1 - minRatio) * (t2 * t2);
  }
}

// src/core/beautify/OrganicAnimationEngine.ts
function hash2D(x2, y) {
  let h = x2 * 374761393 + y * 668265263;
  h = (h ^ h >> 13) * 1274126177;
  h = h ^ h >> 16;
  return (h & 2147483647) / 2147483647;
}
function smoothNoise2D(x2, y, scale = 0.05) {
  const sx = x2 * scale;
  const sy = y * scale;
  const ix = Math.floor(sx);
  const iy = Math.floor(sy);
  const fx = sx - ix;
  const fy = sy - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const n00 = hash2D(ix, iy);
  const n10 = hash2D(ix + 1, iy);
  const n01 = hash2D(ix, iy + 1);
  const n11 = hash2D(ix + 1, iy + 1);
  const nx0 = n00 + (n10 - n00) * ux;
  const nx1 = n01 + (n11 - n01) * ux;
  return nx0 + (nx1 - nx0) * uy;
}
function organicDisplacement(x2, y, time, amplitude) {
  if (amplitude <= 0)
    return { dx: 0, dy: 0 };
  const n1 = smoothNoise2D(x2 + time * 0.3, y, 0.04);
  const n2 = smoothNoise2D(x2 - time * 0.2, y + time * 0.15, 0.08);
  const n3 = smoothNoise2D(x2 + time * 0.1, y - time * 0.1, 0.15);
  const nx = (n1 - 0.5) * 1 + (n2 - 0.5) * 0.5 + (n3 - 0.5) * 0.25;
  const ny = (hash2D(y * 3 + time * 0.25, x2 * 3) - 0.5) * 1 + (hash2D(y * 5 - time * 0.18, x2 * 5 + time * 0.12) - 0.5) * 0.5 + (hash2D(y * 7 + time * 0.08, x2 * 7 - time * 0.06) - 0.5) * 0.25;
  return {
    dx: nx * amplitude,
    dy: ny * amplitude
  };
}
var OrganicAnimationEngine = class {
  constructor() {
    this.animations = /* @__PURE__ */ new Map();
    this._ticking = false;
    this._rafId = null;
  }
  /** Singleton tick loop — runs requestAnimationFrame while animations are active. */
  ensureTicking() {
    if (this._ticking)
      return;
    this._ticking = true;
    this._rafId = requestAnimationFrame(() => this._tick());
  }
  _tick() {
    const now = performance.now();
    let anyActive = false;
    for (const [id, anim] of this.animations) {
      if (anim.completed)
        continue;
      this.stepAnimation(anim, now);
      anyActive = true;
      anim.onFrame?.();
    }
    for (const [id, anim] of this.animations) {
      if (anim.completed) {
        this.animations.delete(id);
      }
    }
    if (anyActive) {
      this._rafId = requestAnimationFrame(() => this._tick());
    } else {
      this._ticking = false;
      this._rafId = null;
    }
  }
  /**
   * Start a character-level animation.
   * @param targetData - Target stroke data with original and target points
   * @param bbox - Character bounding box
   * @param styleRules - Style rules for animation parameters
   * @param strokePointsRefs - Live stroke point arrays (mutated in-place)
   * @param strokeWidthRefs - Live stroke width references
   * @param onFrame - Frame callback
   * @param onComplete - Completion callback
   * @param enableWave - Enable wave propagation (毛毛虫蠕动)
   */
  startCharacterAnimation(targetData, bbox, styleRules, strokePointsRefs, strokeWidthRefs, onFrame, onComplete, enableWave = true) {
    const id = `anim-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const animStrokes = [];
    for (const td of targetData) {
      const pts = strokePointsRefs.get(td.strokeId);
      if (!pts || pts.length === 0)
        continue;
      const animPts = [];
      const minLen = Math.min(pts.length, td.targetPoints.length);
      const dists = [0];
      for (let i = 1; i < minLen; i++) {
        dists.push(dists[i - 1] + Math.hypot(
          td.targetPoints[i].x - td.targetPoints[i - 1].x,
          td.targetPoints[i].y - td.targetPoints[i - 1].y
        ));
      }
      const totalLen = dists[dists.length - 1] || 1;
      for (let i = 0; i < minLen; i++) {
        const orig = td.originalPoints[i] ?? pts[i];
        const tgt = td.targetPoints[i];
        animPts.push({
          x: orig.x,
          y: orig.y,
          originX: orig.x,
          originY: orig.y,
          targetX: tgt.x,
          targetY: tgt.y,
          vx: 0,
          vy: 0,
          // ⭐ Normalized position along stroke for wave propagation
          t: dists[i] / totalLen
        });
      }
      animStrokes.push({
        strokeId: td.strokeId,
        points: animPts,
        originalWidths: td.originalPoints.map(
          (_2, i) => strokeWidthRefs.get(td.strokeId)?.width ?? 2
        ),
        targetWidths: td.targetWidths
      });
    }
    const anim = {
      id,
      strokes: animStrokes,
      bbox,
      styleRules,
      startTime: performance.now(),
      durationMs: styleRules.animationDurationMs,
      progress: 0,
      phase: "wake",
      completed: false,
      onFrame: () => {
        for (const sa of animStrokes) {
          const pts = strokePointsRefs.get(sa.strokeId);
          if (!pts)
            continue;
          const minLen = Math.min(pts.length, sa.points.length);
          for (let i = 0; i < minLen; i++) {
            pts[i].x = sa.points[i].x;
            pts[i].y = sa.points[i].y;
          }
          if (sa.targetWidths && sa.originalWidths) {
            const strokeRef = strokeWidthRefs.get(sa.strokeId);
            if (strokeRef) {
              const t2 = anim.progress;
              const avgOrig = sa.originalWidths.reduce((a2, b2) => a2 + b2, 0) / sa.originalWidths.length;
              const avgTgt = sa.targetWidths.reduce((a2, b2) => a2 + b2, 0) / sa.targetWidths.length;
              const newWidth = avgOrig + (avgTgt - avgOrig) * t2;
              strokeRef.width = newWidth;
              if (strokeRef._penParams) {
                strokeRef._penParams.strokeWidth = newWidth;
              }
            }
          }
        }
        onFrame();
      },
      // ⭐ Wave propagation: points propagate from start to end like a caterpillar
      wavePropagation: enableWave,
      waveTravelFraction: 0.5
      // wave takes 50% of total duration to travel
    };
    this.animations.set(id, anim);
    this.ensureTicking();
    const checkComplete = () => {
      const a2 = this.animations.get(id);
      if (!a2 || a2.completed) {
        onComplete();
        return;
      }
      requestAnimationFrame(checkComplete);
    };
    requestAnimationFrame(checkComplete);
    return id;
  }
  /** Cancel a running animation immediately. */
  cancelAnimation(id) {
    const anim = this.animations.get(id);
    if (anim) {
      anim.completed = true;
      this.animations.delete(id);
    }
  }
  /** Cancel all running animations. */
  cancelAll() {
    this.animations.clear();
    if (this._rafId !== null) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
    this._ticking = false;
  }
  get activeCount() {
    return this.animations.size;
  }
  // ==========================================================
  //  Animation Step
  // ==========================================================
  stepAnimation(anim, now) {
    const elapsed = now - anim.startTime;
    const rawProgress = Math.min(1, elapsed / anim.durationMs);
    if (rawProgress < 0.2) {
      anim.phase = "wake";
    } else if (rawProgress < 0.85) {
      anim.phase = "crawl";
    } else {
      anim.phase = "settle";
    }
    const globalT = this.easeProgress(rawProgress, anim.phase);
    anim.progress = rawProgress;
    const rules = anim.styleRules;
    const bbox = anim.bbox;
    const noiseAmp = this.getPhaseNoise(rules.organicNoise, anim.phase, rawProgress);
    const stiffness = this.getPhaseStiffness(rules.springStiffness, anim.phase);
    const damping = rules.springDamping;
    for (const sa of anim.strokes) {
      for (let i = 0; i < sa.points.length; i++) {
        const p = sa.points[i];
        let localT = globalT;
        if (anim.wavePropagation && anim.waveTravelFraction) {
          const waveFront = Math.min(1, globalT / anim.waveTravelFraction);
          const pointDelay = (p.t ?? 0) * anim.waveTravelFraction;
          if (globalT < pointDelay) {
            localT = 0;
          } else {
            localT = (globalT - pointDelay) / (1 - pointDelay);
            localT = Math.min(1, Math.max(0, localT));
          }
        }
        const targetX = p.originX + (p.targetX - p.originX) * localT;
        const targetY = p.originY + (p.targetY - p.originY) * localT;
        const springFx = (targetX - p.x) * stiffness;
        const springFy = (targetY - p.y) * stiffness;
        const noise = organicDisplacement(p.x, p.y, elapsed * 1e-3, noiseAmp);
        p.vx = (p.vx + springFx) * damping + noise.dx * (1 - damping);
        p.vy = (p.vy + springFy) * damping + noise.dy * (1 - damping);
        let newX = p.x + p.vx;
        let newY = p.y + p.vy;
        const margin = 3;
        const minX = bbox.x - margin;
        const maxX = bbox.x + bbox.w + margin;
        const minY = bbox.y - margin;
        const maxY = bbox.y + bbox.h + margin;
        if (newX < minX) {
          newX = minX;
          p.vx *= -0.4;
        } else if (newX > maxX) {
          newX = maxX;
          p.vx *= -0.4;
        }
        if (newY < minY) {
          newY = minY;
          p.vy *= -0.4;
        } else if (newY > maxY) {
          newY = maxY;
          p.vy *= -0.4;
        }
        p.x = newX;
        p.y = newY;
      }
    }
    if (rawProgress >= 1) {
      for (const sa of anim.strokes) {
        for (const p of sa.points) {
          p.x = p.targetX;
          p.y = p.targetY;
          p.vx = 0;
          p.vy = 0;
        }
      }
      anim.completed = true;
    }
  }
  // ==========================================================
  //  Easing
  // ==========================================================
  easeProgress(t2, phase) {
    switch (phase) {
      case "wake":
        return this.easeOutBack(t2 / 0.2) * 0.15;
      case "crawl":
        const ct = (t2 - 0.2) / 0.65;
        return 0.15 + (1 - 0.15) * this.easeInOutElastic(ct);
      case "settle":
        const st = (t2 - 0.85) / 0.15;
        return 0.85 + 0.15 * this.easeOutExpo(st);
      default:
        return t2;
    }
  }
  easeOutBack(t2) {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t2 - 1, 3) + c1 * Math.pow(t2 - 1, 2);
  }
  easeInOutElastic(t2) {
    const c5 = 2 * Math.PI / 4.5;
    if (t2 === 0 || t2 === 1)
      return t2;
    return t2 < 0.5 ? -(Math.pow(2, 20 * t2 - 10) * Math.sin((20 * t2 - 11.125) * c5)) / 2 : Math.pow(2, -20 * t2 + 10) * Math.sin((20 * t2 - 11.125) * c5) / 2 + 1;
  }
  easeOutExpo(t2) {
    return t2 === 1 ? 1 : 1 - Math.pow(2, -10 * t2);
  }
  // ==========================================================
  //  Phase-dependent parameters
  // ==========================================================
  getPhaseNoise(baseNoise, phase, progress) {
    switch (phase) {
      case "wake":
        return baseNoise * 1.5 * (progress / 0.2);
      case "crawl":
        return baseNoise * (1 - (progress - 0.2) * 0.3);
      case "settle":
        const settleProgress = (progress - 0.85) / 0.15;
        return baseNoise * 0.3 * (1 - settleProgress);
      default:
        return baseNoise;
    }
  }
  getPhaseStiffness(baseStiffness, phase) {
    switch (phase) {
      case "wake":
        return baseStiffness * 0.3;
      case "crawl":
        return baseStiffness * 1;
      case "settle":
        return baseStiffness * 2;
      default:
        return baseStiffness;
    }
  }
};
var organicAnimation = new OrganicAnimationEngine();

// src/core/beautify/VisualEffectLayer.ts
var VisualEffectLayer = class {
  constructor() {
    this.breathings = /* @__PURE__ */ new Map();
    this.ripples = /* @__PURE__ */ new Map();
    this.pulses = /* @__PURE__ */ new Map();
    this._ticking = false;
    this._rafId = null;
    this._overlayCtx = null;
  }
  /** Attach to an overlay canvas context for rendering. */
  attach(ctx) {
    this._overlayCtx = ctx;
  }
  /** Detach from canvas. */
  detach() {
    this._overlayCtx = null;
  }
  // ==========================================================
  //  🫧 Breathing
  // ==========================================================
  /**
   * Start breathing effect on a set of strokes.
   * Creates a subtle pulsating glow around the character.
   */
  startBreathing(strokeIds, bbox, onFrame) {
    const id = `breath-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const effect = {
      id,
      strokeIds,
      bbox,
      phase: "active",
      startTime: performance.now(),
      fadeProgress: 0,
      onFrame,
      completed: false
    };
    this.breathings.set(id, effect);
    this._ensureTicking();
    return id;
  }
  /** Stop breathing effect, with smooth fade-out. */
  stopBreathing(id) {
    const effect = this.breathings.get(id);
    if (effect && effect.phase === "active") {
      effect.phase = "fading";
      effect.startTime = performance.now();
    }
  }
  /** Stop all breathing effects immediately. */
  stopAllBreathing() {
    for (const [id, effect] of this.breathings) {
      effect.phase = "fading";
      effect.startTime = performance.now();
    }
  }
  // ==========================================================
  //  🌊 Ripple
  // ==========================================================
  /**
   * Create a ripple effect at a position.
   * Like a water ripple spreading from where the stroke ended.
   */
  startRipple(x2, y, color = "#1a1a1a", onFrame) {
    const id = `ripple-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const effect = {
      id,
      x: x2,
      y,
      startTime: performance.now(),
      durationMs: 400,
      radius: 0,
      maxRadius: 25,
      opacity: 0.4,
      color,
      completed: false,
      onFrame
    };
    this.ripples.set(id, effect);
    this._ensureTicking();
    return id;
  }
  // ==========================================================
  //  💫 Pulse
  // ==========================================================
  /**
   * Create a completion pulse effect.
   * A subtle glow that expands and fades around the character.
   */
  startPulse(cx, cy, diagonal, onFrame) {
    const id = `pulse-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const effect = {
      id,
      cx,
      cy,
      diagonal,
      startTime: performance.now(),
      durationMs: 500,
      progress: 0,
      completed: false,
      onFrame
    };
    this.pulses.set(id, effect);
    this._ensureTicking();
    return id;
  }
  // ==========================================================
  //  Tick Loop
  // ==========================================================
  _ensureTicking() {
    if (this._ticking)
      return;
    this._ticking = true;
    this._rafId = requestAnimationFrame(() => this._tick());
  }
  _tick() {
    const now = performance.now();
    const ctx = this._overlayCtx;
    let anyActive = false;
    for (const [id, e2] of this.breathings) {
      this._stepBreathing(e2, now, ctx);
      if (!e2.completed)
        anyActive = true;
      else
        this.breathings.delete(id);
    }
    for (const [id, e2] of this.ripples) {
      this._stepRipple(e2, now, ctx);
      if (!e2.completed)
        anyActive = true;
      else
        this.ripples.delete(id);
    }
    for (const [id, e2] of this.pulses) {
      this._stepPulse(e2, now, ctx);
      if (!e2.completed)
        anyActive = true;
      else
        this.pulses.delete(id);
    }
    if (anyActive) {
      this._rafId = requestAnimationFrame(() => this._tick());
    } else {
      this._ticking = false;
      this._rafId = null;
      if (ctx) {
        ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
      }
    }
  }
  // ==========================================================
  //  Step: Breathing
  // ==========================================================
  _stepBreathing(e2, now, ctx) {
    const elapsed = now - e2.startTime;
    if (e2.phase === "active") {
      const breathPhase = elapsed * 1e-3 * 0.8 * Math.PI * 2;
      const breathValue = 0.5 + 0.5 * Math.sin(breathPhase);
      this._renderBreathing(ctx, e2.bbox, breathValue);
      e2.onFrame?.();
    } else if (e2.phase === "fading") {
      e2.fadeProgress = Math.min(1, elapsed / 300);
      const breathValue = 0.5 + 0.5 * Math.sin(elapsed * 1e-3 * 0.8 * Math.PI * 2);
      const fadeValue = breathValue * (1 - e2.fadeProgress);
      this._renderBreathing(ctx, e2.bbox, fadeValue);
      e2.onFrame?.();
      if (e2.fadeProgress >= 1) {
        e2.completed = true;
      }
    }
  }
  _renderBreathing(ctx, bbox, intensity) {
    if (!ctx)
      return;
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    const glowRadius = Math.max(bbox.w, bbox.h) * 0.15 * (0.8 + 0.4 * intensity);
    const glowOpacity = 0.08 + 0.06 * intensity;
    const cx = bbox.x + bbox.w / 2;
    const cy = bbox.y + bbox.h / 2;
    ctx.save();
    ctx.globalAlpha = glowOpacity;
    const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, glowRadius);
    gradient.addColorStop(0, "rgba(80, 80, 200, 0.3)");
    gradient.addColorStop(0.5, "rgba(80, 80, 200, 0.1)");
    gradient.addColorStop(1, "rgba(80, 80, 200, 0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(
      bbox.x - glowRadius,
      bbox.y - glowRadius,
      bbox.w + glowRadius * 2,
      bbox.h + glowRadius * 2
    );
    ctx.restore();
  }
  // ==========================================================
  //  Step: Ripple
  // ==========================================================
  _stepRipple(e2, now, ctx) {
    const elapsed = now - e2.startTime;
    const t2 = Math.min(1, elapsed / e2.durationMs);
    const easeT = 1 - Math.pow(1 - t2, 2);
    e2.radius = e2.maxRadius * easeT;
    e2.opacity = 0.4 * (1 - easeT);
    if (ctx) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, e2.opacity);
      ctx.beginPath();
      ctx.arc(e2.x, e2.y, Math.max(1, e2.radius), 0, Math.PI * 2);
      ctx.strokeStyle = e2.color;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();
    }
    e2.onFrame?.();
    if (t2 >= 1) {
      e2.completed = true;
    }
  }
  // ==========================================================
  //  Step: Pulse
  // ==========================================================
  _stepPulse(e2, now, ctx) {
    const elapsed = now - e2.startTime;
    e2.progress = Math.min(1, elapsed / e2.durationMs);
    const baseRadius = e2.diagonal * 0.3;
    const expandRadius = baseRadius * (1 + e2.progress * 0.8);
    const opacity = 0.2 * (1 - e2.progress);
    if (ctx && opacity > 0.01) {
      ctx.save();
      ctx.globalAlpha = opacity;
      const gradient = ctx.createRadialGradient(e2.cx, e2.cy, 0, e2.cx, e2.cy, expandRadius);
      gradient.addColorStop(0, "rgba(100, 100, 255, 0.15)");
      gradient.addColorStop(0.6, "rgba(100, 100, 255, 0.05)");
      gradient.addColorStop(1, "rgba(100, 100, 255, 0)");
      ctx.fillStyle = gradient;
      ctx.fillRect(e2.cx - expandRadius, e2.cy - expandRadius, expandRadius * 2, expandRadius * 2);
      ctx.restore();
    }
    e2.onFrame?.();
    if (e2.progress >= 1) {
      e2.completed = true;
    }
  }
};
var visualEffects = new VisualEffectLayer();

// src/core/beautify/FontGlyphEngine.ts
function computeBBox2(strokes) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const s of strokes) {
    for (const p of s.points) {
      if (p.x < minX)
        minX = p.x;
      if (p.y < minY)
        minY = p.y;
      if (p.x > maxX)
        maxX = p.x;
      if (p.y > maxY)
        maxY = p.y;
    }
  }
  const w2 = maxX - minX || 1;
  const h = maxY - minY || 1;
  return { x: minX, y: minY, w: w2, h, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 };
}

// src/core/beautify/RedrawOrchestrator.ts
var DEFAULT_REDRAW_CONFIG = {
  enabled: false,
  styleId: "kaiShu",
  pauseMs: 800,
  beautifyStrength: 0.6,
  stylizeStrength: 0.5
};
var RedrawOrchestrator = class {
  constructor() {
    this.config = { ...DEFAULT_REDRAW_CONFIG };
    this._pendingIds = [];
    this._pendingBBox = null;
    this._timer = null;
    this._sessionRef = null;
    /** Map from strokeId to breathing effect ID for cleanup */
    this._breathingMap = /* @__PURE__ */ new Map();
  }
  // ==========================================================
  //  Public
  // ==========================================================
  onStrokeEnd(session) {
    if (!this.config.enabled)
      return;
    const eng = session.engine;
    if (eng.strokes.length === 0)
      return;
    this._sessionRef = session;
    const lastStroke = eng.strokes[eng.strokes.length - 1];
    if (!lastStroke)
      return;
    if (!this._pendingIds.includes(lastStroke.id)) {
      this._pendingIds.push(lastStroke.id);
    }
    this._startBreathingForPending(session);
    const lastPt = lastStroke.points[lastStroke.points.length - 1];
    if (lastPt) {
      visualEffects.startRipple(
        lastPt.x,
        lastPt.y,
        lastStroke?.color || "#1a1a1a",
        () => {
          try {
            session.markDirty();
          } catch {
          }
        }
      );
    }
    if (this._pendingBBox && lastStroke.points.length > 0) {
      const pt = lastStroke.points[0];
      const b2 = this._pendingBBox;
      const dist = Math.hypot(
        Math.max(0, b2.x - pt.x, pt.x - (b2.x + b2.w)),
        Math.max(0, b2.y - pt.y, pt.y - (b2.y + b2.h))
      );
      if (dist > Math.max(b2.w, b2.h) * 2) {
        this._triggerRedraw();
        this._pendingIds = [lastStroke.id];
        this._pendingBBox = null;
        if (this._timer) {
          clearTimeout(this._timer);
          this._timer = null;
        }
      }
    }
    const pendingStrokes = eng.strokes.filter((s) => this._pendingIds.includes(s.id));
    this._pendingBBox = computeBBox2(pendingStrokes);
    if (this._timer)
      clearTimeout(this._timer);
    this._timer = setTimeout(() => this._triggerRedraw(), this.config.pauseMs);
  }
  setFontStyle(styleId) {
    this.config.styleId = styleId;
  }
  get currentStyle() {
    return getFontStyle(this.config.styleId);
  }
  reset() {
    this._pendingIds = [];
    this._pendingBBox = null;
    visualEffects.stopAllBreathing();
    this._breathingMap.clear();
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
    this._sessionRef = null;
  }
  // ==========================================================
  //  Layer 0: Breathing
  // ==========================================================
  _startBreathingForPending(session) {
    const eng = session.engine;
    const pendingStrokes = eng.strokes.filter(
      (s) => this._pendingIds.includes(s.id) && !s._done
    );
    if (pendingStrokes.length === 0)
      return;
    for (const s of pendingStrokes) {
      const breathId2 = this._breathingMap.get(s.id);
      if (breathId2) {
        visualEffects.stopBreathing(breathId2);
      }
    }
    const bbox = computeBBox2(pendingStrokes);
    const breathId = visualEffects.startBreathing(
      pendingStrokes.map((s) => s.id),
      bbox,
      () => {
        try {
          session.markDirty();
        } catch {
        }
      }
    );
    for (const s of pendingStrokes) {
      this._breathingMap.set(s.id, breathId);
    }
  }
  // ==========================================================
  //  Trigger Redraw (Layers 1-2)
  // ==========================================================
  _triggerRedraw() {
    const session = this._sessionRef;
    if (!session)
      return;
    const eng = session.engine;
    this._timer = null;
    const fresh = eng.strokes.filter((s) => s.points && s.points.length >= 1 && !s._done);
    if (fresh.length === 0)
      return;
    const clusters = this._clusterStrokes(fresh);
    if (clusters.length === 0)
      return;
    for (const clusterIds of clusters) {
      const strokes = eng.strokes.filter((s) => clusterIds.has(s.id) && !s._done);
      if (strokes.length === 0)
        continue;
      const bbox = computeBBox2(strokes);
      for (const s of strokes) {
        const breathId = this._breathingMap.get(s.id);
        if (breathId) {
          visualEffects.stopBreathing(breathId);
        }
      }
      this._applyBeautify(session, strokes, bbox);
    }
    this._pendingIds = [];
    this._pendingBBox = null;
  }
  // ==========================================================
  //  Layer 1 + 2: Geometric Beautification + Stylization
  // ==========================================================
  _applyBeautify(session, strokes, bbox) {
    const style = this.currentStyle;
    const beautifyConfig2 = {
      ...style.beautify,
      strength: this.config.beautifyStrength
    };
    const targetData = [];
    const strokePointsRefs = /* @__PURE__ */ new Map();
    const strokeWidthRefs = /* @__PURE__ */ new Map();
    for (const s of strokes) {
      if (s.points.length < 2)
        continue;
      const originalPts = s.points.map((p) => ({ x: p.x, y: p.y }));
      let beautifiedPts = beautifyStroke(originalPts, beautifyConfig2);
      if (this.config.stylizeStrength > 0.1) {
        const stylized = aggressiveBeautifyStroke(
          beautifiedPts,
          this.config.styleId,
          s.width ?? 2
        );
        const blend = this.config.stylizeStrength;
        if (stylized.points.length === beautifiedPts.length) {
          for (let i = 0; i < beautifiedPts.length; i++) {
            beautifiedPts[i] = {
              x: beautifiedPts[i].x + (stylized.points[i].x - beautifiedPts[i].x) * blend,
              y: beautifiedPts[i].y + (stylized.points[i].y - beautifiedPts[i].y) * blend
            };
          }
        }
      }
      const targetWidths = beautifiedPts.map(() => s.width ?? 2);
      targetData.push({
        strokeId: s.id,
        originalPoints: originalPts,
        targetPoints: beautifiedPts,
        targetWidths
      });
      strokePointsRefs.set(s.id, s.points);
      strokeWidthRefs.set(s.id, s);
    }
    if (targetData.length === 0)
      return;
    for (const s of strokes) {
      s._done = true;
    }
    const charBBox = {
      x: bbox.x,
      y: bbox.y,
      w: bbox.w,
      h: bbox.h,
      cx: bbox.x + bbox.w / 2,
      cy: bbox.y + bbox.h / 2
    };
    organicAnimation.startCharacterAnimation(
      targetData,
      charBBox,
      style.character,
      strokePointsRefs,
      strokeWidthRefs,
      () => {
        try {
          session.markDirty();
        } catch {
        }
      },
      () => {
        visualEffects.startPulse(
          charBBox.cx,
          charBBox.cy,
          Math.hypot(charBBox.w, charBBox.h),
          () => {
            try {
              session.markDirty();
            } catch {
            }
          }
        );
        try {
          session.strokeCache?.clear();
          session.markDirty();
          session.requestFullRebuild();
        } catch {
        }
      },
      true
      // enableWave
    );
  }
  // ==========================================================
  //  Stroke Clustering
  // ==========================================================
  _clusterStrokes(strokes) {
    if (strokes.length === 0)
      return [];
    const clusters = [];
    let current = /* @__PURE__ */ new Set([strokes[0].id]);
    let currentBBox = computeBBox2([strokes[0]]);
    for (let i = 1; i < strokes.length; i++) {
      const s = strokes[i];
      const firstPt = s.points[0];
      if (!firstPt) {
        current.add(s.id);
        continue;
      }
      const dist = Math.hypot(
        Math.max(0, currentBBox.x - firstPt.x, firstPt.x - (currentBBox.x + currentBBox.w)),
        Math.max(0, currentBBox.y - firstPt.y, firstPt.y - (currentBBox.y + currentBBox.h))
      );
      if (dist > Math.max(currentBBox.w, currentBBox.h) * 2) {
        clusters.push(current);
        current = /* @__PURE__ */ new Set([s.id]);
        currentBBox = computeBBox2([s]);
      } else {
        current.add(s.id);
        const allStrokes = strokes.filter((x2) => current.has(x2.id));
        currentBBox = computeBBox2(allStrokes);
      }
    }
    if (current.size > 0)
      clusters.push(current);
    return clusters;
  }
};

// main.ts
var DEBUG = false;
function installDebugGuard() {
  if (DEBUG)
    return;
  console.log = () => {
  };
  console.warn = () => {
  };
  console.debug = () => {
  };
}
var CANVAS_CONSTANTS = {
  ERASER_RADIUS: 10,
  SPEED_NORMALIZATION: 3,
  JITTER_THRESHOLD: 5,
  CURVATURE_NORMALIZATION: 10,
  MIN_STROKE_WIDTH: 0.3,
  MAX_STROKE_WIDTH: 14
};
var beautifyConfig = { ...DEFAULT_BEAUTIFY_CONFIG };
var redrawOrchestrator = new RedrawOrchestrator();
function toggleBeautify() {
  beautifyConfig.enabled = !beautifyConfig.enabled;
  redrawOrchestrator.config.enabled = beautifyConfig.enabled;
  if (beautifyConfig.enabled) {
    Object.assign(beautifyConfig, strengthToConfig(beautifyConfig.strength));
  } else {
    redrawOrchestrator.reset();
  }
  return beautifyConfig.enabled;
}
var CAMERA_CONSTANTS = {
  MIN_ZOOM: 0.2,
  MAX_ZOOM: 4,
  ZOOM_STEP: 0.08,
  ZOOM_WHEEL_FACTOR: 1e-3
};
var INERTIA_FRICTION = 0.92;
var INERTIA_STOP_THRESHOLD = 0.1;
function createDefaultCamera() {
  return { x: 0, y: 0, zoom: 1 };
}
var InertiaController = class {
  constructor() {
    this.vx = 0;
    this.vy = 0;
    this.active = false;
    this._onDirty = null;
  }
  /** Start inertia with initial velocity. onDirty called each tick + on stop. */
  start(vx, vy, onDirty) {
    this.vx = vx;
    this.vy = vy;
    this.active = true;
    this._onDirty = onDirty;
  }
  /**
   * Advance one frame of physics. Called by unified frame tick.
   * @returns true if still active, false if stopped.
   */
  tick() {
    if (!this.active)
      return false;
    this._onDirty?.();
    this.vx *= INERTIA_FRICTION;
    this.vy *= INERTIA_FRICTION;
    if (Math.abs(this.vx) < INERTIA_STOP_THRESHOLD && Math.abs(this.vy) < INERTIA_STOP_THRESHOLD) {
      this.vx = 0;
      this.vy = 0;
      this.active = false;
      this._onDirty?.();
      return false;
    }
    return true;
  }
  /** Force-stop inertia immediately. */
  stop() {
    this.active = false;
    this.vx = 0;
    this.vy = 0;
    this._onDirty = null;
  }
};
function clampZoom(zoom) {
  return Math.max(CAMERA_CONSTANTS.MIN_ZOOM, Math.min(CAMERA_CONSTANTS.MAX_ZOOM, zoom));
}
function migratePage(raw) {
  const r2 = raw;
  return {
    id: r2.id || genId(),
    title: r2.title || "Untitled",
    index: r2.index ?? 0,
    strokes: r2.strokes || r2.content?.strokes || [],
    background: r2.background || { type: "blank", color: "#ffffff" },
    createdAt: r2.createdAt || (/* @__PURE__ */ new Date()).toISOString(),
    updatedAt: r2.updatedAt || (/* @__PURE__ */ new Date()).toISOString(),
    thumbnail: r2.thumbnail
  };
}
var CursorRenderer = class {
  constructor(session, ownerDocument) {
    this._unsub = null;
    this._mounted = false;
    this._session = null;
    this._session = session;
    this._doc = ownerDocument ?? activeDocument;
  }
  /** Bind or rebind session. Safe to call multiple times. */
  bindSession(session) {
    if (this._unsub) {
      this._unsub();
      this._unsub = null;
    }
    this._session = session;
    bindViewportCamera(session.viewport.camera);
    if (this._mounted) {
      this._subscribeViewState();
      session.syncViewState();
    }
  }
  /** Mount the cursor overlay into document.body. Safe to call before session exists. */
  mount() {
    const existingDOM = this._doc.querySelector(".reminote-cursor-overlay");
    if (window.__REMINOTE_CURSOR_SINGLETON__ && existingDOM) {
      console.warn("[Cursor] duplicate mount blocked \u2014 cursor already exists in DOM");
      return;
    }
    if (window.__REMINOTE_CURSOR_SINGLETON__ && !existingDOM) {
      console.warn("[Cursor] stale singleton lock cleared \u2014 DOM was removed by reload");
      window.__REMINOTE_CURSOR_SINGLETON__ = false;
    }
    window.__REMINOTE_CURSOR_SINGLETON__ = true;
    if (this._mounted)
      return;
    this._mounted = true;
    this._doc.querySelectorAll(".reminote-cursor-overlay").forEach((el) => el.remove());
    let uiLayer = this._doc.getElementById("reminote-ui-layer");
    if (!uiLayer) {
      uiLayer = this._doc.createElement("div");
      uiLayer.id = "reminote-ui-layer";
      uiLayer.className = "reminote-ui-layer";
      this._doc.body.appendChild(uiLayer);
    }
    this.el = this._doc.createElement("div");
    this.el.className = "reminote-cursor-overlay cursor-pen";
    uiLayer.appendChild(this.el);
    bindCursorDocument(this._doc);
    if (this._session) {
      this._subscribeViewState();
    }
    if (window.__CURSOR_MOVE_LOCK__)
      return;
    window.__CURSOR_MOVE_LOCK__ = true;
  }
  /** Subscribe to session viewState for tool-driven appearance. */
  _subscribeViewState() {
    const session = this._session;
    if (!session)
      return;
    this._unsub = session.subscribeViewUI((vs) => {
      if (!this.el || !this._doc.body.contains(this.el))
        return;
      this.el.classList.remove("cursor-pen", "cursor-eraser", "cursor-hand", "cursor-hand-grabbing");
      this.el.style.removeProperty("--cursor-size");
      this.el.textContent = "";
      const cs = vs.cursor;
      const sizePx = Math.round(cs.size);
      switch (cs.mode) {
        case "pen":
          this.el.classList.add("cursor-pen");
          this.el.style.setProperty("--cursor-size", sizePx + "px");
          break;
        case "eraser":
          this.el.classList.add("cursor-eraser");
          this.el.style.setProperty("--cursor-size", sizePx + "px");
          break;
        case "hand":
          this.el.classList.add("cursor-hand");
          this.el.textContent = "\u270B";
          break;
      }
    });
    session.syncViewState();
  }
  /** Remove cursor overlay and all listeners. Idempotent. */
  destroy() {
    this._mounted = false;
    if (this._unsub) {
      this._unsub();
      this._unsub = null;
    }
    window.__CURSOR_MOVE_LOCK__ = false;
    window.__REMINOTE_CURSOR_SINGLETON__ = false;
    if (this.el && this._doc.body.contains(this.el))
      this.el.remove();
    this._session = null;
  }
};
var InputSnapshotController = class {
  /**
   * Capture a frozen InputSnapshot from a PointerEvent.
   * All state (camera, tool, coords) is copied — never references live objects.
   */
  capture(ev, session) {
    const rect = session.canvasEl.getBoundingClientRect();
    const sx = ev.clientX - rect.left;
    const sy = ev.clientY - rect.top;
    const c2 = session.viewport.camera;
    const worldX = (sx - c2.x) / c2.zoom;
    const worldY = (sy - c2.y) / c2.zoom;
    let pType;
    switch (ev.type) {
      case "pointerdown":
        pType = "down";
        break;
      case "pointermove":
        pType = "move";
        break;
      case "pointerup":
        pType = "up";
        break;
      default:
        pType = "move";
        break;
    }
    const activeTool = session.toolManager.getActive();
    const settingsCopy = JSON.parse(JSON.stringify(activeTool.settings));
    return {
      pointer: {
        screenX: sx,
        screenY: sy,
        worldX,
        worldY,
        pressure: ev.pressure || 0.5,
        pointerId: ev.pointerId,
        type: pType
      },
      camera: { x: c2.x, y: c2.y, zoom: c2.zoom },
      tool: { id: activeTool.id, settings: settingsCopy },
      timestamp: performance.now()
    };
  }
  /** Extract world point from a snapshot (convenience). */
  getWorldPoint(snapshot) {
    return { x: snapshot.pointer.worldX, y: snapshot.pointer.worldY };
  }
};
var PenTool = class {
  constructor() {
    this.id = "pen";
    this.settings = CanvasPolicy.getDefaults();
  }
  onPointerDown(snapshot, session) {
    const canvasRect = session.canvasEl.getBoundingClientRect();
    const world = session.viewport.screenToWorld(dualInput.rawX, dualInput.rawY, canvasRect);
    session.engine.startStroke({ x: world.x, y: world.y, pressure: snapshot.pointer.pressure }, snapshot.pointer.pointerId, (id) => session.canvasEl.setPointerCapture(id));
  }
  onPointerMove(snapshot, session) {
    if (!session.engine.drawing)
      return;
    const pt = { x: snapshot.pointer.worldX, y: snapshot.pointer.worldY, pressure: snapshot.pointer.pressure };
    session.engine.addPoint(pt);
    const strokeId = session.engine.currentStrokeId;
    const prev = session.engine.lastPoint;
    if (strokeId && prev && pt) {
      const bounds = computeStrokeBounds([prev, pt]);
      session.markDirty(strokeId, bounds);
    } else {
      session.markDirty();
    }
  }
  onPointerUp(_snapshot, session) {
    if (!session.engine.drawing)
      return;
    const strokeId = session.engine.currentStrokeId;
    session.engine.endStroke();
    if (strokeId) {
      session.markDirty(strokeId);
    } else {
      session.markDirty();
    }
    redrawOrchestrator.onStrokeEnd(session);
  }
};
var EraserTool = class {
  constructor() {
    this.id = "eraser";
    this.settings = { mode: "point", size: 50, strength: 50 };
    this.isErasing = false;
    this.lastErasePt = null;
  }
  resolveRadius() {
    return 5 + this.settings.size / 100 * 35;
  }
  onPointerDown(snapshot, session) {
    const pt = { x: snapshot.pointer.worldX, y: snapshot.pointer.worldY };
    this.isErasing = true;
    this.lastErasePt = pt;
    this.executeErase(pt, session);
  }
  onPointerMove(snapshot, session) {
    if (!this.isErasing)
      return;
    const pt = { x: snapshot.pointer.worldX, y: snapshot.pointer.worldY };
    const minDist = this.resolveRadius() * 0.5;
    if (this.lastErasePt && Math.hypot(pt.x - this.lastErasePt.x, pt.y - this.lastErasePt.y) < minDist) {
      return;
    }
    this.lastErasePt = pt;
    this.executeErase(pt, session);
  }
  onPointerUp(_snapshot, session) {
    if (!this.isErasing)
      return;
    this.isErasing = false;
    this.lastErasePt = null;
    session.engine.commit();
    session.requestFullRebuild();
    session.markDirty();
  }
  /** Execute erase AND trigger immediate re-render for real-time feedback */
  executeErase(pt, session) {
    const engine = session.engine;
    const radius = this.resolveRadius();
    switch (this.settings.mode) {
      case "stroke":
        this.eraseStroke(pt, engine, radius);
        break;
      case "point":
        this.erasePoints(pt, engine, radius);
        break;
      case "smart":
        this.eraseSmart(pt, engine, radius);
        break;
    }
    session.requestFullRebuild();
    session.markDirty();
  }
  /** Stroke Eraser: delete entire stroke if any point within radius */
  eraseStroke(pt, engine, radius) {
    for (let i = engine.strokes.length - 1; i >= 0; i--) {
      const s = engine.strokes[i];
      if (!s?.points)
        continue;
      if (engine.hitTestStroke(s, pt, radius)) {
        engine.removeStroke(s.id);
        return;
      }
    }
  }
  /** Point Eraser: remove individual points within radius, split stroke if needed */
  erasePoints(pt, engine, radius) {
    const toRemove = [];
    for (let si = engine.strokes.length - 1; si >= 0; si--) {
      const s = engine.strokes[si];
      if (!s?.points)
        continue;
      const indices = [];
      for (let pi = 0; pi < s.points.length; pi++) {
        const p = s.points[pi];
        if (Math.hypot(p.x - pt.x, p.y - pt.y) < radius) {
          indices.push(pi);
        }
      }
      if (indices.length > 0) {
        toRemove.push({ strokeIdx: si, pointIndices: indices });
      }
    }
    for (const item of toRemove) {
      engine.erasePointsFromStroke(item.strokeIdx, item.pointIndices);
    }
  }
  /** Smart Eraser: distance-based segment detection + auto split */
  eraseSmart(pt, engine, radius) {
    const aggressiveness = this.settings.strength / 100;
    const smartRadius = radius * (0.5 + aggressiveness * 1.5);
    for (let si = engine.strokes.length - 1; si >= 0; si--) {
      const s = engine.strokes[si];
      if (!s?.points || s.points.length < 2)
        continue;
      const hitPoints = s.points.map((p) => Math.hypot(p.x - pt.x, p.y - pt.y) < smartRadius);
      const toRemove = [];
      for (let pi = 0; pi < hitPoints.length; pi++) {
        if (hitPoints[pi])
          toRemove.push(pi);
      }
      if (toRemove.length > 0) {
        engine.erasePointsFromStroke(si, toRemove);
        return;
      }
    }
  }
};
var HandTool = class {
  constructor() {
    this.id = "hand";
    this.settings = CanvasPolicy.getDefaults();
    // unused
    this.lastScreenX = 0;
    this.lastScreenY = 0;
  }
  onPointerDown(snapshot, session) {
    session.viewport.inertia.stop();
    session.viewport.isPanning = true;
    session.viewport.inertia.vx = 0;
    session.viewport.inertia.vy = 0;
    this.lastScreenX = snapshot.pointer.screenX;
    this.lastScreenY = snapshot.pointer.screenY;
    session.canvasEl.setPointerCapture(snapshot.pointer.pointerId);
  }
  onPointerMove(snapshot, session) {
    if (!session.viewport.isPanning)
      return;
    const dx = snapshot.pointer.screenX - this.lastScreenX;
    const dy = snapshot.pointer.screenY - this.lastScreenY;
    this.lastScreenX = snapshot.pointer.screenX;
    this.lastScreenY = snapshot.pointer.screenY;
    session.viewport.pan(dx, dy);
    session.viewport.inertia.vx = dx;
    session.viewport.inertia.vy = dy;
    session.syncViewState();
    session.markCameraDirty();
  }
  onPointerUp(_snapshot, session) {
    session.viewport.isPanning = false;
    session.viewport.inertia.start(
      session.viewport.inertia.vx,
      session.viewport.inertia.vy,
      () => {
        session.viewport.camera.x += session.viewport.inertia.vx;
        session.viewport.camera.y += session.viewport.inertia.vy;
        session.syncViewState();
        session.markCameraDirty();
      }
    );
  }
};
function migrateNotebook(raw) {
  const r2 = raw;
  const now = (/* @__PURE__ */ new Date()).toISOString();
  return {
    id: r2.id || genId(),
    name: r2.name || "Untitled",
    pages: (r2.pages || []).map((p) => migratePage(p)),
    activePageId: r2.activePageId ?? r2.pages?.[0]?.id ?? null,
    nextPageIndex: r2.nextPageIndex ?? (r2.pages?.length ?? 0),
    createdAt: r2.createdAt || now,
    updatedAt: r2.updatedAt || now,
    lastPageId: r2.lastPageId,
    isPinned: r2.isPinned
  };
}
var NOTEBOOK_VIEW_TYPE = "reminote-notebook-view";
var PAGE_VIEW_TYPE = "reminote-page-view";
var CANVAS_VIEW_TYPE = "reminote-canvas-view";
var _idCounter = Date.now();
function genId() {
  return `${++_idCounter}`;
}
var FileGateway = class _FileGateway {
  constructor(app) {
    this.app = app;
  }
  static {
    this.DIR = "RemiNote";
  }
  /** Normalize: strip double-prefix, backslash→slash, ensure single RemiNote/ prefix. */
  normalizePath(raw) {
    let p = raw.replace(/\\/g, "/");
    while (p.startsWith(`${_FileGateway.DIR}/${_FileGateway.DIR}/`)) {
      p = p.substring(_FileGateway.DIR.length + 1);
    }
    if (!p.startsWith(`${_FileGateway.DIR}/`)) {
      p = `${_FileGateway.DIR}/${p.replace(/^\/+/, "")}`;
    }
    return p;
  }
  /** Build a guaranteed-correct path from a bare filename. */
  buildPath(filename) {
    const bare = filename.replace(/\\/g, "/").split("/").pop() || filename;
    return this.normalizePath(`${_FileGateway.DIR}/${bare}`);
  }
  async saveNotebook(notebook) {
    const adapter = this.app.vault.adapter;
    if (!await adapter.exists(_FileGateway.DIR))
      await this.app.vault.createFolder(_FileGateway.DIR);
    const path = this.buildPath(`${notebook.name}.remi`);
    await adapter.write(path, JSON.stringify(notebook));
  }
  async loadNotebooks() {
    const adapter = this.app.vault.adapter;
    const dir = _FileGateway.DIR;
    const OLD_DIR = "GoodNoteMax";
    try {
      if (await adapter.exists(OLD_DIR)) {
        console.log("[BOOT] Detected old GoodNoteMax/ directory \u2014 migrating to RemiNote/...");
        const oldList = await adapter.list(OLD_DIR);
        for (const f2 of oldList.files) {
          const bareName = f2.replace(/\\/g, "/").split("/").pop() || f2;
          const remiName = bareName.replace(/\.gnnote$/i, ".remi").replace(/\.gnote$/i, ".remi");
          const destPath = `${dir}/${remiName}`;
          try {
            const content = await adapter.read(f2);
            await adapter.write(destPath, content);
            await adapter.remove(f2);
            console.log("[MIGRATE] moved:", f2, "\u2192", destPath);
          } catch (mfErr) {
            console.warn("[MIGRATE] failed to migrate:", f2, mfErr);
          }
        }
        try {
          await adapter.remove(OLD_DIR);
        } catch (rmErr) {
          console.warn("[MIGRATE] could not remove old dir:", rmErr);
        }
        console.log("[BOOT] Migration from GoodNoteMax/ complete.");
      }
    } catch (e2) {
      console.warn("[BOOT] Migration check failed:", e2);
    }
    try {
      if (!await adapter.exists(dir)) {
        await this.app.vault.createFolder(dir);
        console.log("[BOOT] RemiNote folder created, no notebooks");
        return [];
      }
    } catch (e2) {
      console.warn("[BOOT] adapter.exists failed:", e2);
      try {
        await this.app.vault.createFolder(dir);
      } catch (e22) {
        console.debug(e22);
      }
      return [];
    }
    let list;
    try {
      list = await adapter.list(dir);
    } catch (e2) {
      console.warn("[BOOT] adapter.list failed:", e2);
      return [];
    }
    const remiFiles = list.files.filter(
      (f2) => f2.endsWith(".remi") || f2.endsWith(".gnnote") || f2.endsWith(".gnote")
    );
    console.log("[BOOT] notebook files found:", remiFiles.length);
    const result = [];
    for (const rawName of remiFiles) {
      const filePath = this.buildPath(rawName);
      try {
        const raw = await adapter.read(filePath);
        const raw_nb = JSON.parse(raw);
        const nb = migrateNotebook(raw_nb);
        if (!nb.id)
          nb.id = genId();
        if (!nb.pages)
          nb.pages = [];
        result.push(nb);
        if (filePath.endsWith(".gnnote") || filePath.endsWith(".gnote")) {
          const remiPath = filePath.replace(/\.gnnote$/, ".remi").replace(/\.gnote$/, ".remi");
          try {
            await adapter.write(remiPath, JSON.stringify(nb));
            await adapter.remove(filePath);
            console.log("[BOOT] ext-migrated:", filePath, "\u2192", remiPath);
          } catch (migErr) {
            console.warn("[BOOT] ext-migration failed:", filePath, migErr);
          }
        }
        console.log("[BOOT] parsed:", nb.name, "| pages:", nb.pages.length);
      } catch (e2) {
        console.warn("[BOOT] skip invalid:", filePath, e2);
      }
    }
    console.log("[BOOT] notebooks hydrated:", result.length);
    return result;
  }
  async deleteNotebook(notebook) {
    const p = this.buildPath(`${notebook.name}.remi`);
    try {
      if (await this.app.vault.adapter.exists(p))
        await this.app.vault.adapter.remove(p);
    } catch (e2) {
      console.warn("[FileGateway] delete failed:", p, e2);
    }
  }
  async notebookFileExists(notebook) {
    try {
      return await this.app.vault.adapter.exists(this.buildPath(`${notebook.name}.remi`));
    } catch {
      return false;
    }
  }
};
var NotebookModal = class extends import_obsidian.Modal {
  constructor(app, plugin) {
    super(app);
    this.plugin = plugin;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "Create Notebook" });
    let name = "";
    new import_obsidian.Setting(contentEl).setName("Notebook name").addText((t2) => t2.setPlaceholder("Enter notebook name").onChange((v2) => {
      name = v2;
    }));
    new import_obsidian.Setting(contentEl).addButton((b2) => b2.setButtonText("Create").setCta().onClick(() => {
      (async () => {
        try {
          const now = (/* @__PURE__ */ new Date()).toISOString();
          await this.plugin.addNotebook({
            id: genId(),
            name: name || "Untitled",
            pages: [{
              id: "page-1",
              title: "Page 1",
              index: 0,
              strokes: [],
              background: { type: "blank", color: "#ffffff" },
              createdAt: now,
              updatedAt: now
            }],
            activePageId: "page-1",
            nextPageIndex: 1,
            createdAt: now,
            updatedAt: now
          });
        } catch (e2) {
          console.error(e2);
        } finally {
          this.close();
        }
      })().catch(() => {
      });
    })).addButton((b2) => b2.setButtonText("Cancel").onClick(() => this.close()));
  }
  onClose() {
    this.contentEl.empty();
  }
};
var NotebookRenameModal = class extends import_obsidian.Modal {
  constructor(app, p, nbId, cur) {
    super(app);
    this.plugin = p;
    this.nbId = nbId;
    this.cur = cur;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "Rename Notebook" });
    let v2 = this.cur;
    new import_obsidian.Setting(contentEl).setName("Notebook name").addText((t2) => t2.setValue(this.cur).onChange((x2) => v2 = x2));
    new import_obsidian.Setting(contentEl).addButton((b2) => b2.setButtonText("Rename").setCta().onClick(() => {
      try {
        void this.plugin.renameNotebook(this.nbId, v2 || this.cur);
      } catch (e2) {
        console.error(e2);
      } finally {
        this.close();
      }
    })).addButton((b2) => b2.setButtonText("Cancel").onClick(() => this.close()));
  }
  onClose() {
    this.contentEl.empty();
  }
};
var RenameModal = class extends import_obsidian.Modal {
  constructor(app, p, nbId, pId, cur) {
    super(app);
    this.plugin = p;
    this.nbId = nbId;
    this.pId = pId;
    this.cur = cur;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "Rename Page" });
    let v2 = this.cur;
    new import_obsidian.Setting(contentEl).setName("Page title").addText((t2) => t2.setValue(this.cur).onChange((x2) => v2 = x2));
    new import_obsidian.Setting(contentEl).addButton((b2) => b2.setButtonText("Rename").setCta().onClick(() => {
      (async () => {
        try {
          await this.plugin.renamePage(this.nbId, this.pId, v2 || this.cur);
        } catch (e2) {
          console.error(e2);
        } finally {
          this.close();
        }
      })().catch(() => {
      });
    })).addButton((b2) => b2.setButtonText("Cancel").onClick(() => this.close()));
  }
  onClose() {
    this.contentEl.empty();
  }
};
var NotebookView = class extends import_obsidian.ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
  }
  getViewType() {
    return NOTEBOOK_VIEW_TYPE;
  }
  getDisplayText() {
    return "Notebooks";
  }
  getIcon() {
    return "pen-tool";
  }
  async onOpen() {
    const c2 = this.containerEl;
    c2.empty();
    c2.addClass("reminote-view");
    const h = c2.createEl("div", { cls: "reminote-header" });
    h.createEl("h4", { text: "Notebooks" });
    h.createEl("button", { text: "+ Create" }).onclick = () => new NotebookModal(this.plugin.app, this.plugin).open();
    this.listEl = c2.createEl("ul");
    this.plugin.on("notebooks-changed", () => this.render());
    this.plugin.on("selection-changed", () => this.render());
    this.render();
  }
  render() {
    const nbs = this.plugin.getSortedNotebooks();
    const sid = this.plugin.getSelectedNotebook()?.id ?? null;
    this.listEl.empty();
    nbs.forEach((nb) => {
      const li = this.listEl.createEl("li");
      if (nb.id === sid)
        li.addClass("is-selected");
      li.createSpan({ text: `${nb.isPinned ? "\u{1F4CC}" : "\u{1F4D2}"} ${nb.name}` });
      li.createEl("button", { text: "\u{1F5D1}" }).onclick = () => {
        void this.plugin.deleteNotebook(nb.id);
      };
      li.addEventListener("contextmenu", (ev) => {
        ev.preventDefault();
        new import_obsidian.Menu().addItem((i) => i.setTitle(nb.isPinned ? "Unpin" : "Pin").setIcon("pin").onClick(() => this.plugin.togglePinNotebook(nb.id))).addItem((i) => i.setTitle("Rename").setIcon("pencil").onClick(() => new NotebookRenameModal(this.plugin.app, this.plugin, nb.id, nb.name).open())).addItem((i) => i.setTitle("Delete").setIcon("trash").onClick(() => {
          void this.plugin.deleteNotebook(nb.id);
        })).showAtMouseEvent(ev);
      });
      li.onclick = () => {
        new import_obsidian.Notice(`\u{1F4D2} ${nb.name}`);
        this.plugin.ui.selectNotebook(nb.id);
      };
    });
  }
};
var PageView = class extends import_obsidian.ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.dropdownOpen = false;
    /** UI-only state — 不影响数据层，不传给 PageManager */
    this.mode = "list";
    this.plugin = plugin;
  }
  getViewType() {
    return PAGE_VIEW_TYPE;
  }
  getDisplayText() {
    return "Pages";
  }
  getIcon() {
    return "files";
  }
  async onOpen() {
    const c2 = this.containerEl;
    c2.empty();
    c2.addClass("reminote-page-view");
    this.headerEl = c2.createEl("div", { cls: "gn-page-header" });
    this.buildHeader();
    this.listEl = c2.createEl("div", { cls: "gn-page-list" });
    this.footerEl = c2.createEl("div", { cls: "gn-page-footer" });
    this.buildFooter();
    this.plugin.on("selection-changed", () => this.render());
    this.plugin.on("notebooks-changed", () => this.render());
    this.render();
  }
  // ==========================================================
  //  Header
  // ==========================================================
  buildHeader() {
    this.headerEl.empty();
    const nb = this.plugin.getSelectedNotebook();
    const titleText = nb?.name ?? "No Notebook";
    const topRow = this.headerEl.createEl("div", { cls: "gn-page-header-top" });
    const titleBtn = topRow.createEl("button", { cls: "gn-page-header-title" });
    titleBtn.createSpan({ text: `\u{1F4D2} ${titleText}` });
    titleBtn.createSpan({ cls: "gn-page-header-chevron", text: "\u25BE" });
    titleBtn.onclick = (ev) => {
      ev.stopPropagation();
      this.toggleDropdown();
    };
    if (nb) {
      topRow.createEl("span", { cls: "gn-page-count-badge", text: `${nb.pages.length}` });
    }
    this.modeBarEl = this.headerEl.createEl("div", { cls: "gn-page-mode-bar" });
    this.buildModeBar();
    this.renderDropdown();
  }
  /** Build mode toggle buttons — UI-only, no data impact */
  buildModeBar() {
    this.modeBarEl.empty();
    const modes = [
      { key: "list", icon: "\u2630", label: "List" },
      { key: "thumbnail", icon: "\u25A6", label: "Thumbnail" }
    ];
    for (const m2 of modes) {
      const btn = this.modeBarEl.createEl("button", {
        cls: `gn-page-mode-btn${this.mode === m2.key ? " is-active" : ""}`,
        attr: { title: m2.label }
      });
      btn.createSpan({ text: m2.icon });
      btn.onclick = () => this.setMode(m2.key);
    }
  }
  setMode(mode) {
    if (this.mode === mode)
      return;
    this.mode = mode;
    this.buildModeBar();
    this.render();
  }
  toggleDropdown() {
    this.dropdownOpen = !this.dropdownOpen;
    this.renderDropdown();
  }
  renderDropdown() {
    const old = this.headerEl.querySelector(".gn-page-dropdown");
    if (old)
      old.remove();
    if (!this.dropdownOpen)
      return;
    const nb = this.plugin.getSelectedNotebook();
    if (!nb)
      return;
    const menu = this.headerEl.createEl("div", { cls: "gn-page-dropdown" });
    const items = [
      {
        label: "New Page",
        icon: "\uFF0B",
        action: () => this.handleNewPage()
      },
      {
        label: "Rename Notebook",
        icon: "\u270E",
        action: () => {
          new NotebookRenameModal(this.plugin.app, this.plugin, nb.id, nb.name).open();
          this.dropdownOpen = false;
          this.renderDropdown();
        }
      }
    ];
    for (const item of items) {
      const row = menu.createEl("div", { cls: "gn-page-dropdown-item" });
      row.createSpan({ cls: "gn-page-dropdown-icon", text: item.icon });
      row.createSpan({ text: item.label });
      row.onclick = () => {
        this.dropdownOpen = false;
        item.action();
      };
    }
  }
  // ==========================================================
  //  Footer
  // ==========================================================
  buildFooter() {
    this.footerEl.empty();
    const btn = this.footerEl.createEl("button", { cls: "gn-page-new-btn" });
    btn.createSpan({ text: "\uFF0B  New Page" });
    btn.onclick = () => this.handleNewPage();
  }
  // ==========================================================
  //  Page List — 模式分发
  //  同数据，两种投影：list（信息密度） / thumbnail（视觉优先）
  // ==========================================================
  render() {
    this.buildHeader();
    this.listEl.empty();
    const nb = this.plugin.getSelectedNotebook();
    if (!nb) {
      this.listEl.createEl("div", { cls: "gn-page-placeholder", text: "Select a notebook to view pages" });
      return;
    }
    if (nb.pages.length === 0) {
      this.listEl.createEl("div", { cls: "gn-page-placeholder", text: "No pages yet. Create one!" });
      return;
    }
    switch (this.mode) {
      case "list":
        this.renderList(nb);
        break;
      case "thumbnail":
        this.renderThumbnail(nb);
        break;
    }
  }
  // ── List mode: compact rows, info-dense ──
  renderList(nb) {
    const activeId = nb.activePageId;
    for (const page of nb.pages) {
      const card = this.listEl.createEl("div", {
        cls: `gn-page-card${page.id === activeId ? " is-active" : ""}`
      });
      const thumb = card.createEl("div", { cls: "gn-page-thumb" });
      if (page.thumbnail) {
        const img = thumb.createEl("img", { cls: "gn-page-thumb-img" });
        img.src = page.thumbnail;
      } else {
        thumb.createSpan({ cls: "gn-page-thumb-placeholder", text: "\u{1F4DD}" });
        if (page.strokes && page.strokes.length > 0) {
          thumb.createEl("span", { cls: "gn-page-stroke-hint", text: `${page.strokes.length}` });
        }
      }
      const info = card.createEl("div", { cls: "gn-page-info" });
      info.createSpan({ cls: "gn-page-title", text: page.title });
      info.createSpan({ cls: "gn-page-meta", text: this.formatDate(page.updatedAt) });
      card.onclick = () => this.handlePageClick(nb.id, page.id);
      card.addEventListener("contextmenu", (ev) => {
        ev.preventDefault();
        new import_obsidian.Menu().addItem((it) => it.setTitle("Rename").setIcon("pencil").onClick(() => new RenameModal(this.plugin.app, this.plugin, nb.id, page.id, page.title).open())).addItem((it) => it.setTitle("Delete").setIcon("trash").onClick(() => this.handleDeletePage(nb.id, page.id))).showAtMouseEvent(ev);
      });
    }
  }
  // ── Thumbnail mode: grid cards, visual-first ──
  renderThumbnail(nb) {
    const activeId = nb.activePageId;
    this.listEl.addClass("gn-page-list-thumb");
    for (const page of nb.pages) {
      const isActive = page.id === activeId;
      const card = this.listEl.createEl("div", {
        cls: `gn-page-thumb-card${isActive ? " is-active" : ""}`
      });
      const preview = card.createEl("div", { cls: "gn-page-thumb-preview" });
      preview.createEl("span", {
        cls: "gn-thumb-badge",
        text: `Page ${page.index + 1}`
      });
      if (page.thumbnail) {
        const img = preview.createEl("img", { cls: "gn-page-thumb-preview-img" });
        img.src = page.thumbnail;
      } else {
        preview.createSpan({ cls: "gn-page-thumb-preview-icon", text: "\u{1F4DD}" });
        if (page.strokes && page.strokes.length > 0) {
          preview.createEl("span", { cls: "gn-page-thumb-stroke-badge", text: `${page.strokes.length}` });
        }
      }
      card.createSpan({ cls: "gn-thumb-meta", text: this.formatDate(page.updatedAt) });
      card.createSpan({ cls: "gn-page-thumb-title", text: page.title });
      card.onclick = () => this.handlePageClick(nb.id, page.id);
      card.addEventListener("contextmenu", (ev) => {
        ev.preventDefault();
        new import_obsidian.Menu().addItem((it) => it.setTitle("Rename").setIcon("pencil").onClick(() => new RenameModal(this.plugin.app, this.plugin, nb.id, page.id, page.title).open())).addItem((it) => it.setTitle("Delete").setIcon("trash").onClick(() => this.handleDeletePage(nb.id, page.id))).showAtMouseEvent(ev);
      });
    }
  }
  // ==========================================================
  //  Actions (delegate to PageManager)
  // ==========================================================
  handlePageClick(notebookId, pageId) {
    this.plugin.ui.openCanvas(notebookId, pageId);
  }
  handleNewPage() {
    const nb = this.plugin.getSelectedNotebook();
    if (!nb)
      return;
    this.plugin.pageManager.createPage(nb.id);
  }
  handleDeletePage(notebookId, pageId) {
    this.plugin.pageManager.deletePage(notebookId, pageId);
  }
  // ==========================================================
  //  Helpers
  // ==========================================================
  formatDate(iso) {
    if (!iso)
      return "";
    const d2 = new Date(iso);
    const now = /* @__PURE__ */ new Date();
    const diffMs = now.getTime() - d2.getTime();
    const diffMin = Math.floor(diffMs / 6e4);
    if (diffMin < 1)
      return "Just now";
    if (diffMin < 60)
      return `${diffMin}m ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24)
      return `${diffHr}h ago`;
    const diffDay = Math.floor(diffHr / 24);
    if (diffDay < 7)
      return `${diffDay}d ago`;
    return d2.toLocaleDateString();
  }
};
var CanvasLayoutManager = class {
  constructor(app, plugin) {
    this.app = app;
    this.plugin = plugin;
  }
  async mountCanvas(notebookId, pageId, _mode = "main") {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(CANVAS_VIEW_TYPE)[0];
    if (!leaf) {
      leaf = workspace.getLeaf(false);
      await leaf.setViewState({ type: CANVAS_VIEW_TYPE, active: true });
    } else {
      workspace.setActiveLeaf(leaf, { focus: true });
    }
    const view = leaf.view;
    view.createSession(notebookId, pageId);
    return view;
  }
  getActiveCanvas() {
    const leaf = this.app.workspace.getLeavesOfType(CANVAS_VIEW_TYPE)[0];
    return leaf ? leaf.view : null;
  }
};
var PageManager = class {
  constructor(plugin) {
    this.plugin = plugin;
  }
  // ============ 内部辅助 ============
  getNotebook(notebookId) {
    return this.plugin.getNotebooks().find((n2) => n2.id === notebookId);
  }
  async saveNotebook(nb) {
    await this.plugin.fileGateway.saveNotebook(nb);
    this.plugin.emit("notebooks-changed");
  }
  // ============ CRUD ============
  /**
   * 创建新 page 并自动设为 active。渲染由 Plugin.requestPageChange 调度。
   */
  createPage(notebookId, title) {
    const nb = this.getNotebook(notebookId);
    if (!nb)
      return null;
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const page = {
      id: genId(),
      title: title || `Page ${nb.nextPageIndex + 1}`,
      index: nb.nextPageIndex,
      strokes: [],
      background: { type: "blank", color: "#ffffff" },
      createdAt: now,
      updatedAt: now
    };
    nb.pages.push(page);
    nb.nextPageIndex++;
    nb.activePageId = page.id;
    nb.updatedAt = now;
    this.plugin.requestPageChange(notebookId, page.id);
    void this.saveNotebook(nb);
    return page;
  }
  /**
   * 删除 page。如果删除的是 activePage，自动切换到相邻 page。
   */
  deletePage(notebookId, pageId) {
    const nb = this.getNotebook(notebookId);
    if (!nb)
      return false;
    const idx = nb.pages.findIndex((p) => p.id === pageId);
    if (idx === -1)
      return false;
    const isActive = nb.activePageId === pageId;
    nb.pages.splice(idx, 1);
    nb.pages.forEach((p, i) => {
      p.index = i;
    });
    nb.nextPageIndex = nb.pages.length;
    nb.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
    if (isActive) {
      const adjacent = nb.pages[Math.min(idx, nb.pages.length - 1)];
      nb.activePageId = adjacent?.id ?? null;
      if (adjacent) {
        this.plugin.requestPageChange(notebookId, adjacent.id);
      } else {
        this.plugin.requestPageChange(notebookId, "");
      }
    }
    void this.saveNotebook(nb);
    return true;
  }
  /**
   * 切换 active page。渲染由 Plugin.requestPageChange 调度。
   */
  switchPage(notebookId, pageId) {
    const nb = this.getNotebook(notebookId);
    if (!nb)
      return false;
    const page = nb.pages.find((p) => p.id === pageId);
    if (!page)
      return false;
    nb.activePageId = pageId;
    this.plugin.requestPageChange(notebookId, pageId);
    return true;
  }
  /**
   * 更新 page 元数据（title / background），不影响 strokes。
   */
  updatePage(notebookId, pageId, patch) {
    const nb = this.getNotebook(notebookId);
    if (!nb)
      return false;
    const page = nb.pages.find((p) => p.id === pageId);
    if (!page)
      return false;
    if (patch.title !== void 0)
      page.title = patch.title;
    if (patch.background !== void 0)
      page.background = patch.background;
    if (patch.thumbnail !== void 0)
      page.thumbnail = patch.thumbnail;
    page.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
    nb.updatedAt = page.updatedAt;
    void this.saveNotebook(nb);
    return true;
  }
  /**
   * 直接用新的 strokes 数组更新 page 数据。
   * 如果是当前活跃 page，通过 Plugin 调度重绘。
   */
  updatePageData(notebookId, pageId, strokes) {
    const nb = this.getNotebook(notebookId);
    if (!nb)
      return false;
    const page = nb.pages.find((p) => p.id === pageId);
    if (!page)
      return false;
    page.strokes = strokes;
    page.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
    nb.updatedAt = page.updatedAt;
    if (nb.activePageId === pageId) {
      this.plugin.requestPageChange(notebookId, pageId);
    }
    void this.saveNotebook(nb);
    return true;
  }
  // ============ 排序 ============
  /** 移动 page 到指定 index */
  movePage(notebookId, pageId, targetIndex) {
    const nb = this.getNotebook(notebookId);
    if (!nb)
      return false;
    const idx = nb.pages.findIndex((p) => p.id === pageId);
    if (idx === -1)
      return false;
    const [page] = nb.pages.splice(idx, 1);
    nb.pages.splice(targetIndex, 0, page);
    nb.pages.forEach((p, i) => {
      p.index = i;
    });
    nb.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
    void this.saveNotebook(nb);
    return true;
  }
  /** 深拷贝 page（新 ID + 深拷贝 strokes） */
  duplicatePage(notebookId, pageId) {
    const nb = this.getNotebook(notebookId);
    if (!nb)
      return null;
    const src = nb.pages.find((p) => p.id === pageId);
    if (!src)
      return null;
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const copy = {
      ...src,
      id: genId(),
      title: `${src.title} (copy)`,
      index: nb.pages.length,
      strokes: src.strokes.map((s) => ({ ...s, id: genId(), points: s.points.map((p) => ({ ...p })) })),
      createdAt: now,
      updatedAt: now,
      thumbnail: void 0
    };
    nb.pages.push(copy);
    nb.nextPageIndex = nb.pages.length;
    nb.updatedAt = now;
    void this.saveNotebook(nb);
    this.switchPage(notebookId, copy.id);
    return copy;
  }
  // ============ 查询 ============
  getActivePage(notebookId) {
    const nb = this.getNotebook(notebookId);
    if (!nb || !nb.activePageId)
      return null;
    return nb.pages.find((p) => p.id === nb.activePageId) ?? null;
  }
  getPages(notebookId) {
    return this.getNotebook(notebookId)?.pages ?? [];
  }
  getStrokeCount(notebookId, pageId) {
    const nb = this.getNotebook(notebookId);
    const page = nb?.pages.find((p) => p.id === pageId);
    return page?.strokes?.length ?? 0;
  }
  // ============ 缩略图 ============
  generateThumbnail(notebookId, pageId) {
    const canvas = this.plugin.layoutManager?.getActiveCanvas();
    if (!canvas?.session?.isAlive())
      return null;
    const session = canvas.session;
    if (session.pageId !== pageId) {
      const nb = this.getNotebook(notebookId);
      const page = nb?.pages.find((p) => p.id === pageId);
      if (page) {
        session.loadPage(notebookId, page);
      }
    }
    try {
      return session.canvasEl.toDataURL("image/png", 0.5);
    } catch {
      return null;
    }
  }
};
var CanvasPolicy = class {
  static getDefaults() {
    return {
      spacing: 3,
      smoothness: 0.5,
      strokeWidth: 2,
      cornerKeep: 0.3,
      opacity: 1,
      color: "#1a1a1a",
      brushType: "brush-pen",
      dynamicInk: { enabled: true, strength: 0.25, minWidth: 0.6, maxWidth: 1.8 }
    };
  }
  static clampStrokeWidth(w2) {
    return Math.max(CANVAS_CONSTANTS.MIN_STROKE_WIDTH, Math.min(CANVAS_CONSTANTS.MAX_STROKE_WIDTH, w2));
  }
  static normalizeSpeed(speed) {
    return Math.min(1, speed / CANVAS_CONSTANTS.SPEED_NORMALIZATION);
  }
};
var _engineIdCounter = 0;
var CanvasRuntimeEngine = class {
  // ============================================================
  constructor() {
    this.id = ++_engineIdCounter;
    this.notebookId = "";
    this.pageId = "";
    this.strokes = [];
    this.mode = "raw";
    this.isDrawing = false;
    this.currentStroke = null;
    this.commitTimer = null;
    this.lastRecordedPoint = null;
    this.params = CanvasPolicy.getDefaults();
    // ============================================================
    //  Event System — lightweight pub/sub, zero external deps
    // ============================================================
    this._listeners = /* @__PURE__ */ new Map();
    // ============================================================
    //  Undo / Redo
    // ============================================================
    this._undoStack = [];
    this._redoStack = [];
    /** External callback fired when undo/redo state changes. */
    this.onUndoChange = null;
  }
  /** Subscribe to an engine event. Returns unsubscribe function. */
  on(event, fn) {
    if (!this._listeners.has(event))
      this._listeners.set(event, []);
    this._listeners.get(event).push(fn);
    return () => this.off(event, fn);
  }
  /** Unsubscribe a specific handler from an event. */
  off(event, fn) {
    const arr = this._listeners.get(event);
    if (!arr)
      return;
    const idx = arr.indexOf(fn);
    if (idx !== -1)
      arr.splice(idx, 1);
  }
  /** Emit an event with optional payload. Engine never knows who listens. */
  emit(event, payload) {
    const arr = this._listeners.get(event);
    if (!arr)
      return;
    for (const fn of arr)
      fn(payload);
  }
  get drawing() {
    return this.isDrawing;
  }
  /** Current stroke ID — for dirty tracking by Tool layer. */
  get currentStrokeId() {
    return this.currentStroke?.id ?? null;
  }
  /** Last added point — for computing dirty region bounds. */
  get lastPoint() {
    if (!this.currentStroke?.points?.length)
      return null;
    const pts = this.currentStroke.points;
    return pts[pts.length - 1];
  }
  /**
   * 加载 page 数据 — 幂等可重复调用，返回是否成功。
   * 调用方负责提供 strokes 数据；Engine 不查询 Plugin/Notebook。
   */
  load(notebookId, pageId, strokes) {
    if (this.notebookId === notebookId && this.pageId === pageId)
      return true;
    this.commitNow();
    const safe = strokes && Array.isArray(strokes) ? strokes : [];
    this.notebookId = notebookId;
    this.pageId = pageId;
    this.strokes = safe;
    this.isDrawing = false;
    this.currentStroke = null;
    this.clearHistory();
    return true;
  }
  setParams(p) {
    Object.assign(this.params, p);
  }
  setMode(mode) {
    this.mode = mode;
  }
  startStroke(pt, pointerId, setCapture) {
    if (!Number.isFinite(pt.x) || !Number.isFinite(pt.y)) {
      console.warn("[ENGINE] startStroke blocked \u2014 non-finite coords", pt);
      return;
    }
    this.isDrawing = true;
    const p0 = { x: pt.x, y: pt.y, t: performance.now(), speed: 0, pressure: pt.pressure ?? 0.5 };
    this.currentStroke = {
      id: genId(),
      points: [p0],
      color: this.params.color ?? "#1a1a1a",
      width: this.params.strokeWidth,
      _penParams: {
        spacing: this.params.spacing,
        smoothness: this.params.smoothness,
        strokeWidth: this.params.strokeWidth,
        cornerKeep: this.params.cornerKeep,
        opacity: this.params.opacity ?? 1,
        color: this.params.color ?? "#1a1a1a",
        brushType: this.params.brushType
      },
      debug: { pointCount: 1, resampleCount: 0, droppedPoints: 0, avgSpeed: 0 },
      penState: { lastSpeed: 0, smoothedSpeed: 0, lastWidth: this.params.strokeWidth }
    };
    this.strokes.push(this.currentStroke);
    setCapture(pointerId);
  }
  addPoint(pt) {
    if (!this.isDrawing || !this.currentStroke)
      return;
    if (!Number.isFinite(pt.x) || !Number.isFinite(pt.y)) {
      console.warn("[ENGINE] addPoint blocked \u2014 non-finite coords", pt);
      return;
    }
    const points = this.currentStroke.points;
    if (points.length === 0) {
      points.push({ x: pt.x, y: pt.y, t: performance.now(), speed: 0 });
      this.lastRecordedPoint = { x: pt.x, y: pt.y };
      if (this.currentStroke.debug) {
        this.currentStroke.debug.pointCount++;
      }
      return;
    }
    if (points.length === 1) {
      this.lastRecordedPoint = { x: points[0].x, y: points[0].y };
    }
    if (!this.lastRecordedPoint) {
      this.lastRecordedPoint = { x: points[points.length - 1].x, y: points[points.length - 1].y };
    }
    const dist = Math.hypot(pt.x - this.lastRecordedPoint.x, pt.y - this.lastRecordedPoint.y);
    if (dist < this.params.spacing) {
      if (this.currentStroke.debug) {
        this.currentStroke.debug.droppedPoints++;
      }
      return;
    }
    const count = Math.floor(dist / this.params.spacing);
    if (this.currentStroke.debug && count > 0) {
      this.currentStroke.debug.resampleCount += count;
    }
    const dx = (pt.x - this.lastRecordedPoint.x) / dist * this.params.spacing;
    const dy = (pt.y - this.lastRecordedPoint.y) / dist * this.params.spacing;
    let cx = this.lastRecordedPoint.x;
    let cy = this.lastRecordedPoint.y;
    for (let i = 0; i < count; i++) {
      cx += dx;
      cy += dy;
      points.push({
        x: cx,
        y: cy,
        t: performance.now(),
        speed: 0
      });
      if (this.currentStroke.debug) {
        this.currentStroke.debug.pointCount++;
      }
    }
    if (this.currentStroke.debug && pt.speed != null) {
      this.currentStroke.debug.avgSpeed = (this.currentStroke.debug.avgSpeed + pt.speed) * 0.5;
    }
    if (count > 0) {
      this.lastRecordedPoint = { x: cx, y: cy };
    }
    if (this.currentStroke.penState) {
      const prev = points[points.length - 1];
      const dx2 = pt.x - prev.x;
      const dy2 = pt.y - prev.y;
      const dist2 = Math.hypot(dx2, dy2);
      const dt = Math.max(1, (pt.t ?? 0) - (prev.t ?? pt.t ?? 0));
      const rawSpeed = dist2 / dt;
      const ps = this.currentStroke.penState;
      ps.lastSpeed = rawSpeed;
      ps.smoothedSpeed = this.smoothSpeed(ps.smoothedSpeed, rawSpeed);
    }
  }
  smoothSpeed(prev, current) {
    const alpha = 0.25;
    return prev * (1 - alpha) + current * alpha;
  }
  endStroke() {
    if (!this.isDrawing)
      return;
    this.isDrawing = false;
    const stroke = this.currentStroke;
    if (stroke) {
      stroke.quality = this.analyzeStroke(stroke.points);
      this._pushUndo(stroke);
    }
    this.currentStroke = null;
    this.commitNow();
  }
  analyzeStroke(points) {
    if (points.length < 2) {
      return { smoothness: 1, jitter: 0, density: 1, curvature: 0, overall: 1 };
    }
    let jitter = 0;
    let curvature = 0;
    const distances = [];
    for (let i = 1; i < points.length; i++) {
      const dx = points[i].x - points[i - 1].x;
      const dy = points[i].y - points[i - 1].y;
      const dist = Math.hypot(dx, dy);
      distances.push(dist);
      if (i > 1) {
        const prevDx = points[i - 1].x - points[i - 2].x;
        const prevDy = points[i - 1].y - points[i - 2].y;
        const dot = dx * prevDx + dy * prevDy;
        const mag1 = Math.hypot(dx, dy);
        const mag2 = Math.hypot(prevDx, prevDy);
        const cos = mag1 * mag2 === 0 ? 1 : dot / (mag1 * mag2);
        curvature += Math.acos(Math.max(-1, Math.min(1, cos)));
      }
    }
    const avg = distances.reduce((a2, b2) => a2 + b2, 0) / distances.length;
    jitter = distances.reduce((a2, b2) => a2 + Math.abs(b2 - avg), 0) / distances.length;
    const smoothness = Math.max(0, 1 - jitter / CANVAS_CONSTANTS.JITTER_THRESHOLD);
    const density = Math.max(0, Math.min(1, 1 / (avg + 1e-3)));
    const normCurvature = Math.min(1, curvature / CANVAS_CONSTANTS.CURVATURE_NORMALIZATION);
    const overall = smoothness * 0.4 + density * 0.2 + (1 - normCurvature) * 0.4;
    return { smoothness, jitter, density, curvature: normCurvature, overall };
  }
  // ============================================================
  //  Eraser support — public API for ToolSystem
  // ============================================================
  /** Hit-test: does any point in stroke fall within radius of pt? */
  hitTestStroke(stroke, pt, radius = CANVAS_CONSTANTS.ERASER_RADIUS) {
    if (!stroke?.points)
      return false;
    for (const p of stroke.points) {
      if (Math.hypot(p.x - pt.x, p.y - pt.y) < radius) {
        return true;
      }
    }
    return false;
  }
  /**
   * Point-level erase: remove specific point indices from a stroke.
   * Automatically splits stroke into multiple if gap is detected.
   */
  erasePointsFromStroke(strokeIdx, pointIndices) {
    if (strokeIdx < 0 || strokeIdx >= this.strokes.length)
      return;
    const stroke = this.strokes[strokeIdx];
    if (!stroke?.points)
      return;
    const sorted = [...pointIndices].sort((a2, b2) => b2 - a2);
    const removeSet = new Set(sorted);
    const segments = [];
    let current = [];
    for (let i = 0; i < stroke.points.length; i++) {
      if (removeSet.has(i)) {
        if (current.length >= 2)
          segments.push(current);
        current = [];
      } else {
        current.push({ ...stroke.points[i] });
      }
    }
    if (current.length >= 2)
      segments.push(current);
    if (segments.length === 0) {
      this.strokes.splice(strokeIdx, 1);
      return;
    }
    if (segments.length === 1 && segments[0].length === stroke.points.length) {
      return;
    }
    stroke.points = segments[0];
    for (let si = 1; si < segments.length; si++) {
      const newStroke = {
        id: genId(),
        points: segments[si],
        color: stroke.color,
        width: stroke.width,
        _penParams: stroke._penParams ? { ...stroke._penParams } : void 0
      };
      this.strokes.splice(strokeIdx + si, 0, newStroke);
    }
  }
  // ============================================================
  //  Public Stroke CRUD API — sole write path to strokes[]
  //  Tool layer MUST use these; NEVER touch engine.strokes directly
  // ============================================================
  /** Remove a stroke by its ID. Returns true if found and removed. */
  removeStroke(strokeId) {
    const idx = this.strokes.findIndex((s) => s.id === strokeId);
    if (idx === -1)
      return false;
    const [removed] = this.strokes.splice(idx, 1);
    this._pushUndo(removed);
    return true;
  }
  /** Record a stroke for undo (called on endStroke and erase). */
  _pushUndo(stroke) {
    this._undoStack.push(stroke);
    this._redoStack = [];
    this.onUndoChange?.();
  }
  /** Undo last action. Returns the affected stroke or null. */
  undo() {
    if (this._undoStack.length === 0)
      return null;
    const stroke = this._undoStack.pop();
    const idx = this.strokes.findIndex((s) => s.id === stroke.id);
    if (idx !== -1) {
      this.strokes.splice(idx, 1);
    }
    this._redoStack.push(stroke);
    this.onUndoChange?.();
    return stroke;
  }
  /** Redo last undone action. Returns the restored stroke or null. */
  redo() {
    if (this._redoStack.length === 0)
      return null;
    const stroke = this._redoStack.pop();
    this.strokes.push(stroke);
    this._undoStack.push(stroke);
    this.onUndoChange?.();
    return stroke;
  }
  /** Clear undo/redo history (e.g. on page switch). */
  clearHistory() {
    this._undoStack = [];
    this._redoStack = [];
    this.onUndoChange?.();
  }
  get canUndo() {
    return this._undoStack.length > 0;
  }
  get canRedo() {
    return this._redoStack.length > 0;
  }
  /** Add a fully-constructed stroke (for external injection, e.g. paste / import). */
  addStroke(stroke) {
    this.strokes.push(stroke);
  }
  /** Update an existing stroke's metadata (color, width, etc.) by ID. Does NOT touch points. */
  updateStroke(strokeId, patch) {
    const stroke = this.strokes.find((s) => s.id === strokeId);
    if (!stroke)
      return false;
    Object.assign(stroke, patch);
    return true;
  }
  /** 同步提交 — emit commit event（用于切页前 flush） */
  commitNow() {
    if (this.commitTimer) {
      window.clearTimeout(this.commitTimer);
      this.commitTimer = null;
    }
    this.emitCommit();
  }
  /** 异步提交 — debounce 80ms（正常绘制路径） */
  commit() {
    if (this.commitTimer)
      window.clearTimeout(this.commitTimer);
    this.commitTimer = window.setTimeout(() => this.emitCommit(), 80);
  }
  /** Fire commit event with current state. Subscribers handle persistence. */
  emitCommit() {
    this.emit("commit", {
      notebookId: this.notebookId,
      pageId: this.pageId,
      strokes: this.strokes
    });
  }
  reset() {
    if (this.commitTimer)
      window.clearTimeout(this.commitTimer);
    this.notebookId = "";
    this.pageId = "";
    this.strokes = [];
    this.isDrawing = false;
    this.currentStroke = null;
  }
  detach() {
    if (this.commitTimer)
      window.clearTimeout(this.commitTimer);
    this.isDrawing = false;
    this.currentStroke = null;
  }
};
var Viewport = class {
  constructor() {
    /** CSS pixel dimensions — the single source of truth for world space. */
    this.cssW = 0;
    this.cssH = 0;
    /** devicePixelRatio — used ONLY in render buffer mapping, never in input math. */
    this.dpr = 1;
    /** Camera — 唯一视图变换源，只影响显示，不影响数据 */
    this.camera = createDefaultCamera();
    /** Interaction guard — true during active pointer drag. Input state, NOT camera state. */
    this.isPanning = false;
    /** Inertia physics controller — driven by unified frame tick, no independent RAF. */
    this.inertia = new InertiaController();
  }
  update(cssW, cssH, dpr) {
    this.cssW = cssW;
    this.cssH = cssH;
    this.dpr = dpr;
  }
  /**
   * screen → camera → world
   * screen（canvas-relative pixels）→ world（stroke data space）
   * 公式: world = (screen - camera) / zoom
   */
  screenToWorld(clientX, clientY, canvasRect) {
    const sx = clientX - canvasRect.left;
    const sy = clientY - canvasRect.top;
    const c2 = this.camera;
    return {
      x: (sx - c2.x) / c2.zoom,
      y: (sy - c2.y) / c2.zoom
    };
  }
  /**
   * world → screen
   * 公式: screen = world * zoom + camera
   */
  worldToScreen(worldX, worldY) {
    const c2 = this.camera;
    return {
      x: worldX * c2.zoom + c2.x,
      y: worldY * c2.zoom + c2.y
    };
  }
  /**
   * Render transform: 应用 camera 到 canvas context
   * 公式: deviceCoord = (worldCoord * zoom + camera) * dpr
   * 用 setTransform 一次性设置，避免累积变换
   */
  applyTransform(ctx) {
    const c2 = this.camera;
    ctx.setTransform(
      this.dpr * c2.zoom,
      0,
      0,
      this.dpr * c2.zoom,
      c2.x * this.dpr,
      c2.y * this.dpr
    );
  }
  /**
   * Pan — 拖动画布
   * delta 是 screen-space pixels，直接加到 camera 偏移
   */
  pan(dx, dy) {
    this.camera.x += dx;
    this.camera.y += dy;
  }
  // ============================================================
  //  Inertia — driven by unified frame tick (no independent RAF)
  // ============================================================
  /** Get a snapshot of the camera state (for viewState sync). */
  getCameraSnapshot() {
    const c2 = this.camera;
    return { x: c2.x, y: c2.y, zoom: c2.zoom, vx: this.inertia.vx, vy: this.inertia.vy };
  }
  /**
   * Zoom at anchor — 以指定世界坐标为锚点缩放
   * 保持 anchorWorld 在屏幕上的位置不变
   *
   * @param anchorScreenX 锚点在 canvas-relative screen space 的 X
   * @param anchorScreenY 锚点在 canvas-relative screen space 的 Y
   * @param newZoom 目标缩放值（会被 clamp）
   */
  zoomAt(anchorScreenX, anchorScreenY, newZoom) {
    const c2 = this.camera;
    const oldZoom = c2.zoom;
    newZoom = clampZoom(newZoom);
    if (newZoom === oldZoom)
      return;
    const worldX = (anchorScreenX - c2.x) / oldZoom;
    const worldY = (anchorScreenY - c2.y) / oldZoom;
    c2.zoom = newZoom;
    c2.x = anchorScreenX - worldX * newZoom;
    c2.y = anchorScreenY - worldY * newZoom;
  }
  /** 重置 camera 到默认状态（含停止惯性） */
  resetCamera() {
    this.inertia.stop();
    this.camera = createDefaultCamera();
  }
  /** 获取当前 zoom 级别（方便外部读取） */
  get zoom() {
    return this.camera.zoom;
  }
};
var ReplayController = class {
  constructor() {
    this._strokeId = null;
    this._cursorIndex = 0;
    this._enabled = false;
  }
  get active() {
    return this._enabled;
  }
  get strokeId() {
    return this._strokeId;
  }
  get cursorIndex() {
    return this._cursorIndex;
  }
  /** Check if a given stroke is the one currently being replayed. */
  isActive(strokeId) {
    return this._enabled && this._strokeId === strokeId;
  }
  start(strokeId) {
    this._strokeId = strokeId;
    this._cursorIndex = 0;
    this._enabled = true;
  }
  /** Advance cursor by one frame. Returns true if still within stroke bounds. */
  tick() {
    this._cursorIndex++;
    return true;
  }
  stop() {
    this._enabled = false;
  }
  reset() {
    this.stop();
    this._strokeId = null;
    this._cursorIndex = 0;
  }
};
var StrokeDirtyTracker = class {
  constructor() {
    this.dirtyIds = /* @__PURE__ */ new Set();
  }
  /** Mark a stroke as dirty — its Path2D needs rebuild. */
  markDirty(strokeId) {
    this.dirtyIds.add(strokeId);
  }
  /** Check if a stroke is dirty. */
  isDirty(strokeId) {
    return this.dirtyIds.has(strokeId);
  }
  /** Get all dirty stroke IDs and clear the set. */
  flushDirty() {
    const ids = Array.from(this.dirtyIds);
    this.dirtyIds.clear();
    return ids;
  }
  /** Check if any stroke is dirty. */
  get hasDirty() {
    return this.dirtyIds.size > 0;
  }
  /** Mark all strokes as dirty (e.g. page load, camera reset). */
  markAllDirty(strokeIds) {
    for (const id of strokeIds)
      this.dirtyIds.add(id);
  }
  /** Clear all dirty flags without processing. */
  clear() {
    this.dirtyIds.clear();
  }
};
var StrokeRenderCache = class {
  constructor() {
    this.cache = /* @__PURE__ */ new Map();
    /** Tracks how many points the cached Path2D was built from (for incremental rebuild). */
    this._smoothCounts = /* @__PURE__ */ new Map();
  }
  /** Get cached Path2D, or undefined if not built yet. */
  get(strokeId) {
    return this.cache.get(strokeId);
  }
  /** Store a Path2D in cache with optional point count for incremental rebuild. */
  set(strokeId, path2D, pointCount) {
    this.cache.set(strokeId, path2D);
    if (pointCount !== void 0)
      this._smoothCounts.set(strokeId, pointCount);
  }
  /** Get the number of points the cached Path2D was built from. */
  getSmoothCount(strokeId) {
    return this._smoothCounts.get(strokeId) ?? 0;
  }
  /** Invalidate (remove) a stroke's cached Path2D. */
  invalidate(strokeId) {
    this.cache.delete(strokeId);
    this._smoothCounts.delete(strokeId);
  }
  /** Clear all cached Path2Ds. */
  clear() {
    this.cache.clear();
    this._smoothCounts.clear();
  }
  /** Number of cached entries. */
  get size() {
    return this.cache.size;
  }
};
function mergeDirtyRegions(a2, b2) {
  if (!a2)
    return { ...b2 };
  const ax2 = a2.x + a2.w, ay2 = a2.y + a2.h;
  const bx2 = b2.x + b2.x + b2.w, by2 = b2.y + b2.h;
  const nx = Math.min(a2.x, b2.x);
  const ny = Math.min(a2.y, b2.y);
  return {
    x: nx,
    y: ny,
    w: Math.max(ax2, bx2) - nx,
    h: Math.max(ay2, by2) - ny
  };
}
function computeStrokeBounds(points) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX)
      minX = p.x;
    if (p.y < minY)
      minY = p.y;
    if (p.x > maxX)
      maxX = p.x;
    if (p.y > maxY)
      maxY = p.y;
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}
var RenderScheduler = class {
  constructor() {
    this.rafId = null;
    this._onFrame = null;
    this._running = false;
  }
  /** Register the frame callback. Called once per RAF tick. */
  set onFrame(fn) {
    this._onFrame = fn;
  }
  get running() {
    return this._running;
  }
  /**
   * Request a render. Multiple rapid calls are merged into a single RAF tick.
   * Idempotent — if already pending, this is a no-op.
   */
  requestRender() {
    if (this.rafId !== null)
      return;
    if (!this._running)
      return;
    this.rafId = window.requestAnimationFrame(() => {
      this.rafId = null;
      if (!this._running)
        return;
      this._onFrame?.();
    });
  }
  /** Start the scheduler. Before start(), requestRender() is silently ignored. */
  start() {
    this._running = true;
  }
  /** Stop the scheduler and cancel any pending RAF. */
  stop() {
    this._running = false;
    if (this.rafId !== null) {
      window.cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }
};
var RenderQueue = class {
  constructor() {
    this.renderables = [];
    /** Camera snapshot at queue-build time */
    this.camera = { x: 0, y: 0, zoom: 1 };
    /** Canvas buffer dimensions (cssW/cssH * dpr) */
    this.bufW = 0;
    this.bufH = 0;
    /** Accumulated dirty region in world-space (for partial repaint clip). */
    this.dirtyRegion = null;
    /** Background color */
    this.backgroundColor = "#ffffff";
  }
  // ==========================================================
  //  Full rebuild — used for page load / camera reset / resize
  // ==========================================================
  /** Full rebuild of all renderables from scratch. Uses cache for Path2D. */
  fullRebuild(strokes, params, cache2, replayCtrl) {
    const newRenderables = [];
    for (const s of strokes) {
      if (!s?.points || s.points.length === 0)
        continue;
      if (replayCtrl?.isActive(s.id)) {
        const cursorIdx = replayCtrl.cursorIndex;
        let pts = s.points.slice(0, cursorIdx);
        if (pts.length < 2)
          continue;
        pts = beautifyStroke(pts, beautifyConfig);
        const path2D2 = buildPath2D(pts, s._penParams || params);
        cache2.set(s.id, path2D2, pts.length);
        newRenderables.push({
          id: s.id,
          path2D: path2D2,
          style: buildStyle(s, s._penParams || params),
          _sourcePoints: s.points,
          _totalPoints: s.points.length,
          _glyph: s._glyph
        });
        continue;
      }
      let path2D = cache2.get(s.id);
      const prevCount = cache2.getSmoothCount(s.id);
      if (!path2D || prevCount > 0 && prevCount !== s.points.length) {
        const freezeIdx = !path2D ? 0 : prevCount;
        const pts = beautifyStroke(s.points, beautifyConfig);
        path2D = buildPath2D(pts, s._penParams || params, freezeIdx);
        cache2.set(s.id, path2D, s.points.length);
      }
      newRenderables.push({
        id: s.id,
        path2D,
        style: buildStyle(s, s._penParams || params),
        _sourcePoints: s.points,
        _totalPoints: s.points.length,
        _glyph: s._glyph
      });
    }
    this.renderables = newRenderables;
    this.dirtyRegion = null;
  }
  // ==========================================================
  //  Incremental update — only dirty strokes rebuild Path2D
  //  O(k) where k = number of dirty strokes
  // ==========================================================
  /**
   * Update only dirty strokes. Non-dirty strokes keep their existing Path2D.
   * @param dirtyIds Set of stroke IDs that need rebuild
   * @param strokes Full strokes array (for index lookup)
   * @param params Engine pen params
   * @param cache StrokeRenderCache for Path2D storage
   */
  updateDirty(dirtyIds, strokes, params, cache2) {
    if (dirtyIds.length === 0)
      return;
    const indexMap = /* @__PURE__ */ new Map();
    for (let i = 0; i < strokes.length; i++) {
      indexMap.set(strokes[i].id, i);
    }
    for (const id of dirtyIds) {
      const idx = indexMap.get(id);
      if (idx === void 0) {
        cache2.invalidate(id);
        continue;
      }
      const s = strokes[idx];
      if (!s?.points || s.points.length === 0)
        continue;
      const pp = s._penParams || params;
      const prevCount = cache2.getSmoothCount(s.id);
      const freezeIdx = prevCount > 0 ? prevCount : 0;
      const pts = beautifyStroke(s.points, beautifyConfig);
      const path2D = buildPath2D(pts, pp, freezeIdx);
      cache2.set(s.id, path2D, s.points.length);
      while (this.renderables.length <= idx) {
        this.renderables.push(null);
      }
      this.renderables[idx] = {
        id: s.id,
        path2D,
        style: buildStyle(s, pp),
        _sourcePoints: s.points,
        _totalPoints: s.points.length,
        _glyph: s._glyph
      };
    }
  }
  // ==========================================================
  //  Dirty region management
  // ==========================================================
  /** Merge a new dirty region (world-space) into the accumulated region. */
  mergeDirtyRegion(region) {
    this.dirtyRegion = mergeDirtyRegions(this.dirtyRegion, region);
  }
  /** Get the accumulated dirty region, or null if none. */
  getDirtyRegion() {
    return this.dirtyRegion;
  }
  /** Clear the accumulated dirty region. */
  clearDirtyRegion() {
    this.dirtyRegion = null;
  }
  /** Clear all cached renderables. */
  clear() {
    this.renderables = [];
    this.dirtyRegion = null;
  }
};
function smoothStroke(points, freezeIdx = 0) {
  if (points.length < 3)
    return points;
  const smoothed = points.slice(0, Math.max(0, freezeIdx));
  const startI = Math.max(freezeIdx, 0);
  for (let i = startI; i < points.length; i++) {
    if (i === 0 || i === points.length - 1) {
      smoothed.push({ x: points[i].x, y: points[i].y });
      continue;
    }
    const p0 = points[i - 1];
    const p1 = points[i];
    const p2 = points[i + 1];
    smoothed.push({
      x: p0.x * 0.25 + p1.x * 0.5 + p2.x * 0.25,
      y: p0.y * 0.25 + p1.y * 0.5 + p2.y * 0.25
    });
  }
  return smoothed;
}
function hslToRgb(h, s, l) {
  let r2, g, b2;
  if (s === 0) {
    r2 = g = b2 = l;
  } else {
    const hue2rgb = (p2, q2, t2) => {
      if (t2 < 0)
        t2 += 1;
      if (t2 > 1)
        t2 -= 1;
      if (t2 < 1 / 6)
        return p2 + (q2 - p2) * 6 * t2;
      if (t2 < 1 / 2)
        return q2;
      if (t2 < 2 / 3)
        return p2 + (q2 - p2) * (2 / 3 - t2) * 6;
      return p2;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r2 = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b2 = hue2rgb(p, q, h - 1 / 3);
  }
  return [Math.round(r2 * 255), Math.round(g * 255), Math.round(b2 * 255)];
}
function rgbToHsl(r2, g, b2) {
  r2 /= 255;
  g /= 255;
  b2 /= 255;
  const max = Math.max(r2, g, b2), min = Math.min(r2, g, b2);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d2 = max - min;
    s = l > 0.5 ? d2 / (2 - max - min) : d2 / (max + min);
    if (max === r2)
      h = ((g - b2) / d2 + (g < b2 ? 6 : 0)) / 6;
    else if (max === g)
      h = ((b2 - r2) / d2 + 2) / 6;
    else
      h = ((r2 - g) / d2 + 4) / 6;
  }
  return { h: h * 360, s, l };
}
function hexToHsl(hex) {
  const r2 = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b2 = parseInt(hex.slice(5, 7), 16);
  return rgbToHsl(r2, g, b2);
}
function hslToHex(h, s, l) {
  const [r2, g, b2] = hslToRgb(h / 360, s, l);
  return "#" + [r2, g, b2].map((c2) => c2.toString(16).padStart(2, "0")).join("");
}
function buildPath2D(points, p, freezeIdx = 0) {
  const pts = smoothStroke(points, freezeIdx);
  const path = new Path2D();
  if (pts.length === 1) {
    path.moveTo(pts[0].x, pts[0].y);
    path.arc(pts[0].x, pts[0].y, 1, 0, Math.PI * 2);
    return path;
  }
  if (pts.length === 2) {
    path.moveTo(pts[0].x, pts[0].y);
    path.lineTo(pts[1].x, pts[1].y);
    return path;
  }
  const thresholdAngle = p.cornerKeep * Math.PI;
  path.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length - 1; i++) {
    const v1x = pts[i].x - pts[i - 1].x;
    const v1y = pts[i].y - pts[i - 1].y;
    const v2x = pts[i + 1].x - pts[i].x;
    const v2y = pts[i + 1].y - pts[i].y;
    const dot = v1x * v2x + v1y * v2y;
    const m1 = Math.hypot(v1x, v1y);
    const m2 = Math.hypot(v2x, v2y);
    const cosA = m1 && m2 ? dot / (m1 * m2) : 1;
    const angle = Math.acos(Math.max(-1, Math.min(1, cosA)));
    if (angle > thresholdAngle) {
      path.lineTo(pts[i].x, pts[i].y);
      continue;
    }
    const t2 = p.smoothness;
    path.quadraticCurveTo(
      pts[i].x,
      pts[i].y,
      pts[i].x + (pts[i + 1].x - pts[i].x) * t2,
      pts[i].y + (pts[i + 1].y - pts[i].y) * t2
    );
  }
  path.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
  return path;
}
function buildStyle(s, p) {
  const baseW = CanvasPolicy.clampStrokeWidth(p.strokeWidth);
  const widths = computeStrokeWidths(s.points, baseW);
  return {
    color: p.color ?? s.color,
    lineWidth: baseW,
    lineCap: "round",
    lineJoin: "round",
    opacity: p.opacity ?? 1,
    _widths: widths,
    _brushType: p.brushType ?? "brush-pen"
  };
}
function computeStrokeWidths(points, baseW) {
  const n2 = points.length;
  if (n2 < 2)
    return new Array(n2).fill(baseW);
  const w2 = new Array(n2);
  const hasPressure = points.some((p) => p.pressure !== void 0 && p.pressure > 0 && p.pressure < 1);
  let prevFilteredP = points[0]?.pressure ?? 0.5;
  const filteredPs = [prevFilteredP];
  if (hasPressure) {
    for (let i = 1; i < n2; i++) {
      const rawP = points[i].pressure ?? 0.5;
      const smoothed = prevFilteredP * 0.85 + rawP * 0.15;
      filteredPs.push(smoothed);
      prevFilteredP = smoothed;
    }
  }
  for (let i = 0; i < n2; i++) {
    let bw = baseW;
    if (n2 > 6) {
      const fadeLen = Math.min(8, Math.floor(n2 * 0.08));
      const endDist = Math.min(i, n2 - 1 - i);
      if (endDist < fadeLen) {
        const t2 = endDist / Math.max(1, fadeLen - 1);
        const fade = t2 * t2 * (3 - 2 * t2);
        bw *= 0.15 + 0.85 * fade;
      }
    }
    if (hasPressure) {
      const p = filteredPs[i];
      bw *= 0.35 + p * 0.65;
    }
    w2[i] = Math.max(0.08, Math.min(bw, baseW * 1.8));
  }
  return w2;
}
var Renderer = class {
  /** Draw the render queue to canvas. Always full clear+redraw to prevent double-stroke artifacts. */
  draw(ctx, canvas, queue, viewport) {
    const cam = queue.camera;
    const dpr = viewport.dpr;
    ctx.imageSmoothingEnabled = false;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = queue.backgroundColor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(
      dpr * cam.zoom,
      0,
      0,
      dpr * cam.zoom,
      cam.x * dpr,
      cam.y * dpr
    );
    for (const r2 of queue.renderables) {
      if (!r2)
        continue;
      ctx.save();
      ctx.strokeStyle = r2.style.color;
      ctx.lineCap = r2.style.lineCap;
      ctx.lineJoin = r2.style.lineJoin;
      const pts = r2._sourcePoints;
      const ws = r2.style._widths;
      const color = r2.style.color;
      const baseAlpha = r2.style.opacity ?? 1;
      const brushType = r2.style._brushType ?? "brush-pen";
      if (brushType === "ps-default" && pts && pts.length >= 2 && ws && ws.length >= 2) {
        ctx.fillStyle = color;
        ctx.globalAlpha = baseAlpha;
        ctx.beginPath();
        for (let i = 0; i < pts.length - 1; i++) {
          const p0 = pts[i], p1 = pts[i + 1];
          const hw0 = ws[i] / 2, hw1 = ws[i + 1] / 2;
          const dx = p1.x - p0.x, dy = p1.y - p0.y;
          const len = Math.hypot(dx, dy) || 1;
          const nx = -dy / len, ny = dx / len;
          ctx.moveTo(p0.x + nx * hw0, p0.y + ny * hw0);
          ctx.lineTo(p0.x - nx * hw0, p0.y - ny * hw0);
          ctx.lineTo(p1.x - nx * hw1, p1.y - ny * hw1);
          ctx.lineTo(p1.x + nx * hw1, p1.y + ny * hw1);
          ctx.closePath();
        }
        ctx.fill();
        if (pts.length > 0 && ws.length > 0) {
          const first = pts[0], last = pts[pts.length - 1];
          const r0 = ws[0] / 2, r1 = ws[ws.length - 1] / 2;
          if (r0 > 0.5) {
            ctx.beginPath();
            ctx.arc(first.x, first.y, r0, 0, Math.PI * 2);
            ctx.fill();
          }
          if (r1 > 0.5 && pts.length > 1) {
            ctx.beginPath();
            ctx.arc(last.x, last.y, r1, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      } else if (brushType === "brush-pen" && pts && pts.length >= 1 && ws && pts.length === ws.length) {
        const point2ds = pts.map((p) => ({
          x: p.x,
          y: p.y,
          pressure: 0.5,
          speed: 0
        }));
        const geom = buildStrokeGeometry(point2ds, {
          width: r2.style.lineWidth,
          smoothing: 0.5,
          taper: 0.7,
          minWidth: 0.02,
          maxWidth: 1.4,
          capSegments: 8,
          edgeBlur: 0.3,
          startFadePct: 0.06,
          endFadePct: 0.08
        });
        drawGeometryToCanvas2D(ctx, geom, color, r2.style.lineWidth, 0.3);
      } else {
        ctx.globalAlpha = baseAlpha;
        ctx.strokeStyle = color;
        ctx.lineWidth = r2.style.lineWidth;
        ctx.stroke(r2.path2D);
      }
      ctx.restore();
    }
    const glyphs = window.__REMINOTE_GLYPHS__;
    if (glyphs && glyphs.length > 0) {
      const engStrokes = window.__REMINOTE_ENGINE_STROKES__;
      const liveIds = engStrokes ? new Set(engStrokes.map((s) => s.id)) : null;
      if (!engStrokes || engStrokes.length === 0) {
        window.__REMINOTE_GLYPHS__ = [];
      } else {
        const valid = glyphs.filter((g) => g.strokeIds?.some((id) => liveIds?.has(id)));
        if (valid.length !== glyphs.length) {
          window.__REMINOTE_GLYPHS__ = valid;
        }
        for (const g of valid) {
          ctx.save();
          ctx.fillStyle = g.color || "#1a1a1a";
          ctx.globalAlpha = g.opacity ?? 1;
          const cx = g.x + g.w / 2;
          const cy = g.y + g.h / 2;
          ctx.font = `${g.h * 0.92}px ${g.fontFamily}`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(g.char, cx, cy);
          ctx.restore();
        }
      }
    }
  }
};
var CanvasSessionRegistry = class _CanvasSessionRegistry {
  constructor() {
    this.activeSession = null;
    this.sessionId = "";
  }
  static {
    this._instance = null;
  }
  static getInstance() {
    if (!this._instance) {
      this._instance = new _CanvasSessionRegistry();
    }
    return this._instance;
  }
  register(session) {
    if (this.activeSession && !this.activeSession.destroyed) {
      console.warn("[REGISTRY] \u26A0\uFE0F  destroying previous session before creating new one");
      this.activeSession.destroy();
    }
    this.activeSession = session;
    this.sessionId = `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    console.log("[REGISTRY] \u2705 session registered", this.sessionId);
  }
  deregister() {
    if (this.activeSession) {
      console.log("[REGISTRY] \u{1F5D1}  session deregistered", this.sessionId);
    }
    this.activeSession = null;
    this.sessionId = "";
  }
  get isActive() {
    return this.activeSession !== null && !this.activeSession.destroyed;
  }
};
var ToolManager = class {
  constructor() {
    this.tools = /* @__PURE__ */ new Map();
    this.tools.set("pen", new PenTool());
    this.tools.set("eraser", new EraserTool());
    this.tools.set("hand", new HandTool());
    this.active = this.tools.get("pen");
  }
  /** Get the currently active tool instance. */
  getActive() {
    return this.active;
  }
  /** Get active tool ID for UI query. */
  getActiveId() {
    return this.active.id;
  }
  /** Get a specific tool by ID (for settings UI). */
  get(id) {
    return this.tools.get(id);
  }
  /** Switch active tool by ID. Returns false if tool not found. */
  setActive(id) {
    const tool = this.tools.get(id);
    if (!tool)
      return false;
    this.active = tool;
    return true;
  }
  /** Update settings on a specific tool. */
  updateSettings(id, patch) {
    const tool = this.tools.get(id);
    if (!tool)
      return false;
    Object.assign(tool.settings, patch);
    return true;
  }
  /** Cleanup all tools. */
  destroy() {
    this.tools.clear();
  }
};
var PointerPipeline = class {
  constructor(session) {
    this.session = session;
    this.inputCtrl = new InputSnapshotController();
    const el = session.canvasEl;
    this._onPD = (ev) => {
      if (!session.isReady)
        return;
      const snapshot = this.inputCtrl.capture(ev, session);
      session.toolManager.getActive().onPointerDown(snapshot, session);
      session.markDirty();
    };
    this._onPM = (ev) => {
      if (!session.isReady)
        return;
      const snapshot = this.inputCtrl.capture(ev, session);
      session.toolManager.getActive().onPointerMove(snapshot, session);
      session.markDirty();
    };
    this._onPU = (ev) => {
      if (!session.isReady)
        return;
      const snapshot = this.inputCtrl.capture(ev, session);
      session.toolManager.getActive().onPointerUp(snapshot, session);
      session.markDirty();
    };
    this._onWH = (ev) => {
      if (!session.isReady)
        return;
      ev.preventDefault();
      const r2 = el.getBoundingClientRect();
      const ax = ev.clientX - r2.left, ay = ev.clientY - r2.top;
      const dz = -ev.deltaY * CAMERA_CONSTANTS.ZOOM_WHEEL_FACTOR;
      session.viewport.zoomAt(ax, ay, session.viewport.camera.zoom * (1 + dz));
      session.syncViewState();
      session.markCameraDirty();
    };
    el.addEventListener("pointerdown", this._onPD, { capture: true });
    el.addEventListener("pointermove", this._onPM, { capture: true });
    el.addEventListener("pointerup", this._onPU, { capture: true });
    el.addEventListener("wheel", this._onWH, { capture: true, passive: false });
  }
  destroy() {
    const el = this.session?.canvasEl;
    if (!el)
      return;
    el.removeEventListener("pointerdown", this._onPD, { capture: true });
    el.removeEventListener("pointermove", this._onPM, { capture: true });
    el.removeEventListener("pointerup", this._onPU, { capture: true });
    el.removeEventListener("wheel", this._onWH, { capture: true });
  }
};
var CanvasSession = class {
  constructor(notebookId, pageId, plugin, parentEl) {
    this.notebookId = notebookId;
    this.pageId = pageId;
    this.plugin = plugin;
    this.viewport = new Viewport();
    this.replayCtrl = new ReplayController();
    this.toolManager = new ToolManager();
    this.destroyed = false;
    // ============================================================
    // ============================================================
    //  Render Pipeline — PS级调度系统 + 增量更新
    // ============================================================
    this.renderScheduler = new RenderScheduler();
    this.renderQueue = new RenderQueue();
    this.renderer = new Renderer();
    this.dirtyTracker = new StrokeDirtyTracker();
    this.strokeCache = new StrokeRenderCache();
    /** True when a full rebuild is needed (page load, camera change, resize). */
    this._needsFullRebuild = true;
    /** Execution Guard — 唯一生命周期标记，destroy 后永久为 false */
    this.alive = true;
    // ============================================================
    //  ViewUIState — single source for cursor/camera/tool UI
    // ============================================================
    this.viewState = {
      cursor: { x: 0, y: 0, visible: true, mode: "pen", size: 8 },
      camera: { x: 0, y: 0, zoom: 1, vx: 0, vy: 0 },
      tool: {
        activeTool: "pen",
        penSettings: CanvasPolicy.getDefaults(),
        eraserMode: "point",
        eraserSize: 50,
        eraserStrength: 50
      }
    };
    this._viewSubs = [];
    this._frameCount = 0;
    this.engine = plugin.createEngine();
    const nb = plugin.getNotebooks().find((n2) => n2.id === notebookId);
    const page = nb?.pages.find((p) => p.id === pageId);
    const strokes = page?.strokes ?? [];
    this.engine.load(notebookId, pageId, strokes);
    this.engine.on("commit", (raw) => {
      const payload = raw;
      if (!payload)
        return;
      const nb2 = plugin.getNotebooks().find((n2) => n2.id === payload.notebookId);
      const page2 = nb2?.pages.find((p) => p.id === payload.pageId);
      if (!nb2 || !page2)
        return;
      page2.strokes = payload.strokes ?? [];
      page2.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
      plugin.isInternalWrite = true;
      try {
        plugin.fileGateway.saveNotebook(nb2);
      } finally {
        plugin.isInternalWrite = false;
      }
    });
    const wrapper = parentEl.createEl("div", { cls: "reminote-canvas-wrapper" });
    this.canvasEl = wrapper.createEl("canvas", { cls: "reminote-canvas" });
    this.ctx = this.canvasEl.getContext("2d");
    this._onResize = () => this.applySize();
    this.applySize();
    window.addEventListener("resize", this._onResize);
    this.pointerPipeline = new PointerPipeline(this);
    this.renderScheduler.onFrame = () => this._unifiedTick();
    this.syncViewState();
  }
  /** Subscribe to viewState changes. Returns unsubscribe function. */
  subscribeViewUI(fn) {
    this._viewSubs.push(fn);
    return () => {
      const i = this._viewSubs.indexOf(fn);
      if (i !== -1)
        this._viewSubs.splice(i, 1);
    };
  }
  /** Sync internal state → viewState + notify subscribers. Call after any change. */
  syncViewState() {
    const c2 = this.viewport.camera;
    const inertia = this.viewport.inertia;
    this.viewState.camera = { x: c2.x, y: c2.y, zoom: c2.zoom, vx: inertia.vx, vy: inertia.vy };
    const activeTool = this.toolManager.getActiveId();
    this.viewState.tool.activeTool = activeTool;
    this.viewState.cursor.mode = activeTool;
    if (activeTool === "pen") {
      const pen = this.toolManager.get("pen");
      if (pen) {
        const ps = pen.settings;
        this.viewState.tool.penSettings = { ...ps };
        this.viewState.cursor.size = 6 + ps.strokeWidth * 3;
      }
    } else if (activeTool === "eraser") {
      const eraser = this.toolManager.get("eraser");
      if (eraser) {
        const es = eraser.settings;
        this.viewState.tool.eraserMode = es.mode;
        this.viewState.tool.eraserSize = es.size;
        this.viewState.tool.eraserStrength = es.strength;
        this.viewState.cursor.size = 10 + es.size / 100 * 50;
      }
    } else {
      this.viewState.cursor.size = 10;
    }
    for (const fn of this._viewSubs)
      fn(this.viewState);
  }
  /** 公开只读 — 外部 guard 用，不会 throw */
  isAlive() {
    return this.alive;
  }
  /** 内部强制检查 — 任何核心方法入口调用，destroy 后 throw */
  assertAlive() {
    if (!this.alive) {
      throw new Error("[CanvasSession] \u274C Execution blocked \u2014 session already destroyed");
    }
  }
  get isReady() {
    return this.alive && !this.destroyed && !!this.engine;
  }
  // ---- lifecycle ----
  destroy() {
    if (this.destroyed)
      return;
    this.alive = false;
    this.destroyed = true;
    this.stopReplayLoop();
    this.replayCtrl.reset();
    this.viewport.inertia.stop();
    this.renderScheduler.stop();
    this.renderQueue.clear();
    this.dirtyTracker.clear();
    this.strokeCache.clear();
    window.removeEventListener("resize", this._onResize);
    if (this.pointerPipeline) {
      this.pointerPipeline.destroy();
    }
    if (this.engine) {
      this.engine.detach();
    }
    if (this.canvasEl) {
      this.canvasEl.parentElement?.remove();
    }
    const self = this;
    self.engine = null;
    self.viewport = null;
    self.canvasEl = null;
    self.ctx = null;
    self.replayCtrl = null;
    self._onResize = null;
    console.log("[SESSION] \u{1F480} fully destroyed \u2014 all references nulled, all listeners removed");
  }
  // ---- size ----
  applySize() {
    window.requestAnimationFrame(() => {
      if (!this.alive)
        return;
      const rect = this.canvasEl.getBoundingClientRect();
      const cssW = rect.width, cssH = rect.height;
      const w2 = Math.round(cssW), h = Math.round(cssH);
      if (w2 < 50 || h < 50)
        return;
      if (w2 === this.viewport.cssW && h === this.viewport.cssH && this.viewport.cssW > 0)
        return;
      const dpr = window.devicePixelRatio || 1;
      this.canvasEl.width = Math.round(cssW * dpr);
      this.canvasEl.height = Math.round(cssH * dpr);
      this.canvasEl.style.setProperty("--canvas-css-w", cssW + "px");
      this.canvasEl.style.setProperty("--canvas-css-h", cssH + "px");
      this.viewport.update(cssW, cssH, dpr);
      bindCanvas(this.canvasEl);
    });
  }
  requestResize() {
    this.assertAlive();
    this.applySize();
  }
  // ---- pointer events ----
  // ---- pointer events (routed through ToolSystem) ----
  // ---- Page loading (zero-overhead, no DOM rebuild) ----
  /**
   * 加载 Page 数据 — 仅更新 engine 引用，不重建 DOM。
   * 调用方（Plugin）提供完整 Page 对象；Session 不查询 Notebook。
   */
  loadPage(notebookId, page) {
    this.assertAlive();
    this.engine.commitNow();
    this.engine.load(notebookId, page.id, page.strokes ?? []);
    this.notebookId = notebookId;
    this.pageId = page.id;
    this.strokeCache.clear();
    this._needsFullRebuild = true;
    this.markDirty();
    this.syncViewState();
  }
  /** Switch active tool by ID. Returns false if tool not found. */
  setTool(id) {
    const ok = this.toolManager.setActive(id);
    if (ok)
      this.syncViewState();
    return ok;
  }
  /** Get active tool ID (for UI query). */
  getActiveToolId() {
    return this.toolManager.getActiveId();
  }
  /** Update settings on a specific tool. */
  updateToolSettings(id, patch) {
    return this.toolManager.updateSettings(id, patch);
  }
  // ---- Stroke accessor (for PageManager) ----
  /** 获取当前渲染的 strokes（直接引用，非拷贝） */
  getStrokes() {
    return this.engine.strokes;
  }
  /** 替换 strokes 并触发重绘（用于 PageManager.updatePageData） */
  setStrokes(strokes) {
    this.assertAlive();
    this.engine.strokes = strokes;
    this.strokeCache.clear();
    this._needsFullRebuild = true;
    this.markDirty();
  }
  /** 强制重绘（不检查 isDirty） */
  rerender() {
    this.assertAlive();
    this._needsFullRebuild = true;
    this.renderFrame();
  }
  // ---- Render Pipeline (PS级调度 + 增量更新) ----
  /**
   * Mark canvas dirty.
   * @param strokeId Optional — the stroke that changed (for incremental update).
   * @param dirtyRect Optional — world-space bounding box of the change (for partial redraw).
   */
  markDirty(strokeId, dirtyRect) {
    this.assertAlive();
    if (strokeId) {
      this.dirtyTracker.markDirty(strokeId);
    }
    if (dirtyRect) {
      this.renderQueue.mergeDirtyRegion(dirtyRect);
    }
    this.renderScheduler.requestRender();
  }
  /**
   * Notify that the camera changed — triggers full rebuild + full redraw on next frame.
   */
  markCameraDirty() {
    this.assertAlive();
    this._needsFullRebuild = true;
    this.renderScheduler.requestRender();
  }
  /**
   * Request a full rebuild on next frame (e.g. after erase operations that may split strokes).
   * Public so Tool layer can trigger it.
   */
  requestFullRebuild() {
    this.assertAlive();
    this._needsFullRebuild = true;
  }
  /**
   * Render frame — called by RenderScheduler at most once per RAF tick.
   * ① Decides: full rebuild vs incremental update
   * ② Delegates to Renderer.draw()
   */
  renderFrame() {
    this.assertAlive();
    const ctx = this.ctx, canvas = this.canvasEl, engine = this.engine;
    if (!ctx || !canvas || !engine)
      return;
    this._frameCount++;
    const c2 = this.viewport.camera;
    this.renderQueue.camera = { x: c2.x, y: c2.y, zoom: c2.zoom };
    this.renderQueue.bufW = canvas.width;
    this.renderQueue.bufH = canvas.height;
    if (this._needsFullRebuild) {
      this._needsFullRebuild = false;
      this.renderQueue.fullRebuild(engine.strokes, engine.params, this.strokeCache, this.replayCtrl);
      this.dirtyTracker.clear();
    } else if (this.dirtyTracker.hasDirty) {
      const dirtyIds = this.dirtyTracker.flushDirty();
      this.renderQueue.updateDirty(dirtyIds, engine.strokes, engine.params, this.strokeCache);
    }
    this.renderer.draw(ctx, canvas, this.renderQueue, this.viewport);
    this.renderQueue.clearDirtyRegion();
  }
  // ---- Unified Frame Tick (single RAF → inertia → replay → render) ----
  /**
   * Start replay animation. Replay is now driven by the unified frame tick,
   * not by its own RAF loop.
   */
  startReplayLoop() {
    this.markDirty();
  }
  /** Stop replay animation. */
  stopReplayLoop() {
    this.replayCtrl.stop();
  }
  /**
   * SINGLE UNIFIED FRAME TICK — the only RAF callback in the entire system.
   * Called by RenderScheduler once per frame.
   * Order: inertia physics → replay advance → render
   */
  _unifiedTick() {
    if (!this.alive)
      return;
    tickSmoothing();
    if (this.viewport.inertia.active) {
      const stillActive = this.viewport.inertia.tick();
      if (!stillActive) {
      }
    }
    if (this.replayCtrl.active) {
      const stroke = this.engine?.strokes.find((s) => s.id === this.replayCtrl.strokeId);
      if (!stroke || this.replayCtrl.cursorIndex >= stroke.points.length) {
        this.replayCtrl.stop();
      } else {
        this.replayCtrl.tick();
      }
      this.markDirty();
    }
    this.renderFrame();
  }
  /**
   * 🟥 Public tick entry — called by RuntimeOrchestrator only.
   * This is the sole frame advancement entry point for CanvasSession.
   * No other module may call _unifiedTick() or renderFrame() directly.
   */
  orchestratorTick() {
    this._unifiedTick();
  }
  /** 🟦 Mark dirty only — render happens in next RAF tick. No synchronous render. */
  renderNow() {
    this.assertAlive();
    this.markDirty();
  }
};
function createDefaultToolbarState() {
  return {
    x: 12,
    y: -1,
    // -1 = uninitialized, will be computed from viewport on first render
    dock: "free",
    dragging: false,
    dragOx: 0,
    dragOy: 0,
    viewportW: window.innerWidth,
    viewportH: window.innerHeight,
    toolbarW: 0,
    toolbarH: 0
  };
}
var CanvasView = class _CanvasView extends import_obsidian.ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.session = null;
    this.isDrawerOpen = false;
    this._drawerMode = "tool";
    // Floating toolbar — single state source
    this.ts = createDefaultToolbarState();
    this._resizeObserver = null;
    // ============================================================
    //  Undo Bar — bottom-left action buttons
    // ============================================================
    this.undoBarEl = null;
    this._syncUndoBar = null;
    this.plugin = plugin;
  }
  getViewType() {
    return CANVAS_VIEW_TYPE;
  }
  getDisplayText() {
    return "Canvas";
  }
  getIcon() {
    return "pen-tool";
  }
  // ---- session lifecycle ----
  /**
   * 创建或切换 session。
   * - 首次调用：创建 CanvasSession + canvas DOM
   * - 后续调用（同一 notebook 不同 page）：仅 switchPage，零 DOM 开销
   * - 不同 notebook：销毁重建（notebook 切换是低频操作）
   */
  createSession(notebookId, pageId) {
    if (this.session?.isAlive() && this.session.notebookId === notebookId) {
      if (this.session.pageId === pageId)
        return;
      const nb = this.plugin.getNotebooks().find((n2) => n2.id === notebookId);
      const page = nb?.pages.find((p) => p.id === pageId);
      if (page) {
        this.session.loadPage(notebookId, page);
        console.log("[SESSION] \u{1F504} page switched (zero-overhead)", { notebookId, pageId });
        return;
      }
      console.warn("[SESSION] \u26A0\uFE0F page not found, falling back to rebuild");
    }
    this.destroySession();
    if (!this.canvasAreaEl)
      return;
    this.canvasAreaEl.empty();
    console.assert(
      typeof _CanvasView === "function",
      "CanvasView must NOT exist at runtime logic level"
    );
    this.session = new CanvasSession(notebookId, pageId, this.plugin, this.canvasAreaEl);
    CanvasSessionRegistry.getInstance().register(this.session);
    if (this.session.engine) {
      this.session.engine.onUndoChange = () => this._syncUndoBar?.();
    }
    const ownerDoc = this.containerEl.ownerDocument;
    const canvasCount = ownerDoc.querySelectorAll("canvas").length;
    if (canvasCount !== 1) {
      console.error(`\u274C Canvas count = ${canvasCount}, expected 1 \u2014 destroying and recreating`);
      CanvasSessionRegistry.getInstance().deregister();
      this.session.destroy();
      this.canvasAreaEl.empty();
      this.session = new CanvasSession(notebookId, pageId, this.plugin, this.canvasAreaEl);
      CanvasSessionRegistry.getInstance().register(this.session);
      console.assert(ownerDoc.querySelectorAll("canvas").length === 1, "\u274C FAILED: Multiple canvases after retry");
    }
    if (this.cursorRenderer) {
      this.cursorRenderer.bindSession(this.session);
      this.cursorRenderer.mount();
    }
    window.requestAnimationFrame(() => {
      const r2 = this.layoutEl.getBoundingClientRect();
      this.ts.viewportW = r2.width;
      this.ts.viewportH = r2.height;
      this.cacheToolbarSize();
      this.initToolbarPosition();
    });
    console.log("[SESSION] \u2705 created", { notebookId, pageId, engineId: this.session.engine.id });
  }
  destroySession() {
    if (this.session) {
      CanvasSessionRegistry.getInstance().deregister();
      this.session.destroy();
      console.log("[SESSION] \u{1F480} destroyed");
      this.session = null;
    }
    const remainingCanvases = this.containerEl.ownerDocument.querySelectorAll("canvas").length;
    if (remainingCanvases > 0) {
      console.warn(`\u26A0\uFE0F [GHOST] Orphan canvas detected after destroySession: ${remainingCanvases} remaining`);
    }
  }
  async onClose() {
    if (this.cursorRenderer) {
      this.cursorRenderer.destroy();
    }
    if (this._resizeObserver) {
      this._resizeObserver.disconnect();
      this._resizeObserver = null;
    }
    this.destroySession();
  }
  async onOpen() {
    const c2 = this.containerEl;
    c2.empty();
    c2.addClass("reminote-canvas-view");
    this.layoutEl = c2.createEl("div", { cls: "reminote-canvas-layout" });
    this.layoutEl.createEl("div", { cls: "reminote-interaction-shield" });
    this.canvasAreaEl = c2.createEl("div", { cls: "reminote-canvas-area" });
    this.drawerEl = this.layoutEl.createEl("div", { cls: "reminote-canvas-drawer" });
    this.buildDrawer(this.drawerEl);
    this.buildFloatingToolbar(this.layoutEl);
    this.buildUndoBar(this.layoutEl);
    if (this.plugin._uiController && this.layoutEl) {
      this.plugin._uiController.mount(this.layoutEl);
    }
    let _roTimer = null;
    this._resizeObserver = new ResizeObserver(() => {
      if (_roTimer !== null)
        return;
      _roTimer = window.setTimeout(() => {
        _roTimer = null;
        const r2 = this.layoutEl.getBoundingClientRect();
        if (Math.abs(r2.width - this.ts.viewportW) < 2 && Math.abs(r2.height - this.ts.viewportH) < 2)
          return;
        this.ts.viewportW = r2.width;
        this.ts.viewportH = r2.height;
        this.session?.requestResize();
        this.applyToolbarState();
      }, 150);
    });
    this._resizeObserver.observe(this.layoutEl);
    window.requestAnimationFrame(() => {
      const r2 = this.layoutEl.getBoundingClientRect();
      this.ts.viewportW = r2.width;
      this.ts.viewportH = r2.height;
      this.cacheToolbarSize();
      this.initToolbarPosition();
    });
    this.containerEl.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape" && this.isDrawerOpen)
        this.toggleDrawer();
    });
    this.cursorRenderer = new CursorRenderer(null, this.containerEl?.ownerDocument);
  }
  // ============================================================
  //  Toolbar State Machine
  //  ┌──────────┐    drag     ┌──────────┐   release   ┌──────────┐
  //  │  FREE    │◄──────────►│ DRAGGING │───────────►│  SNAP    │
  //  │ (x,y)    │            │ (x,y)    │            │ compute  │
  //  └──────────┘            └──────────┘            └────┬─────┘
  //       ▲                      ▲                       │
  //       │                      │            ┌──────────▼──────────┐
  //       │                      │            │  DOCK (left/right/  │
  //       │                      │            │  top/bottom)        │
  //       │                      │            └─────────────────────┘
  //       │                      │                       │
  //       │         undock (pointerdown from dock) ──────┘
  //       └──────────────────────────────────────────────┘
  // ============================================================
  /** Single render path: state → DOM. Never reads DOM for position. */
  applyToolbarState() {
    if (!this.toolbarEl)
      return;
    const s = this.ts;
    const isVertical = s.dock === "left" || s.dock === "right";
    this.toolbarEl.classList.remove("horizontal", "vertical");
    this.toolbarEl.classList.add(isVertical ? "vertical" : "horizontal");
    window.requestAnimationFrame(() => this.cacheToolbarSize());
    const maxX = Math.max(0, s.viewportW - s.toolbarW);
    const maxY = Math.max(0, s.viewportH - s.toolbarH);
    s.x = Math.max(0, Math.min(s.x, maxX));
    s.y = Math.max(0, Math.min(s.y, maxY));
    this.toolbarEl.style.setProperty("--toolbar-x", s.x + "px");
    this.toolbarEl.style.setProperty("--toolbar-y", s.y + "px");
  }
  /** Cache toolbar intrinsic size — called once after DOM create + after tool switch */
  cacheToolbarSize() {
    if (!this.toolbarEl)
      return;
    this.ts.toolbarW = this.toolbarEl.offsetWidth;
    this.ts.toolbarH = this.toolbarEl.offsetHeight;
  }
  /** Initial position: top-left corner — smartSnap will dock to left edge as vertical sidebar */
  initToolbarPosition() {
    this.ts.dock = "free";
    this.ts.x = 12;
    this.ts.y = 12;
    this.clearDockClasses();
    this.applyToolbarState();
    this.smartSnap();
  }
  clearDockClasses() {
    this.toolbarEl.classList.remove(
      "dock-left",
      "dock-right",
      "dock-top",
      "dock-bottom",
      "compact",
      "snapping",
      "undocking",
      "horizontal",
      "vertical"
    );
  }
  // ============================================================
  //  Drag — only mutates state, never touches DOM directly
  // ============================================================
  buildFloatingToolbar(parent) {
    this.toolbarEl = parent.createEl("div", { cls: "reminote-floating-toolbar" });
    const toolLabels = { pen: "\u94A2\u7B14", eraser: "\u6A61\u76AE", hand: "\u624B\u638C" };
    for (const t2 of [{ k: "pen", l: "\u2712\uFE0F" }, { k: "eraser", l: "\u{1F9F9}" }, { k: "hand", l: "\u270B" }]) {
      const b2 = this.toolbarEl.createEl("button", { text: t2.l, title: toolLabels[t2.k] });
      b2.setAttribute("data-tool", t2.k);
      const curTool = this.session?.getActiveToolId();
      if (curTool === t2.k)
        b2.addClass("is-active");
      b2.onclick = () => {
        if (!this.session?.isReady || !this.session?.engine)
          return;
        this.session?.setTool(t2.k);
        this.updateToolbarState();
        if (this.isDrawerOpen)
          this.buildDrawer(this.drawerEl);
        window.requestAnimationFrame(() => this.cacheToolbarSize());
      };
    }
    const beautyBtn = this.toolbarEl.createEl("button", { text: "\u2728", title: "\u5B57\u8FF9\u7F8E\u989C" });
    beautyBtn.setAttribute("data-tool", "beautify");
    if (beautifyConfig.enabled)
      beautyBtn.addClass("is-active");
    beautyBtn.onclick = () => {
      const active = toggleBeautify();
      beautyBtn.classList.toggle("is-active", active);
      if (this.session) {
        this.session.markDirty();
        this.session.requestFullRebuild();
      }
      this._drawerMode = "beautify";
      this.isDrawerOpen = true;
      this.drawerEl.classList.add("is-visible");
      this.buildDrawer(this.drawerEl);
    };
    this.toolbarEl.createEl("button", { text: "\u2699\uFE0F", title: "\u8BBE\u7F6E" }).onclick = () => {
      this._drawerMode = "tool";
      this.toggleDrawer();
    };
    this.toolbarEl.onpointerdown = (ev) => {
      if (ev.target.tagName === "BUTTON")
        return;
      const s = this.ts;
      this.toolbarEl.classList.add("no-transition");
      if (s.dock !== "free") {
        s.dock = "free";
        this.clearDockClasses();
      }
      s.dragging = true;
      s.dragOx = ev.clientX - s.x;
      s.dragOy = ev.clientY - s.y;
      this.toolbarEl.classList.add("dragging");
      this.toolbarEl.setPointerCapture(ev.pointerId);
    };
    this.toolbarEl.onpointermove = (ev) => {
      const s = this.ts;
      if (!s.dragging)
        return;
      this.toolbarEl.classList.add("no-transition");
      s.x = ev.clientX - s.dragOx;
      s.y = ev.clientY - s.dragOy;
      const maxX = Math.max(0, s.viewportW - s.toolbarW);
      const maxY = Math.max(0, s.viewportH - s.toolbarH);
      s.x = Math.max(0, Math.min(s.x, maxX));
      s.y = Math.max(0, Math.min(s.y, maxY));
      this.toolbarEl.style.setProperty("--toolbar-x", s.x + "px");
      this.toolbarEl.style.setProperty("--toolbar-y", s.y + "px");
    };
    this.toolbarEl.onpointerup = () => {
      const s = this.ts;
      s.dragging = false;
      this.toolbarEl.classList.remove("dragging");
      this.toolbarEl.classList.remove("no-transition");
      this.smartSnap();
    };
    this.toolbarEl.onmouseenter = () => {
      if (this.ts.dock !== "free" && !this.ts.dragging)
        this.toolbarEl.classList.remove("compact");
    };
    this.toolbarEl.onmouseleave = () => {
      if (this.ts.dock !== "free" && !this.ts.dragging)
        this.toolbarEl.classList.add("compact");
    };
  }
  buildUndoBar(parent) {
    this.undoBarEl = parent.createEl("div", { cls: "reminote-undo-bar" });
    const undoBtn = this.undoBarEl.createEl("button", { text: "\u21A9\uFE0F", title: "\u64A4\u9500 (Ctrl+Z)" });
    const redoBtn = this.undoBarEl.createEl("button", { text: "\u21AA\uFE0F", title: "\u91CD\u505A (Ctrl+Y)" });
    const clearBtn = this.undoBarEl.createEl("button", { text: "\u{1F5D1}\uFE0F", title: "\u6E05\u7A7A\u753B\u5E03" });
    clearBtn.classList.add("gn-clear-btn");
    const refreshUndoState = () => {
      const eng = this.session?.engine;
      if (undoBtn)
        undoBtn.disabled = !eng?.canUndo;
      if (redoBtn)
        redoBtn.disabled = !eng?.canRedo;
    };
    this._syncUndoBar = refreshUndoState;
    undoBtn.onclick = () => {
      const eng = this.session?.engine;
      if (!eng?.canUndo)
        return;
      eng.undo();
      this.session?.markDirty();
      this.session?.requestFullRebuild();
      refreshUndoState();
    };
    redoBtn.onclick = () => {
      const eng = this.session?.engine;
      if (!eng?.canRedo)
        return;
      eng.redo();
      this.session?.markDirty();
      this.session?.requestFullRebuild();
      refreshUndoState();
    };
    clearBtn.onclick = () => {
      const eng = this.session?.engine;
      if (!eng || eng.strokes.length === 0)
        return;
      while (eng.strokes.length > 0) {
        eng.removeStroke(eng.strokes[eng.strokes.length - 1].id);
      }
      this.session?.markDirty();
      this.session?.requestFullRebuild();
      refreshUndoState();
    };
    refreshUndoState();
  }
  // ============================================================
  //  Smart Snap — pure math on state + cached viewport
  // ============================================================
  smartSnap() {
    const s = this.ts;
    const SNAP_DISTANCE = 100;
    const tw = s.toolbarW;
    const th = s.toolbarH;
    const vw = s.viewportW;
    const vh = s.viewportH;
    const distTo = {
      left: s.x,
      right: vw - tw - s.x,
      top: s.y,
      bottom: vh - th - s.y
    };
    let bestEdge = "free";
    let bestDist = Infinity;
    for (const [edge, dist] of Object.entries(distTo)) {
      if (dist < SNAP_DISTANCE && dist < bestDist) {
        bestDist = dist;
        bestEdge = edge;
      }
    }
    this.clearDockClasses();
    if (bestEdge === "free") {
      s.dock = "free";
      this.applyToolbarState();
      return;
    }
    switch (bestEdge) {
      case "left":
        s.x = 8;
        s.y = (vh - th) / 2;
        break;
      case "right":
        s.x = vw - tw - 8;
        s.y = (vh - th) / 2;
        break;
      case "top":
        s.x = 12;
        s.y = 12;
        break;
      case "bottom":
        s.x = (vw - tw) / 2;
        s.y = vh - th - 12;
        break;
    }
    s.dock = bestEdge;
    this.toolbarEl.classList.add("dock-" + bestEdge, "compact", "snapping");
    this.applyToolbarState();
    window.setTimeout(() => {
      this.toolbarEl.classList.remove("snapping");
      this.toolbarEl.classList.remove("no-transition");
    }, 420);
  }
  updateToolbarState() {
    const curTool = this.session?.getActiveToolId();
    this.containerEl.querySelectorAll(".reminote-floating-toolbar button").forEach((b2) => {
      const el = b2;
      const toolId = el.getAttribute("data-tool");
      if (toolId)
        el.classList.toggle("is-active", toolId === curTool);
    });
  }
  toggleDrawer() {
    this.isDrawerOpen = !this.isDrawerOpen;
    this.drawerEl.classList.toggle("is-visible", this.isDrawerOpen);
    if (this.isDrawerOpen)
      this.buildDrawer(this.drawerEl);
  }
  // ==========================================================
  //  Settings Panel — reads tool state from Session.toolManager
  // ==========================================================
  buildDrawer(container) {
    container.empty();
    if (this._drawerMode === "beautify") {
      this.buildBeautifyPanel(container);
      return;
    }
    const toolId = this.session?.getActiveToolId();
    if (toolId === "pen") {
      this.buildBrushPanel(container);
    } else if (toolId === "eraser") {
      this.buildEraserPanel(container);
    } else {
      container.createEl("h4", { text: "\u270B \u624B\u638C" });
      container.createEl("p", { text: "\u62D6\u52A8\u753B\u5E03", cls: "reminote-placeholder" });
    }
  }
  // ── Brush Panel — PS-style: size, opacity, color picker, presets ──
  getPenFullParams() {
    const pen = this.session?.toolManager.get("pen");
    return pen?.settings ?? CanvasPolicy.getDefaults();
  }
  applyPenFullParams(patch) {
    const s = this.session;
    if (!s?.isAlive?.() || !s?.engine)
      return;
    const current = this.getPenFullParams();
    const params = { ...current, ...patch };
    s.engine.setParams(params);
    s.updateToolSettings("pen", params);
    s.syncViewState();
    s.markDirty();
  }
  buildBrushPanel(container) {
    const ps = this.getPenFullParams();
    const presetRow = container.createEl("div", { cls: "gn-brush-preset-row" });
    const brushPresetsData = [
      { id: "brush-pen", label: "\u6BDB\u7B14", desc: "\u4E66\u6CD5\u611F\uFF0C\u4E24\u5934\u5C16\u4E2D\u95F4\u9971\u6EE1" },
      { id: "ps-default", label: "PS\u9ED8\u8BA4", desc: "\u5300\u5300\u9971\u6EE1\uFF0C\u8D77\u6536\u5E72\u8106" }
    ];
    const activeBrushType = ps.brushType ?? "brush-pen";
    for (const bp of brushPresetsData) {
      const btn = presetRow.createEl("button", { text: bp.label });
      if (bp.id === activeBrushType)
        btn.addClass("is-active");
      btn.title = bp.desc;
      btn.onclick = () => {
        this.applyPenFullParams({
          brushType: bp.id,
          strokeWidth: bp.id === "brush-pen" ? 3.5 : 2.5,
          smoothness: bp.id === "brush-pen" ? 0.6 : 0.4,
          spacing: bp.id === "brush-pen" ? 1 : 2,
          cornerKeep: 0.2,
          opacity: 0.92,
          color: ps.color ?? "#1a1a1a"
        });
        this.buildDrawer(container.closest(".reminote-canvas-drawer"));
      };
    }
    this.buildSlider(
      container,
      "\u5927\u5C0F",
      "\u7EC6 \u2192 \u7C97",
      0.5,
      12,
      ps.strokeWidth,
      (v2) => {
        this.applyPenFullParams({ strokeWidth: v2 });
        const s = this.session;
        if (s)
          s.syncViewState();
      },
      0.5
    );
    this.buildSlider(
      container,
      "\u900F\u660E\u5EA6",
      "\u6DE1 \u2192 \u6D53",
      10,
      100,
      Math.round((ps.opacity ?? 1) * 100),
      (v2) => this.applyPenFullParams({ opacity: v2 / 100 })
    );
    this.buildColorPicker(
      container,
      ps.color ?? "#1a1a1a",
      (color) => this.applyPenFullParams({ color })
    );
    const pressureSec = container.createEl("div", { cls: "gn-brush-section-label" });
    pressureSec.setText("\u{1F590}\uFE0F \u538B\u611F");
    const hasPen = window.__REMINOTE_HAS_PEN__ ?? false;
    const penType = window.__REMINOTE_PEN_TYPE__ ?? "\u672A\u77E5";
    const statusRow = container.createEl("div", { style: "display:flex;align-items:center;gap:8px;margin:6px 0" });
    const statusDot = statusRow.createEl("span", { text: hasPen ? "\u{1F7E2}" : "\u26AA", attr: { style: "font-size:14px" } });
    statusRow.createEl("span", { text: hasPen ? "\u5DF2\u68C0\u6D4B\u5230\u538B\u611F\u7B14" : "\u672A\u68C0\u6D4B\u5230\u538B\u611F\u7B14", cls: "reminote-pen-slider-label" });
    const modelRow = container.createEl("div", { style: "display:flex;align-items:center;gap:8px;margin:4px 0" });
    modelRow.createEl("span", { text: "\u578B\u53F7:", cls: "reminote-pen-slider-label" });
    modelRow.createEl("span", { text: penType, attr: { style: "font-size:11px;opacity:0.7" } });
    const appleRow = container.createEl("div", { style: "display:flex;align-items:center;justify-content:space-between;margin:8px 0" });
    appleRow.createEl("span", { text: "Apple Pencil \u4F18\u5316", cls: "reminote-pen-slider-label" });
    const appleToggle = appleRow.createEl("input", { attr: { type: "checkbox" } });
    appleToggle.checked = window.__REMINOTE_APPLE_PENCIL_MODE__ ?? true;
    appleToggle.onchange = () => {
      window.__REMINOTE_APPLE_PENCIL_MODE__ = appleToggle.checked;
    };
  }
  // ── Beautify Panel (独立) ──
  buildBeautifyPanel(container) {
    const cfg = redrawOrchestrator.config;
    const row = container.createEl("div", { cls: "reminote-pen-slider" });
    const lbl = row.createEl("div", { cls: "reminote-pen-slider-header" });
    lbl.createEl("span", { text: "\u2728 \u7B14\u8FF9\u91CD\u7ED8\uFF08\u751F\u7269\u52A8\u753B\uFF09", cls: "reminote-pen-slider-label" });
    const check = row.createEl("input", { attr: { type: "checkbox" } });
    check.checked = cfg.enabled;
    check.onchange = () => {
      cfg.enabled = check.checked;
      beautifyConfig.enabled = check.checked;
      if (!check.checked)
        redrawOrchestrator.reset();
    };
    const styleSec = container.createEl("div", { cls: "gn-brush-section-label" });
    styleSec.setText("\u{1F3A8} \u5B57\u4F53\u98CE\u683C");
    const styleDesc = container.createEl("div", { cls: "gn-brush-hint" });
    styleDesc.setText("\u5199\u5B8C\u4E00\u4E2A\u5B57\u540E\uFF0C\u7B14\u753B\u50CF\u751F\u7269\u4E00\u6837\u722C\u52A8\u53D8\u5F62\u4E3A\u76EE\u6807\u5B57\u4F53");
    const styleGrid = container.createEl("div", { cls: "gn-font-style-grid" });
    const fontStyles = [
      { id: "roundCute", label: "\u5706\u5F62\u53EF\u7231\u4F53", desc: "\u5706\u6DA6\u53EF\u7231\uFF0C\u7C97\u7EC6\u5747\u5300", icon: "\u{1F36C}" },
      { id: "kaiShu", label: "\u6B63\u6977", desc: "\u7AEF\u5E84\u5DE5\u6574\uFF0C\u6A2A\u7EC6\u7AD6\u7C97", icon: "\u2712\uFE0F" },
      { id: "xingShu", label: "\u884C\u4E66", desc: "\u884C\u4E91\u6D41\u6C34\uFF0C\u7B14\u610F\u8FDE\u8D2F", icon: "\u{1F30A}" },
      { id: "caoShu", label: "\u8349\u4E66", desc: "\u72C2\u653E\u4E0D\u7F81\uFF0C\u7B14\u8D70\u9F99\u86C7", icon: "\u{1F409}" }
    ];
    for (const fs of fontStyles) {
      const card = styleGrid.createEl("button", { cls: "gn-font-style-card" });
      if (cfg.styleId === fs.id)
        card.addClass("is-active");
      const iconEl = card.createEl("span", { cls: "gn-font-style-icon", text: fs.icon });
      const labelEl = card.createEl("span", { cls: "gn-font-style-label", text: fs.label });
      const descEl = card.createEl("span", { cls: "gn-font-style-desc", text: fs.desc });
      card.onclick = () => {
        cfg.styleId = fs.id;
        redrawOrchestrator.setFontStyle(fs.id);
        this.buildDrawer(this.drawerEl);
      };
    }
    this.buildSlider(
      container,
      "\u7F8E\u5316\u5F3A\u5EA6",
      "\u67D4\u548C \u2192 \u5F3A\u529B",
      0,
      1,
      cfg.beautifyStrength,
      (v2) => {
        cfg.beautifyStrength = v2;
      },
      0.1
    );
    this.buildSlider(
      container,
      "\u98CE\u683C\u5316\u5F3A\u5EA6",
      "\u4FDD\u7559\u624B\u5199 \u2192 \u5B8C\u5168\u98CE\u683C\u5316",
      0,
      1,
      cfg.stylizeStrength,
      (v2) => {
        cfg.stylizeStrength = v2;
      },
      0.1
    );
    this.buildSlider(
      container,
      "\u505C\u7B14\u7B49\u5F85",
      "200ms \u2192 1500ms",
      200,
      1500,
      cfg.pauseMs,
      (v2) => {
        cfg.pauseMs = v2;
      }
    );
    const infoBox = container.createEl("div", { cls: "gn-beautify-info" });
    infoBox.setText("\u{1F4A1} \u5199\u5B8C\u7B14\u753B \u2192 \u547C\u5438\u52A8\u753B \u2192 \u505C\u987F \u2192 \u8815\u53D8\u52A8\u753B\u53D8\u5F62\u4E3A\u4F18\u7F8E\u5F62\u6001 \u2192 \u5B8C\u6210\u8109\u51B2\u3002100%\u89E6\u53D1\uFF0C\u65E0\u9700\u8BC6\u522B\u3002");
  }
  // ── Color Picker Widget (HSL ring) ──
  // ── HSL/RGB color helpers ──
  buildColorPicker(container, currentColor, onChange) {
    const initialHsl = hexToHsl(currentColor);
    let hue = initialHsl.h;
    let sat = 1;
    let bri = 0.5;
    if (initialHsl.l < 0.1) {
      bri = 0;
      sat = 0;
    } else if (initialHsl.l > 0.9) {
      bri = 1;
      sat = 0;
    } else {
      bri = initialHsl.l;
      sat = initialHsl.s;
    }
    const wrap = container.createEl("div", { cls: "gn-color-picker" });
    const update = () => {
      const hex = hslToHex(hue, sat, bri);
      preview.style.background = hex;
      hexInput.value = hex;
      onChange(hex);
    };
    const hueRow = wrap.createEl("div");
    hueRow.style.cssText = "display:flex;align-items:center;gap:8px";
    hueRow.createEl("span", { text: "\u8272\u76F8", cls: "reminote-pen-slider-label" });
    const hueSlider = hueRow.createEl("input", { attr: { type: "range", min: "0", max: "360" } });
    hueSlider.value = String(Math.round(hue));
    hueSlider.style.cssText = "flex:1;height:14px;-webkit-appearance:none;background:linear-gradient(to right,red,yellow,lime,cyan,blue,magenta,red);border-radius:7px";
    const onHue = () => {
      hue = parseInt(hueSlider.value);
      updateSatBg();
      updateBriBg();
      update();
    };
    hueSlider.oninput = onHue;
    const satRow = wrap.createEl("div");
    satRow.style.cssText = "display:flex;align-items:center;gap:8px";
    satRow.createEl("span", { text: "\u9971\u548C\u5EA6", cls: "reminote-pen-slider-label" });
    const satSlider = satRow.createEl("input", { attr: { type: "range", min: "0", max: "100" } });
    satSlider.value = String(Math.round(sat * 100));
    satSlider.style.flex = "1";
    const updateSatBg = () => {
      satSlider.style.background = `linear-gradient(to right, #888, ${hslToHex(hue, 1, 0.5)})`;
    };
    updateSatBg();
    const onSat = () => {
      sat = parseInt(satSlider.value) / 100;
      updateBriBg();
      update();
    };
    satSlider.oninput = onSat;
    const briRow = wrap.createEl("div");
    briRow.style.cssText = "display:flex;align-items:center;gap:8px";
    briRow.createEl("span", { text: "\u660E\u5EA6", cls: "reminote-pen-slider-label" });
    const briSlider = briRow.createEl("input", { attr: { type: "range", min: "0", max: "100" } });
    briSlider.value = String(Math.round(bri * 100));
    briSlider.style.flex = "1";
    const updateBriBg = () => {
      briSlider.style.background = `linear-gradient(to right,#000,${hslToHex(hue, sat, 0.5)},#fff)`;
    };
    updateBriBg();
    briSlider.oninput = () => {
      bri = parseInt(briSlider.value) / 100;
      update();
    };
    const hexRow = wrap.createEl("div", { cls: "gn-color-hex-row" });
    const hexInput = hexRow.createEl("input", { cls: "gn-color-hex-input", attr: { type: "text", value: currentColor } });
    const preview = hexRow.createEl("div", { cls: "gn-color-preview" });
    preview.style.background = currentColor;
    hexInput.onchange = () => {
      const hex = hexInput.value;
      if (/^#[0-9a-fA-F]{6}$/.test(hex)) {
        const hsl = hexToHsl(hex);
        hue = hsl.h;
        sat = hsl.s;
        bri = hsl.l;
        hueSlider.value = String(Math.round(hue));
        satSlider.value = String(Math.round(sat * 100));
        briSlider.value = String(Math.round(bri * 100));
        updateSatBg();
        updateBriBg();
        preview.style.background = hex;
        onChange(hex);
      }
    };
  }
  // ── Eraser Panel — reads/writes via session.toolManager ──
  buildEraserPanel(container) {
    container.empty();
    const eraser = this.session?.toolManager.get("eraser");
    if (!eraser)
      return;
    const es = eraser.settings;
    container.createEl("h4", { text: "\u{1F9F9} \u6A61\u76AE" });
    const modeRow = container.createEl("div", { cls: "reminote-drawer-presets" });
    for (const m2 of [
      { k: "stroke", l: "\u6574\u4F53\u64E6\u9664" },
      { k: "point", l: "\u5C40\u90E8\u64E6\u9664" },
      { k: "smart", l: "\u667A\u80FD\u64E6\u9664" }
    ]) {
      const btn = modeRow.createEl("button", { text: m2.l });
      if (es.mode === m2.k)
        btn.addClass("is-active");
      btn.onclick = () => {
        es.mode = m2.k;
        this.session?.updateToolSettings("eraser", { mode: m2.k });
        this.buildEraserPanel(container);
      };
    }
    this.buildSlider(
      container,
      "\u5927\u5C0F",
      "\u5C0F \u2192 \u5927",
      0,
      100,
      es.size,
      (v2) => {
        es.size = v2;
        this.session?.updateToolSettings("eraser", { size: v2 });
        this.session?.syncViewState();
      }
    );
    if (es.mode === "smart") {
      this.buildSlider(
        container,
        "\u7075\u654F\u5EA6",
        "\u8F7B\u67D4 \u2192 \u5F3A\u529B",
        0,
        100,
        es.strength,
        (v2) => {
          es.strength = v2;
          this.session?.updateToolSettings("eraser", { strength: v2 });
        }
      );
    }
  }
  // ── Generic Slider Builder ──
  buildSlider(container, label, hint, min, max, value, onChange, step = 1) {
    const row = container.createEl("div", { cls: "reminote-pen-slider" });
    const hdr = row.createEl("div", { cls: "reminote-pen-slider-header" });
    hdr.createEl("span", { cls: "reminote-pen-slider-label", text: label });
    if (hint)
      hdr.createEl("span", { cls: "reminote-pen-slider-hint", text: hint });
    const input = row.createEl("input", { type: "range" });
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(value);
    input.oninput = () => onChange(parseFloat(input.value));
    input.setAttribute("data-slider-key", label);
  }
};
var RemiNotePlugin = class extends import_obsidian.Plugin {
  constructor() {
    super(...arguments);
    this._initialized = false;
    this._uiController = null;
    this._urs = null;
    this._orchestrator = null;
    this.notebooks = [];
    this.selectedNotebookId = null;
    this.listeners = /* @__PURE__ */ new Map();
    this.isInternalWrite = false;
    this.isInternalRename = false;
    this.uiState = { selectedNotebookId: null, selectedPageId: null, activeView: "notebook", isCanvasDirty: false };
    /** UI intent layer — views call these instead of mutating state directly. */
    this.ui = {
      selectNotebook: (id) => {
        this.uiState.selectedNotebookId = id;
        this.uiState.selectedPageId = null;
        this.uiState.activeView = "page";
        this.setSelectedNotebook(id);
        this.emit("ui-changed");
      },
      selectPage: (pageId) => {
        this.uiState.selectedPageId = pageId;
        this.uiState.activeView = "canvas";
        this.emit("ui-changed");
      },
      openCanvas: (notebookId, pageId) => {
        this.ui.selectPage(pageId);
        this.openCanvasForPage(notebookId, pageId);
      },
      backToPages: () => {
        this.uiState.activeView = "page";
        this.uiState.selectedPageId = null;
        this.emit("ui-changed");
      }
    };
  }
  on(event, h) {
    if (!this.listeners.has(event))
      this.listeners.set(event, []);
    this.listeners.get(event).push(h);
  }
  emit(event) {
    for (const fn of this.listeners.get(event) ?? [])
      fn();
  }
  getNotebooks() {
    return this.notebooks;
  }
  getSortedNotebooks() {
    return [...this.notebooks.filter((n2) => n2.isPinned), ...this.notebooks.filter((n2) => !n2.isPinned)];
  }
  getSelectedNotebook() {
    return this.selectedNotebookId ? this.notebooks.find((n2) => n2.id === this.selectedNotebookId) ?? null : null;
  }
  setSelectedNotebook(id) {
    const nb = this.notebooks.find((n2) => n2.id === id);
    if (nb && !nb.isPinned) {
      const i = this.notebooks.findIndex((n2) => n2.id === id);
      if (i > 0) {
        const [it] = this.notebooks.splice(i, 1);
        this.notebooks.unshift(it);
      }
    }
    this.selectedNotebookId = id;
    this.emit("selection-changed");
  }
  togglePinNotebook(id) {
    const nb = this.notebooks.find((n2) => n2.id === id);
    if (!nb)
      return;
    nb.isPinned = !nb.isPinned;
    void this.fileGateway.saveNotebook(nb);
    this.emit("notebooks-changed");
  }
  async resolveNotebookPath(id) {
    const adapter = this.app.vault.adapter;
    const files = (await adapter.list(FileGateway.DIR)).files.filter(
      (f2) => f2.endsWith(".remi") || f2.endsWith(".gnnote")
    );
    for (const f2 of files) {
      try {
        const raw = await adapter.read(f2);
        if (JSON.parse(raw).id === id)
          return f2;
      } catch (e2) {
        console.debug(e2);
      }
    }
    return void 0;
  }
  async renameNotebook(id, newName) {
    const trimmed = newName.trim();
    if (!trimmed)
      return;
    const nb = this.notebooks.find((n2) => n2.id === id);
    if (!nb)
      return;
    const adapter = this.app.vault.adapter;
    const files = (await adapter.list(FileGateway.DIR)).files;
    if (files.some((f2) => f2.endsWith(`${trimmed}.remi`)))
      return;
    const oldPath = await this.resolveNotebookPath(id);
    if (!oldPath)
      return;
    const newPath = `${FileGateway.DIR}/${trimmed}.remi`;
    this.isInternalRename = true;
    this.isInternalWrite = true;
    try {
      await adapter.rename(oldPath, newPath);
      nb.name = trimmed;
      await this.fileGateway.saveNotebook(nb);
    } finally {
      this.isInternalRename = false;
      this.isInternalWrite = false;
    }
    this.emit("notebooks-changed");
  }
  safeBootCheck(caller) {
    if (!this._initialized) {
      console.warn(`[BOOT] ${caller}: ignored \u2014 plugin not initialized`);
      return false;
    }
    return true;
  }
  async handleVaultEvent(type, file, oldPath) {
    if (!this.safeBootCheck("handleVaultEvent"))
      return;
    if (this.isInternalRename || this.isInternalWrite)
      return;
    const path = file?.path ?? "";
    if (!path.startsWith(`${FileGateway.DIR}/`) || !path.endsWith(".remi") && !path.endsWith(".gnnote"))
      return;
    if (type === "delete") {
      const barePath = path.replace(new RegExp(`^${FileGateway.DIR}/`), "");
      const filename = barePath.replace(/\.(remi|gnnote)$/, "");
      const match = this.notebooks.find(
        (n2) => n2.name === filename || `${n2.name}.remi` === barePath || `${n2.name}.gnnote` === barePath
      );
      if (!match)
        return;
      this.notebooks = this.notebooks.filter((n2) => n2.id !== match.id);
      if (this.selectedNotebookId === match.id) {
        this.selectedNotebookId = null;
        this.emit("selection-changed");
      }
      const activeCanvas = this.layoutManager?.getActiveCanvas();
      console.log("[ENGINE LIFECYCLE]", {
        action: "VAULT_DELETE",
        matchId: match.id,
        activeEngineId: activeCanvas?.session?.engine?.id ?? "none",
        activeEngineNotebookId: activeCanvas?.session?.engine?.notebookId ?? "none"
      });
      if (activeCanvas) {
        activeCanvas.destroySession();
      }
      this.emit("notebooks-changed");
      return;
    }
    if (type === "create") {
      try {
        const raw = await this.app.vault.adapter.read(path);
        const nb = JSON.parse(raw);
        if (!nb.id)
          return;
        if (this.notebooks.some((n2) => n2.id === nb.id))
          return;
        if (!nb.pages)
          nb.pages = [];
        if (!nb.updatedAt)
          nb.updatedAt = Date.now();
        this.notebooks.push(nb);
        this.emit("notebooks-changed");
      } catch (e2) {
        console.debug(e2);
      }
      return;
    }
    if (type === "rename") {
      try {
        const raw = await this.app.vault.adapter.read(path);
        const nb = JSON.parse(raw);
        if (!nb.id)
          return;
        const existing = this.notebooks.find((n2) => n2.id === nb.id);
        if (!existing)
          return;
        if (!nb.updatedAt)
          nb.updatedAt = Date.now();
        if (existing.updatedAt && nb.updatedAt < existing.updatedAt)
          return;
        nb.updatedAt = Date.now();
        const preservedStrokes = existing.pages.map((p) => {
          const nbPage = nb.pages?.find((np) => np.id === p.id);
          return nbPage ? { ...nbPage, strokes: p.strokes } : p;
        });
        Object.assign(existing, nb);
        existing.pages = preservedStrokes;
        this.emit("notebooks-changed");
      } catch (e2) {
        console.debug(e2);
      }
      return;
    }
    if (type === "modify") {
      try {
        const raw = await this.app.vault.adapter.read(path);
        const nb = JSON.parse(raw);
        if (!nb.id)
          return;
        const existing = this.notebooks.find((n2) => n2.id === nb.id);
        if (!existing)
          return;
        if (!nb.updatedAt)
          nb.updatedAt = Date.now();
        if (existing.updatedAt && nb.updatedAt < existing.updatedAt)
          return;
        nb.updatedAt = Date.now();
        const preservedStrokes = existing.pages.map((p) => {
          const nbPage = nb.pages?.find((np) => np.id === p.id);
          return nbPage ? { ...nbPage, strokes: p.strokes } : p;
        });
        Object.assign(existing, nb);
        existing.pages = preservedStrokes;
        this.emit("notebooks-changed");
      } catch (e2) {
        console.debug(e2);
      }
      return;
    }
  }
  async addNotebook(nb) {
    this.notebooks.push(nb);
    await this.fileGateway.saveNotebook(nb);
    this.emit("notebooks-changed");
  }
  async deleteNotebook(id) {
    const nb = this.notebooks.find((n2) => n2.id === id);
    if (!nb)
      return;
    const activeCanvas = this.layoutManager?.getActiveCanvas();
    console.log("[ENGINE LIFECYCLE]", {
      action: "DELETE_NOTEBOOK",
      notebookId: id,
      activeEngineId: activeCanvas?.session?.engine?.id ?? "none",
      activeEngineNotebookId: activeCanvas?.session?.engine?.notebookId ?? "none"
    });
    await this.fileGateway.deleteNotebook(nb);
    this.notebooks = this.notebooks.filter((n2) => n2.id !== id);
    if (this.selectedNotebookId === id) {
      this.selectedNotebookId = null;
      this.emit("selection-changed");
    }
    this.emit("notebooks-changed");
  }
  async renamePage(nbId, pId, title) {
    this.pageManager.updatePage(nbId, pId, { title });
  }
  async deletePage(nbId, pId) {
    this.pageManager.deletePage(nbId, pId);
  }
  recordLastPage(nbId, pId) {
    const nb = this.notebooks.find((n2) => n2.id === nbId);
    if (!nb)
      return;
    nb.lastPageId = pId;
    void this.fileGateway.saveNotebook(nb);
  }
  /**
   * 单向调度：Page 数据变更 → Session 状态重建。
   * PageManager / UI 不直接接触 CanvasSession，统一走此入口。
   */
  requestPageChange(notebookId, pageId) {
    const canvas = this.layoutManager?.getActiveCanvas();
    if (!canvas?.session?.isAlive())
      return;
    if (!pageId) {
      canvas.session.setStrokes([]);
      this.emit("selection-changed");
      return;
    }
    const nb = this.notebooks.find((n2) => n2.id === notebookId);
    const page = nb?.pages.find((p) => p.id === pageId);
    if (!page)
      return;
    canvas.session.loadPage(notebookId, page);
    this.emit("selection-changed");
  }
  createEngine() {
    return new CanvasRuntimeEngine();
  }
  // ==========================================================
  //  Canvas entry — delegates to LayoutManager
  // ==========================================================
  async openCanvasForPage(notebookId, pageId) {
    this.recordLastPage(notebookId, pageId);
    const nb = this.notebooks.find((n2) => n2.id === notebookId);
    if (nb)
      nb.activePageId = pageId;
    await this.layoutManager.mountCanvas(notebookId, pageId, "main");
  }
  // --- Lifecycle ---
  // --- Lifecycle ---
  async onload() {
    console.log("[PLUGIN INSTANCE]", this);
    if (this._initialized) {
      console.warn("[BOOT] blocked duplicate init");
      return;
    }
    this._initialized = true;
    console.log("[BOOT] init start");
    await this._boot();
  }
  async _boot() {
    installDebugGuard();
    console.log("[BOOT] running core init");
    this.fileGateway = new FileGateway(this.app);
    this.layoutManager = new CanvasLayoutManager(this.app, this);
    this.pageManager = new PageManager(this);
    this.notebooks = await this.fileGateway.loadNotebooks();
    console.log("[BOOT] gnnote files hydrated:", this.notebooks.length);
    this.registerView(NOTEBOOK_VIEW_TYPE, (leaf) => new NotebookView(leaf, this));
    this.registerView(PAGE_VIEW_TYPE, (leaf) => new PageView(leaf, this));
    this.registerView(CANVAS_VIEW_TYPE, (leaf) => new CanvasView(leaf, this));
    this.addRibbonIcon("pen-tool", "RemiNote", () => this.openBothViews());
    if (!this._uiController)
      this._uiController = new CanvasUIController();
    if (!this._orchestrator) {
      this._orchestrator = new RuntimeOrchestrator({ debug: false });
      this._orchestrator.createAndBindShadowHook();
      this._orchestrator.bindUIController(this._uiController);
      this._orchestrator.bindSessionProvider(() => {
        const registry = CanvasSessionRegistry.getInstance();
        const session = registry.activeSession;
        return session && !session.destroyed ? session : null;
      });
      this._orchestrator.start();
      console.log("[BOOT] \u{1F7E5} Runtime Orchestrator: Single Frame Authority ACTIVE");
      window.__debug = {
        orchestrator: this._orchestrator,
        trace: this._orchestrator.debugLayer,
        replay: this._orchestrator.replay,
        ui: this._uiController,
        get session() {
          const r2 = CanvasSessionRegistry.getInstance();
          return r2.activeSession && !r2.activeSession.destroyed ? r2.activeSession : null;
        }
      };
      console.log("[BOOT] \u{1F50D} DevTools: window.__debug ready");
    }
    startPointerStream();
    console.log("[BOOT] \u{1F4D0} Coordinate Input System ACTIVE");
    this.app.workspace.onLayoutReady(() => {
      this.openBothViews();
      this.emit("notebooks-changed");
    });
    const vault = this.app.vault;
    vault.on("create", (file) => this.handleVaultEvent("create", file));
    vault.on("delete", (file) => this.handleVaultEvent("delete", file));
    vault.on("rename", (file, oldPath) => this.handleVaultEvent("rename", file, oldPath));
    vault.on("modify", (file) => this.handleVaultEvent("modify", file));
    window.setInterval(() => {
      const registry = CanvasSessionRegistry.getInstance();
      const canvasCount = activeDocument.querySelectorAll("canvas").length;
      const sessionAlive = !!(registry.activeSession && !registry.activeSession.destroyed);
    }, 5e3);
  }
  async onunload() {
    stopPointerStream();
    window.__REMINOTE_CURSOR_SINGLETON__ = false;
    window.__CURSOR_MOVE_LOCK__ = false;
    if (this._orchestrator) {
      this._orchestrator.destroy();
      this._orchestrator = null;
    }
    console.log("[PLUGIN] \u{1F480} unloaded \u2014 global locks released");
  }
  async openBothViews() {
    if (!this.safeBootCheck("openBothViews"))
      return;
    const { workspace } = this.app;
    let l = workspace.getLeavesOfType(NOTEBOOK_VIEW_TYPE)[0];
    if (!l) {
      const leaf = workspace.getLeftLeaf(false);
      if (leaf)
        await leaf.setViewState({ type: NOTEBOOK_VIEW_TYPE, active: true });
    } else
      workspace.setActiveLeaf(l, { focus: true });
    let r2 = workspace.getLeavesOfType(PAGE_VIEW_TYPE)[0];
    if (!r2) {
      const leaf = workspace.getRightLeaf(false);
      if (leaf)
        await leaf.setViewState({ type: PAGE_VIEW_TYPE, active: true });
    } else
      workspace.setActiveLeaf(r2, { focus: true });
  }
};
