// ============================================================
//  URS v3 — Stability Discriminator (classify before repair)
// ============================================================

type FailureType = 'TRANSIENT' | 'STRUCTURAL' | 'UNKNOWN';
type V3State = 'STABLE' | 'WAITING' | 'REPAIR_PENDING' | 'REPAIRING' | 'SAFE_MODE';

export class UIRuntimeStabilizer {
  // Config
  private _tickMs = 1000;
  private _cooldownMs = 2000;
  private _structMissThreshold = 3;
  private _transientWindowMs = 3000;
  private _structuralWindowMs = 10000;

  // State
  private _state: V3State = 'STABLE';
  private _structMissCount = 0;
  private _transientMissCount = 0;
  private _lastRepairTime = 0;
  private _repairing = false;

  // History buffer
  private _history: Array<{ ts: number; alive: boolean; container: string | null }> = [];
  private _lastContainer: string | null = null;

  // Confidence
  private _stableChecks = 0;
  private _totalChecks = 0;

  // Timer + dashboard
  private _timer: ReturnType<typeof setInterval> | null = null;
  private _dashboard: any = null;

  // ==========================================================
  //  Lifecycle
  // ==========================================================

  start(dashboard: any): void {
    if (this._timer) return;
    this._dashboard = dashboard;
    this._timer = setInterval(() => this._tick(), this._tickMs);
  }

  stop(): void { if (this._timer) { clearInterval(this._timer); this._timer = null; } }

  // ==========================================================
  //  Tick pipeline: observe → classify → decide → act
  // ==========================================================

  private _tick(): void {
    try {
      const alive = this._checkAlive();
      const container = this._getContainerId();
      const now = Date.now();

      // Push history (keep 30 entries)
      this._history.push({ ts: now, alive, container });
      if (this._history.length > 30) this._history.shift();

      // Track container changes
      if (container) this._lastContainer = container;

      // Confidence
      this._totalChecks++;
      if (alive) this._stableChecks++;
      const confidence = this._stableChecks / this._totalChecks;

      if (alive) {
        this._structMissCount = 0;
        this._transientMissCount = 0;
        if (this._state === 'SAFE_MODE' && confidence > 0.7) {
          this._state = 'STABLE';
        }
        return;
      }

      // ── Classify failure ──
      const failure = this._classify(now);

      if (failure === 'TRANSIENT') {
        this._transientMissCount++;
        return; // IGNORE
      }

      if (failure === 'STRUCTURAL') {
        this._structMissCount++;
        this._transientMissCount = 0;
      }

      // ── State transitions ──
      if (this._state === 'STABLE' && this._structMissCount > 0) {
        this._state = 'WAITING';
      }
      if (this._state === 'WAITING' && this._structMissCount >= this._structMissThreshold) {
        this._state = 'REPAIR_PENDING';
      }
      if (this._state === 'REPAIR_PENDING') {
        this._repair();
      }

      if (this._structMissCount >= 6) {
        this._state = 'SAFE_MODE';
        this._repairSafe();
      }
    } catch { /* silent */ }
  }

  // ==========================================================
  //  Failure Classification
  // ==========================================================

  private _classify(now: number): FailureType {
    // Check: was container recently seen?
    const recent = this._history.filter(h => h.ts > now - this._transientWindowMs);
    const everHadContainer = recent.some(h => h.container !== null);
    const recentlyAlive = recent.some(h => h.alive);

    // TRANSIENT: container existed recently, or UI was recently alive
    if (everHadContainer || recentlyAlive) return 'TRANSIENT';

    // STRUCTURAL: no container for extended period
    const structural = this._history.filter(h => h.ts > now - this._structuralWindowMs);
    const everStructural = structural.some(h => h.container !== null);
    if (!everStructural) return 'STRUCTURAL';

    return 'UNKNOWN'; // conservative → treat as transient
  }

  // ==========================================================
  //  Repair
  // ==========================================================

  private _repair(): void {
    if (Date.now() - this._lastRepairTime < this._cooldownMs) return;
    if (this._repairing) return;
    this._repairing = true;
    this._state = 'REPAIRING';

    try {
      this._dashboard?.destroy();
      const c = this._resolveContainer();
      if (c) {
        this._dashboard?.mount(c);
        this._lastRepairTime = Date.now();
        this._structMissCount = 0;
        this._state = 'STABLE';
      } else {
        this._state = 'SAFE_MODE';
      }
    } catch {
      this._state = 'SAFE_MODE';
    } finally {
      this._repairing = false;
    }
  }

  private _repairSafe(): void {
    if (Date.now() - this._lastRepairTime < 5000) return;
    if (this._repairing) return;
    this._repairing = true;
    try { this._dashboard?.destroy(); this._dashboard?.mount(document.body); this._lastRepairTime = Date.now(); } catch { /* */ }
    finally { this._repairing = false; }
  }

  // ==========================================================
  //  Helpers
  // ==========================================================

  private _checkAlive(): boolean {
    const btn = document.querySelector('.v11-mb');
    const pnl = document.querySelector('.v11-pn');
    return !!(btn && pnl && document.contains(btn) && document.contains(pnl));
  }

  private _getContainerId(): string | null {
    const c = document.querySelector('.reminote-canvas-layout');
    return c ? 'canvas' : null;
  }

  private _resolveContainer(): HTMLElement | null {
    return (
      document.querySelector('.workspace-leaf.mod-active .reminote-canvas-layout') as HTMLElement
      || document.querySelector('.reminote-canvas-layout') as HTMLElement
      || null
    );
  }

  // Debug
  get state(): V3State { return this._state; }
  get confidence(): number { return this._totalChecks > 0 ? this._stableChecks / this._totalChecks : 0; }
}

export default UIRuntimeStabilizer;
