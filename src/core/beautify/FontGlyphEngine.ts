// ============================================================
//  Font Glyph Engine v4 — 图片像素匹配（简单可靠）
//
//  思路：
//  1. 手写笔画簇 → 渲染到小 Canvas (48×48)
//  2. 候选字符 → 字体渲染到小 Canvas (48×48)
//  3. 归一化互相关比较 → 最佳匹配
//  4. 返回匹配字符 → _glyph fillText 渲染
//
//  无轮廓提取、无特征缓存。简单、可靠、可调试。
// ============================================================

import type { FontStyleId } from './FontStyleSystem';

// ============================================================
//  Font Families
// ============================================================

export const FONT_FAMILY_MAP: Record<FontStyleId, string[]> = {
  roundCute: ['"ZCOOL KuaiLe"', '"LXGW WenKai"', '"Noto Sans SC"', '"Microsoft YaHei"', 'sans-serif'],
  kaiShu:    ['"KaiTi"', '"STKaiti"', '"AR PL UKai CN"', '"Noto Serif SC"', 'serif'],
  xingShu:   ['"STXingkai"', '"Xingkai SC"', '"AR PL UKai CN"', '"KaiTi"', 'serif'],
  caoShu:    ['"STCaiyun"', '"Hannotate SC"', '"Noto Serif SC"', 'cursive'],
};

// ============================================================
//  Google Fonts mapping (CSP compatible)
// ============================================================

const GOOGLE_FONT_MAP: Record<string, string> = {
  KaiTi: 'Ma+Shan+Zheng',
  STKaiti: 'Ma+Shan+Zheng',
  kaiShu: 'Ma+Shan+Zheng',
  roundCute: 'ZCOOL+KuaiLe',
  xingShu: 'Ma+Shan+Zheng',
  caoShu: 'Zhi+Mang+Xing',
};

// ============================================================
//  Font Detection & Loading
// ============================================================

function detectFont(fontFamily: string): boolean {
  const testStr = '我永东国和的一是在';
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return false;
  ctx.font = `72px ${fontFamily}`;
  const w1 = ctx.measureText(testStr).width;
  ctx.font = '72px serif';
  const w2 = ctx.measureText(testStr).width;
  ctx.font = '72px sans-serif';
  const w3 = ctx.measureText(testStr).width;
  return Math.abs(w1 - w2) / Math.max(1, w2) > 0.02 ||
         Math.abs(w1 - w3) / Math.max(1, w3) > 0.02;
}

let _webFontLoaded = false;
let _webFontName = '';

async function loadWebFont(styleId: FontStyleId): Promise<string> {
  const gfName = GOOGLE_FONT_MAP[styleId] || 'Ma+Shan+Zheng';
  if (_webFontLoaded && _webFontName) return _webFontName;

  return new Promise((resolve) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = `https://fonts.googleapis.com/css2?family=${gfName}&display=swap`;
    link.onload = async () => {
      const cleanName = gfName.replace(/\+/g, ' ');
      _webFontName = `"${cleanName}"`;
      try {
        await document.fonts.load(`16px "${cleanName}"`);
        _webFontLoaded = true;
        console.error(`[FontGlyph] Web font ready: ${_webFontName}`);
        resolve(_webFontName);
      } catch {
        resolve('');
      }
    };
    link.onerror = () => resolve('');
    document.head.appendChild(link);
    setTimeout(() => { if (!_webFontLoaded) resolve(''); }, 15000);
  });
}

export async function resolveFont(styleId: FontStyleId): Promise<{ fontFamily: string; fontAvailable: boolean }> {
  const families = FONT_FAMILY_MAP[styleId];
  for (let i = 0; i < families.length; i++) {
    const fam = families[i].replace(/"/g, '');
    if (detectFont(fam)) {
      console.error(`[FontGlyph] System font: ${fam}`);
      return { fontFamily: families.slice(0, i + 1).join(', '), fontAvailable: true };
    }
  }
  console.error('[FontGlyph] Loading Google Font...');
  const wf = await loadWebFont(styleId);
  if (wf) return { fontFamily: `${wf}, ${families.join(', ')}`, fontAvailable: true };
  return { fontFamily: families.join(', '), fontAvailable: false };
}

// ============================================================
//  Image-based Character Matching
// ============================================================

const MATCH_CANVAS_SIZE = 80;

/** Font image cache — avoid re-rendering the same character. */
const _fontImageCache = new Map<string, HTMLCanvasElement>();

function getCachedFontImage(char: string, fontFamily: string): HTMLCanvasElement {
  const key = `${char}|${fontFamily}`;
  let cached = _fontImageCache.get(key);
  if (!cached) {
    cached = renderCharToCanvas(char, fontFamily);
    _fontImageCache.set(key, cached);
  }
  return cached;
}

/** Render strokes to a small canvas for matching. Thickened 3x for better correlation. */
export function renderStrokesToCanvas(
  strokes: Array<{ points: { x: number; y: number }[]; width?: number }>,
  bbox: { x: number; y: number; w: number; h: number },
): { canvas: HTMLCanvasElement; strokeCount: number; aspectRatio: number } {
  const size = MATCH_CANVAS_SIZE;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return { canvas, strokeCount: 0, aspectRatio: 0 };

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, size, size);

  const pad = 2;
  const scaleX = (size - pad * 2) / Math.max(1, bbox.w);
  const scaleY = (size - pad * 2) / Math.max(1, bbox.h);
  const scale = Math.min(scaleX, scaleY);
  const ox = pad + (size - pad * 2 - bbox.w * scale) / 2 - bbox.x * scale;
  const oy = pad + (size - pad * 2 - bbox.h * scale) / 2 - bbox.y * scale;

  ctx.strokeStyle = '#000000';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  let strokeCount = 0;
  for (const s of strokes) {
    if (s.points.length < 2) continue;
    strokeCount++;
    // 🎯 Thicken 3x to bridge gap between handwriting and font
    ctx.lineWidth = Math.max(3, (s.width ?? 2) * scale * 3);
    ctx.beginPath();
    ctx.moveTo(s.points[0].x * scale + ox, s.points[0].y * scale + oy);
    for (let i = 1; i < s.points.length; i++) {
      ctx.lineTo(s.points[i].x * scale + ox, s.points[i].y * scale + oy);
    }
    ctx.stroke();
  }

  return { canvas, strokeCount, aspectRatio: bbox.w / Math.max(1, bbox.h) };
}

function boxBlur(
  imageData: ImageData, w: number, h: number, radius: number,
): ImageData {
  const src = new Uint8ClampedArray(imageData.data);
  const dst = new Uint8ClampedArray(src.length);
  // Horizontal
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let dx = -radius; dx <= radius; dx++) {
        const nx = x + dx;
        if (nx < 0 || nx >= w) continue;
        const i = (y * w + nx) * 4;
        r += src[i]; g += src[i + 1]; b += src[i + 2]; a += src[i + 3];
        n++;
      }
      const i = (y * w + x) * 4;
      dst[i] = r / n; dst[i + 1] = g / n; dst[i + 2] = b / n; dst[i + 3] = a / n;
    }
  }
  // Vertical
  const result = new Uint8ClampedArray(dst.length);
  const tmp = new Uint8ClampedArray(dst);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let dy = -radius; dy <= radius; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= h) continue;
        const i = (ny * w + x) * 4;
        r += tmp[i]; g += tmp[i + 1]; b += tmp[i + 2]; a += tmp[i + 3];
        n++;
      }
      const i = (y * w + x) * 4;
      result[i] = r / n; result[i + 1] = g / n; result[i + 2] = b / n; result[i + 3] = a / n;
    }
  }
  return new ImageData(result, w, h);
}

/** Render a single character with the font to a small canvas. */
function renderCharToCanvas(char: string, fontFamily: string): HTMLCanvasElement {
  const size = MATCH_CANVAS_SIZE;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return canvas;

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, size, size);

  // 🎯 strokeText (outline) instead of fillText — matches handwritten strokes structure
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 2.5;
  ctx.font = `${size * 0.75}px ${fontFamily}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.strokeText(char, size / 2, size / 2);

  return canvas;
}

/** Normalized cross-correlation between two canvases. Higher = better match. */
function imageCorrelation(a: HTMLCanvasElement, b: HTMLCanvasElement): number {
  const ca = a.getContext('2d');
  const cb = b.getContext('2d');
  if (!ca || !cb) return 0;

  const da = ca.getImageData(0, 0, MATCH_CANVAS_SIZE, MATCH_CANVAS_SIZE).data;
  const db = cb.getImageData(0, 0, MATCH_CANVAS_SIZE, MATCH_CANVAS_SIZE).data;

  const n = MATCH_CANVAS_SIZE * MATCH_CANVAS_SIZE;
  let sumA = 0, sumB = 0;
  for (let i = 0; i < da.length; i += 4) {
    sumA += da[i];     // use R channel (all same for grayscale)
    sumB += db[i];
  }
  const meanA = sumA / n;
  const meanB = sumB / n;

  let cov = 0, varA = 0, varB = 0;
  for (let i = 0; i < da.length; i += 4) {
    const daVal = da[i] - meanA;
    const dbVal = db[i] - meanB;
    cov += daVal * dbVal;
    varA += daVal * daVal;
    varB += dbVal * dbVal;
  }

  if (varA < 1 || varB < 1) return 0;
  return cov / Math.sqrt(varA * varB);
}

// ============================================================
//  Character Candidates
// ============================================================

export const COMMON_CHARS =
  '的一是在不了有和人这中大为上个国我以要他时来用们生到作地于出就分对成会可主发年动同工也能下过子说产种面而方后多定行学法所民得经十三之进着等部度家电力里如水化高自二理起小物现实加量都两体制机当使点从业本去把性好应开它合还因由其些然前外天政四日那社义事平形相全表间样与关各重新线内数正心反你明看原又么利比或但质气第向道命此变条只没结解问意建月公无系军很情者最立代想已通并提直题党程展五果料象员革位入常文总次品式活设及管特件长求老头基资边流路级少图山统接知较将组见计别她手角期根论运农指几九区强放决西被干做必战先回则任取据处队南给色光门即保治北造百规热领七海口东导器压志世金增争济阶油思术极交受联什认六共权收证改清己美再采转更单风切打白教速花带安场身车例真务具万每目至达走积示议声报斗完类八离华名确才科张信马节话米整空元况今集温传土许步群广石记需段研界拉林律叫且究观越织装影算低持音众书布复容儿须际商非验连断深难近矿千周委素技备半办青省列习响约支般史感劳便团往酸历市克何除消构府称太准精值号率族维划选标写存候毛亲快效斯院查江型眼王按格养易置派层片始却专状育厂京识适属圆包火住调满县局照参红细引听该铁价严龙朝首单改';

let _chars: string[] | null = null;
export function getCandidateChars(): string[] {
  if (!_chars) _chars = [...new Set(COMMON_CHARS.replace(/\s/g, ''))];
  return _chars;
}

// ============================================================
//  Match Character
// ============================================================

export interface MatchResult {
  char: string;
  score: number;
}

/**
 * Two-stage matching:
 * Stage 1: Filter by stroke count (±2) — <1ms
 * Stage 2: Image correlation on filtered candidates (80×80) — ~30ms
 */
export function matchCharacter(
  hwResult: { canvas: HTMLCanvasElement; strokeCount: number; aspectRatio: number },
  candidates: string[],
  fontFamily: string,
  _maxCandidates: number = 250,
): MatchResult | null {
  const { canvas: hwCanvas, strokeCount, aspectRatio } = hwResult;

  // 🎯 Stage 1: Filter by stroke count (±2 for complex, exact for simple)
  const tolerance = strokeCount <= 3 ? 1 : 2;
  const filtered: string[] = [];
  for (const char of candidates) {
    const expectedStrokes = CHAR_STROKES.get(char);
    if (expectedStrokes === undefined) {
      // Unknown stroke count — include as fallback
      filtered.push(char);
    } else if (Math.abs(expectedStrokes - strokeCount) <= tolerance) {
      filtered.push(char);
    }
  }

  // Geometric heuristic for 1-stroke characters
  if (strokeCount === 1 && filtered.length > 0) {
    const simpleChar = classifySimpleStroke(hwCanvas);
    if (simpleChar) return { char: simpleChar, score: 0.9 };
  }

  // Take subset for speed
  const sample = filtered.slice(0, 80);

  if (sample.length === 0) return null;

  // Stage 2: Image correlation
  let bestChar = '';
  let bestScore = -Infinity;

  for (const char of sample) {
    const charCanvas = getCachedFontImage(char, fontFamily);
    const score = imageCorrelation(hwCanvas, charCanvas);
    if (score > bestScore) {
      bestScore = score;
      bestChar = char;
    }
  }

  if (bestScore < 0.06) return null;
  return { char: bestChar, score: bestScore };
}

/**
 * Classify simple 1-stroke characters by geometry.
 * Returns the character or null if uncertain.
 */
function classifySimpleStroke(canvas: HTMLCanvasElement): string | null {
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const size = MATCH_CANVAS_SIZE;
  const data = ctx.getImageData(0, 0, size, size).data;

  // Find non-white pixels
  let minX = size, maxX = 0, minY = size, maxY = 0, count = 0;
  let sumX = 0, sumY = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (data[(y * size + x) * 4] < 200) { // dark pixel
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        sumX += x; sumY += y;
        count++;
      }
    }
  }

  if (count < 10) return null;

  const bw = maxX - minX || 1;
  const bh = maxY - minY || 1;
  const cx = sumX / count;
  const cy = sumY / count;

  // Aspect ratio
  const aspect = bw / Math.max(1, bh);

  if (aspect > 3) return '一';       // Very wide → horizontal line
  if (bh > bw * 3) return '丨';       // Very tall → vertical line
  
  // Dot: small and compact
  if (bw < size * 0.2 && bh < size * 0.2) return '丶';
  
  // Left-falling: diagonal from top-right to bottom-left
  if (cx > size * 0.55 && aspect > 1.5) return '丿';

  return null; // Uncertain, fall through to image matching
}

// Stroke count database for common Chinese characters
const CHAR_STROKES = new Map<string, number>([
  ['一',1],['乙',1],['二',2],['十',2],['丁',2],['厂',2],['七',2],['卜',2],['人',2],['入',2],
  ['八',2],['九',2],['几',2],['儿',2],['了',2],['力',2],['乃',2],['刀',2],['又',2],['三',3],
  ['于',3],['干',3],['亏',3],['士',3],['工',3],['土',3],['才',3],['寸',3],['下',3],['大',3],
  ['丈',3],['与',3],['万',3],['上',3],['小',3],['口',3],['巾',3],['山',3],['千',3],['乞',3],
  ['川',3],['亿',3],['个',3],['勺',3],['久',3],['凡',3],['及',3],['夕',3],['丸',3],['么',3],
  ['广',3],['亡',3],['门',3],['义',3],['之',3],['尸',3],['弓',3],['己',3],['已',3],['子',3],
  ['卫',3],['也',3],['女',3],['飞',3],['刃',3],['习',3],['叉',3],['马',3],['乡',3],['丰',4],
  ['王',4],['井',4],['开',4],['夫',4],['天',4],['无',4],['元',4],['专',4],['云',4],['扎',4],
  ['艺',4],['木',4],['五',4],['支',4],['厅',4],['不',4],['太',4],['犬',4],['区',4],['历',4],
  ['尤',4],['友',4],['匹',4],['车',4],['巨',4],['牙',4],['屯',4],['比',4],['互',4],['切',4],
  ['瓦',4],['止',4],['少',4],['日',4],['中',4],['冈',4],['贝',4],['内',4],['水',4],['见',4],
  ['午',4],['牛',4],['手',4],['毛',4],['气',4],['升',4],['长',4],['仁',4],['什',4],['片',4],
  ['仆',4],['化',4],['仇',4],['币',4],['仍',4],['仅',4],['斤',4],['爪',4],['反',4],['介',4],
  ['父',4],['从',4],['今',4],['凶',4],['分',4],['乏',4],['公',4],['仓',4],['月',4],['氏',4],
  ['勿',4],['欠',4],['风',4],['丹',4],['匀',4],['乌',4],['凤',4],['勾',4],['文',4],['六',4],
  ['方',4],['火',4],['为',4],['斗',4],['忆',4],['订',4],['计',4],['户',4],['认',4],['心',4],
  ['尺',4],['引',4],['丑',4],['巴',4],['孔',4],['队',4],['办',4],['以',4],['允',4],['予',4],
  ['劝',4],['双',4],['书',4],['幻',4],['玉',5],['刊',5],['示',5],['未',5],['末',5],['击',5],
  ['打',5],['巧',5],['正',5],['扑',5],['扒',5],['功',5],['扔',5],['去',5],['甘',5],['世',5],
  ['古',5],['节',5],['本',5],['术',5],['可',5],['丙',5],['左',5],['厉',5],['右',5],['石',5],
  ['布',5],['龙',5],['平',5],['灭',5],['轧',5],['东',5],['卡',5],['北',5],['占',5],['业',5],
  ['旧',5],['帅',5],['归',5],['且',5],['旦',5],['目',5],['叶',5],['甲',5],['申',5],['叮',5],
  ['电',5],['号',5],['田',5],['由',5],['史',5],['只',5],['央',5],['兄',5],['叼',5],['叫',5],
  ['另',5],['叨',5],['叹',5],['四',5],['生',5],['失',5],['禾',5],['丘',5],['付',5],['仗',5],
  ['代',5],['仙',5],['们',5],['仪',5],['白',5],['仔',5],['他',5],['斥',5],['瓜',5],['乎',5],
  ['丛',5],['令',5],['用',5],['甩',5],['印',5],['乐',5],['句',5],['匆',5],['册',5],['犯',5],
  ['外',5],['处',5],['冬',5],['鸟',5],['务',5],['包',5],['饥',5],['主',5],['市',5],['立',5],
  ['闪',5],['兰',5],['半',5],['汁',5],['汇',5],['头',5],['汉',5],['宁',5],['穴',5],['它',5],
  ['讨',5],['写',5],['让',5],['礼',5],['训',5],['必',5],['议',5],['讯',5],['记',5],['永',5],
  ['司',5],['尼',5],['民',5],['出',5],['辽',5],['奶',5],['奴',5],['加',5],['召',5],['皮',5],
  ['边',5],['发',5],['孕',5],['圣',5],['对',5],['台',5],['矛',5],['纠',5],['母',5],['幼',5],
  ['丝',5],['式',6],['刑',6],['动',6],['扛',6],['寺',6],['吉',6],['扣',6],['考',6],['托',6],
  ['老',6],['执',6],['巩',6],['圾',6],['扩',6],['扫',6],['地',6],['扬',6],['场',6],['耳',6],
  ['共',6],['芒',6],['亚',6],['芝',6],['朽',6],['朴',6],['机',6],['权',6],['过',6],['臣',6],
  ['再',6],['协',6],['西',6],['压',6],['厌',6],['在',6],['有',6],['百',6],['存',6],['而',6],
  ['页',6],['匠',6],['夸',6],['夺',6],['灰',6],['达',6],['列',6],['死',6],['成',6],['夹',6],
  ['轨',6],['邪',6],['划',6],['迈',6],['毕',6],['至',6],['此',6],['贞',6],['师',6],['尘',6],
  ['尖',6],['劣',6],['光',6],['当',6],['早',6],['吐',6],['吓',6],['虫',6],['曲',6],['团',6],
  ['同',6],['吊',6],['吃',6],['因',6],['吸',6],['吗',6],['屿',6],['帆',6],['岁',6],['回',6],
  ['岂',6],['刚',6],['则',6],['肉',6],['网',6],['年',6],['朱',6],['先',6],['丢',6],['舌',6],
  ['竹',6],['迁',6],['乔',6],['伟',6],['传',6],['乒',6],['乓',6],['休',6],['伍',6],['伏',6],
  ['优',6],['伐',6],['延',6],['件',6],['任',6],['伤',6],['价',6],['份',6],['华',6],['仰',6],
  ['仿',6],['伙',6],['伪',6],['自',6],['血',6],['向',6],['似',6],['后',6],['行',6],['舟',6],
  ['全',6],['会',6],['杀',6],['合',6],['兆',6],['企',6],['众',6],['爷',6],['伞',6],['创',6],
  ['肌',6],['朵',6],['杂',6],['危',6],['旬',6],['旨',6],['负',6],['各',6],['名',6],['多',6],
  ['争',6],['色',6],['壮',6],['冲',6],['冰',6],['庄',6],['庆',6],['亦',6],['刘',6],['齐',6],
  ['交',6],['次',6],['衣',6],['产',6],['决',6],['充',6],['妄',6],['闭',6],['问',6],['闯',6],
  ['羊',6],['并',6],['关',6],['米',6],['灯',6],['州',6],['汗',6],['污',6],['江',6],['池',6],
  ['汤',6],['忙',6],['兴',6],['宇',6],['守',6],['宅',6],['字',6],['安',6],['讲',6],['军',6],
  ['许',6],['论',6],['农',6],['讽',6],['设',6],['访',6],['寻',6],['那',6],['迅',6],['尽',6],
  ['导',6],['异',6],['孙',6],['阵',6],['阳',6],['收',6],['阶',6],['阴',6],['防',6],['奸',6],
  ['如',6],['妇',6],['好',6],['她',6],['妈',6],['戏',6],['羽',6],['观',6],['欢',6],['买',6],
  ['红',6],['纤',6],['级',6],['约',6],['纪',6],['驰',6],['巡',7],['寿',7],['弄',7],['麦',7],
]);

// ============================================================
//  Compute handwriting bounding box
// ============================================================

export function computeBBox(strokes: Array<{ points: { x: number; y: number }[] }>): { x: number; y: number; w: number; h: number; cx: number; cy: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const s of strokes) {
    for (const p of s.points) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  }
  const w = maxX - minX || 1;
  const h = maxY - minY || 1;
  return { x: minX, y: minY, w, h, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 };
}
