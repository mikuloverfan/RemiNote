// ============================================================
//  Runtime Orchestrator — Frame Contract Verifier
//
//  Upgraded from "executor" to "verifier":
//  Every tick() produces a FrameResult (the contract).
//  No DOM access, no recovery, no UI mount — only verification.
//
//  Flow:
//    INPUT (DOM events → engine.strokes)
//      ↓
//    tick() → compute hashes → evaluate contract → FrameResult
//      ↓
//    FrameReplaySystem.record(result)
//    CanvasUIController.renderFromFrame(result)  ← UI reacts, not controls
// ============================================================

import { ShadowSessionHook, createSVSHook } from '../shadow/ShadowSessionHook';
import { CanvasUIController } from './CanvasUIController';
import {
  FrameDebugLayer,
  runStep,
  captureDOM,
} from './FrameDebugLayer';
import type { FrameTrace, FrameError, StepResult } from './FrameDebugLayer';
import {
  FrameReplaySystem,
  computeStateHash,
  computeRenderHash,
  computePixelHash,
  computeUIHash,
  evaluateStability,
} from './FrameContract';
import type { FrameResult } from './FrameContract';

// ============================================================
//  Types
// ============================================================

export interface OrchestratorConfig {
  observerEnabled?: boolean;
  stabilityEnabled?: boolean;
  traceEnabled?: boolean;
  traceMaxFrames?: number;
  traceVerbose?: boolean;
  debug?: boolean;
}

export interface RawMetrics {
  pixelDiff: number;
  gpuDiff: number;
  shadowDiff: number;
}

export type GateDecision = 'ALLOW' | 'BLOCK';

export interface FrameReport {
  frameId: number;
  strokeCount: number;
  metrics: RawMetrics | null;
  decision: GateDecision;
  timestamp: number;
}

export interface OrchestratedSession {
  isAlive(): boolean;
  orchestratorTick(): void;
  engine: {
    strokes: ReadonlyArray<{
      id: string;
      points?: readonly { x: number; y: number }[];
      color?: string;
      width?: number;
      _penParams?: { spacing?: number; smoothness?: number; strokeWidth?: number; cornerKeep?: number };
    }>;
    params: { spacing: number; smoothness: number; strokeWidth: number; cornerKeep: number };
  };
  inputSnapshot: {
    previewStroke: {
      id: string; points?: readonly { x: number; y: number }[];
      color?: string; width?: number;
      _penParams?: { spacing?: number; smoothness?: number; strokeWidth?: number; cornerKeep?: number };
    } | null;
  };
  viewport: { camera: { x: number; y: number; zoom: number } };
  renderQueue?: { renderables: ReadonlyArray<{ id: string } | null> };
}

// ============================================================
//  RuntimeOrchestrator (Verifier)
// ============================================================

export class RuntimeOrchestrator {
  private config: Required<Omit<OrchestratorConfig, 'traceMaxFrames' | 'traceVerbose'>> & { traceMaxFrames: number; traceVerbose: boolean };

  private shadowHook: ShadowSessionHook | null = null;
  private uiController: CanvasUIController | null = null;
  private frameDebugLayer: FrameDebugLayer | null = null;
  private replaySystem: FrameReplaySystem;
  private sessionProvider: (() => OrchestratedSession | null) | null = null;

  private running = false;
  private rafId: number | null = null;
  private frameId = 0;

  private frameHistory: Array<'green' | 'yellow' | 'red'> = [];
  private readonly HISTORY_MAX = 30;
  private lastReport: FrameReport | null = null;

  constructor(config: OrchestratorConfig = {}) {
    this.config = {
      observerEnabled: config.observerEnabled ?? true,
      stabilityEnabled: config.stabilityEnabled ?? true,
      traceEnabled: config.traceEnabled ?? true,
      traceMaxFrames: config.traceMaxFrames ?? 300,
      traceVerbose: config.traceVerbose ?? false,
      debug: config.debug ?? false,
    };

    this.replaySystem = new FrameReplaySystem(600);

    if (this.config.traceEnabled) {
      this.frameDebugLayer = new FrameDebugLayer({
        maxFrames: this.config.traceMaxFrames,
        verbose: this.config.traceVerbose,
        autoDumpOnError: true,
      });
    }
  }

  // ==========================================================
  //  Binding
  // ==========================================================

  bindSessionProvider(provider: () => OrchestratedSession | null): void { this.sessionProvider = provider; }
  bindUIController(controller: CanvasUIController): void { this.uiController = controller; }

  createAndBindShadowHook(svsConfig?: Parameters<typeof createSVSHook>[0]): ShadowSessionHook {
    const hook = createSVSHook({ svsEnabled: this.config.observerEnabled, debug: this.config.debug, ...svsConfig });
    this.shadowHook = hook;
    return hook;
  }

  // ==========================================================
  //  Lifecycle
  // ==========================================================

  start(): void {
    if (this.running) return;
    this.running = true;
    this.frameId = 0;
    if (this.shadowHook && this.config.observerEnabled && !this.shadowHook.attached) this.shadowHook.attach();
    this.scheduleNextFrame();
    if (this.config.debug) console.log('[RuntimeOrchestrator] ▶ FRAME CONTRACT VERIFIER started');
  }

  stop(): void {
    this.running = false;
    if (this.rafId !== null) { cancelAnimationFrame(this.rafId); this.rafId = null; }
    if (this.shadowHook) this.shadowHook.detach();
  }

  destroy(): void {
    this.stop();
    if (this.shadowHook) { this.shadowHook.destroy(); this.shadowHook = null; }
    this.uiController = null;
    this.sessionProvider = null;
    this.frameDebugLayer?.clear();
    this.frameDebugLayer = null;
  }

  // ==========================================================
  //  FRAME LOOP
  // ==========================================================

  private scheduleNextFrame(): void { if (this.running) this.rafId = requestAnimationFrame(() => this.loop()); }

  private loop(): void {
    if (!this.running) return;
    try { this.tick(); } catch (err) {
      if (this.config.debug) console.error('[RuntimeOrchestrator] ❌ FATAL:', err);
    }
    this.scheduleNextFrame();
  }

  // ==========================================================
  //  TICK — Produces FrameResult (contract), no side effects
  // ==========================================================

  private tick(): void {
    this.frameId++;
    const frameStart = performance.now();

    const errors: FrameError[] = [];
    const ce = (step: string, err: unknown) => errors.push({ step, message: err instanceof Error ? err.message : String(err), timestamp: performance.now() });

    let session: OrchestratedSession | null = null;
    let strokeCount = 0;
    let metrics: RawMetrics | null = null;

    // STEP 1 — STATE
    const stateResult = runStep('state', () => {
      const s = this.sessionProvider?.() ?? null;
      if (s?.isAlive()) { session = s; strokeCount = s.engine.strokes.length; }
    }, (err) => ce('state', err));

    if (!session) {
      this.pushFrameHistory('yellow');
      const uiResult = runStep('ui', () => {}, (err) => ce('ui', err));
      this.logTrace(frameStart, stateResult, { ok: true, durationMs: 0 }, { ok: true, durationMs: 0 }, { ok: true, durationMs: 0 }, uiResult, errors);
      // Produce minimal FrameResult
      const result = this.buildResult(null, null, 'PASS');
      this.replaySystem.record(result);
      this.uiController?.renderFromFrame(result);
      return;
    }

    // STEP 2 — RENDER
    const renderResult = runStep('render', () => session!.orchestratorTick(), (err) => ce('render', err));

    // STEP 3 — OBSERVE
    const observeResult = runStep('observe', () => {
      if (!this.shadowHook?.attached || !this.config.observerEnabled) return;
      this.shadowHook.observe(session!);
      const r = this.shadowHook.diffStabilizer.getReport();
      metrics = {
        pixelDiff: 1 - r.cleanRatio,
        gpuDiff: 0,
        shadowDiff: (r.stats.totalMissing + r.stats.totalExtra) > 0
          ? Math.min(1, (r.stats.totalMissing + r.stats.totalExtra) / Math.max(1, strokeCount)) : 0,
      };
    }, (err) => ce('observe', err));

    // STEP 4 — STABILITY (pure, no side effects)
    const stabilityResult = runStep('stability', () => {
      // Stability is now computed AFTER FrameResult construction
      // This step only collects data; verdict is in buildResult()
    }, (err) => ce('stability', err));

    // ── Build FrameResult (the contract) ──
    const m = metrics ?? { pixelDiff: 0, gpuDiff: 0, shadowDiff: 0 };
    const dom = captureDOM();
    const s = session as OrchestratedSession; // Guarded by early return above

    const stateHash = computeStateHash(s.engine.strokes);
    const renderIds = s.renderQueue?.renderables
      ?.filter((r): r is { id: string } => !!r)
      .map(r => r.id) ?? [];
    const renderHash = computeRenderHash(renderIds, s.viewport.camera);
    const pixelHash = computePixelHash(m);
    const uiHash = computeUIHash(dom);

    // Pure stability evaluation
    const verdict = evaluateStability({
      frameId: this.frameId, stateHash, renderHash, pixelHash, uiHash,
      stability: 'PASS', failReasons: [], timestamp: frameStart,
      metrics: m, strokeCount,
    });

    const result: FrameResult = {
      frameId: this.frameId,
      stateHash, renderHash, pixelHash, uiHash,
      stability: verdict.stability,
      failReasons: verdict.reasons,
      timestamp: frameStart,
      metrics: m,
      strokeCount,
    };

    // ── Record ──
    this.replaySystem.record(result);

    // ── UI SYNC (step 5, outside contract — pure reaction) ──
    const uiResult = runStep('ui', () => {
      this.pushFrameHistory(result.stability === 'PASS' ? 'green' : 'red');
      this.uiController?.renderFromFrame(result);
      this.uiController?.tickAnimation();
    }, (err) => ce('ui', err));

    // ── Trace ──
    this.logTrace(frameStart, stateResult, renderResult, observeResult, stabilityResult, uiResult, errors);

    this.lastReport = {
      frameId: this.frameId, strokeCount, metrics,
      decision: result.stability === 'PASS' ? 'ALLOW' : 'BLOCK',
      timestamp: frameStart,
    };
  }

  // ==========================================================
  //  Helpers
  // ==========================================================

  private buildResult(_session: OrchestratedSession | null, _metrics: RawMetrics | null, stability: 'PASS' | 'FAIL'): FrameResult {
    return {
      frameId: this.frameId,
      stateHash: '00000000', renderHash: '00000000', pixelHash: '00000000', uiHash: '00000000',
      stability, failReasons: stability === 'FAIL' ? ['no session'] : [],
      timestamp: performance.now(),
      metrics: { pixelDiff: 0, gpuDiff: 0, shadowDiff: 0 },
      strokeCount: 0,
    };
  }

  private pushFrameHistory(color: 'green' | 'yellow' | 'red'): void {
    this.frameHistory.push(color);
    if (this.frameHistory.length > this.HISTORY_MAX) this.frameHistory.shift();
  }

  private logTrace(
    frameStart: number, state: StepResult, render: StepResult, observe: StepResult,
    stability: StepResult, ui: StepResult, errors: FrameError[],
  ): void {
    const dom = captureDOM();
    this.frameDebugLayer?.log({
      frameId: this.frameId,
      steps: { state, render, observe, stability, ui },
      dom,
      metrics: { pixelDiff: 0, gpuDiff: 0, shadowDiff: 0 },
      errors,
      timestamp: frameStart,
    });
  }

  // ==========================================================
  //  Public Query
  // ==========================================================

  get lastFrameReport(): FrameReport | null { return this.lastReport; }
  get lastTrace(): FrameTrace | undefined { return this.frameDebugLayer?.getLast(); }
  get debugLayer(): FrameDebugLayer | null { return this.frameDebugLayer; }
  get replay(): FrameReplaySystem { return this.replaySystem; }
  get currentFrameId(): number { return this.frameId; }
  get isRunning(): boolean { return this.running; }
}

export default RuntimeOrchestrator;
