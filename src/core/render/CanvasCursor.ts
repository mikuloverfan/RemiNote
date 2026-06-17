// CanvasCursor — DOM-free cursor rendered on canvas context
// Drawn by Renderer in the same frame as strokes for perfect sync.
export interface CanvasCursorState {
  x: number; y: number;    // world coords
  visible: boolean;
  radius: number;          // world-space radius
  tool: 'pen' | 'eraser' | 'hand';
}

const PEN_COLOR = 'rgba(0,0,0,0.85)';
const ERASER_COLOR = 'rgba(180,180,180,0.5)';

export function drawCursor(
  ctx: CanvasRenderingContext2D,
  state: CanvasCursorState,
): void {
  if (!state.visible) return;

  ctx.save();
  ctx.beginPath();
  ctx.arc(state.x, state.y, state.radius, 0, Math.PI * 2);

  switch (state.tool) {
    case 'pen':
      ctx.strokeStyle = PEN_COLOR;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      break;
    case 'eraser':
      ctx.fillStyle = ERASER_COLOR;
      ctx.fill();
      ctx.strokeStyle = 'rgba(128,128,128,0.5)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      break;
    case 'hand':
      ctx.fillStyle = 'rgba(0,0,0,0.15)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.5)';
      ctx.lineWidth = 2;
      ctx.stroke();
      break;
  }
  ctx.restore();
}
