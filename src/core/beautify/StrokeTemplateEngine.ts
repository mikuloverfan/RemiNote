// ============================================================
//  Stroke Template Engine — 笔画模板匹配 + 结构修正
//
//  核心机制：
//  1. 从字体渲染中提取每个字的笔画模板（位置+方向）
//  2. 将手写笔画匹配到模板笔画
//  3. 计算偏移量 → 重定位笔画到正确位置
//
//  解决"个"问题：竖画偏右 → 模板说竖在中间 → 自动修正
// ============================================================

// ============================================================
//  Types
// ============================================================

export interface StrokeTemplate {
  /** Normalized centroid X (0-1 within character bbox) */
  cx: number;
  /** Normalized centroid Y (0-1 within character bbox) */
  cy: number;
  /** Dominant angle in radians */
  angle: number;
  /** Normalized width */
  nw: number;
  /** Normalized height */
  nh: number;
}

export interface CharacterTemplate {
  char: string;
  strokes: StrokeTemplate[];
}

// ============================================================
//  Template Generation from Font Rendering
// ============================================================

/**
 * Generate a stroke template for a character by rendering it with a font
 * and extracting stroke positions from the rendered glyph.
 */
export function generateTemplate(
  char: string,
  fontFamily: string,
): CharacterTemplate | null {
  const size = 200;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  // Render character with strokeText for outline
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 3;
  ctx.font = `${size * 0.7}px ${fontFamily}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.strokeText(char, size / 2, size / 2);

  // Get pixel data
  const imageData = ctx.getImageData(0, 0, size, size);
  const { data } = imageData;

  // Find glyph bounds
  let minX = size, minY = size, maxX = 0, maxY = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (data[(y * size + x) * 4] < 200) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (minX > maxX) return null;
  const bw = maxX - minX || 1;
  const bh = maxY - minY || 1;

  // Extract connected components (strokes) using flood fill on dark pixels
  const visited = new Uint8Array(size * size);
  const strokes: Array<{ px: number[]; py: number[] }> = [];

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const idx = y * size + x;
      if (!visited[idx] && data[idx * 4] < 200) {
        // Flood fill
        const px: number[] = [];
        const py: number[] = [];
        const stack: [number, number][] = [[x, y]];
        visited[idx] = 1;

        while (stack.length > 0) {
          const [cx, cy] = stack.pop()!;
          px.push(cx);
          py.push(cy);

          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const nx = cx + dx, ny = cy + dy;
            if (nx >= minX && nx <= maxX && ny >= minY && ny <= maxY) {
              const nidx = ny * size + nx;
              if (!visited[nidx] && data[nidx * 4] < 200) {
                visited[nidx] = 1;
                stack.push([nx, ny]);
              }
            }
          }
        }

        if (px.length > 5) {
          strokes.push({ px, py });
        }
      }
    }
  }

  // Convert each stroke to a template entry
  const templates: StrokeTemplate[] = [];
  for (const s of strokes) {
    const n = s.px.length;
    let sx = 0, sy = 0;
    for (let i = 0; i < n; i++) { sx += s.px[i]; sy += s.py[i]; }
    const cx = ((sx / n) - minX) / bw;
    const cy = ((sy / n) - minY) / bh;

    // Dominant angle via PCA
    let cXX = 0, cXY = 0, cYY = 0;
    const mx = sx / n, my = sy / n;
    for (let i = 0; i < n; i++) {
      const dx = s.px[i] - mx, dy = s.py[i] - my;
      cXX += dx * dx; cXY += dx * dy; cYY += dy * dy;
    }
    const angle = 0.5 * Math.atan2(2 * cXY, cXX - cYY);

    // Bbox
    let sminX = Infinity, sminY = Infinity, smaxX = -Infinity, smaxY = -Infinity;
    for (let i = 0; i < n; i++) {
      if (s.px[i] < sminX) sminX = s.px[i];
      if (s.py[i] < sminY) sminY = s.py[i];
      if (s.px[i] > smaxX) smaxX = s.px[i];
      if (s.py[i] > smaxY) smaxY = s.py[i];
    }

    templates.push({
      cx: Math.max(0, Math.min(1, cx)),
      cy: Math.max(0, Math.min(1, cy)),
      angle,
      nw: (smaxX - sminX) / bw,
      nh: (smaxY - sminY) / bh,
    });
  }

  // Sort by cx for consistent matching
  templates.sort((a, b) => a.cx - b.cx || a.cy - b.cy);

  return { char, strokes: templates };
}

// ============================================================
//  Template Database
// ============================================================

const templateDB = new Map<string, CharacterTemplate>();

export function getTemplate(char: string, fontFamily: string): CharacterTemplate | undefined {
  const key = `${char}|${fontFamily}`;
  let cached = templateDB.get(key);
  if (!cached) {
    const gen = generateTemplate(char, fontFamily);
    if (gen) {
      templateDB.set(key, gen);
      return gen;
    }
    return undefined;
  }
  return cached;
}

// ============================================================
//  Handwriting Feature Extraction
// ============================================================

export interface HandwritingStroke {
  cx: number;    // Normalized centroid X (0-1)
  cy: number;    // Normalized centroid Y (0-1)
  angle: number; // Dominant angle
  nw: number;    // Normalized width
  nh: number;    // Normalized height
  /** Index of this stroke in the original strokes array */
  index: number;
}

export function extractHandwritingFeatures(
  strokes: Array<{ points: { x: number; y: number }[] }>,
): HandwritingStroke[] {
  // Compute overall bbox
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const s of strokes) {
    for (const p of s.points) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  }
  const bw = maxX - minX || 1;
  const bh = maxY - minY || 1;

  const features: HandwritingStroke[] = [];

  for (let si = 0; si < strokes.length; si++) {
    const s = strokes[si];
    if (s.points.length < 2) continue;

    const n = s.points.length;
    let sx = 0, sy = 0;
    for (const p of s.points) { sx += p.x; sy += p.y; }
    const cx = ((sx / n) - minX) / bw;
    const cy = ((sy / n) - minY) / bh;

    // Dominant angle
    const mx = sx / n, my = sy / n;
    let cXX = 0, cXY = 0, cYY = 0;
    for (const p of s.points) {
      const dx = p.x - mx, dy = p.y - my;
      cXX += dx * dx; cXY += dx * dy; cYY += dy * dy;
    }
    const angle = 0.5 * Math.atan2(2 * cXY, cXX - cYY);

    // Stroke bbox
    let sminX = Infinity, sminY = Infinity, smaxX = -Infinity, smaxY = -Infinity;
    for (const p of s.points) {
      if (p.x < sminX) sminX = p.x;
      if (p.y < sminY) sminY = p.y;
      if (p.x > smaxX) smaxX = p.x;
      if (p.y > smaxY) smaxY = p.y;
    }

    features.push({
      cx: Math.max(0, Math.min(1, cx)),
      cy: Math.max(0, Math.min(1, cy)),
      angle,
      nw: (smaxX - sminX) / bw,
      nh: (smaxY - sminY) / bh,
      index: si,
    });
  }

  // Sort for consistent matching
  features.sort((a, b) => a.cx - b.cx || a.cy - b.cy);

  return features;
}

// ============================================================
//  Stroke Matching + Repositioning
// ============================================================

export interface StrokeCorrection {
  /** Index of the stroke in the original array */
  strokeIndex: number;
  /** Translation to apply (in world coordinates) */
  dx: number;
  dy: number;
}

/**
 * Match handwritten strokes to template strokes and compute corrections.
 * Returns repositioning instructions for each stroke.
 */
export function computeCorrections(
  hwStrokes: Array<{ points: { x: number; y: number }[] }>,
  template: CharacterTemplate,
): StrokeCorrection[] {
  const hwFeatures = extractHandwritingFeatures(hwStrokes);
  const tmplStrokes = template.strokes;

  // Compute overall bbox for scale
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const s of hwStrokes) {
    for (const p of s.points) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  }
  const bw = maxX - minX || 1;
  const bh = maxY - minY || 1;

  const corrections: StrokeCorrection[] = [];

  // Greedy match: pair closest hw stroke to template stroke
  const used = new Set<number>();

  for (const tmpl of tmplStrokes) {
    let bestIdx = -1;
    let bestDist = Infinity;

    for (let i = 0; i < hwFeatures.length; i++) {
      if (used.has(i)) continue;
      const hw = hwFeatures[i];
      // Distance in normalized space
      const d = Math.hypot(hw.cx - tmpl.cx, hw.cy - tmpl.cy);
      // Angle similarity bonus
      const angleDiff = Math.abs(hw.angle - tmpl.angle);
      const circDiff = Math.min(angleDiff, Math.PI - angleDiff);
      const weightedDist = d + circDiff * 0.3;

      if (weightedDist < bestDist) {
        bestDist = weightedDist;
        bestIdx = i;
      }
    }

    if (bestIdx >= 0) {
      used.add(bestIdx);
      const hw = hwFeatures[bestIdx];

      // Compute world-space offset
      const targetX = minX + tmpl.cx * bw;
      const targetY = minY + tmpl.cy * bh;
      const currentX = minX + hw.cx * bw;
      const currentY = minY + hw.cy * bh;

      // Only apply correction if offset is significant (> 2px)
      const dx = targetX - currentX;
      const dy = targetY - currentY;

      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
        corrections.push({
          strokeIndex: hw.index,
          dx,
          dy,
        });
      }
    }
  }

  return corrections;
}

/**
 * Apply corrections to strokes in-place.
 * Repositions each stroke toward its template position.
 */
export function applyCorrections(
  strokes: Array<{ points: { x: number; y: number }[] }>,
  corrections: StrokeCorrection[],
  strength: number = 0.6,
): void {
  for (const c of corrections) {
    const s = strokes[c.strokeIndex];
    if (!s) continue;
    for (const p of s.points) {
      p.x += c.dx * strength;
      p.y += c.dy * strength;
    }
  }
}
