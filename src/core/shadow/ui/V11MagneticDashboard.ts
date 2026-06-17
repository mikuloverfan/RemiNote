// ============================================================
//  V11 Magnetic Dashboard �� UCRP v1 (Hard Singleton + Safe Mount)
// ============================================================

interface V11DashboardInput {
  integrity: number; pixelStability: number; gpuFidelity: number; systemHealth: number;
  mode: string; policyDecision: string;
  rootCause?: { type: string; confidence: number; strokes: Array<{ id: string; score: number }> };
  frameHistory: Array<'green' | 'yellow' | 'red'>;
}

type V11Dashboard = InstanceType<typeof V11MagneticDashboard>;

function hc(v: number): string { if(v>=0.9)return'#2ecc71';if(v>=0.6)return'#f1c40f';if(v>=0.3)return'#e67e22';return'#e74c3c'; }
function bc(v: number): string { if(v>=0.8)return'#2ecc71';if(v>=0.5)return'#f1c40f';return'#e74c3c'; }
function dc(c: 'green'|'yellow'|'red'): string { return c==='green'?'#2ecc71':c==='yellow'?'#f1c40f':'#e74c3c'; }

function injectStyles(): void {
  const old = document.getElementById('v11-mag-style'); if (old) old.remove();
  const s = document.createElement('style'); s.id = 'v11-mag-style';
  s.textContent = '.v11-mb{position:absolute;top:10px;left:10px;width:14px;height:14px;border-radius:50%;z-index:99999;cursor:pointer;border:none;outline:none;padding:0;background:transparent;color:var(--v11-c, #2ecc71);font-size:14px;line-height:14px;text-align:center;transition:box-shadow .3s;will-change:transform;pointer-events:auto;}.v11-mb::after{content:"";display:block;width:100%;height:100%;border-radius:50%;background:var(--v11-c);position:absolute;top:0;left:0;}.v11-mb span{position:relative;z-index:1;}.v11-pn{position:absolute;top:36px;left:10px;width:280px;max-height:calc(100vh - 56px);overflow-y:auto;z-index:99998;border-radius:14px;padding:16px;font-family:-apple-system,sans-serif;font-size:12px;color:#e0e0e0;line-height:1.5;background:rgba(20,20,24,.88);backdrop-filter:blur(12px);border:1px solid rgba(255,255,255,.06);box-shadow:0 8px 32px rgba(0,0,0,.4);opacity:0;transform:scale(.92);transform-origin:top left;transition:opacity .28s cubic-bezier(.2,.9,.2,1),transform .28s cubic-bezier(.2,.9,.2,1);pointer-events:none;}.v11-pn.open{opacity:1;transform:scale(1);pointer-events:auto;}.v11-pn .hdr{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;}.v11-pn .tt{font-size:14px;font-weight:600;}.v11-pn .bd{font-size:10px;padding:2px 8px;border-radius:8px;}.v11-pn .br{margin:6px 0;}.v11-pn .lbl{display:flex;justify-content:space-between;margin-bottom:2px;font-size:11px;opacity:.8;}.v11-pn .bar{height:4px;border-radius:2px;background:rgba(255,255,255,.08);overflow:hidden;}.v11-pn .fill{height:100%;border-radius:2px;transition:width .4s ease;}.v11-pn .sec{margin-top:12px;padding-top:10px;border-top:1px solid rgba(255,255,255,.06);}.v11-pn .st{font-size:10px;text-transform:uppercase;letter-spacing:.06em;opacity:.5;margin-bottom:6px;}.v11-pn .ri{display:flex;justify-content:space-between;padding:3px 0;font-size:11px;}.v11-pn .tl{display:flex;gap:4px;flex-wrap:wrap;}.v11-pn .dot{width:8px;height:8px;border-radius:50%;}.v11-pn .pr{display:flex;justify-content:space-between;padding:3px 0;font-size:11px;}';
  document.head.appendChild(s);
}

function buildPanelHTML(d: V11DashboardInput): string {
  const c = hc(d.systemHealth);
  const rc = d.rootCause ? `<div class="sec"><div class="st">Root Cause</div><div class="ri"><span>${d.rootCause.type}</span><span>${(d.rootCause.confidence*100).toFixed(0)}%</span></div>${d.rootCause.strokes.slice(0,3).map(s=>`<div class="ri"><span style="opacity:.7">${s.id}</span><span>${s.score.toFixed(2)}</span></div>`).join('')}</div>` : '';
  return `<div class="hdr"><span class="tt">System Trust</span><span class="bd" style="background:${c}22;color:${c}">${(d.systemHealth*100).toFixed(0)}%</span></div><div class="br"><div class="lbl"><span>Integrity</span><span>${d.integrity.toFixed(2)}</span></div><div class="bar"><div class="fill" style="width:${d.integrity*100}%;background:${bc(d.integrity)}"></div></div></div><div class="br"><div class="lbl"><span>Pixel</span><span>${d.pixelStability.toFixed(2)}</span></div><div class="bar"><div class="fill" style="width:${d.pixelStability*100}%;background:${bc(d.pixelStability)}"></div></div></div><div class="br"><div class="lbl"><span>GPU</span><span>${d.gpuFidelity.toFixed(2)}</span></div><div class="bar"><div class="fill" style="width:${d.gpuFidelity*100}%;background:${bc(d.gpuFidelity)}"></div></div></div>${rc}<div class="sec"><div class="st">Policy</div><div class="pr"><span>Decision</span><span style="font-weight:500">${d.policyDecision}</span></div><div class="pr"><span>Mode</span><span style="font-weight:500">${d.mode}</span></div></div><div class="sec"><div class="st">Timeline</div><div class="tl">${d.frameHistory.map(x=>`<div class="dot" style="background:${dc(x)}"></div>`).join('')}</div></div>`;
}

export class V11MagneticDashboard {
  private _btn: HTMLButtonElement | null = null;
  private _pnl: HTMLDivElement | null = null;
  private _open = false;
  private _mounted = false;
  private _container: HTMLElement | null = null;
  // ?? No independent RAF �� animation driven by RuntimeOrchestrator via tickAnimation()

  // Magnetic spring state
  private _sx = 1; private _tx = 0; private _ty = 0;

  // Bound handlers (for cleanup)
  private _onClick: (() => void) | null = null;
  private _onMouse: ((e: MouseEvent) => void) | null = null;

  private _color = '#2ecc71';
  _lastData: V11DashboardInput | null = null;

  constructor() {
    injectStyles();
    // --- Hard Singleton ---
    const prev = (window as any).__REMINOTE_DASHBOARD__ as V11Dashboard | undefined;
    if (prev) { prev.destroy(); }
    (window as any).__REMINOTE_DASHBOARD__ = this;
  }

  // ==========================================================
  //  mount (safe, repeatable)
  // ==========================================================

  mount(container?: HTMLElement): void {
    // Destroy previous DOM if exists
    if (this._mounted) this._unmountDOM();

    this._container = this._resolveContainer(container);
    if (!this._container) return;

    // Create fresh DOM
    this._btn = document.createElement('button');
    this._btn.className = 'v11-mb';
    // Pure ::after circle �?no text content to avoid font-level color override
    this._btn.style.setProperty('--v11-c', this._color);

    this._pnl = document.createElement('div');
    this._pnl.className = 'v11-pn';

    // Bind events (fresh, instance-scoped)
    this._onClick = () => { this._open = !this._open; this._pnl!.classList.toggle('open', this._open); };
    this._btn.addEventListener('click', this._onClick);

    this._onMouse = (e: MouseEvent) => {
      if (!this._btn) return;
      const r = this._btn.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const dist = Math.hypot(e.clientX - cx, e.clientY - cy);
      if (dist < 80) { this._sx = 1 + 0.6 * (1 - dist / 80); const pull = (1 - dist / 80) * 6; this._tx = (e.clientX - cx) * pull * 0.15; this._ty = (e.clientY - cy) * pull * 0.15; }
    };
    document.addEventListener('mousemove', this._onMouse);

    // ?? No independent RAF �� spring animation driven by RuntimeOrchestrator via tickAnimation()

    // Append
    this._container.appendChild(this._btn);
    this._container.appendChild(this._pnl);
    this._mounted = true;
  }

  /**
   * ?? Spring animation tick �� called by RuntimeOrchestrator each frame.
   * Pure visual effect. No logic, no state mutation beyond CSS transform.
   */
  tickAnimation(): void {
    if (!this._mounted || !this._btn) return;
    this._sx += (1 - this._sx) * 0.12;
    this._tx *= 0.88;
    this._ty *= 0.88;
    this._btn.style.transform = `translate(${this._tx.toFixed(1)}px,${this._ty.toFixed(1)}px) scale(${this._sx.toFixed(3)})`;
  }

  /** ?? Idempotent mount guard �� true if dashboard DOM is attached. */
  get mounted(): boolean { return this._mounted; }

  // ==========================================================
  //  destroy (complete cleanup)
  // ==========================================================

  destroy(): void {
    this._unmountDOM();
    // ?? No independent RAF to cancel �� animation driven by RuntimeOrchestrator
    if ((window as any).__REMINOTE_DASHBOARD__ === this) {
      delete (window as any).__REMINOTE_DASHBOARD__;
    }
  }

  unmount(): void { this.destroy(); }

  // ==========================================================
  //  update
  // ==========================================================

  update(data: V11DashboardInput): void {
    this._lastData = data;
    this._color = hc(data.systemHealth);
    if (this._btn) this._btn.style.setProperty('--v11-c', this._color);
    if (this._pnl) this._pnl.innerHTML = buildPanelHTML(data);
  }

  // ==========================================================
  //  Private
  // ==========================================================

  private _resolveContainer(container?: HTMLElement): HTMLElement | null {
    if (container && container.isConnected) return container;
    // Fallback: find canvas root in DOM
    const canvas = document.querySelector('.reminote-canvas-layout') as HTMLElement;
    if (canvas && canvas.isConnected) return canvas;
    if (document.body && document.body.isConnected) return document.body;
    return null;
  }

  private _unmountDOM(): void {
    if (this._btn) {
      if (this._onClick) this._btn.removeEventListener('click', this._onClick);
      this._btn.remove();
      this._btn = null;
    }
    if (this._pnl) { this._pnl.remove(); this._pnl = null; }
    if (this._onMouse) { document.removeEventListener('mousemove', this._onMouse); this._onMouse = null; }
    this._onClick = null;
    this._open = false;
    this._mounted = false;
  }
}

export default V11MagneticDashboard;
