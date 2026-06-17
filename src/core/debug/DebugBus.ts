// ============================================================
//  DebugBus / Debug HUD — minimal, zero-overhead
//  Usage: DebugBus.enable() in console to show HUD
// ============================================================

import { dualInput } from '../input/CoordinateInputSystem';

class DebugBus {
  private static buffer: Array<{ t: number; tag: string; data: unknown }> = [];
  private static _enabled = false;
  private static _hud: HTMLElement | null = null;
  private static _timer: ReturnType<typeof setInterval> | null = null;

  static enable(v = true): void {
    this._enabled = v;
    if (v) {
      this._ensureHUD();
      if (!this._timer) this._timer = setInterval(() => this._flush(), 200);
    } else {
      if (this._timer) { clearInterval(this._timer); this._timer = null; }
      if (this._hud) { this._hud.remove(); this._hud = null; }
    }
  }

  static log(tag: string, data: unknown): void {
    if (!this._enabled) return;
    this.buffer.push({ t: performance.now(), tag, data });
  }

  private static _ensureHUD(): void {
    if (this._hud) return;
    const el = document.createElement('div');
    el.id = 'debug-hud';
    Object.assign(el.style, {
      position: 'fixed',
      left: '12px',
      bottom: '12px',
      zIndex: '2147483647',
      padding: '8px 10px',
      fontSize: '12px',
      fontFamily: 'monospace',
      background: 'rgba(0,0,0,0.6)',
      color: '#0f0',
      borderRadius: '6px',
      pointerEvents: 'none',
    });
    document.body.appendChild(el);
    this._hud = el;
  }

  private static _flush(): void {
    // Update HUD with live pointer + cursor state
    if (this._hud) {
      const cursorEl = document.querySelector('.reminote-cursor-overlay');
      this._hud.textContent =
        `raw: (${dualInput.rawX.toFixed(0)}, ${dualInput.rawY.toFixed(0)})\n` +
        `smoothed: (${dualInput.smoothedX.toFixed(0)}, ${dualInput.smoothedY.toFixed(0)})\n` +
        `down: ${dualInput.isDown ? 'YES' : 'no'}\n` +
        `cursor: ${cursorEl ? 'alive' : 'missing'}`;
    }

    // Drain buffer (keep last 20)
    while (this.buffer.length > 20) this.buffer.shift();
  }
}

export default DebugBus;
