// ============================================================
//  Phase 5.2: Stamp Buffer Pipeline — Render Decoupling
//
//  核心职责：
//  🎯 addPoint = 写入 stamp buffer（不再渲染）
//  🎯 renderFrame = 消费 buffer（唯一渲染入口）
//
//  数据结构：GPU-ready SoA (Structure of Arrays)
//  每个 stamp 占 6 个 float32：
//    [x, y, radius, opacity, color, seed]
//
//  收益：
//  ✔ CPU/GPU 解耦 — 后续只需 upload buffer + instanced draw
//  ✔ 零 GC render — 无 per-stroke 对象分配
//  ✔ 可控性能 — buffer overflow 自动丢弃旧 stamp
//  ✔ density 控制 — 与 Phase 5.1 budget guardrails 联动
//
//  约束：
//  ❌ 不引入 GPU
//  ❌ 不改 brush kernel
//  ❌ 不改 inkW formula
//  ❌ 不改 geometry system
// ============================================================

// ============================================================
//  Types
// ============================================================

/** GPU-ready Stamp — SoA 兼容布局 */
export interface Stamp {
  x: number;
  y: number;
  radius: number;
  opacity: number;
  /** Packed RGBA color as uint32 (0xRRGGBBAA) */
  color: number;
  /** Deterministic seed for grain texture */
  seed: number;
}

/** Stamp 在 Float32Array 中的 stride（每个 stamp 6 个 float） */
export const STAMP_STRIDE = 6;

// ============================================================
//  Color Packing / Unpacking
// ============================================================

/**
 * Pack CSS hex color string → packed RGBA number.
 *
 * Supports: "#RGB", "#RRGGBB", "#RRGGBBAA"
 * Default alpha = 0xFF (fully opaque).
 *
 * @example packColor("#ff0000") → 0xFF0000FF
 * @example packColor("#000")    → 0x000000FF
 */
export function packColor(hex: string): number {
  let h = hex.replace('#', '');

  // Expand shorthand #RGB → #RRGGBB
  if (h.length === 3) {
    h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  }

  // Parse components
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  const a = h.length >= 8 ? parseInt(h.substring(6, 8), 16) : 0xFF;

  // Pack: RRGGBBAA → single number
  return ((r << 24) | (g << 16) | (b << 8) | a) >>> 0;
}

/**
 * Unpack packed RGBA number → CSS hex string.
 *
 * @example unpackColor(0xFF0000FF) → "#ff0000"
 */
export function unpackColor(packed: number): string {
  const r = (packed >>> 24) & 0xFF;
  const g = (packed >>> 16) & 0xFF;
  const b = (packed >>> 8) & 0xFF;
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

// ============================================================
//  StampBuffer — 环形缓冲区
// ============================================================

export class StampBuffer {
  /** Float32Array 底层存储 — SoA 布局 */
  private _buffer: Float32Array;
  /** 容量（stamp 数量，非 float 数量） */
  private _capacity: number;
  /** 当前写入位置（下一个 stamp 将写入的索引） */
  private _writePtr = 0;
  /** 当前有效 stamp 数量（环形覆盖后等于 capacity） */
  private _count = 0;

  /**
   * @param capacity 最大 stamp 数量，默认 200000（≈ 1.2M floats = 4.8MB）
   */
  constructor(capacity: number = 200000) {
    this._capacity = capacity;
    this._buffer = new Float32Array(capacity * STAMP_STRIDE);
  }

  /**
   * 写入一个 stamp 到环形缓冲区。
   *
   * 环形语义：当 writePtr 到达 capacity 时回绕到 0，
   * 覆盖最旧的 stamp（buffer overflow → drop old stamps）。
   *
   * @param stamp 待写入的 stamp
   */
  write(stamp: Stamp): void {
    const i = this._writePtr * STAMP_STRIDE;

    this._buffer[i] = stamp.x;
    this._buffer[i + 1] = stamp.y;
    this._buffer[i + 2] = stamp.radius;
    this._buffer[i + 3] = stamp.opacity;
    this._buffer[i + 4] = stamp.color;
    this._buffer[i + 5] = stamp.seed;

    this._writePtr = (this._writePtr + 1) % this._capacity;
    if (this._count < this._capacity) {
      this._count++;
    }
  }

  /**
   * 批量写入 stamps（避免多次 write 调用开销）。
   *
   * @param stamps 待写入的 stamp 数组
   */
  writeBatch(stamps: readonly Stamp[]): void {
    for (let idx = 0; idx < stamps.length; idx++) {
      this.write(stamps[idx]);
    }
  }

  /**
   * 重置缓冲区（清空所有 stamp 数据）。
   * 不释放 Float32Array，仅重置指针。
   */
  reset(): void {
    this._writePtr = 0;
    this._count = 0;
  }

  /** 底层 Float32Array — 只读，供渲染消费 */
  get buffer(): Float32Array {
    return this._buffer;
  }

  /** 当前有效 stamp 数量 */
  get count(): number {
    return this._count;
  }

  /** 缓冲区容量 */
  get capacity(): number {
    return this._capacity;
  }
}

/** 全局单例 — 唯一 stamp buffer 实例 */
export const stampBuffer = new StampBuffer();
