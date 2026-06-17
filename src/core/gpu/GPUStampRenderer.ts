// ============================================================
//  Phase 5.6: GPU Instanced Stamp Renderer
//
//  核心原则�?
//  🎯 GPU 成为唯一视觉输出 �?CPU 不再�?stamp draw
//
//  数据流：
//    RenderCommandStream �?BrushKernel.evaluate() �?GPU buffer �?draw
//
//  架构�?
//    �?WebGL2 instanced rendering（offscreen canvas �?composite�?
//    �?CPU path 降级�?fallback
//    �?Camera transform �?vertex shader 中应�?
//    �?Buffer batch upload（单�?upload，减�?CPU↔GPU 同步成本�?
//
//  约束�?
//  �?不修改现�?Canvas 2D 上下�?
//  �?CPU fallback 完整保留
//  �?WebGL2 不可用时自动降级�?CPU
// ============================================================

// ============================================================
//  Types
// ============================================================

/** GPU stamp 输入 — 每个 stamp 在 GPU buffer 中的布局 */
export interface GPUStamp {
  x: number;
  y: number;
  radius: number;
  opacity: number;
  /** Unpacked RGBA: [r, g, b, a] in 0~1 range */
  colorR: number;
  colorG: number;
  colorB: number;
  /** Edge hardness 0~1 (0=soft feather, 1=crisp edge) */
  hardness: number;
}

/** Camera state for vertex shader transform */
export interface GPUCameraState {
  x: number;
  y: number;
  zoom: number;
  cssW: number;
  cssH: number;
  dpr: number;
}

// ============================================================
//  Constants
// ============================================================

/** GPU buffer stride: [x, y, radius, opacity, r, g, b, hardness] = 8 floats */
const GPU_STRIDE = 8;

/** 最�?instance 数量（WebGL2 安全上限�?*/
const MAX_INSTANCES = 65536;

// ============================================================
//  Shaders
// ============================================================

// ============================================================
//  Quad Splat Shaders �?replaces gl.POINTS point sprites
//  Each stamp = instanced quad (2 triangles) �?true continuous coverage
// ============================================================

const VERTEX_SHADER_SRC = `#version 300 es
precision highp float;

// Per-vertex: quad corner in local space (-1..1)
in vec2 a_corner;

// Per-instance attributes
in vec2 a_position;
in float a_radius;
in float a_opacity;
in vec3 a_color;
in float a_hardness;

// Camera uniforms
uniform vec2 u_camera;
uniform float u_zoom;
uniform vec2 u_viewport;
uniform float u_dpr;

// Output to fragment shader
out float v_opacity;
out vec3 v_color;
out vec2 v_localCoord;
out float v_hardness;

void main() {
    v_opacity = a_opacity;
    v_color = a_color;
    v_hardness = a_hardness;

    // World → screen position (center of stamp)
    float sx = a_position.x * u_zoom + u_camera.x;
    float sy = a_position.y * u_zoom + u_camera.y;

    // Expand quad by radius in screen pixels
    float r = a_radius * u_zoom * u_dpr;
    vec2 offset = a_corner * r;

    // Screen position + corner offset → NDC
    gl_Position = vec4(
        ((sx + offset.x) / u_viewport.x) * 2.0 - 1.0,
        1.0 - ((sy + offset.y) / u_viewport.y) * 2.0,
        0.0,
        1.0
    );

    // Local coordinate for fragment shader: (0,0)=center, (±1,±1)=corners
    v_localCoord = a_corner;
}
`;

const FRAGMENT_SHADER_SRC = `#version 300 es
precision mediump float;

in float v_opacity;
in vec3 v_color;
in vec2 v_localCoord;
in float v_hardness;

out vec4 fragColor;

void main() {
    // Distance from stamp center: 0 at center, 1 at edge, >1 outside
    float d = length(v_localCoord);

    // Hard clip outside unit circle
    if (d > 1.0) discard;

    // ⭐ PS-style hardness curve with smoothstep feather
    // hardness=0 → soft brush, feather from center to edge
    // hardness=1 → hard brush, only thin feather at outer rim
    float core = v_hardness * 0.85;        // fully opaque core radius (0..0.85)
    float feather = 1.0 - core;            // transition zone width
    float alpha = 1.0 - smoothstep(core, core + feather, d);
    alpha *= v_opacity;

    // Premultiplied alpha for correct compositing
    fragColor = vec4(v_color * alpha, alpha);
}
`;

// ============================================================
//  Stroke Ribbon Shaders �?continuous ink mesh (not points)
// ============================================================

const STROKE_VERTEX_SRC = `#version 300 es
precision highp float;
in vec2 a_pos;
in float a_radius;
in float a_opacity;
in vec3 a_color;
uniform vec2 u_camera;
uniform float u_zoom;
uniform vec2 u_viewport;
uniform float u_dpr;
out float v_opacity;
out vec3 v_color;
out float v_radius;
void main() {
    v_opacity = a_opacity;
    v_color = a_color;
    v_radius = a_radius;
    float sx = a_pos.x * u_zoom + u_camera.x;
    float sy = a_pos.y * u_zoom + u_camera.y;
    gl_Position = vec4((sx / u_viewport.x) * 2.0 - 1.0, 1.0 - (sy / u_viewport.y) * 2.0, 0.0, 1.0);
}
`;

const STROKE_FRAG_SRC = `#version 300 es
precision mediump float;
in float v_opacity;
in vec3 v_color;
in float v_radius;
out vec4 fragColor;
void main() {
    float alpha = smoothstep(v_radius * u_dpr * u_zoom, 0.0, length(gl_FragCoord.xy - vec2(0.0)));
    fragColor = vec4(v_color, v_opacity);
}
`;

// ============================================================
//  GPUStampRenderer
// ============================================================

export class GPUStampRenderer {
  private _gl: WebGL2RenderingContext | null = null;
  private _canvas: HTMLCanvasElement | null = null;
  private _program: WebGLProgram | null = null;
  private _vao: WebGLVertexArrayObject | null = null;
  private _instanceBuffer: WebGLBuffer | null = null;

  // Quad splat geometry (replaces gl.POINTS auto-generated vertices)
  private _quadVbo: WebGLBuffer | null = null;
  private _quadIbo: WebGLBuffer | null = null;

  private _available = false;
  private _capacity: number;

  // Uniform locations
  private _uCameraLoc: WebGLUniformLocation | null = null;
  private _uZoomLoc: WebGLUniformLocation | null = null;
  private _uViewportLoc: WebGLUniformLocation | null = null;
  private _uDprLoc: WebGLUniformLocation | null = null;

  // CPU-side buffer
  private _cpuBuffer: Float32Array;

  constructor(capacity: number = MAX_INSTANCES) {
    this._capacity = Math.min(capacity, MAX_INSTANCES);
    this._cpuBuffer = new Float32Array(this._capacity * GPU_STRIDE);
    this._init();
  }

  // ==========================================================
  //  Public API
  // ==========================================================

  /** 检�?WebGL2 是否可用 */
  get isAvailable(): boolean {
    return this._available;
  }

  /** 获取 offscreen canvas（用�?compositing�?*/
  get canvas(): HTMLCanvasElement | null {
    return this._canvas;
  }

  /**
   * 上传 stamps �?GPU 并渲染�?
   *
   * @param stamps   GPU stamp 数组
   * @param camera   当前相机状�?
   * @param cssW     viewport CSS 宽度
   * @param cssH     viewport CSS 高度
   * @param dpr      devicePixelRatio
   */
  draw(
    stamps: readonly GPUStamp[],
    camera: GPUCameraState,
    cssW: number,
    cssH: number,
    dpr: number,
    bufW?: number,
    bufH?: number,
  ): void {
    if (!this._available || !this._gl || !this._canvas) return;

    const gl = this._gl;
    const count = Math.min(stamps.length, this._capacity);

    if (count === 0) return;

    // Resize GPU canvas to match main canvas buffer exactly (1:1 pixel copy)
    const targetW = bufW ?? cssW * dpr;
    const targetH = bufH ?? cssH * dpr;
    if (this._canvas.width !== targetW || this._canvas.height !== targetH) {
      this._canvas.width = targetW;
      this._canvas.height = targetH;
      gl.viewport(0, 0, this._canvas.width, this._canvas.height);
    }

    // ── Upload stamps to GPU buffer ──
    for (let i = 0; i < count; i++) {
      const s = stamps[i];
      const base = i * GPU_STRIDE;
      this._cpuBuffer[base] = s.x;
      this._cpuBuffer[base + 1] = s.y;
      this._cpuBuffer[base + 2] = s.radius;
      this._cpuBuffer[base + 3] = s.opacity;
      this._cpuBuffer[base + 4] = s.colorR;
      this._cpuBuffer[base + 5] = s.colorG;
      this._cpuBuffer[base + 6] = s.colorB;
      this._cpuBuffer[base + 7] = s.hardness;
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, this._instanceBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this._cpuBuffer, gl.DYNAMIC_DRAW, 0, count * GPU_STRIDE);

    // ── Set uniforms ──
    gl.uniform2f(this._uCameraLoc, camera.x, camera.y);
    gl.uniform1f(this._uZoomLoc, camera.zoom);
    gl.uniform2f(this._uViewportLoc, cssW, cssH);
    gl.uniform1f(this._uDprLoc, dpr);

    // ── Clear ──
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    // ── Enable blending (premultiplied alpha) ──
    //   ONE, ONE_MINUS_SRC_ALPHA = correct premultiplied blend
    //   Overlapping ink �?darker accumulation (not additive glow)
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    // ── Draw instanced quads (2 triangles per stamp) ──
    gl.bindVertexArray(this._vao);
    gl.drawElementsInstanced(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0, count);

    // ── Cleanup ──
    gl.bindVertexArray(null);
    gl.disable(gl.BLEND);
  }

  /**
   * 调整渲染目标大小�?
   */
  resize(cssW: number, cssH: number, dpr: number): void {
    if (!this._canvas || !this._gl) return;
    this._canvas.width = cssW * dpr;
    this._canvas.height = cssH * dpr;
    this._gl.viewport(0, 0, this._canvas.width, this._canvas.height);
  }

  /**
   * 销�?GPU 资源�?
   */
  destroy(): void {
    if (this._gl) {
      const gl = this._gl;
      if (this._program) gl.deleteProgram(this._program);
      if (this._vao) gl.deleteVertexArray(this._vao);
      if (this._instanceBuffer) gl.deleteBuffer(this._instanceBuffer);
      if (this._quadVbo) gl.deleteBuffer(this._quadVbo);
      if (this._quadIbo) gl.deleteBuffer(this._quadIbo);
      const ext = gl.getExtension('WEBGL_lose_context');
      if (ext) ext.loseContext();
    }
    this._gl = null;
    this._canvas = null;
    this._program = null;
    this._vao = null;
    this._instanceBuffer = null;
    this._quadVbo = null;
    this._quadIbo = null;
    this._available = false;
  }

  // ==========================================================
  //  Private: Init
  // ==========================================================

  private _init(): void {
    try {
      // Create offscreen canvas
      this._canvas = document.createElement('canvas');
      this._canvas.width = 1;
      this._canvas.height = 1;

      // Request WebGL2 context
      const gl = this._canvas.getContext('webgl2', {
        alpha: true,
        premultipliedAlpha: true,
        antialias: false,
        powerPreference: 'high-performance',
      });

      if (!gl) {
        LogManager.warn("workspace", '[GPU] WebGL2 not available �?using CPU fallback');
        this._available = false;
        return;
      }

      this._gl = gl;

      // Compile shaders
      const program = this._compileProgram(gl);
      if (!program) {
        LogManager.warn("workspace", '[GPU] Shader compilation failed �?using CPU fallback');
        this._available = false;
        return;
      }
      this._program = program;

      // Setup VAO + instance buffer
      this._setupGeometry(gl, program);

      this._available = true;
      LogManager.log("workspace", '[GPU] WebGL2 instanced renderer initialized');
    } catch (e) {
      LogManager.warn("workspace", '[GPU] Initialization failed �?using CPU fallback:', e);
      this._available = false;
    }
  }

  private _compileProgram(gl: WebGL2RenderingContext): WebGLProgram | null {
    const vs = this._compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER_SRC);
    const fs = this._compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER_SRC);
    if (!vs || !fs) return null;

    const program = gl.createProgram();
    if (!program) return null;

    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      LogManager.warn("workspace", '[GPU] Program link failed:', gl.getProgramInfoLog(program));
      gl.deleteProgram(program);
      return null;
    }

    gl.useProgram(program);

    // Cache uniform locations
    this._uCameraLoc = gl.getUniformLocation(program, 'u_camera');
    this._uZoomLoc = gl.getUniformLocation(program, 'u_zoom');
    this._uViewportLoc = gl.getUniformLocation(program, 'u_viewport');
    this._uDprLoc = gl.getUniformLocation(program, 'u_dpr');

    return program;
  }

  private _compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader | null {
    const shader = gl.createShader(type);
    if (!shader) return null;

    gl.shaderSource(shader, source);
    gl.compileShader(shader);

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const typeName = type === gl.VERTEX_SHADER ? 'vertex' : 'fragment';
      LogManager.warn("workspace", `[GPU] ${typeName} shader compile failed:`, gl.getShaderInfoLog(shader));
      gl.deleteShader(shader);
      return null;
    }

    return shader;
  }

  private _setupGeometry(gl: WebGL2RenderingContext, program: WebGLProgram): void {
    const FLOAT_SIZE = 4;
    const INSTANCE_STRIDE = GPU_STRIDE * FLOAT_SIZE; // 32 bytes per instance

    // ── 1. Static quad vertex buffer (4 corners, shared across all instances) ──
    const quadVbo = gl.createBuffer();
    if (!quadVbo) return;
    this._quadVbo = quadVbo;

    // Quad corners in local space: (-1,-1) (1,-1) (-1,1) (1,1)
    const quadVerts = new Float32Array([
      -1, -1,   // bottom-left
       1, -1,   // bottom-right
      -1,  1,   // top-left
       1,  1,   // top-right
    ]);
    gl.bindBuffer(gl.ARRAY_BUFFER, quadVbo);
    gl.bufferData(gl.ARRAY_BUFFER, quadVerts, gl.STATIC_DRAW);

    // ── 2. Static index buffer (2 triangles = 6 indices) ──
    const quadIbo = gl.createBuffer();
    if (!quadIbo) return;
    this._quadIbo = quadIbo;

    const indices = new Uint16Array([0, 1, 2, 1, 3, 2]);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, quadIbo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);

    // ── 3. Instance buffer (per-stamp: x,y,radius,opacity,r,g,b,hardness) ──
    const instBuf = gl.createBuffer();
    if (!instBuf) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, instBuf);
    this._instanceBuffer = instBuf;

    // ── 4. Create VAO and bind all attributes ──
    const vao = gl.createVertexArray();
    if (!vao) return;
    gl.bindVertexArray(vao);
    this._vao = vao;

    // Bind index buffer to VAO
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, quadIbo);

    // ── Vertex attribute 0: a_corner (vec2, per-vertex, divisor=0) ──
    gl.bindBuffer(gl.ARRAY_BUFFER, quadVbo);
    const cornerLoc = gl.getAttribLocation(program, 'a_corner');
    if (cornerLoc >= 0) {
      gl.enableVertexAttribArray(cornerLoc);
      gl.vertexAttribPointer(cornerLoc, 2, gl.FLOAT, false, 0, 0);
    }

    // ── Instance attributes (per-stamp, divisor=1) ──
    gl.bindBuffer(gl.ARRAY_BUFFER, instBuf);

    // a_position: offset 0, 2 floats
    const posLoc = gl.getAttribLocation(program, 'a_position');
    if (posLoc >= 0) {
      gl.enableVertexAttribArray(posLoc);
      gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, INSTANCE_STRIDE, 0);
      gl.vertexAttribDivisor(posLoc, 1);
    }

    // a_radius: offset 2, 1 float
    const radLoc = gl.getAttribLocation(program, 'a_radius');
    if (radLoc >= 0) {
      gl.enableVertexAttribArray(radLoc);
      gl.vertexAttribPointer(radLoc, 1, gl.FLOAT, false, INSTANCE_STRIDE, 2 * FLOAT_SIZE);
      gl.vertexAttribDivisor(radLoc, 1);
    }

    // a_opacity: offset 3, 1 float
    const opLoc = gl.getAttribLocation(program, 'a_opacity');
    if (opLoc >= 0) {
      gl.enableVertexAttribArray(opLoc);
      gl.vertexAttribPointer(opLoc, 1, gl.FLOAT, false, INSTANCE_STRIDE, 3 * FLOAT_SIZE);
      gl.vertexAttribDivisor(opLoc, 1);
    }

    // a_color: offset 4, 3 floats
    const colLoc = gl.getAttribLocation(program, 'a_color');
    if (colLoc >= 0) {
      gl.enableVertexAttribArray(colLoc);
      gl.vertexAttribPointer(colLoc, 3, gl.FLOAT, false, INSTANCE_STRIDE, 4 * FLOAT_SIZE);
      gl.vertexAttribDivisor(colLoc, 1);
    }

    // a_hardness: offset 7, 1 float
    const hardLoc = gl.getAttribLocation(program, 'a_hardness');
    if (hardLoc >= 0) {
      gl.enableVertexAttribArray(hardLoc);
      gl.vertexAttribPointer(hardLoc, 1, gl.FLOAT, false, INSTANCE_STRIDE, 7 * FLOAT_SIZE);
      gl.vertexAttribDivisor(hardLoc, 1);
    }

    // Unbind
    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);
  }
}

/** 全局单例 �?GPU stamp renderer */
export const gpuStampRenderer = new GPUStampRenderer();

// ============================================================
//  Helpers
// ============================================================

/**
 * 解包 packed RGBA color �?[r, g, b] in 0~1 range.
 * Packed format: 0xRRGGBBAA �?[R/255, G/255, B/255]
 */
export function unpackColorForGPU(packed: number): { r: number; g: number; b: number } {
  return {
    r: ((packed >>> 24) & 0xFF) / 255,
    g: ((packed >>> 16) & 0xFF) / 255,
    b: ((packed >>> 8) & 0xFF) / 255,
  };
}
