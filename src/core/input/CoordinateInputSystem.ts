// ============================================================
//  Dual-Channel Input System
//
//  🟢 CHANNEL 1 — RAW (cursor 用): 零延迟，每 pointer 事件直接更新
//  🟡 CHANNEL 2 — SMOOTHED (stroke 用): 每 RAF 帧 EMA 平滑一次
//
//  Architecture:
//    pointermove → rawX/rawY (immediate)
//    RAF tick   → smoothed += (raw - smoothed) * SMOOTH_FACTOR
//
//  Rules:
//  🟥 rawX/rawY 永远不被平滑 — cursor 绝对实时
//  🟥 smoothedX/Y 只在 RAF 循环中更新 — stroke 高质量
//  🟥 isDown 直接映射 pointerdown/pointerup — 零逻辑延迟
// ============================================================

export interface DualInputState {
  /** Raw screen-space X (clientX) — cursor channel, zero latency */
  rawX: number;
  /** Raw screen-space Y (clientY) — cursor channel, zero latency */
  rawY: number;
  /** EMA-smoothed X — stroke channel, high quality */
  smoothedX: number;
  /** EMA-smoothed Y — stroke channel, high quality */
  smoothedY: number;
  /** Pointer pressed state */
  isDown: boolean;
  /** Last event timestamp (performance.now) */
  timestamp: number;
  /** 🟢 Display gate — true when pointer is inside the canvas bounding rect */
  isInsideCanvas: boolean;
}

// ============================================================
//  Smoothing constant — lower = smoother but more lag
//  0.35 = reminote-grade balance between quality and latency
// ============================================================

const SMOOTH_FACTOR = 0.35;

// ============================================================
//  Singleton input state
// ============================================================

export const dualInput: DualInputState = {
  rawX: 0,
  rawY: 0,
  smoothedX: 0,
  smoothedY: 0,
  isDown: false,
  timestamp: 0,
  isInsideCanvas: false,
};

// ============================================================
//  Backward-compat: PointerState (used by DebugBus)
//  Mirrors smoothed coords — what the stroke engine sees.
// ============================================================

export interface PointerState {
  x: number;
  y: number;
  isDown: boolean;
  timestamp: number;
}

export const pointerState: PointerState = {
  x: 0, y: 0, isDown: false, timestamp: 0,
};

// ============================================================
//  Canvas reference (for isInCanvas geometry check)
// ============================================================

let _canvasEl: HTMLElement | null = null;

export function bindCanvas(el: HTMLElement): void {
  _canvasEl = el;
}

/** 🟥 Pure geometry — canvas.getBoundingClientRect() every call. No cache. */
export function isInCanvas(x: number, y: number): boolean {
  if (!_canvasEl) return false;
  const rect = _canvasEl.getBoundingClientRect();
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

// ============================================================
//  Pointer Stream — single update entry (RAW channel only)
// ============================================================

let _streamStarted = false;

export function startPointerStream(): void {
  if (_streamStarted) return;
  _streamStarted = true;
  document.addEventListener('pointermove', _onPointerMove, { capture: true });
  document.addEventListener('pointerdown', _onPointerDown, { capture: true });
  document.addEventListener('pointerup', _onPointerUp, { capture: true });
}

export function stopPointerStream(): void {
  _streamStarted = false;
  document.removeEventListener('pointermove', _onPointerMove, { capture: true });
  document.removeEventListener('pointerdown', _onPointerDown, { capture: true });
  document.removeEventListener('pointerup', _onPointerUp, { capture: true });
}

function _detectStylus(e: PointerEvent): void {
  if (e.pointerType === 'pen') {
    (window as any).__REMINOTE_HAS_PEN__ = true;
    // Detect Apple Pencil vs generic stylus
    if (e.pressure > 0 && e.pointerType === 'pen') {
      // Apple Pencil reports tiltX/tiltY; generic pens may not
      const hasTilt = e.tiltX !== 0 || e.tiltY !== 0;
      const isApple = /Mac|iPad|iPhone/.test(navigator.userAgent) && e.pointerType === 'pen' && e.pressure > 0;
      (window as any).__REMINOTE_PEN_TYPE__ = isApple ? 'Apple Pencil' : (hasTilt ? '触控笔 (带倾斜)' : '触控笔');
    }
  }
}

function _onPointerMove(e: PointerEvent): void { _detectStylus(e); _updateRaw(e.clientX, e.clientY, e.buttons > 0); renderCursor(); }
function _onPointerDown(e: PointerEvent): void { _detectStylus(e); _updateRaw(e.clientX, e.clientY, true); renderCursor(); }
function _onPointerUp(e: PointerEvent): void { _updateRaw(e.clientX, e.clientY, false); renderCursor(); }

/** 🟢 RAW channel update — immediate, zero processing. */
function _updateRaw(x: number, y: number, isDown: boolean): void {
  dualInput.rawX = x;
  dualInput.rawY = y;
  dualInput.isDown = isDown;
  dualInput.timestamp = performance.now();
  dualInput.isInsideCanvas = isInCanvas(x, y);
}

// ============================================================
//  🟡 SMOOTHED channel — call once per RAF tick
//  Moves smoothed coords toward raw coords by SMOOTH_FACTOR.
//  Also snaps smoothed to raw on pointerdown (no lag on stroke start).
// ============================================================

let _lastIsDown = false;

export function tickSmoothing(): void {
  // Snap on transition: down edge → instant sync to avoid stroke-start lag
  if (dualInput.isDown && !_lastIsDown) {
    dualInput.smoothedX = dualInput.rawX;
    dualInput.smoothedY = dualInput.rawY;
  } else {
    dualInput.smoothedX += (dualInput.rawX - dualInput.smoothedX) * SMOOTH_FACTOR;
    dualInput.smoothedY += (dualInput.rawY - dualInput.smoothedY) * SMOOTH_FACTOR;
  }
  _lastIsDown = dualInput.isDown;

  // Sync backward-compat pointerState
  pointerState.x = dualInput.smoothedX;
  pointerState.y = dualInput.smoothedY;
  pointerState.isDown = dualInput.isDown;
  pointerState.timestamp = dualInput.timestamp;
}

// ============================================================
//  🟢 Cursor render — DOM overlay at raw coords, zero latency
// ============================================================

/** Bound document for cursor queries — set by CursorRenderer.mount(). */
let _cursorDoc: Document = document;

export function bindCursorDocument(doc: Document): void {
  _cursorDoc = doc;
}

/** Shared camera reference — used for screen→world→screen alignment with stroke. */
interface CameraRef { x: number; y: number; zoom: number; }
let _viewportCamera: CameraRef | null = null;

export function bindViewportCamera(camera: CameraRef | null): void {
  _viewportCamera = camera;
}

export function renderCursor(): void {
  const el = _cursorDoc.querySelector('.reminote-cursor-overlay') as HTMLElement | null;
  if (!el) return;

  // 🟢 Display gate: only show cursor inside canvas boundary
  if (!dualInput.isInsideCanvas) {
    el.style.display = 'none';
    return;
  }
  el.style.display = '';

  // 🔗 Shared projection: same screen→world→screen pipeline as stroke.
  // This guarantees cursor and stroke occupy identical screen position
  // regardless of camera zoom/pan or canvas placement.
  let sx = dualInput.rawX;
  let sy = dualInput.rawY;
  if (_viewportCamera && _canvasEl) {
    const rect = _canvasEl.getBoundingClientRect();
    const c = _viewportCamera;
    const wx = (sx - rect.left - c.x) / c.zoom;
    const wy = (sy - rect.top - c.y) / c.zoom;
    sx = wx * c.zoom + c.x + rect.left;
    sy = wy * c.zoom + c.y + rect.top;
  }

  // 🟢 Center the cursor ring on the pointer: translate(-50%,-50%) offsets
  // by half the element's border-box so the circle center = pointer position.
  el.style.transform = `translate3d(${sx}px, ${sy}px, 0) translate(-50%, -50%)`;
}

// ============================================================
//  Staleness watchdog: if pointermove is swallowed, release stuck stroke
// ============================================================

setInterval(() => {
  if (performance.now() - dualInput.timestamp > 2000) {
    dualInput.isDown = false;
    _lastIsDown = false;
  }
}, 500);
