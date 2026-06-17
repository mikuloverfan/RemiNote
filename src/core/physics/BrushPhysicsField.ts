// ============================================================
//  Phase 5.7.1: Brush Physics Field — Input Stabilizer Only
//
//  核心原则：
//  🎯 Physics 只做"稳定输入"，不再参与"视觉表达规则"
//
//  职责收敛：
//  ✔ Velocity EMA — 平滑速度（输入稳定）
//  ✔ Pressure EMA — 平滑压力（噪声抑制）
//  ✔ Direction EMA — 方向惯性（防转弯抖动）
//
//  禁止：
//  ❌ physics → radius / shape / deform（视觉规则）
//  ❌ physics → alpha / opacity（渲染规则）
//  ❌ physics → stamp deformation（GPU 逻辑）
//
//  架构：
//    Input → PhysicsField (stabilizer) → BrushKernel (shape authority) → GPU (render)
// ============================================================

// ============================================================
//  Types
// ============================================================

export interface PhysicsFieldInput {
  x: number;
  y: number;
  pressure: number;
  timestamp: number;
}

export interface PhysicsFieldOutput {
  velocity: number;
  pressure: number;
  directionX: number;
  directionY: number;
}

// ============================================================
//  Constants
// ============================================================

const VELOCITY_EMA = 0.8;
const PRESSURE_EMA = 0.35;
const DIRECTION_EMA = 0.7;

// ============================================================
//  BrushPhysicsField
// ============================================================

export class BrushPhysicsField {
  private _prevX = 0;
  private _prevY = 0;
  private _prevTimestamp = 0;
  private _smoothedVelocity = 0;
  private _smoothedPressure = 0;
  private _prevDirX = 0;
  private _prevDirY = 0;
  private _hasPrev = false;

  evaluate(input: PhysicsFieldInput): PhysicsFieldOutput {
    const { x, y, pressure, timestamp } = input;

    let vx = 0, vy = 0, rawVel = 0;
    if (this._hasPrev) {
      const dt = timestamp - this._prevTimestamp;
      if (dt > 0) {
        vx = (x - this._prevX) / dt;
        vy = (y - this._prevY) / dt;
        rawVel = Math.hypot(vx, vy);
      }
    }

    this._smoothedVelocity = this._hasPrev
      ? this._smoothedVelocity * (1 - VELOCITY_EMA) + rawVel * VELOCITY_EMA
      : rawVel;

    this._smoothedPressure = this._hasPrev
      ? this._smoothedPressure * (1 - PRESSURE_EMA) + pressure * PRESSURE_EMA
      : pressure;

    let dirX = 0, dirY = 0;
    if (this._smoothedVelocity > 0.001) {
      dirX = vx / this._smoothedVelocity;
      dirY = vy / this._smoothedVelocity;
    }
    if (this._hasPrev) {
      dirX = this._prevDirX * DIRECTION_EMA + dirX * (1 - DIRECTION_EMA);
      dirY = this._prevDirY * DIRECTION_EMA + dirY * (1 - DIRECTION_EMA);
      const len = Math.hypot(dirX, dirY);
      if (len > 0.001) { dirX /= len; dirY /= len; }
    }

    this._prevX = x;
    this._prevY = y;
    this._prevTimestamp = timestamp;
    this._prevDirX = dirX;
    this._prevDirY = dirY;
    this._hasPrev = true;

    return {
      velocity: this._smoothedVelocity,
      pressure: this._smoothedPressure,
      directionX: dirX,
      directionY: dirY,
    };
  }

  reset(): void {
    this._hasPrev = false;
    this._smoothedVelocity = 0;
    this._smoothedPressure = 0;
    this._prevDirX = 0;
    this._prevDirY = 0;
  }
}
