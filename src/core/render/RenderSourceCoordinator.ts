// ============================================================
//  RenderSourceCoordinator — 渲染源统一协调器
//  统一三件事：
//    输入              → 作用
//    RenderContract    → 初始状态（hydrate once）+ 静态描述
//    StrokeMutationLog → 唯一 runtime source（debug only）
//
//  核心理念：
//  ❌ 从"状态驱动 UI"
//  ✅ 变成"事件驱动渲染引擎"
//
//  质变带来的能力：
//  - 回放：100% 精确
//  - 协作：可 merge mutation stream
//  - 性能：不再 diff state
//  - 缩略图：replay mutations
//  - undo/redo：天然支持
// ============================================================

import type { RenderContract } from './RenderContract';
import { StrokeMutationLog } from './StrokeMutationLog';
import type { StrokeMutation } from './StrokeMutationLog';

// ============================================================
//  RenderSourceCoordinator
// ============================================================

/**
 * 渲染源统一协调器 — 单一事件流入口。
 *
 * 生命周期：
 * 1. hydrate(snapshot) — 首帧初始化（只执行一次）
 * 2. getMutations()   — 每帧消费 mutationLog
 * 3. isHydrated()     — 检查是否已初始化
 *
 * 约束：
 * ❌ RenderContract 不参与 runtime render
 * ❌ snapshot 仅用于 hydrate
 * ✅ mutationLog 是唯一 runtime source
 */
export class RenderSourceCoordinator {
  private _hydrated = false;

  /**
   * 初始 hydration — 只在首帧执行一次。
   * 接受 RenderContract 作为初始状态描述，
   * 后续所有渲染只依赖 mutationLog。
   */
  hydrate(_contract: RenderContract): void {
    // 初始只执行一次
    this._hydrated = true;
  }

  /**
   * 从 StrokeMutationLog 消费本帧的所有 stroke 变更。
   * 这是 Renderer 的唯一 runtime 数据源。
   */
  /**
   * 从 StrokeMutationLog 消费本帧的所有 stroke 变更。
   * 这是 Renderer 的唯一 runtime 数据源。
   *
   * @param frameId 当前帧标识
   */
  getMutations(frameId: string): { frameId: string; mutations: StrokeMutation[] } | null {
    return StrokeMutationLog.instance.consume(frameId);
  }

  /** 是否已完成初始 hydration。 */
  isHydrated(): boolean {
    return this._hydrated;
  }
}
