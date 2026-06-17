// ============================================================
//  SYSTEM DIAGNOSIS SCRIPT
//  注入方式：Obsidian 开发者控制台 (Ctrl+Shift+I)
//  前提：RuntimeOrchestrator 已启动、FrameDebugLayer 有数据
//
//  用法：
//    const report = window.__systemDiagnosis();
//    console.log(report);
// ============================================================

interface DiagnosisReport {
  uiFailures: UIFailureEntry[];
  cursorIssues: CursorIssueEntry[];
  renderIssues: RenderIssueEntry[];
  lifecycleIssues: LifecycleIssueEntry[];
  stabilitySummary: StabilitySummary;
  generatedAt: string;
  totalFramesScanned: number;
}

interface UIFailureEntry {
  frameId: number;
  reason: string;
  domSnapshot: string;
  repeating: boolean;
  streak: number;
}

interface CursorIssueEntry {
  frameId: number;
  cursorState: string;
  issue: string;
}

interface RenderIssueEntry {
  frameId: number;
  durationMs: number;
  error?: string;
  issue: string;
}

interface LifecycleIssueEntry {
  frameId: number;
  dashboardExists: boolean;
  canvasMounted: boolean;
  issue: string;
}

interface StabilitySummary {
  totalFrames: number;
  stableFrames: number;
  stablePercent: number;
  maxUnstableStreak: number;
  currentUnstableStreak: number;
  primaryFailureDomain: string;
  recovered: boolean;
}

// ============================================================
//  Diagnosis Function
// ============================================================

function systemDiagnosis(maxFrames: number = 300): DiagnosisReport | string {
  // ── Access orchestrator ──
  const plugin = (window as any).app?.plugins?.plugins?.['reminote'];
  if (!plugin) return '❌ RemiNote plugin not found. Is it loaded?';

  const orch = plugin._orchestrator;
  if (!orch) return '❌ RuntimeOrchestrator not found. Has _boot() completed?';

  const debugLayer = orch.debugLayer;
  if (!debugLayer) return '❌ FrameDebugLayer not enabled. Set traceEnabled: true.';

  // ── Get trace data ──
  const traces = debugLayer.getRange(
    Math.max(1, orch.currentFrameId - maxFrames),
    orch.currentFrameId,
  );

  if (traces.length === 0) {
    return '⚠️ No trace data yet. RuntimeOrchestrator may not have started, or no frames have elapsed. Try running `orch.start()` first.';
  }

  // ── Analyze ──
  const report: DiagnosisReport = {
    uiFailures: [],
    cursorIssues: [],
    renderIssues: [],
    lifecycleIssues: [],
    stabilitySummary: {
      totalFrames: traces.length,
      stableFrames: 0,
      stablePercent: 0,
      maxUnstableStreak: 0,
      currentUnstableStreak: 0,
      primaryFailureDomain: 'NONE',
      recovered: false,
    },
    generatedAt: new Date().toISOString(),
    totalFramesScanned: traces.length,
  };

  // ── Counters for pattern detection ──
  const uiFailureMap = new Map<string, number[]>(); // reason → frameIds
  let unstableStreak = 0;
  let maxUnstableStreak = 0;
  const domainFailures: Record<string, number> = {
    ui: 0,
    cursor: 0,
    render: 0,
    lifecycle: 0,
  };

  for (const t of traces) {
    let frameUnstable = false;

    // ── 1. UI Failures ──
    if (!t.steps.ui.ok) {
      frameUnstable = true;
      domainFailures.ui++;
      const reason = t.steps.ui.error || 'ui step failed';
      if (!uiFailureMap.has(reason)) uiFailureMap.set(reason, []);
      uiFailureMap.get(reason)!.push(t.frameId);
      report.uiFailures.push({
        frameId: t.frameId,
        reason,
        domSnapshot: JSON.stringify(t.dom),
        repeating: false, // filled after loop
        streak: 0,        // filled after loop
      });
    } else if (!t.dom.dashboardExists && t.frameId > 10) {
      // Dashboard expected to be mounted after frame 10 (boot settle)
      frameUnstable = true;
      domainFailures.ui++;
      const reason = 'dashboard missing from DOM';
      if (!uiFailureMap.has(reason)) uiFailureMap.set(reason, []);
      uiFailureMap.get(reason)!.push(t.frameId);
      report.uiFailures.push({
        frameId: t.frameId,
        reason,
        domSnapshot: JSON.stringify(t.dom),
        repeating: false,
        streak: 0,
      });
    }

    // ── 2. Cursor Issues ──
    if (t.dom.cursorState === 'error') {
      frameUnstable = true;
      domainFailures.cursor++;
      report.cursorIssues.push({
        frameId: t.frameId,
        cursorState: t.dom.cursorState,
        issue: 'cursor DOM read failed (captureDOM error)',
      });
    } else if (t.dom.cursorState === 'unknown' && t.dom.canvasMounted) {
      // Canvas mounted but cursor overlay not found — possible mount order issue
      domainFailures.cursor++;
      report.cursorIssues.push({
        frameId: t.frameId,
        cursorState: t.dom.cursorState,
        issue: 'cursor overlay missing while canvas is mounted — possible mount order',
      });
    }

    // ── 3. Render Issues ──
    if (!t.steps.render.ok) {
      frameUnstable = true;
      domainFailures.render++;
      report.renderIssues.push({
        frameId: t.frameId,
        durationMs: t.steps.render.durationMs,
        error: t.steps.render.error,
        issue: `render step failed: ${t.steps.render.error || 'unknown'}`,
      });
    } else if (t.steps.render.durationMs > 16) {
      // Frame budget exceeded (60fps = 16.67ms)
      domainFailures.render++;
      report.renderIssues.push({
        frameId: t.frameId,
        durationMs: t.steps.render.durationMs,
        issue: `render duration ${t.steps.render.durationMs.toFixed(1)}ms exceeds 16ms budget`,
      });
    }

    // ── 4. Lifecycle Issues ──
    if (t.dom.canvasMounted && !t.dom.dashboardExists) {
      frameUnstable = true;
      domainFailures.lifecycle++;
      report.lifecycleIssues.push({
        frameId: t.frameId,
        dashboardExists: t.dom.dashboardExists,
        canvasMounted: t.dom.canvasMounted,
        issue: 'canvas mounted but dashboard missing — possible mount race or DOM detachment',
      });
    }
    if (!t.dom.canvasMounted && t.frameId > 5) {
      // After frame 5, canvas should be mounted if session exists
      domainFailures.lifecycle++;
      report.lifecycleIssues.push({
        frameId: t.frameId,
        dashboardExists: t.dom.dashboardExists,
        canvasMounted: t.dom.canvasMounted,
        issue: 'canvas not mounted after boot settle period',
      });
    }

    // ── Stability streak tracking ──
    if (frameUnstable) {
      unstableStreak++;
      if (unstableStreak > maxUnstableStreak) {
        maxUnstableStreak = unstableStreak;
      }
    } else {
      unstableStreak = 0;
    }
  }

  // ── Post-process: detect repeating patterns ──
  for (const entry of report.uiFailures) {
    const ids = uiFailureMap.get(entry.reason) || [];
    entry.repeating = ids.length >= 3;
    // Calculate streak: consecutive frameIds with same reason
    let streak = 1;
    for (let i = 1; i < ids.length; i++) {
      if (ids[i] === ids[i - 1] + 1) streak++;
      else break;
    }
    entry.streak = streak;
  }

  // ── Stability Summary ──
  const stableFrames = traces.length - new Set([
    ...report.uiFailures.map(f => f.frameId),
    ...report.cursorIssues.map(f => f.frameId),
    ...report.renderIssues.map(f => f.frameId),
    ...report.lifecycleIssues.map(f => f.frameId),
  ]).size;

  report.stabilitySummary = {
    totalFrames: traces.length,
    stableFrames,
    stablePercent: traces.length > 0 ? (stableFrames / traces.length) * 100 : 100,
    maxUnstableStreak: maxUnstableStreak,
    currentUnstableStreak: unstableStreak,
    primaryFailureDomain: Object.entries(domainFailures)
      .sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'NONE',
    recovered: unstableStreak === 0 && maxUnstableStreak > 0,
  };

  return report;
}

// ============================================================
//  Pretty-Print Formatter
// ============================================================

function formatDiagnosisReport(report: DiagnosisReport | string): string {
  if (typeof report === 'string') return report;

  const s = report.stabilitySummary;
  const lines: string[] = [];

  lines.push('═══════════════════════════════════════');
  lines.push('  SYSTEM DIAGNOSIS REPORT');
  lines.push('═══════════════════════════════════════');
  lines.push(`  Generated: ${report.generatedAt}`);
  lines.push(`  Frames Scanned: ${report.totalFramesScanned}`);
  lines.push('');

  // ── UI FAILURES ──
  lines.push('[UI FAILURES]');
  if (report.uiFailures.length === 0) {
    lines.push('  ✅ No UI failures detected.');
  } else {
    lines.push(`  ${report.uiFailures.length} failure(s):`);
    for (const f of report.uiFailures) {
      const repeat = f.repeating ? ` ⚠️ REPEATING (streak=${f.streak})` : '';
      lines.push(`  - Frame #${f.frameId}: ${f.reason}${repeat}`);
    }
  }
  lines.push('');

  // ── CURSOR ISSUES ──
  lines.push('[CURSOR ISSUES]');
  if (report.cursorIssues.length === 0) {
    lines.push('  ✅ No cursor issues detected.');
  } else {
    lines.push(`  ${report.cursorIssues.length} issue(s):`);
    for (const c of report.cursorIssues) {
      lines.push(`  - Frame #${c.frameId}: cursorState="${c.cursorState}" → ${c.issue}`);
    }
  }
  lines.push('');

  // ── RENDER ISSUES ──
  lines.push('[RENDER ISSUES]');
  if (report.renderIssues.length === 0) {
    lines.push('  ✅ No render issues detected.');
  } else {
    lines.push(`  ${report.renderIssues.length} issue(s):`);
    for (const r of report.renderIssues) {
      lines.push(`  - Frame #${r.frameId}: ${r.durationMs.toFixed(1)}ms → ${r.issue}`);
    }
  }
  lines.push('');

  // ── LIFECYCLE ISSUES ──
  lines.push('[LIFECYCLE ISSUES]');
  if (report.lifecycleIssues.length === 0) {
    lines.push('  ✅ No lifecycle issues detected.');
  } else {
    lines.push(`  ${report.lifecycleIssues.length} issue(s):`);
    for (const l of report.lifecycleIssues) {
      lines.push(`  - Frame #${l.frameId}: dash=${l.dashboardExists} canvas=${l.canvasMounted} → ${l.issue}`);
    }
  }
  lines.push('');

  // ── STABILITY SUMMARY ──
  lines.push('[STABILITY SUMMARY]');
  lines.push(`  Stable frames:     ${s.stableFrames}/${s.totalFrames} (${s.stablePercent.toFixed(1)}%)`);
  lines.push(`  Max unstable streak: ${s.maxUnstableStreak} frames`);
  lines.push(`  Current streak:      ${s.currentUnstableStreak} frames`);
  lines.push(`  Primary failure domain: ${s.primaryFailureDomain.toUpperCase()}`);
  lines.push(`  System recovered:   ${s.recovered ? '✅ YES' : '⚠️ NO (or never failed)'}`);
  lines.push('');
  lines.push('═══════════════════════════════════════');

  return lines.join('\n');
}

// ============================================================
//  Expose to window for console access
// ============================================================

(window as any).__systemDiagnosis = () => {
  const report = systemDiagnosis();
  console.log(formatDiagnosisReport(report));
  return report;
};

// ============================================================
//  STATIC ANALYSIS (compile-time structural issues)
//  These are issues guaranteed by code structure, not runtime.
// ============================================================

export function staticAnalysisReport(): string {
  const issues: string[] = [];

  // 1. Dashboard mount: no initial mount in orchestrator start()
  //    Dashboard is created in _boot() but mount() is only called
  //    reactively during recovery. The initial mount was in CanvasView.onOpen
  //    which we removed.
  issues.push(
    '[LIFECYCLE] Dashboard initial mount gap: V11MagneticDashboard is constructed ' +
    'in _boot() but its mount() is only called during RECOVERY step. The initial ' +
    'mount was removed from CanvasView.onOpen. Dashboard will not appear in DOM ' +
    'until the first recovery trigger or until a BLOCK decision occurs. ' +
    'FIX: Add initial dashboard.mount(container) in CanvasView.onOpen or in ' +
    'orchestrator.start() after first session creation.',
  );

  // 2. CursorRenderer mount: mount() is called in createSession() but
  //    depends on cursorRenderer.bindSession() preceding it.
  //    If bindSession fails or session is null, mount() still attaches
  //    to document.body but has no session to subscribe to.
  issues.push(
    '[CURSOR] CursorRenderer mount order dependency: In CanvasView.createSession(), ' +
    'cursorRenderer.bindSession(session) is called before cursorRenderer.mount(). ' +
    'If bindSession fails silently (e.g., session becomes null between calls), ' +
    'mount() will attach to body without a valid session, leaving cursorState="unknown" ' +
    'in DOM snapshots.',
  );

  // 3. ShadowSessionHook.observe() accesses session.engine, session.inputSnapshot,
  //    session.viewport — none of these are null-checked in the observe() call chain.
  //    If the session is partially destroyed (e.g., engine detached but alive=true),
  //    observe will throw, producing a trace with observe.ok=false.
  issues.push(
    '[OBSERVE] ShadowSessionHook.observe() null-safety gap: The observe() method ' +
    'accesses session.engine.strokes, session.inputSnapshot.previewStroke, and ' +
    'session.viewport.camera without null guards. If CanvasSession.detach() nulls ' +
    'engine before alive is set to false, this will produce trace errors.',
  );

  // 4. Recovery logic: the DOM querySelector calls in recover() and captureDOM()
  //    run synchronously. If called during a React/Obsidian re-render cycle,
  //    they may read stale DOM state.
  issues.push(
    '[DOM] Synchronous DOM reads during Obsidian re-render cycles: Both recover() ' +
    'and captureDOM() use synchronous querySelector. If Obsidian is mid-render ' +
    '(e.g., leaf resize, tab switch), these reads may return stale/missing elements ' +
    'even though the elements will exist after the render cycle completes.',
  );

  // 5. No initial canvas session at orchestrator start time.
  //    In _boot(), orchestrator.start() is called, but CanvasSession is created
  //    later (when user opens a canvas). The first N frames will all show
  //    "no session" → yellow frame history → dashboard shows UNSTABLE.
  issues.push(
    '[BOOT] Cold-start noise: RuntimeOrchestrator starts in _boot() before any ' +
    'CanvasSession exists. The first frames (until user opens a canvas) will all ' +
    'have session=null, producing yellow frame history entries and a dashboard ' +
    'showing "UNSTABLE" mode. This is technically correct but may be confusing.',
  );

  return issues.join('\n\n');
}

// Diagnosis script loaded — call __systemDiagnosis() in console to scan traces.
