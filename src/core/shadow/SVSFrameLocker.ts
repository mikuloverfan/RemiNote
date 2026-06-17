// ============================================================
//  SVS Frame Locker — 帧原子性保证
//
//  问题：engine.strokes 在 renderFrame() 期间可能被 mutate。
//         shadow observer 读到"半更新状态"→ diff 随机 spike。
//
//  方案：
//  ① FrameToken — 每帧唯一标识，含 strokesVersion 校验
//  ② beginFrame() — 在 renderFrame 前锁定，返回 token
//  ③ verifyFrame() — 在 shadow render 后验证 frame 未被修改
//  ④ 外部版本追踪 — 不修改 engine，通过 checksum 检测 mutation
//
//  约束：
//  ❌ 不修改 CanvasRuntimeEngine（main.ts 不动）
//  ❌ 不拦截 engine.strokes 的写操作
//  ✅ 纯检测层 — 发现 mid-frame mutation 时标记 frame 为 corrupted
// ============================================================

// ============================================================
//  Types
// ============================================================

/** 每帧的唯一令牌 */
export interface FrameToken {
  /** 单调递增帧序号 */
  frameId: number;
  /** 捕获时间戳 (performance.now) */
  timestamp: number;
  /** 帧开始时的 strokes 版本校验和 */
  strokesChecksum: number;
  /** 帧开始时的 stroke 数量 */
  strokeCount: number;
}

/** FrameLocker 配置 */
export interface FrameLockerConfig {
  /** 是否启用 mid-frame mutation 检测 */
  mutationDetection?: boolean;
  /** debug 日志 */
  debug?: boolean;
}

// ============================================================
//  Constants
// ============================================================

const DEFAULT_CONFIG: Required<FrameLockerConfig> = {
  mutationDetection: true,
  debug: false,
};

// ============================================================
//  SVSFrameLocker
// ============================================================

export class SVSFrameLocker {
  // ── State ──
  private _frameId = 0;
  private _config: Required<FrameLockerConfig>;
  private _enabled = false;

  // ── Current frame tracking ──
  private _currentToken: FrameToken | null = null;
  private _corruptedFrames = 0;
  private _totalFrames = 0;

  constructor(config: FrameLockerConfig = {}) {
    this._config = { ...DEFAULT_CONFIG, ...config };
  }

  // ==========================================================
  //  Lifecycle
  // ==========================================================

  enable(): void { this._enabled = true; }
  disable(): void {
    this._enabled = false;
    this._currentToken = null;
  }
  get enabled(): boolean { return this._enabled; }

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
  beginFrame(
    strokes: ReadonlyArray<{ id: string; points?: readonly { x: number; y: number }[] }>,
  ): FrameToken {
    this._frameId++;
    this._totalFrames++;

    const checksum = this._computeChecksum(strokes);

    const token: FrameToken = {
      frameId: this._frameId,
      timestamp: performance.now(),
      strokesChecksum: checksum,
      strokeCount: strokes.length,
    };

    this._currentToken = token;

    if (this._config.debug && this._frameId % 60 === 0) {
      console.log('[SVSFrameLocker] 🔒 frame locked:', {
        frameId: token.frameId,
        strokeCount: token.strokeCount,
        checksum: token.strokesChecksum.toString(16),
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
  verifyFrame(
    strokes: ReadonlyArray<{ id: string; points?: readonly { x: number; y: number }[] }>,
  ): boolean {
    if (!this._enabled || !this._config.mutationDetection) return true;
    if (!this._currentToken) return false;

    const currentChecksum = this._computeChecksum(strokes);
    const clean = currentChecksum === this._currentToken.strokesChecksum;

    if (!clean) {
      this._corruptedFrames++;
      if (this._config.debug) {
        console.warn('[SVSFrameLocker] ⚠️ mid-frame mutation detected!', {
          frameId: this._currentToken.frameId,
          expectedChecksum: this._currentToken.strokesChecksum.toString(16),
          actualChecksum: currentChecksum.toString(16),
          expectedCount: this._currentToken.strokeCount,
          actualCount: strokes.length,
        });
      }
    }

    return clean;
  }

  // ==========================================================
  //  Query
  // ==========================================================

  /** 当前帧的 token（可能为 null = 未调用 beginFrame） */
  get currentToken(): FrameToken | null {
    return this._currentToken;
  }

  /** 当前帧 ID */
  get currentFrameId(): number {
    return this._frameId;
  }

  /** 被标记为 corrupted 的帧数 */
  get corruptedFrames(): number {
    return this._corruptedFrames;
  }

  /** 总帧数 */
  get totalFrames(): number {
    return this._totalFrames;
  }

  /** corruption 比例 (0~1) */
  get corruptionRate(): number {
    return this._totalFrames > 0
      ? this._corruptedFrames / this._totalFrames
      : 0;
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
  private _computeChecksum(
    strokes: ReadonlyArray<{ id: string; points?: readonly { x: number; y: number }[] }>,
  ): number {
    let h = 2166136261; // FNV offset basis

    for (const s of strokes) {
      // Mix stroke ID
      for (let i = 0; i < s.id.length; i++) {
        h ^= s.id.charCodeAt(i);
        h = Math.imul(h, 16777619);
      }

      const pts = s.points;
      if (pts && pts.length > 0) {
        // Mix point count
        h ^= pts.length;
        h = Math.imul(h, 16777619);

        // Mix first point
        h ^= Math.round(pts[0].x * 100);
        h = Math.imul(h, 16777619);
        h ^= Math.round(pts[0].y * 100);
        h = Math.imul(h, 16777619);

        // Mix last point
        const last = pts[pts.length - 1];
        h ^= Math.round(last.x * 100);
        h = Math.imul(h, 16777619);
        h ^= Math.round(last.y * 100);
        h = Math.imul(h, 16777619);
      } else {
        // Empty stroke — just mix a sentinel
        h ^= 0;
        h = Math.imul(h, 16777619);
      }
    }

    return h >>> 0; // ensure unsigned 32-bit
  }
}

export default SVSFrameLocker;
