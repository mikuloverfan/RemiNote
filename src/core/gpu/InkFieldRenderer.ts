// ============================================================
//  Ink Field Renderer — CPU stroke → triangle mesh
// ============================================================

import LogManager from "../debug/LogManager";

const VERTEX_SRC = `#version 300 es
precision highp float;

in vec2 a_position;
uniform vec2 u_resolution;

void main() {
    vec2 clip = (a_position / u_resolution) * 2.0 - 1.0;
    clip.y = -clip.y;
    gl_Position = vec4(clip, 0.0, 1.0);
}
`;

const FRAGMENT_SRC = `#version 300 es
precision highp float;
out vec4 fragColor;

void main() {
    fragColor = vec4(0.0, 0.0, 0.0, 1.0);
}
`;

const HALF_WIDTH = 2.0;

export class InkFieldRenderer {
  private _gl: WebGL2RenderingContext | null = null;
  private _canvas: HTMLCanvasElement | null = null;
  private _program: WebGLProgram | null = null;
  private _vao: WebGLVertexArrayObject | null = null;
  private _vbo: WebGLBuffer | null = null;
  private _available = false;
  private _uResolutionLoc: WebGLUniformLocation | null = null;

  constructor() {
    LogManager.debug("lifecycle", "InkFieldRenderer constructor — start");
    this._init();
    LogManager.debug("lifecycle", "InkFieldRenderer constructor — done", { available: this._available });
  }

  get isAvailable(): boolean { return this._available; }
  get canvas(): HTMLCanvasElement | null { return this._canvas; }

  private buildStrokeMesh(points: Array<{ x: number; y: number }>, halfWidth: number): Float32Array {
    const n = points.length;
    if (n < 2) return new Float32Array(0);
    const verts = new Float32Array((n - 1) * 6 * 2);
    let vi = 0;
    for (let i = 0; i < n - 1; i++) {
      const p0 = points[i], p1 = points[i + 1];
      const dx = p1.x - p0.x, dy = p1.y - p0.y;
      const len = Math.hypot(dx, dy);
      if (len < 0.001) continue;
      const nx = -dy / len * halfWidth, ny = dx / len * halfWidth;
      const x0 = p0.x - nx, y0 = p0.y - ny;
      const x1 = p0.x + nx, y1 = p0.y + ny;
      const x2 = p1.x - nx, y2 = p1.y - ny;
      const x3 = p1.x + nx, y3 = p1.y + ny;
      verts[vi++] = x0; verts[vi++] = y0;
      verts[vi++] = x1; verts[vi++] = y1;
      verts[vi++] = x2; verts[vi++] = y2;
      verts[vi++] = x1; verts[vi++] = y1;
      verts[vi++] = x3; verts[vi++] = y3;
      verts[vi++] = x2; verts[vi++] = y2;
    }
    return verts.slice(0, vi);
  }

  draw(
    strokes: Array<{ points: Array<{ x: number; y: number; pressure?: number }>; color: string }>,
    camera: { x: number; y: number; zoom: number },
    cssW: number, cssH: number, dpr: number,
    bufW?: number, bufH?: number,
  ): void {
    LogManager.debug("pipeline", "draw reached", strokes?.length);

    if (!this._available || !this._gl || !this._canvas) return;
    const gl = this._gl;

    const targetW = bufW ?? cssW * dpr;
    const targetH = bufH ?? cssH * dpr;
    if (this._canvas.width !== targetW || this._canvas.height !== targetH) {
      this._canvas.width = targetW;
      this._canvas.height = targetH;
      gl.viewport(0, 0, targetW, targetH);
    }

    const sx = dpr * camera.zoom, sy = dpr * camera.zoom;
    const tx = camera.x * dpr, ty = camera.y * dpr;

    let totalVerts = 0;
    for (const s of strokes) {
      if (s.points.length >= 2) totalVerts += (s.points.length - 1) * 6 * 2;
    }

    if (totalVerts === 0) {
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      return;
    }

    const combined = new Float32Array(totalVerts);
    let offset = 0;
    for (const s of strokes) {
      if (s.points.length < 2) continue;
      const pixelPts = s.points.map(p => ({ x: p.x * sx + tx, y: p.y * sy + ty }));
      const mesh = this.buildStrokeMesh(pixelPts, HALF_WIDTH);
      combined.set(mesh, offset);
      offset += mesh.length;
    }

    const vertexCount = offset / 2;

    LogManager.debug("pipeline", "useProgram about to run");
    gl.useProgram(this._program);

    if (this._uResolutionLoc) gl.uniform2f(this._uResolutionLoc, targetW, targetH);

    gl.bindBuffer(gl.ARRAY_BUFFER, this._vbo);
    gl.bufferData(gl.ARRAY_BUFFER, combined.subarray(0, offset), gl.DYNAMIC_DRAW);

    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindVertexArray(this._vao);
    gl.drawArrays(gl.TRIANGLES, 0, vertexCount);
    gl.bindVertexArray(null);

    LogManager.info("render", "triangle mesh drawn", {
      strokeCount: strokes.length,
      vertexCount,
      totalTriangles: vertexCount / 3,
    });
  }

  resize(cssW: number, cssH: number, dpr: number): void {
    if (!this._canvas || !this._gl) return;
    this._canvas.width = cssW * dpr;
    this._canvas.height = cssH * dpr;
    this._gl.viewport(0, 0, this._canvas.width, this._canvas.height);
  }

  destroy(): void {
    if (this._gl) {
      const gl = this._gl;
      if (this._program) gl.deleteProgram(this._program);
      if (this._vao) gl.deleteVertexArray(this._vao);
      if (this._vbo) gl.deleteBuffer(this._vbo);
      const ext = gl.getExtension('WEBGL_lose_context');
      if (ext) ext.loseContext();
    }
    this._gl = null; this._canvas = null; this._program = null;
    this._vao = null; this._vbo = null;
    this._available = false;
  }

  private _init(): void {
    LogManager.debug("lifecycle", "_init() — start");
    try {
      this._canvas = document.createElement('canvas');
      this._canvas.width = 1; this._canvas.height = 1;
      const gl = this._canvas.getContext('webgl2', {
        alpha: true, premultipliedAlpha: true, antialias: false, powerPreference: 'high-performance',
      });
      if (!gl) { LogManager.error("inkfield", "WebGL2 not available"); return; }
      this._gl = gl;

      const program = this._compileProgram(gl);
      if (!program) { LogManager.error("inkfield", "Shader compilation failed"); return; }
      this._program = program;

      this._setupGeometry(gl, program);
      this._available = true;
      LogManager.debug("lifecycle", "_init complete");
    } catch (e) { LogManager.error("inkfield", "_init EXCEPTION:", e); this._available = false; }
  }

  private _compileProgram(gl: WebGL2RenderingContext): WebGLProgram | null {
    const vs = this._compileShader(gl, gl.VERTEX_SHADER, VERTEX_SRC);
    const fs = this._compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SRC);
    if (!vs || !fs) return null;
    const program = gl.createProgram()!;
    gl.attachShader(program, vs); gl.attachShader(program, fs); gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      LogManager.error("inkfield", "Link failed:", gl.getProgramInfoLog(program));
      gl.deleteProgram(program); return null;
    }
    gl.useProgram(program);
    this._uResolutionLoc = gl.getUniformLocation(program, 'u_resolution');
    return program;
  }

  private _compileShader(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader | null {
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, src); gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      LogManager.error("inkfield", "Shader compile error:", gl.getShaderInfoLog(shader));
      gl.deleteShader(shader); return null;
    }
    return shader;
  }

  private _setupGeometry(gl: WebGL2RenderingContext, program: WebGLProgram): void {
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    this._vao = vao;
    const vbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    this._vbo = vbo;
    const loc = gl.getAttribLocation(program, 'a_position');
    if (loc < 0) { LogManager.error("inkfield", "FATAL: a_position not found"); return; }
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
  }
}

export const inkFieldRenderer = new InkFieldRenderer();
