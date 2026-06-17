// ============================================================
//  GPU Shadow Mirror — GPUInkFieldShadowRenderer
//
//  职责：
//  ✔ WebGL2 offscreen canvas — instanced quad stamping
//  ✔ 输入: GPUStrokeBuffer[] (来自 StrokeToGPUEncoder)
//  ✔ 输出: offscreen WebGL2 canvas + render metrics
//  ✔ Stateless rebuild — 每帧从零构建，无累积状态
//
//  WebGL2 Pipeline:
//    ① Compile shaders (vertex + fragment)
//    ② Upload static quad geometry (4 corners)
//    ③ Per-frame: upload instance buffer → drawElementsInstanced
//    ④ Clear + blend
//
//  约束：
//  ❌ 不访问 main.ts / engine / session
//  ❌ 不修改 SVS snapshot
//  ❌ 不依赖 DOM 可见性
//  ✅ 可随时 create/destroy
// ============================================================

import type { GPUStrokeBuffer } from './StrokeToGPUEncoder';

// ============================================================
//  Types
// ============================================================

export interface GPURenderMetrics {
  /** 渲染的 stroke 数量 */
  strokeCount: number;
  /** 渲染的 stamp (instance) 数量 */
  stampCount: number;
  /** 上传到 GPU 的顶点数 */
  vertexCount: number;
  /** render() 总耗时 (ms) */
  renderTimeMs: number;
  /** GPU 上传耗时 (ms) */
  uploadTimeMs: number;
  /** GPU draw 耗时 (ms) */
  drawTimeMs: number;
  /** WebGL2 是否可用 */
  webgl2Available: boolean;
}

export interface GPURendererConfig {
  /** canvas 宽度 (px, 默认 1024) */
  width?: number;
  /** canvas 高度 (px, 默认 768) */
  height?: number;
  /** debug */
  debug?: boolean;
}

// ============================================================
//  Shaders
// ============================================================

const VERTEX_SHADER = `#version 300 es
precision highp float;

// Per-vertex: quad corner in local space (-1..1)
in vec2 a_corner;

// Per-instance attributes
in vec2 a_center;
in float a_radius;
in float a_pressure;
in float a_velocity;
in float a_time;
in vec3 a_color;

// Uniforms
uniform vec2 u_viewport;   // canvas width, height
uniform float u_dpr;

// Outputs
out float v_pressure;
out float v_velocity;
out float v_time;
out vec3 v_color;
out vec2 v_localCoord;

void main() {
    v_pressure = a_pressure;
    v_velocity = a_velocity;
    v_time = a_time;
    v_color = a_color;

    // Expand quad by radius
    float r = a_radius * u_dpr;
    vec2 offset = a_corner * r;

    // Center in NDC
    vec2 ndc = vec2(
        (a_center.x / u_viewport.x) * 2.0 - 1.0,
        1.0 - (a_center.y / u_viewport.y) * 2.0
    );

    // Offset in NDC
    ndc += vec2(
        offset.x / u_viewport.x * 2.0,
        -offset.y / u_viewport.y * 2.0
    );

    gl_Position = vec4(ndc, 0.0, 1.0);
    v_localCoord = a_corner;
}
`;

const FRAGMENT_SHADER = `#version 300 es
precision mediump float;

in float v_pressure;
in float v_velocity;
in float v_time;
in vec3 v_color;
in vec2 v_localCoord;

out vec4 fragColor;

void main() {
    // Distance from stamp center
    float d = length(v_localCoord);

    // Hard clip outside unit circle
    if (d > 1.0) discard;

    // Ink accumulation: pressure-driven opacity
    // Higher pressure → more opaque
    float alpha = v_pressure;

    // Velocity fade: faster → slightly more transparent
    //   velocity=0 → 1.0 (opaque)
    //   velocity=1 → 0.6 (semi-transparent)
    float velFade = 1.0 - v_velocity * 0.4;
    alpha *= velFade;

    // Time taper: start/end fade
    //   time=0 (start) → fade in
    //   time=1 (end)   → fade out
    float timeFade = smoothstep(0.0, 0.1, v_time) * smoothstep(0.0, 0.1, 1.0 - v_time);
    alpha *= max(0.3, timeFade);

    // Premultiplied alpha
    fragColor = vec4(v_color * alpha, alpha);
}
`;

// ============================================================
//  Constants
// ============================================================

const QUAD_VERTS = new Float32Array([-1,-1, 1,-1, -1,1, 1,1]);
const QUAD_INDICES = new Uint16Array([0,1,2, 1,3,2]);

const INSTANCE_STRIDE = 10; // 2+1+1+1+1+3 = 9 + 1 padding = 10 floats
const FLOAT_SIZE = 4;

const DEFAULT_CONFIG: Required<GPURendererConfig> = {
  width: 1024,
  height: 768,
  debug: false,
};

// ============================================================
//  GPUInkFieldShadowRenderer
// ============================================================

export class GPUInkFieldShadowRenderer {
  // ── WebGL2 ──
  private _gl: WebGL2RenderingContext | null = null;
  private _canvas: HTMLCanvasElement | null = null;
  private _program: WebGLProgram | null = null;
  private _vao: WebGLVertexArrayObject | null = null;
  private _quadVbo: WebGLBuffer | null = null;
  private _quadIbo: WebGLBuffer | null = null;
  private _instanceVbo: WebGLBuffer | null = null;

  // ── Uniforms ──
  private _uViewport: WebGLUniformLocation | null = null;
  private _uDpr: WebGLUniformLocation | null = null;

  // ── State ──
  private _available = false;
  private _enabled = false;
  private _config: Required<GPURendererConfig>;
  private _lastMetrics: GPURenderMetrics | null = null;
  private _totalFrames = 0;

  constructor(config: GPURendererConfig = {}) {
    this._config = { ...DEFAULT_CONFIG, ...config };
  }

  // ==========================================================
  //  Lifecycle
  // ==========================================================

  enable(): void {
    if (this._enabled) return;

    try {
      this._initWebGL();
      if (this._available) {
        this._enabled = true;
        if (this._config.debug) console.log('[GPUInkField] ✅ enabled');
      }
    } catch (err) {
      console.error('[GPUInkField] ❌ enable failed:', err);
      this._available = false;
      this._enabled = false;
    }
  }

  disable(): void {
    this._enabled = false;
    this._destroyWebGL();
    this._lastMetrics = null;
  }

  get enabled(): boolean { return this._enabled; }
  get available(): boolean { return this._available; }

  // ==========================================================
  //  render — 主渲染入口
  // ==========================================================

  /**
   * 将 GPUStrokeBuffer[] 渲染到 offscreen WebGL2 canvas。
   *
   * 每帧流程：
   * 1. Clear canvas
   * 2. For each GPUStrokeBuffer: flatten stamps → instance buffer
   * 3. bufferData upload
   * 4. drawElementsInstanced
   * 5. Return metrics
   *
   * @param buffers   编码后的 GPU stroke buffer 数组
   * @param viewportW canvas CSS 宽度
   * @param viewportH canvas CSS 高度
   * @returns         渲染指标
   */
  render(
    buffers: GPUStrokeBuffer[],
    viewportW?: number,
    viewportH?: number,
  ): GPURenderMetrics | null {
    if (!this._enabled || !this._gl || !this._canvas) return null;

    const t0 = performance.now();
    const gl = this._gl;

    const metrics: GPURenderMetrics = {
      strokeCount: 0,
      stampCount: 0,
      vertexCount: 0,
      renderTimeMs: 0,
      uploadTimeMs: 0,
      drawTimeMs: 0,
      webgl2Available: this._available,
    };

    try {
      const w = viewportW ?? this._config.width;
      const h = viewportH ?? this._config.height;

      // ── Resize ──
      if (this._canvas.width !== w || this._canvas.height !== h) {
        this._canvas.width = w;
        this._canvas.height = h;
        gl.viewport(0, 0, w, h);
      }

      // ── Count stamps ──
      let totalStamps = 0;
      for (const buf of buffers) {
        totalStamps += buf.meta.pointCount;
      }
      metrics.strokeCount = buffers.length;
      metrics.stampCount = totalStamps;

      if (totalStamps === 0) {
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        metrics.renderTimeMs = performance.now() - t0;
        this._lastMetrics = metrics;
        return metrics;
      }

      // ── Flatten stamps → instance buffer ──
      const tUpload0 = performance.now();
      const instanceData = new Float32Array(totalStamps * INSTANCE_STRIDE);
      let offset = 0;

      // Default brush radius = 4px (matching main.ts lineWidth ~2 * 2)
      const DEFAULT_RADIUS = 4;

      for (const buf of buffers) {
        const n = buf.meta.pointCount;
        const radius = buf.meta.brushSize * 0.5; // half width = radius
        const r = buf.meta.color[0];
        const g = buf.meta.color[1];
        const b = buf.meta.color[2];

        for (let i = 0; i < n; i++) {
          const base = offset;
          instanceData[base] = buf.positions[i * 2];       // center.x
          instanceData[base + 1] = buf.positions[i * 2 + 1]; // center.y
          instanceData[base + 2] = Math.max(1, radius);     // radius
          instanceData[base + 3] = buf.pressures[i];        // pressure
          instanceData[base + 4] = buf.velocities[i];       // velocity
          instanceData[base + 5] = buf.times[i];            // time
          instanceData[base + 6] = r;                       // color.r
          instanceData[base + 7] = g;                       // color.g
          instanceData[base + 8] = b;                       // color.b
          // base+9 = padding (unused)
          offset += INSTANCE_STRIDE;
        }
      }

      // ── Upload ──
      gl.bindBuffer(gl.ARRAY_BUFFER, this._instanceVbo);
      gl.bufferData(gl.ARRAY_BUFFER, instanceData, gl.DYNAMIC_DRAW);
      metrics.uploadTimeMs = performance.now() - tUpload0;

      // ── Uniforms ──
      gl.uniform2f(this._uViewport, w, h);
      gl.uniform1f(this._uDpr, 1); // shadow GPU = dpr 1

      // ── Clear ──
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);

      // ── Blend ──
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

      // ── Draw ──
      const tDraw0 = performance.now();
      gl.bindVertexArray(this._vao);
      gl.drawElementsInstanced(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0, totalStamps);
      gl.bindVertexArray(null);
      metrics.drawTimeMs = performance.now() - tDraw0;

      // ── Cleanup ──
      gl.disable(gl.BLEND);

      metrics.renderTimeMs = performance.now() - t0;
      this._lastMetrics = metrics;
      this._totalFrames++;

      return metrics;
    } catch (err) {
      if (this._config.debug) {
        console.error('[GPUInkField] ❌ render crashed:', err);
      }
      metrics.renderTimeMs = performance.now() - t0;
      this._lastMetrics = metrics;
      return metrics;
    }
  }

  // ==========================================================
  //  Query
  // ==========================================================

  getCanvas(): HTMLCanvasElement | null { return this._canvas; }
  get lastMetrics(): GPURenderMetrics | null { return this._lastMetrics; }
  get totalFrames(): number { return this._totalFrames; }

  /** Export GPU canvas as base64 PNG */
  toDataURL(): string | null {
    if (!this._canvas) return null;
    try { return this._canvas.toDataURL('image/png'); }
    catch { return null; }
  }

  // ==========================================================
  //  Private: WebGL2 Init
  // ==========================================================

  private _initWebGL(): void {
    this._canvas = document.createElement('canvas');
    this._canvas.style.display = 'none';
    this._canvas.width = this._config.width;
    this._canvas.height = this._config.height;

    const gl = this._canvas.getContext('webgl2', {
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      powerPreference: 'high-performance',
    });

    if (!gl) {
      console.warn('[GPUInkField] WebGL2 not available');
      this._available = false;
      return;
    }

    this._gl = gl;

    // Compile program
    const program = this._compileProgram(gl);
    if (!program) {
      this._available = false;
      return;
    }
    this._program = program;

    // Setup geometry
    this._setupGeometry(gl, program);

    this._available = true;
  }

  private _compileProgram(gl: WebGL2RenderingContext): WebGLProgram | null {
    const vs = this._compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
    const fs = this._compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
    if (!vs || !fs) return null;

    const program = gl.createProgram()!;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.warn('[GPUInkField] link failed:', gl.getProgramInfoLog(program));
      gl.deleteProgram(program);
      return null;
    }

    gl.useProgram(program);
    this._uViewport = gl.getUniformLocation(program, 'u_viewport');
    this._uDpr = gl.getUniformLocation(program, 'u_dpr');

    return program;
  }

  private _compileShader(
    gl: WebGL2RenderingContext, type: number, src: string,
  ): WebGLShader | null {
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, src);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.warn('[GPUInkField] shader compile:', gl.getShaderInfoLog(shader));
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  }

  private _setupGeometry(gl: WebGL2RenderingContext, program: WebGLProgram): void {
    // Static quad VBO
    const quadVbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, quadVbo);
    gl.bufferData(gl.ARRAY_BUFFER, QUAD_VERTS, gl.STATIC_DRAW);
    this._quadVbo = quadVbo;

    // Static index buffer
    const quadIbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, quadIbo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, QUAD_INDICES, gl.STATIC_DRAW);
    this._quadIbo = quadIbo;

    // Instance buffer
    const instVbo = gl.createBuffer()!;
    this._instanceVbo = instVbo;

    // VAO
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    this._vao = vao;

    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, quadIbo);

    // a_corner (per-vertex)
    gl.bindBuffer(gl.ARRAY_BUFFER, quadVbo);
    const cornerLoc = gl.getAttribLocation(program, 'a_corner');
    if (cornerLoc >= 0) {
      gl.enableVertexAttribArray(cornerLoc);
      gl.vertexAttribPointer(cornerLoc, 2, gl.FLOAT, false, 0, 0);
    }

    const STRIDE = INSTANCE_STRIDE * FLOAT_SIZE;
    gl.bindBuffer(gl.ARRAY_BUFFER, instVbo);

    this._bindInstanced(gl, program, 'a_center',   2, 0, STRIDE);
    this._bindInstanced(gl, program, 'a_radius',   1, 2 * FLOAT_SIZE, STRIDE);
    this._bindInstanced(gl, program, 'a_pressure', 1, 3 * FLOAT_SIZE, STRIDE);
    this._bindInstanced(gl, program, 'a_velocity', 1, 4 * FLOAT_SIZE, STRIDE);
    this._bindInstanced(gl, program, 'a_time',     1, 5 * FLOAT_SIZE, STRIDE);
    this._bindInstanced(gl, program, 'a_color',    3, 6 * FLOAT_SIZE, STRIDE);

    gl.bindVertexArray(null);
  }

  private _bindInstanced(
    gl: WebGL2RenderingContext,
    program: WebGLProgram,
    name: string,
    size: number,
    offset: number,
    stride: number,
  ): void {
    const loc = gl.getAttribLocation(program, name);
    if (loc >= 0) {
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, offset);
      gl.vertexAttribDivisor(loc, 1);
    }
  }

  private _destroyWebGL(): void {
    if (this._gl) {
      const gl = this._gl;
      if (this._program) gl.deleteProgram(this._program);
      if (this._vao) gl.deleteVertexArray(this._vao);
      if (this._quadVbo) gl.deleteBuffer(this._quadVbo);
      if (this._quadIbo) gl.deleteBuffer(this._quadIbo);
      if (this._instanceVbo) gl.deleteBuffer(this._instanceVbo);
      const ext = gl.getExtension('WEBGL_lose_context');
      if (ext) ext.loseContext();
    }
    this._gl = null;
    this._canvas = null;
    this._program = null;
    this._vao = null;
    this._quadVbo = null;
    this._quadIbo = null;
    this._instanceVbo = null;
    this._available = false;
  }
}

export default GPUInkFieldShadowRenderer;
