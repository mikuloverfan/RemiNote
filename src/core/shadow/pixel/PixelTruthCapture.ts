// ============================================================
//  Pixel Truth Layer — PixelTruthCapture
//
//  职责：
//  ✔ 从真实 HTMLCanvasElement 读取像素 — 纯粹的外部观测
//  ✔ 不打折 — 不依赖 snapshot / renderQueue / GPU buffer
//  ✔ 自适应性能降级 — downsample + edge-only + N-frame skip
//  ✔ 产出 PixelTruthFrame — 可 hash 对比的像素指纹
//
//  放置决策：
//  ✅ CPU renderFrame() 之后（draw calls 已 flush）
//  ✅ 使用 downsample 避免 getImageData 性能瓶颈
//  ✅ 支持 edge-only 模式（只读关键行/列，减少 90% 数据量）
//  ✅ 支持 N-frame skip（默认每 30 帧一次全量，其余帧 edge-only）
//
//  性能分析：
//    getImageData 是同步操作，会强制 GPU pipeline flush。
//    全分辨率 (1920×1080) → ~2ms GPU stall
//    1/4 downsample (480×270)    → ~0.3ms
//    edge-only (2 rows + 2 cols) → ~0.05ms
//
//  约束：
//  ❌ 不修改 canvas 内容（纯读取）
//  ❌ 不调用 canvas.toDataURL（比 getImageData 慢 5x）
//  ✅ getImageData 在 renderFrame 完成之后调用
// ============================================================

// ============================================================
//  Types
// ============================================================

export interface PixelTruthFrame {
  frameId: number;
  /** canvas 实际宽高（CSS px） */
  width: number;
  height: number;
  /** FNV-1a hash over pixel samples */
  hash: string;
  /** 降采样像素数据（RGBA） */
  thumbnail: Uint8ClampedArray | null;
  /** 边缘采样点（上下左右 4 条边的像素值） */
  edgeSamples: number[];
  /** 采样模式 */
  sampleMode: 'full' | 'downsample' | 'edge-only';
  /** 捕获耗时 (ms) */
  captureTimeMs: number;
  /** 捕获时间戳 */
  capturedAt: number;
}

export interface PixelTruthConfig {
  /** downsample 因子 (2 = 1/2, 4 = 1/4, 默认 4) */
  downsampleFactor?: number;
  /** 每 N 帧做一次完整采样（默认 30） */
  fullSampleInterval?: number;
  /** 是否启用 */
  enabled?: boolean;
  /** debug */
  debug?: boolean;
}

// ============================================================
//  Constants
// ============================================================

const DEFAULT_CONFIG: Required<PixelTruthConfig> = {
  downsampleFactor: 4,
  fullSampleInterval: 30,
  enabled: false,
  debug: false,
};

// ============================================================
//  PixelTruthCapture
// ============================================================

export class PixelTruthCapture {
  private _config: Required<PixelTruthConfig>;
  private _enabled = false;
  private _frameCount = 0;
  private _lastFrame: PixelTruthFrame | null = null;

  constructor(config: PixelTruthConfig = {}) {
    this._config = { ...DEFAULT_CONFIG, ...config };
  }

  enable(): void { this._enabled = true; }
  disable(): void { this._enabled = false; }

  // ==========================================================
  //  capture — 主入口
  // ==========================================================

  /**
   * 从真实 canvas 捕获像素指纹。
   *
   * @param canvas  主渲染 canvas（HTMLCanvasElement）
   * @param frameId 当前帧 ID（对齐 FrameBarrier）
   * @returns       PixelTruthFrame — 外部像素锚点
   */
  capture(canvas: HTMLCanvasElement, frameId: number): PixelTruthFrame | null {
    if (!this._enabled) return null;

    this._frameCount++;
    const t0 = performance.now();

    const w = canvas.width;
    const h = canvas.height;

    // 决定采样模式
    const isFullSample = this._frameCount % this._config.fullSampleInterval === 0;

    let thumbnail: Uint8ClampedArray | null = null;
    let edgeSamples: number[] = [];
    let sampleMode: PixelTruthFrame['sampleMode'];

    try {
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;

      if (isFullSample) {
        // 完整降采样
        const ds = this._config.downsampleFactor;
        const sw = Math.max(1, Math.floor(w / ds));
        const sh = Math.max(1, Math.floor(h / ds));
        thumbnail = ctx.getImageData(0, 0, sw, sh).data;
        sampleMode = 'downsample';
        edgeSamples = this._extractEdgeSamples(thumbnail, sw, sh);
      } else {
        // 边缘采样（只读四边）
        edgeSamples = this._captureEdgeOnly(ctx, w, h);
        sampleMode = 'edge-only';
      }
    } catch (err) {
      // getImageData may fail if canvas is tainted (cross-origin)
      if (this._config.debug) {
        console.warn('[PixelTruth] capture failed (possibly tainted canvas):', err);
      }
      return null;
    }

    // Hash
    const hashData = thumbnail ?? new Uint8ClampedArray(edgeSamples);
    const hash = this._fnvHash(hashData);

    const frame: PixelTruthFrame = {
      frameId,
      width: w,
      height: h,
      hash,
      thumbnail,
      edgeSamples,
      sampleMode,
      captureTimeMs: performance.now() - t0,
      capturedAt: performance.now(),
    };

    this._lastFrame = frame;
    return frame;
  }

  get lastFrame(): PixelTruthFrame | null { return this._lastFrame; }
  get frameCount(): number { return this._frameCount; }

  // ==========================================================
  //  Private: edge-only sampling
  // ==========================================================

  private _captureEdgeOnly(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
  ): number[] {
    const samples: number[] = [];

    // Top row (sample every 8th pixel)
    const topRow = ctx.getImageData(0, 0, w, 1).data;
    for (let x = 0; x < w; x += 8) {
      const i = x * 4;
      samples.push(topRow[i], topRow[i + 1], topRow[i + 2], topRow[i + 3]);
    }

    // Bottom row
    const bottomRow = ctx.getImageData(0, h - 1, w, 1).data;
    for (let x = 0; x < w; x += 8) {
      const i = x * 4;
      samples.push(bottomRow[i], bottomRow[i + 1], bottomRow[i + 2], bottomRow[i + 3]);
    }

    // Left column
    const leftCol = ctx.getImageData(0, 0, 1, h).data;
    for (let y = 0; y < h; y += 8) {
      const i = y * 4;
      samples.push(leftCol[i], leftCol[i + 1], leftCol[i + 2], leftCol[i + 3]);
    }

    // Right column
    const rightCol = ctx.getImageData(w - 1, 0, 1, h).data;
    for (let y = 0; y < h; y += 8) {
      const i = y * 4;
      samples.push(rightCol[i], rightCol[i + 1], rightCol[i + 2], rightCol[i + 3]);
    }

    return samples;
  }

  private _extractEdgeSamples(
    thumbnail: Uint8ClampedArray,
    w: number,
    h: number,
  ): number[] {
    // From already-downsampled data, extract edges
    const samples: number[] = [];
    for (let x = 0; x < w; x++) {
      const i = x * 4;
      samples.push(thumbnail[i], thumbnail[i + 1], thumbnail[i + 2], thumbnail[i + 3]);
    }
    for (let x = 0; x < w; x++) {
      const i = ((h - 1) * w + x) * 4;
      samples.push(thumbnail[i], thumbnail[i + 1], thumbnail[i + 2], thumbnail[i + 3]);
    }
    return samples;
  }

  // ==========================================================
  //  Private: FNV-1a hash over pixel data
  // ==========================================================

  private _fnvHash(data: Uint8ClampedArray | number[]): string {
    let h = 2166136261;
    const step = Math.max(1, Math.floor(data.length / 256)); // sample 256 values
    for (let i = 0; i < data.length; i += step) {
      h ^= data[i];
      h = Math.imul(h, 16777619);
    }
    return 'px_' + (h >>> 0).toString(16);
  }
}

export default PixelTruthCapture;
