/* ============================================================================
 * 天空与草原 · 动漫风动态壁纸
 * ----------------------------------------------------------------------------
 * 参考方向：蓝天积云 + 远山 + 起伏草坡，草地上的野花逐朵依次开合。
 *
 * 三条设计约束
 *   1. 易读性优先 —— 桌面图标文字是白色带投影，压在浅蓝天空（约 #69BAEE）上
 *      的对比度只有约 1.6:1，根本读不清。所以除了构图（细节全部让到下方、
 *      图标常驻的左列与上部保持低频），还叠一层可调的"图标区柔和压暗"，
 *      把对比度抬到 4:1 以上。见 CFG.scrim。
 *   2. 分带构图 —— 地平线以上是天空（大块平滑色域），以下是草坡。
 *      高频元素（前景草叶、大花）压在最底部。
 *   3. 开花是"波前"不是"随机" —— 每朵花按自身世界坐标落在一个横扫的波前相位上，
 *      依次张开、停留、再合上，整片草地呈现一道自左向右掠过的开花波。
 *
 * 画法
 *   草坡用 5 层**起伏平涂色阶**堆叠，而不是渐变 —— 这是动漫风表现"起伏地形"的
 *   标准手法，也是这版和上一版最本质的差别。花朵贴合各自色阶的起伏曲线。
 *
 * 平铺
 *   本场景有地平线，所以只在**水平方向**无缝平铺，垂直方向贴屏幕。
 *   所有起伏都用"整除瓦片宽度的正弦"生成，因此横向天然无缝。
 *
 * 世界单位
 *   1 世界单位 = 100% 缩放下的物理像素。尺寸来源有两条路径，**两条都落在物理像素上**：
 *     有宿主传参（pw/ph>0）→ 直接用宿主给的世界尺寸，不参与任何 DPR 运算；
 *     浏览器预览（无宿主）→ 用 innerWidth × devicePixelRatio 把 CSS 像素折成物理像素。
 *   因此多显示器不同缩放比下坐标一致、拼接无错位。
 *   （页面里确实读到 devicePixelRatio，但只用于预览模式的折算与诊断上报，
 *     宿主模式下不参与坐标计算 —— 别把这条简化成"代码里没有 devicePixelRatio"。）
 * ========================================================================== */
'use strict';
(function () {

/* ------------------------------------------------------------------ 工具 */
const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);
const lerp = (a, b, t) => a + (b - a) * t;
const fract = v => v - Math.floor(v);
const smoothstep = (a, b, x) => { const t = clamp01((x - a) / ((b - a) || 1e-6)); return t * t * (3 - 2 * t); };
const easeOutCubic = t => 1 - Math.pow(1 - t, 3);
const easeInOutCubic = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOutBack = (t, s) => { s = s === undefined ? 1.15 : s; const c = s + 1, u = t - 1; return 1 + c * u * u * u + s * u * u; };

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
const rnd = (r, a, b) => a + (b - a) * r();

/** 颜色明暗微调：f > 0 提亮，f < 0 压暗 */
function shade(hex, f) {
  const v = parseInt(hex.slice(1), 16);
  let r = (v >> 16) & 255, g = (v >> 8) & 255, b = v & 255;
  if (f >= 0) { r += (255 - r) * f; g += (255 - g) * f; b += (255 - b) * f; }
  else { r *= (1 + f); g *= (1 + f); b *= (1 + f); }
  return 'rgb(' + (r | 0) + ',' + (g | 0) + ',' + (b | 0) + ')';
}

/* ------------------------------------------------------------ 启动参数 */
const Q = new URLSearchParams(location.search);
const qnum = (k, d) => { const v = parseFloat(Q.get(k)); return Number.isFinite(v) ? v : d; };
const qbool = (k, d) => { const v = Q.get(k); return v == null ? d : (v === '1' || v === 'true'); };

const CFG = {
  ox: qnum('ox', 0), oy: qnum('oy', 0),
  pw: qnum('pw', 0), ph: qnum('ph', 0), sf: qnum('sf', 0),
  vl: qnum('vl', 0), vt: qnum('vt', 0),
  fps: qnum('fps', 30),
  density: clamp(qnum('density', 1), 0.2, 2.2),
  wind: qnum('wind', 1),
  drift: qnum('drift', 0),
  renderScale: qnum('renderScale', 0),
  veil: clamp(qnum('veil', 1), 0, 1.6),
  scrim: clamp(qnum('scrim', 0.46), 0, 0.7),          // 图标区柔和压暗强度（易读性）
  cloudLife: clamp(qnum('cloudLife', 88), 20, 400),   // 一朵云从生成到消散的总时长（秒）
  cloudDensity: clamp(qnum('cloudDensity', 1), 0, 3), // 云量倍率
  cloudSpeed: clamp(qnum('cloudSpeed', 1), 0, 4),     // 云速倍率
  planes: qbool('planes', true),                      // 天空中的客机与云迹
  egg: qbool('egg', true),                            // 彩蛋：点中客机洒彩纸
  planeInterval: clamp(qnum('planeInterval', 70), 2, 600), // 客机平均间隔（秒），实际取 0.43~1.57 倍
  biplane: qbool('biplane', true),                    // 低空红色双翼机（点它触发飞行员跳伞）
  biplaneInterval: clamp(qnum('biplaneInterval', 60), 15, 600), // 双翼机平均间隔（秒），实际取 0.5~1.6 倍
  animals: qbool('animals', true),                    // 远景的牛羊
  animalDensity: clamp(qnum('animalDensity', 1), 0, 2.5),
  horizon: clamp(qnum('horizon', 0.55), 0.30, 0.75),  // 地平线位置（占屏高比例）
  seed: qnum('seed', 20260923),
  t0: qnum('t0', 0),
  budget: qnum('budget', 4700000),
  debug: qnum('debug', 0),
};

/* -------------------------------------------------------------- 调色板 */
const SKY = ['#1E79D2', '#459BE2', '#74B9E8', '#A6D2E8', '#D2E8EE'];
const CLOUD = { body: '#FFFFFF', mid: '#F0F7FE', shadow: '#D2E2F0' };
const HILL = [
  { top: '#A8C4DE', bot: '#88AECB', h: 0.190 },
  { top: '#8FB0A6', bot: '#749A8C', h: 0.120 },
  { top: '#7BAC6E', bot: '#629455', h: 0.070 },
];
/* 草坡用 5 个平涂色阶 —— 动漫风靠"色阶"而不是渐变来表现起伏 */
/* 偏暖偏黄 —— 目标是午后被阳光晒过的草坡，不是冷调的荧光绿 */
const MEADOW = ['#C8DE92', '#B4D478', '#9FC85F', '#8ABA4C', '#74A63A'];
/* 每层色阶的起伏：振幅（占草地高度比例）与空间周期（整除瓦片宽，保证无缝） */
const MEADOW_ROLL = [
  { amp: 0.000, n: 1 },
  { amp: 0.020, n: 2 },
  { amp: 0.028, n: 3 },
  { amp: 0.034, n: 2 },
  { amp: 0.000, n: 1 },
];
const BAND_T = [0.00, 0.11, 0.30, 0.53, 0.77, 1.00];   // 5 层色阶的上下边界

/* =========================================================================
 * 1. 野花品种
 * ======================================================================= */
const FLOWERS = [
  { id: 'fWhite',  petals: 5, shape: 'round', len: 4.8, wid: 4.6, h: 9.6,
    c1: '#FFFFFF', c2: '#D3DBCE', cc: '#F5C838', stem: '#4E8A2C' },
  { id: 'fYellow', petals: 5, shape: 'round', len: 4.4, wid: 4.3, h: 9.0,
    c1: '#FBD84A', c2: '#E0B824', cc: '#C88A10', stem: '#4E8A2C' },
  { id: 'fPink',   petals: 5, shape: 'round', len: 4.8, wid: 4.5, h: 9.6,
    c1: '#F79AC0', c2: '#E06E9C', cc: '#F8DE86', stem: '#4E8A2C' },
  { id: 'fViolet', petals: 5, shape: 'round', len: 4.6, wid: 4.4, h: 9.2,
    c1: '#B48CE4', c2: '#9468CE', cc: '#F6E2A8', stem: '#4E8A2C' },
  { id: 'fCoral',  petals: 5, shape: 'round', len: 5.0, wid: 4.8, h: 9.8,
    c1: '#FA8450', c2: '#E25E2C', cc: '#FBE7A6', stem: '#4E8A2C' },
  { id: 'fBlue',   petals: 5, shape: 'round', len: 4.6, wid: 4.4, h: 9.2,
    c1: '#8CC0F4', c2: '#6698DE', cc: '#F4E6AC', stem: '#4E8A2C' },
  { id: 'fDaisy',  petals: 9, shape: 'spoon', len: 6.0, wid: 1.9, h: 11.0,
    c1: '#FFFFFF', c2: '#D6DED0', cc: '#F5C838', stem: '#4E8A2C' },
];
/* 白与黄占主导 —— 参考图里野花是零星散落的小色点，不是成片花毯 */
const WEIGHTS = { fWhite: 26, fYellow: 22, fPink: 13, fViolet: 11, fCoral: 11, fBlue: 9, fDaisy: 8 };

function makePicker(w) {
  const ids = [], cum = []; let acc = 0;
  for (const k in w) { acc += w[k]; ids.push(k); cum.push(acc); }
  return r => { const v = r() * acc; for (let i = 0; i < cum.length; i++) if (v < cum[i]) return ids[i]; return ids[ids.length - 1]; };
}
const PICK_FLOWER = makePicker(WEIGHTS);

/* =========================================================================
 * 2. 画布与世界坐标
 * ======================================================================= */
const canvas = document.getElementById('scene');
const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
const bootEl = document.getElementById('boot');

let VW = 1, VH = 1;
let S = 1, DBASE = 1, BS = 1, uiScale = 1;
let HY = 0, GH = 0;

/* ------------------------------------------------------ 花瓣 / 叶片路径 */
function petalUnit(g, shape, w) {
  w = Math.max(w, 0.02);
  switch (shape) {
    case 'round':
      g.moveTo(0, -w * 0.30);
      g.quadraticCurveTo(0.30, -w * 1.02, 0.80, -w * 0.94);
      g.quadraticCurveTo(1.00, -w * 0.72, 1.00, 0);
      g.quadraticCurveTo(1.00, w * 0.72, 0.80, w * 0.94);
      g.quadraticCurveTo(0.30, w * 1.02, 0, w * 0.30);
      g.quadraticCurveTo(-w * 0.32, 0, 0, -w * 0.30);
      break;
    case 'spoon':
      g.moveTo(0, -w * 0.36);
      g.quadraticCurveTo(0.40, -w * 0.38, 0.60, -w * 0.80);
      g.quadraticCurveTo(1.00, -w * 1.00, 1.00, -w * 0.08);
      g.quadraticCurveTo(1.00, w * 1.00, 0.60, w * 0.80);
      g.quadraticCurveTo(0.40, w * 0.38, 0, w * 0.36);
      g.quadraticCurveTo(-w * 0.34, 0, 0, -w * 0.36);
      break;
    default:
      g.rect(0, -w, 1, w * 2);
  }
  g.closePath();
}

function leafPath(g, L, W, droop) {
  const ty = L * (droop || 0);
  g.beginPath();
  g.moveTo(0, 0);
  g.bezierCurveTo(L * 0.16, -W * 1.12 + ty * 0.18, L * 0.66, -W * 1.00 + ty * 0.74, L, ty);
  g.bezierCurveTo(L * 0.66, W * 1.00 + ty * 0.74, L * 0.16, W * 1.12 + ty * 0.18, 0, 0);
  g.closePath();
}

/* =========================================================================
 * 3. 赛璐璐上色
 * ======================================================================= */
/* 一片花瓣画两遍：整片平涂主色，再以 0.42 缩放叠一层暗色，
 * 天然分出"亮面 + 内侧暗面"。0.42 是试出来的 —— 取 0.60 会让小花变成甜甜圈。 */
const SHADE_SCALE = 0.42;

function celPetal(g, shape, wRatio, c1, c2) {
  g.beginPath(); petalUnit(g, shape, wRatio);
  g.fillStyle = c1; g.fill();
  if (c2) {
    g.save();
    g.scale(SHADE_SCALE, SHADE_SCALE);
    g.beginPath(); petalUnit(g, shape, Math.min(wRatio * 1.16, 0.95));
    g.fillStyle = c2; g.fill();
    g.restore();
  }
}

/* =========================================================================
 * 4. 单株野花（短茎 + 花冠），open: 0 花蕾 → 1 盛开
 * ======================================================================= */
function drawFlower(g, sp, open, r) {
  const H = sp.h;
  const bud = 1 - smoothstep(0.14, 0.62, open);

  /* 茎 */
  g.beginPath();
  g.moveTo(-0.62, 0);
  g.quadraticCurveTo(-0.30, -H * 0.55, -0.52, -H);
  g.lineTo(0.52, -H);
  g.quadraticCurveTo(0.30, -H * 0.55, 0.62, 0);
  g.closePath();
  g.fillStyle = sp.stem; g.fill();
  g.beginPath();
  g.moveTo(0.02, 0);
  g.quadraticCurveTo(0.22, -H * 0.55, 0.10, -H);
  g.lineTo(0.52, -H);
  g.quadraticCurveTo(0.30, -H * 0.55, 0.62, 0);
  g.closePath();
  g.fillStyle = shade(sp.stem, -0.28); g.fill();

  /* 一对小叶片（花太小就省略，免得糊成一团） */
  if (H > 8.6) {
    for (let i = 0; i < 2; i++) {
      const side = i ? 1 : -1;
      g.save();
      g.translate(side * 0.7, -H * 0.34);
      g.rotate(side * 1.15);
      leafPath(g, H * 0.34, H * 0.14, 0.18);
      g.fillStyle = shade(sp.stem, i ? 0.06 : -0.14);
      g.fill();
      g.restore();
    }
  }

  /* 花冠 */
  const L = sp.len * (0.22 + 0.78 * easeOutBack(clamp01(open), 1.06));
  const W = sp.wid * (0.44 + 0.56 * easeOutCubic(clamp01(open)));
  g.save();
  g.translate(0, -H);
  g.rotate(r * 0.5 - 0.25);

  if (bud > 0.02) {
    const keep = g.globalAlpha;
    g.globalAlpha = keep * bud;
    g.fillStyle = '#5E9A38';
    g.beginPath(); g.ellipse(0, -W * 0.34, W * 0.44, W * 0.62, 0, 0, TAU); g.fill();
    g.fillStyle = '#437226';
    g.beginPath(); g.ellipse(0, -W * 0.28, W * 0.24, W * 0.36, 0, 0, TAU); g.fill();
    g.globalAlpha = keep;
  }

  const pa = smoothstep(0.10, 0.55, open);
  if (pa > 0.02) {
    const keep = g.globalAlpha;
    g.globalAlpha = keep * pa;
    const n = sp.petals;
    for (let i = 0; i < n; i++) {
      g.save();
      g.rotate(i * TAU / n + r * 0.6);
      g.scale(L, L);
      celPetal(g, sp.shape, W / Math.max(L, 1e-4), sp.c1, sp.c2);
      g.restore();
    }
    g.fillStyle = sp.cc;
    g.beginPath(); g.arc(0, 0, Math.max(0.42, W * 0.24 * (0.4 + 0.6 * open)), 0, TAU); g.fill();
    g.globalAlpha = keep;
  }
  g.restore();
}

function flowerBox() { return { minX: -7, maxX: 7, minY: -16, maxY: 3.5 }; }

/* =========================================================================
 * 5. 云（赛璐璐积云：白色团块 + 贴合底部的冷灰暗面）
 * ======================================================================= */
function drawCloud(g, spec, r) {
  /* 三种类型分开画。
   *
   * 消除"直边"的**几何约束**（这是根因，不是调参）：
   * 半径 R 的圆弧，顶点附近落差 ≤2px 的横向跨度约 2·√(4R−4)：
   *     R=20 → 约 17px    R=30 → 约 24px    R=40 → 约 28px
   * 所以「云球越大，顶就越像一条直线」。早先那块 W×0.47 宽的扁底衬半径
   * 超过 140，直接拉出 205 列的尺子边。
   * 结论：**任何云球的半径都封顶在 22**，宁可多用几个小球去堆体积。
   * 相邻小球的高度差只要超过 2px，它们之间就会出现可见的凹口，
   * 轮廓自然是一串弧。 */
  const W = spec.w, H = spec.h;
  /* 云球半径上限。上一版为了压掉直边把上限收到 22，结果轮廓变成高频小凸起的
   * 串珠状 —— 那正是"细碎毛糙"的来源。控制"平直感"的正确做法是**限制圆弧的
   * 尺寸下限而非上限**：半径 R 的弧在顶点附近落差 ≤2px 的跨度约 2√(4R−4)，
   * 只要这个跨度不超过整朵云宽的一小部分，就仍是清晰的弧而非直线。
   * 所以这里把上限放回 34（弧更大更圆润），改由 cloudFlatLimit 兜底。 */
  const RMAX = 34;
  const lobes = [];
  const push = (x, y, rx, ry) => lobes.push({
    x: x, y: y,
    rx: Math.max(0.5, rx),
    ry: Math.max(0.5, ry === undefined ? rx : ry),
  });

  if (spec.kind === 'stratus') {
    /* 层云：扁长带子，两端渐薄；上下缘都由小球串成 */
    const nb = Math.max(5, Math.round(W / (H * 0.95)));
    const ph = r() * TAU;
    for (let i = 0; i < nb; i++) {
      const t = (i + 0.5) / nb;
      const taper = 0.22 + 0.78 * Math.pow(Math.sin(t * Math.PI), 0.6);
      const rr = Math.min(RMAX, H * rnd(r, 0.60, 0.95) * taper);
      const lvl = Math.sin(t * Math.PI * 2 + ph) * 0.16 + rnd(r, -0.20, 0.20);
      push((t * 2 - 1) * W * 0.46 + rnd(r, -0.03, 0.03) * W, -rr * (0.92 + lvl), rr);
    }
    const nt = Math.max(4, Math.round(nb * 0.8));
    const ph2 = r() * TAU;
    for (let i = 0; i < nt; i++) {
      const t = (i + 0.5) / nt;
      const taper = 0.30 + 0.70 * Math.sin(t * Math.PI);
      const rr = Math.min(RMAX, H * rnd(r, 0.45, 0.72) * taper);
      const lvl = Math.sin(t * Math.PI * 1.6 + ph2) * 0.14 + rnd(r, -0.18, 0.18);
      push((t * 2 - 1) * W * 0.40 + rnd(r, -0.05, 0.05) * W,
           -rr * (1.0 + lvl) - H * rnd(r, 0.10, 0.48), rr);
    }
  } else if (spec.kind === 'puff') {
    /* 碎云：几团松散小球，位置与高度都很随机 */
    const nb = Math.max(3, Math.round(spec.n * 0.9));
    for (let i = 0; i < nb; i++) {
      const t = (i + 0.5) / nb;
      const rr = Math.min(RMAX, H * rnd(r, 0.55, 0.90));
      push((t * 2 - 1) * W * 0.40 + rnd(r, -0.08, 0.08) * W,
           -rr * rnd(r, 0.75, 1.05) - H * rnd(r, 0.02, 0.42), rr);
    }
  } else {
    /* 积云：底排小球 + 中段主团 + 顶部小凸起 + 1~3 座峰。
     *
     * 主团用中等半径撑体积，**再沿上缘贴一排更小的凸起球**：
     * 只有中等球时，单个弧顶就能拉出二三十像素的近直线段；
     * 只有小球时，云会变成一堆肥皂泡。大小混用才既饱满又不出现长直边。 */
    const nb = Math.max(4, Math.round(W / (H * 0.62)));
    const phb = r() * TAU;
    for (let i = 0; i < nb; i++) {
      const t = (i + 0.5) / nb;
      const rr = Math.min(RMAX, H * rnd(r, 0.26, 0.40));
      const lvl = Math.sin(t * Math.PI * 2 + phb) * 0.14 + rnd(r, -0.16, 0.16);
      push((t * 2 - 1) * W * 0.46 + rnd(r, -0.02, 0.02) * W, -rr * (0.92 + lvl), rr);
    }
    const nb2 = Math.max(3, nb - 1);
    const phb2 = r() * TAU;
    for (let i = 0; i < nb2; i++) {
      const t = (i + 0.5) / nb2;
      const rr = Math.min(RMAX, H * rnd(r, 0.30, 0.46));
      const lvl = Math.sin(t * Math.PI * 1.5 + phb2) * 0.12 + rnd(r, -0.14, 0.14);
      push((t * 2 - 1) * W * 0.42 + rnd(r, -0.03, 0.03) * W,
           -rr * (1.02 + lvl) - H * rnd(r, 0.03, 0.15), rr);
    }
    /* 中段主团 */
    const nm = Math.max(3, Math.round(W / (H * 0.62)));
    const phm = r() * TAU;
    for (let i = 0; i < nm; i++) {
      const t = (i + 0.5) / nm;
      const rr = Math.min(RMAX, H * rnd(r, 0.30, 0.48));
      const lvl = Math.sin(t * Math.PI * 1.6 + phm) * 0.12 + rnd(r, -0.15, 0.15);
      push((t * 2 - 1) * W * 0.32 + rnd(r, -0.06, 0.06) * W,
           -rr * (0.95 + lvl) - H * rnd(r, 0.08, 0.28), rr);
    }
    /* 顶部小凸起：升幅刻意错开，专门用来打断长弧 */
    /* 顶部凸起：上一版这里排得又密又小，轮廓成了细碎的波浪。
     * 现在只留 2~4 团、半径加大，让上缘是几道平缓的大弧。 */
    const nc = Math.max(2, Math.round(W / (H * 1.15)));
    for (let i = 0; i < nc; i++) {
      const t = (i + 0.5) / nc;
      const rr = Math.min(RMAX, H * rnd(r, 0.22, 0.36));
      const lift = H * rnd(r, 0.34, 0.72);
      push((t * 2 - 1) * W * 0.30 + rnd(r, -0.05, 0.05) * W, -lift - rr, rr);
    }
    /* 峰的数量、高度、左右偏向都随机 —— 这是"每朵云都长得一样"的根源 */
    const nt = 1 + ((r() * 3) | 0);
    const bias = rnd(r, -0.60, 0.60);
    for (let i = 0; i < nt; i++) {
      const t = nt === 1 ? rnd(r, 0.30, 0.70) : (i + 0.5) / nt;
      const rr = Math.min(24, H * rnd(r, 0.18, 0.32));
      push((t * 2 - 1) * W * (0.10 + 0.20 * r()) + bias * W * 0.22,
           -rr * 0.95 - H * rnd(r, 0.28, 0.62), rr);
    }
  }

  const paint = (col, dy, ks) => {
    g.fillStyle = col;
    for (const l of lobes) {
      g.beginPath();
      g.ellipse(l.x, l.y + dy, l.rx * ks, l.ry * 0.94 * ks, 0, 0, TAU);
      g.fill();
    }
  };
  paint(CLOUD.shadow, H * 0.045, 1.00);
  paint(CLOUD.body, H * 0.015, 1.07);
}

/* =========================================================================
 * 6. 精灵烘焙
 * ======================================================================= */
const spriteCache = new Map();

function bakeSprite(key, w, h, ax, ay, fn) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w * BS));
  c.height = Math.max(1, Math.ceil(h * BS));
  const g = c.getContext('2d');
  g.scale(BS, BS);
  g.translate(ax, ay);
  g.lineJoin = 'round'; g.lineCap = 'round';
  fn(g);
  const spr = { cv: c, w: w, h: h, ax: ax, ay: ay };
  spriteCache.set(key, spr);
  return spr;
}

function getFlowerSprite(sp, vi, open) {
  const key = 'F|' + sp.id + '|' + vi + '|' + open;
  let s = spriteCache.get(key);
  if (s) return s;
  const b = flowerBox();
  const rr = mulberry32((hashStr(sp.id) + vi * 7919 + open * 131) >>> 0);
  return bakeSprite(key, b.maxX - b.minX + 8, b.maxY - b.minY + 8, -b.minX + 4, -b.minY + 4,
    g => drawFlower(g, sp, open, rr));
}

/* 上/下缘允许的最长"近直线段"。
 * 注意阈值必须**按云朵自身宽度取比例**：单个云球的弧顶附近本来就有
 * 约 2·√(4R−4) 的跨度落在 2px 落差内（R=40 时约 28px），
 * 这段在一朵 300px 宽的云上只占 10%，是正常圆弧而非直边；
 * 而早先那块宽扁底衬能拉出 205 列（占宽度 66%），那才是要消灭的尺子边。 */
function cloudFlatLimit(specW, top) {
  /* 这里的"直段"指窗口内落差 ≤2px 的一段。阈值给得比上一版宽 ——
   * 上一版卡在 20~28px，逼着轮廓往高频小凸起上走，反而毛糙。
   * 现在允许到云宽的 20%（上限 62px）：这么长的一段实际上是一道平缓的大弧，
   * 视觉上是"圆润"而不是"平直"。真正的尺子边（早先 205 列那种）远超此值。 */
  return top ? Math.max(34, Math.min(58, specW * 0.20))
             : Math.max(40, Math.min(72, specW * 0.26));
}

/** 实测一张已画好的云图上、下缘轮廓里最长的近直线段（世界单位像素）。
 *  判据是"窗口内轮廓高度总落差 ≤ 2px"，对应肉眼感受到的"直"。 */
function cloudFlatRun(cv, W, H, scale) {
  const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
  const w = cv.width, h = cv.height;
  const measure = (top) => {
    const a = new Int32Array(w).fill(-1);
    for (let x = 0; x < w; x++) {
      if (top) { for (let y = 0; y < h; y++) if (d[(y * w + x) * 4 + 3] > 24) { a[x] = y; break; } }
      else { for (let y = h - 1; y >= 0; y--) if (d[(y * w + x) * 4 + 3] > 24) { a[x] = y; break; } }
    }
    const tol = Math.max(1, Math.round(2 * scale));
    let best = 0;
    for (let x0 = 0; x0 < w; x0++) {
      if (a[x0] < 0) continue;
      let mn = a[x0], mx = a[x0], x = x0;
      while (x + 1 < w && a[x + 1] >= 0) {
        const nx = a[x + 1];
        const nmn = nx < mn ? nx : mn, nmx = nx > mx ? nx : mx;
        if (nmx - nmn > tol) break;
        mn = nmn; mx = nmx; x++;
      }
      if (x - x0 + 1 > best) best = x - x0 + 1;
    }
    return best / scale;
  };
  return Math.max(measure(true), measure(false));
}

/** 烘一个云精灵；烘完实测轮廓，出现直边就换个种子重掷（最多 6 次）。 */
function getCloudSprite(spec, vi) {
  const key = 'K|' + spec.id + '|' + vi;
  let s = spriteCache.get(key);
  if (s) return s;
  const w = spec.w * 1.6, h = spec.h * 3.0;
  const limit = cloudFlatLimit(spec.w);

  let best = null, bestRun = Infinity;
  for (let attempt = 0; attempt < 6; attempt++) {
    const r = mulberry32((hashStr(spec.id) + vi * 4517 + attempt * 7919) >>> 0);
    const cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.ceil(w * BS));
    cv.height = Math.max(1, Math.ceil(h * BS));
    const g = cv.getContext('2d');
    g.scale(BS, BS);
    g.translate(w / 2, h * 0.70);
    g.lineJoin = 'round'; g.lineCap = 'round';
    /* 烘焙时给一点极轻的柔化：云球并集在边缘会留下微小的抗锯齿台阶，
     * 缩小绘制时这些台阶就是"锯齿感"。0.9px 的模糊足以抹平台阶，
     * 又不会让云看起来是糊的。 */
    g.filter = 'blur(' + (0.9 * BS) + 'px)';
    drawCloud(g, spec, r);
    g.filter = 'none';

    const run = cloudFlatRun(cv, w, h, BS);
    if (run < bestRun) { bestRun = run; best = cv; }
    if (run <= limit) break;
  }
  const spr = { cv: best, w: w, h: h, ax: w / 2, ay: h * 0.70 };
  spriteCache.set(key, spr);
  return spr;
}

/* =========================================================================
 * 7. 场景
 * ======================================================================= */
/* ---- 云的生命周期参数 ----
 * 每朵云独立经历三段：生成增长 → 盛期维持 → 消散。比例之和为 1。
 * 以默认总时长 88 秒计：生长 13.2s / 维持 52.8s / 消散 22.0s。 */
const CLOUD_GROW = 0.15;
const CLOUD_FADE = 0.25;
/* 一朵云在整条寿命内的横向位移 ≈ 这个比例的屏宽。速度由它与寿命反推，
 * 这样换分辨率时"看起来的飘动快慢"是一致的。 */
const CLOUD_TRAVEL = 0.72;

/* 形态库：三种类型（积云 / 层云 / 碎云）× 十种身材，每种再烘 6 个变体，
 * 加上每朵云自己的水平拉伸与镜像，任一朵都不会和旁边那朵长一样。 */
const CLOUD_SPECS = [
  { id: 'puffA', kind: 'puff',    n: 5,  w: 78,  h: 24 },
  { id: 'puffB', kind: 'puff',    n: 6,  w: 112, h: 28 },
  { id: 'cumA',  kind: 'cumulus', n: 6,  w: 120, h: 34 },
  { id: 'cumB',  kind: 'cumulus', n: 7,  w: 178, h: 46 },
  { id: 'cumC',  kind: 'cumulus', n: 9,  w: 246, h: 62 },
  { id: 'cumD',  kind: 'cumulus', n: 8,  w: 188, h: 86 },   // 高耸的塔状
  { id: 'cumE',  kind: 'cumulus', n: 11, w: 312, h: 70 },
  { id: 'strA',  kind: 'stratus', n: 8,  w: 250, h: 17 },
  { id: 'strB',  kind: 'stratus', n: 11, w: 352, h: 21 },
  { id: 'strC',  kind: 'stratus', n: 7,  w: 196, h: 14 },
];
const CLOUD_VARIANTS = 6;

const TILE_W = 1680;      // 草坡水平瓦片宽度（世界单位，uiScale 前）
/* 图标安全区：屏幕左侧这个比例范围内的元素都按易读性要求做减弱处理 */
const ICON_SAFE_X = 0.34;

/* 每层色阶的花数量 / 缩放区间 / 草叶簇数量 —— 越靠前越大越密 */
const BAND_FLOWERS = [138, 219, 244, 219, 163];
const BAND_SCALE = [[0.30, 0.44], [0.42, 0.64], [0.60, 0.90], [0.85, 1.32], [1.25, 2.40]];
/* 每条草带的草簇数量（远 → 近）。
 * 原来最远那条带一株草都没有，中景也偏稀；现在把密度往远处补，
 * 近景那条反而减量 —— 近景草太高太密会把画面下半部压住。 */
const BAND_TUFTS = [23, 42, 55, 55, 44];   // 原 [18, 32, 42, 42, 34]，整体 +30%
/* 每条草带的草高系数。景深造成的近大远小由 BAND_SCALE 负责，
 * 这里只额外压低近景：最后一档 0.55 —— 近处草明显变矮，
 * 但由远及近的递增关系仍然成立，不会出现"近处比远处还矮"。 */
const BAND_TUFT_H = [1.00, 1.00, 0.96, 0.82, 0.55];
/* 草叶色阶：多给几档，配合每株的 tone0 偏移，成片看才不会像同一种草复制粘贴 */
const TUFT_TONES = ['#5AA030', '#6CB03A', '#4A8A28', '#63A836', '#54902C'];

let clouds = [], ridges = [], flowers = [], tufts = [], fringe = null;
let cloudRnd = mulberry32(0x9C41);
let ROLL_PH = [];

function bandEdgeY(k, wx) {
  if (k <= 0) return HY;
  if (k >= BAND_T.length - 1) return VH;
  const r0 = MEADOW_ROLL[k];
  const TW = TILE_W * uiScale;
  return HY + GH * BAND_T[k] + r0.amp * GH * Math.sin(TAU * r0.n * wx / TW + ROLL_PH[k]);
}

/** 让一朵云开始新的一生。delay 为 0~1 表示初始年龄比例；负数区间用于错开重生 */
function spawnCloud(c, r, ageRatio) {
  /* 纵向分三档叠加，比原来的两段分布更散：
   *   低空（多、大、实） / 中空 / 高空（少、小、淡） */
  /* 纵向分布：往地平线一侧多压一些，这样"山体后方"那一档才看得到 ——
   * 它们的位置正好落在远山山脊线以下，会呈现明显的透明。 */
  const roll = r();
  const y = roll < 0.46 ? rnd(r, 0.50, 0.92)
          : roll < 0.78 ? rnd(r, 0.18, 0.50)
          : rnd(r, 0.02, 0.18);
  const depth = smoothstep(0.02, 0.92, y);

  /* 形态：高空偏向小碎云与层云，低空偏向积云；但仍留随机空间，
   * 免得"高的永远是小云"变成另一种千篇一律。 */
  const ws = [];
  for (const sp of CLOUD_SPECS) {
    let w = 1;
    if (sp.kind === 'cumulus') w = lerp(0.5, 2.0, depth);
    else if (sp.kind === 'stratus') w = lerp(1.5, 0.8, depth);
    else w = lerp(1.6, 0.7, depth);
    ws.push(w);
  }
  let total = 0;
  for (const w of ws) total += w;
  let pick = r() * total, idx = 0;
  for (let i = 0; i < ws.length; i++) { pick -= ws[i]; if (pick <= 0) { idx = i; break; } }
  c.spec = CLOUD_SPECS[idx];
  c.kind = c.spec.kind;

  c.vi = (r() * CLOUD_VARIANTS) | 0;
  c.y = y;
  /* 尺寸的景深方向和透明度必须一致：**近的更大、远的更小**。
   * 旧版是反的（天顶小、地平线大），于是"尺寸"和"透明度"两项深度线索互相打架，
   * 整体观感就变成"云既小又淡、不像是近处的云"。 */
  c.s = lerp(1.10, 0.72, depth) * uiScale * rnd(r, 0.78, 1.28);
  /* 每朵自己的身材微调：水平拉伸 + 竖直压扁 + 左右镜像 */
  c.sx = rnd(r, 0.84, 1.34);
  c.sy = rnd(r, 0.88, 1.14);
  c.flip = r() < 0.5 ? 1 : -1;
  /* 景深：云层大致在同一高度，所以**越靠近地平线仰角越小、视线穿过的大气越厚、
   * 距离也越远** —— 应当越淡越透明；天顶附近的最近，最白最实。
   * 这里的 depth 是 0(天顶/近) → 1(地平线/远)，透明度必须与它**负相关**。
   * （旧版写成了正相关，方向反了：地平线附近的云最不透明。） */
  /* 不透明度下限从 0.30 提到 0.62：远景也仍然是清亮的白云，
   * 不会淡成一层灰雾。深度关系保留（近 1.0 → 远 0.62）。 */
  c.a0 = lerp(1.0, 0.62, depth) * rnd(r, 0.94, 1.0);
  c.life = CFG.cloudLife * rnd(r, 0.78, 1.26);
  c.age = ageRatio * c.life;
  /* 生成位置：随机落在屏幕上，且偏右 —— 因为它要一路向左飘 */
  c.x = CFG.ox + rnd(r, 0.26, 1.14) * VW;
  c.v = (CLOUD_TRAVEL * VW / c.life) * CFG.cloudSpeed * rnd(r, 0.82, 1.20);
  c.splitT = 0;      // > 0 表示正在分裂过渡中
  c.splitKids = null;// 过渡期间暂存两朵子云，走完再放进 clouds
  c.lastA = 0;       // 上一帧的实际透明度，供命中判定用
}

/** 造出两朵子云。**在点击的那一刻就造好**，而不是等过渡结束 ——
 *  因为过渡期间要把它们画出来（从母云中心长出去），
 *  这样收尾那一帧子云已经就位，不会"凭空换掉"。子云的**渲染宽度**各取母云的 62%。 */
function splitCloud(c, r) {
  const parentW = c.spec.w * c.s * c.sx;
  /* 只从比母云更小的身材里挑，否则子云反而比母云还大 */
  const pool = CLOUD_SPECS.filter(sp => sp.w <= c.spec.w * 0.85);
  const sep = parentW * CLOUD_SPLIT_SEP;
  const out = [];
  for (let sgn = -1; sgn <= 1; sgn += 2) {
    const spec = pool.length ? pool[(r() * pool.length) | 0] : c.spec;
    const child = {};
    child.spec = spec;
    child.kind = spec.kind;
    child.vi = (r() * CLOUD_VARIANTS) | 0;
    child.y = clamp(c.y + rnd(r, -0.014, 0.014), 0.02, 0.90);
    child.sx = rnd(r, 0.88, 1.24);
    child.sy = rnd(r, 0.90, 1.10);
    child.flip = r() < 0.5 ? 1 : -1;
    child.s = (parentW * CLOUD_SPLIT_SCALE) / Math.max(1, spec.w * child.sx);
    const depth = smoothstep(0.02, 0.92, child.y);
    child.a0 = lerp(1.0, 0.62, depth) * rnd(r, 0.94, 1.0);
    child.life = c.life * rnd(r, 0.55, 0.85);
    child.age = rnd(r, 0.20, 0.38) * child.life;   // 已长成，不再走生长段
    child.splitSign = sgn;
    child.x = c.x + sgn * sep;
    child.v = c.v * rnd(r, 0.86, 1.12);
    child.splitT = 0;
    child.splitKids = null;
    child.lastA = 0;
    out.push(child);
  }
  return out;
}

function buildScene() {
  const r = mulberry32((CFG.seed ^ 0x7A31) >>> 0);
  cloudRnd = mulberry32((CFG.seed ^ 0x9C41) >>> 0);
  const D = CFG.density;
  const TW = TILE_W * uiScale;

  ROLL_PH = [];
  for (let k = 0; k < BAND_T.length; k++) ROLL_PH.push(r() * TAU);

  /* ---------------- 云：一堆各自过着生命周期的云 ---------------- */
  clouds = [];
  /* 数量 +20%（原 VW/240） */
  const nCloud = Math.round(clamp(VW / 240 * 1.2 * CFG.cloudDensity, 2, 24));
  for (let i = 0; i < nCloud; i++) {
    const c = {};
    /* 初始化时把年龄打散到整条寿命上，开场就是一片成熟的云海，不会集体同步 */
    spawnCloud(c, r, r() * 1.0);
    clouds.push(c);
  }
  clouds.sort((a, b) => a.y - b.y);

  /* ---------------- 远山 ---------------- */
  ridges = [];
  {
    const rr = mulberry32((CFG.seed ^ 0x3B1D) >>> 0);
    for (let i = 0; i < HILL.length; i++) {
      const harm = [];
      for (let k = 0; k < 4; k++) {
        harm.push({ n: Math.round(rnd(rr, 1, 3 + i * 2)), a: rnd(rr, 0.10, 0.34), p: rr() * TAU });
      }
      ridges.push({ harm: harm, layer: HILL[i] });
    }
  }

  /* ---------------- 野花：按色阶分配，贴合地形起伏 ---------------- */
  flowers = [];
  tufts = [];
  for (let k = 0; k < BAND_FLOWERS.length; k++) {
    const nF = Math.max(4, Math.round(BAND_FLOWERS[k] * D * uiScale));
    for (let i = 0; i < nF; i++) {
      const tIn = Math.pow(r(), 0.78);          // 略偏向前方
      const sp = FLOWERS.find(f => f.id === PICK_FLOWER(r)) || FLOWERS[0];
      const tDepth = (BAND_T[k] + tIn * (BAND_T[k + 1] - BAND_T[k]));
      flowers.push({
        sp: sp, vi: (r() * 2) | 0,
        band: k, tIn: tIn,
        x: r() * TW,
        s: lerp(BAND_SCALE[k][0], BAND_SCALE[k][1], tIn) * uiScale * rnd(r, 0.86, 1.18),
        flip: r() < 0.5 ? 1 : -1,
        rot: rnd(r, -0.35, 0.35),
        jit: rnd(r, -0.055, 0.055),             // 波前相位抖动，开花带边缘是毛的
        sway: rnd(r, 0.5, 1.3),
        depth: tDepth,
      });
    }
    const nT = Math.max(0, Math.round(BAND_TUFTS[k] * D * uiScale));
    for (let i = 0; i < nT; i++) {
      tufts.push({
        band: k, tIn: Math.pow(r(), 0.7),
        x: r() * TW,
        s: lerp(BAND_SCALE[k][0], BAND_SCALE[k][1], 0.92) * uiScale * rnd(r, 0.75, 1.30),
        hMul: BAND_TUFT_H[k],
        /* 每株草自己的形态：叶数 2~4、整体倾倒方向、张开度、色阶
         * —— 全都固定成"3 片对称叶"会显得很机械。 */
        n: 2 + ((r() * 3) | 0),
        leanBias: rnd(r, -0.42, 0.42),
        spread: rnd(r, 0.72, 1.50),
        tone0: (r() * 5) | 0,
        flip: r() < 0.5 ? 1 : -1,
      });
    }
  }
  flowers.sort((a, b) => a.depth - b.depth);
  tufts.sort((a, b) => a.depth - b.depth);

  fringe = buildFringe();
  buildHerds();
  planes = [];
  planeRnd = mulberry32((CFG.seed ^ 0x5E11) >>> 0);
  nextPlaneAt = rnd(planeRnd, 0.10, 0.30) * CFG.planeInterval;   // 首架别让人等太久

  /* 低空双翼机：同样清空重来。首架 8~20 秒内出现，不用干等 */
  biplanes = [];
  biplaneRnd = mulberry32((CFG.seed ^ 0x7D3F) >>> 0);
  paratroopers = [];
  nextBiplaneAt = rnd(biplaneRnd, 8, 20);

}

/* 前景草叶带：贴在屏幕最下沿，横向无缝 */
function buildFringe() {
  const w = TILE_W * uiScale, h = 460;
  const cv = document.createElement('canvas');
  cv.width = Math.ceil(w * BS); cv.height = Math.ceil(h * BS);
  const g = cv.getContext('2d');
  g.scale(BS, BS);
  const r = mulberry32((CFG.seed ^ 0x51FE) >>> 0);
  const wrap = (bx, margin, fn) => { fn(bx); if (bx < margin) fn(bx + w); else if (bx > w - margin) fn(bx - w); };

  const tones = ['#2B5A1A', '#376C20', '#458228', '#54962F'];
  for (let layer = 0; layer < 3; layer++) {
    const n = 58 - layer * 10;
    for (let i = 0; i < n; i++) {
      const bx = (i + rnd(r, 0.1, 0.9)) * w / n;
      const hh = Math.pow(rnd(r, 0.12, 1.0), 1.25) * (150 - layer * 26);
      const lean = rnd(r, -0.5, 0.5);
      const bw = Math.max(1.9, hh * 0.038);
      wrap(bx, hh * 0.8 + 8, (bxx) => {
        const tipX = bxx + lean * hh;
        g.beginPath();
        g.moveTo(bxx - bw, h);
        g.quadraticCurveTo(bxx + lean * hh * 0.35 - bw * 0.5, h - hh * 0.55, tipX, h - hh);
        g.quadraticCurveTo(bxx + lean * hh * 0.35 + bw * 0.5, h - hh * 0.55, bxx + bw, h);
        g.closePath();
        g.fillStyle = tones[(layer + (i % 2)) % tones.length];
        g.fill();
      });
    }
  }
  return { cv: cv, w: w, h: h, screenH: 0.14 };
}


/* =========================================================================
 * 8. 远景的牛羊
 * -------------------------------------------------------------------------
 * 每群（牛群 / 羊群）共用一个状态机：吃草 ↔ 走动 交替；
 * 每头牲口再加自己的走路相位、头部延迟与啃食点动，
 * 于是同一群里的动作不会整齐划一 —— 这是"活着"的关键。
 * ======================================================================= */

/* ---- 被掀翻的动画时序（秒）：翻倒 → 侧→背翻转 → 倒地停留 → 起身 → 恢复待机 ----
 * 五段之和即整段动画的时长，期间该动物不可再次点击。
 * FLIP 曾叫 STRUGGLE、时长 1.40s，用 easeInOutCubic + 顿挫；
 * 现已改为 0.70s（−50%）的连贯翻转，理由见 advanceKnockdown 里的注释。 */
const KNOCK = { FALL: 0.45, FLIP: 0.70, DOWN: 1.10, RISE: 1.90, RECOVER: 0.80 };
const KNOCK_TOTAL = KNOCK.FALL + KNOCK.FLIP + KNOCK.DOWN + KNOCK.RISE + KNOCK.RECOVER;
/* ---- 倒地的旋转轴 ----
 * 真实动物倒下是**绕自身前后轴（脊椎轴）侧滚**：先倒向侧面，再翻成四脚朝天。
 * 在侧视图里这根轴垂直于画面，于是旋转的投影表现是
 *   「躯干截面按**椭圆**投影，过 90° 后符号翻转成上下颠倒」，
 * 而**不是**在画面里转圈 —— 后者看起来像前滚翻/后滚翻，是错的。
 *
 * 【务必用椭圆截面，不要用矩形】矩形截面 `体高·|cosθ| + 体宽·|sinθ|` 有两个毛病：
 *   ① θ=90° 时竖向尺寸掉到只剩体宽 → 压成纸片；② 中间角度还会先"变高"再塌下去。
 * 椭圆截面 `√(半高²cos²θ + 半厚²sin²θ)` 让躯干只在 0.43H↔0.54H 之间变化，全程保体积。
 *
 * 【第二件同样要命的事】投影只作用于**位置**，不作用于**部件自身厚度**。
 * 早先图省事对整只动物做统一竖向缩放，头/腿/躯干被一起压扁，也是纸片感的来源。
 * 正解是逐部件投影：位置乘 cosθ、厚度不缩放（详见 drawCow / drawSheep 的 kBody）。
 *
 * roll: 0 = 站立，0.5 = 侧躺（θ=90°），1 = 四脚朝天（θ=180°）。 */
const ROLL_LEAN = 0.11;        // 侧滚时附带的一点画面内倾斜，避免每只倒得一模一样

/* ---- 牛羊：数量比例 1:1 基准 + 有界随机浮动 ----------------------------------
 * 设定方式（四步，见 buildHerds）：
 *   1. 每群头数区间统一为 [HERD_CAP_LO, HERD_CAP_HI]，牛羊**相同** —— 这是 1:1 能成立的前提，
 *      两群容量不同的话"群数各半"也换不来"头数各半"。
 *   2. 群数 nHerd 由密度定；群种用等量列表 + 洗牌 → 两种的**群数**差 ≤1。
 *   3. 基准总头数 = nHerd × 每群基准头数（区间中位数）。取半作为 1:1 的基准。
 *   4. 在此基础上加**一次性的场景级偏差** dev（三角分布，峰值在 0），
 *      牛的头上 = 半数 + dev，羊的头上 = 总头数 − 牛的头上（**总数守恒**，
 *      不会出现两侧同时偏多/偏少）。dev 上限随总数缩放，见 HERD_RATIO_DEV。 */
const HERD_CAP_LO = 2, HERD_CAP_HI = 4;   // 每群头数区间（牛羊一致）
const HERD_RATIO_DEV = 0.12;              // 比例浮动上限 = 半数 × 12%

/* ---- 牛羊：个体间距与前后速度差 --------------------------------------------
 * 每个个体在群里有一个固定名次 rank ∈ [-1, +1]（+1 = 行进方向最前）：
 *   · 初始偏移  dx0 = rank × HERD_DX_SPAN  → 按名次**等距分层**，从第一帧起就不重叠
 *   · 速度因子  spd = 1 + HERD_SPD_SPREAD × rank  → 最前 +8%、最后 −8%，**恒 > 0，永不反向**
 *   · 目标偏移  dxT = dx0 × HERD_STRETCH  → 只在走路时朝它靠，到位即停
 * 于是间距随时间**单调拉开**到初始的 1.8 倍后稳定，保序且有界。 */
const HERD_DX_SPAN = 52;                  // 初始横向半间距（世界单位，×uiScale）
const HERD_STRETCH = 1.8;                 // 间距最终拉到的倍数
const HERD_SPD_SPREAD = 0.08;             // 前后个体速度差（±8%）

const HERD_KINDS = [
  /* push 是每群的个体数区间。牛羊的**群数各占一半、每群容量也拉平**，
   * 全局数量比才接近 1:1（原来牛群只占 34% 且每群更少，实测牛:羊 约 1:3）。
   * 容量区间必须与 HERD_CAP_LO/HI 一致 —— 两处不一致会让 1:1 慢慢漂掉。 */
  { id: 'cow',   len: 30, h: 17, push: [HERD_CAP_LO, HERD_CAP_HI], colors: [
      { body: '#E4C79E', shade: '#C4A276', patch: '#A9855C', head: '#CBA97E', horn: '#E0D2B4' },
      { body: '#F4EFE2', shade: '#D6CEBB', patch: '#9C8A74', head: '#DCD3C0', horn: '#D8C9A8' },
      { body: '#B08256', shade: '#946A44', patch: '#8A6240', head: '#9E7348', horn: '#D8C9A8' },
    ] },
  { id: 'sheep', len: 21, h: 14, push: [HERD_CAP_LO, HERD_CAP_HI], colors: [
      { body: '#F9F4E6', shade: '#DED6C2', head: '#7E6A54' },
      { body: '#F0EEE6', shade: '#D2CFC4', head: '#6E6454' },
      { body: '#FCF7EC', shade: '#E2DAC8', head: '#8C7458' },
    ] },
];

let herds = [];
let herdRnd = mulberry32(0x1D2F);

/* ---- 一头牛（侧视，原点在四蹄中心，向上为负）---- */
function drawCow(g, col, head, gait, ct) {
  /* ct = cos(侧滚角)：各部件的**位置**按它投影，1 站立、0 侧滚 90°、-1 四脚朝天。
   * 注意躯干不能跟着 ct 一起缩放 —— 躯干是有厚度的椭圆柱，
   * 它的竖向投影高度是 √(半高²cos²θ + 半厚²sin²θ)，在 90° 时只降到"体厚"，
   * 绝不会塌成一片纸。 */
  ct = ct === undefined ? 1 : ct;
  const L = 30, H = 19;
  const aB = H * 0.27, bB = H * 0.215;                 // 躯干半高 / 半厚
  const st = Math.sqrt(Math.max(0, 1 - ct * ct));
  const hs = Math.sqrt(aB * aB * ct * ct + bB * bB * st * st);
  const kBody = hs / aB;                               // 躯干竖向投影系数（约 0.80~1.00）
  const yBody = (-H * 0.73) * ct;                      // 躯干中心的投影位置
  const yBelly = yBody + aB * ct;                      // 腹线 = 腿根
  const LEG_MIN = 0.22;                                // 腿不完全消失，保证"有腿"的读感
  const legLen = (H * 0.46) * (LEG_MIN + (1 - LEG_MIN) * Math.abs(ct));
  const yFoot = yBelly + (ct >= 0 ? 1 : -1) * legLen;
  const bodyTop = yBody - hs, bodyBot = yBody + hs;
  const legW = L * 0.055;
  const sw = Math.sin(gait) * L * 0.085, sw2 = -sw;
  /* 躯干上的任一局部偏移（相对躯干中心）按 kBody 投影 */
  const yb = (dy) => yBody + dy * kBody;

  /* 腿：前后各两条，相位相反 */
  g.fillStyle = col.shade;
  const legs = [[-0.32 * L, sw], [-0.20 * L, sw2], [0.20 * L, sw2], [0.31 * L, sw]];
  for (const [lx, off] of legs) {
    g.beginPath();
    g.moveTo(lx - legW * 0.5, yBelly);
    g.lineTo(lx + off - legW * 0.42, yFoot);
    g.lineTo(lx + off + legW * 0.42, yFoot);
    g.lineTo(lx + legW * 0.5, yBelly);
    g.closePath();
    g.fill();
  }

  /* 躯干 */
  g.fillStyle = col.body;
  g.beginPath();
  const r = hs * 0.42;
  const x0 = -0.50 * L, y0 = bodyTop, w0 = L, h0 = bodyBot - bodyTop;
  g.moveTo(x0 + r, y0);
  g.lineTo(x0 + w0 - r, y0);
  g.quadraticCurveTo(x0 + w0, y0, x0 + w0, y0 + r);
  g.lineTo(x0 + w0, y0 + h0 - r);
  g.quadraticCurveTo(x0 + w0, y0 + h0, x0 + w0 - r, y0 + h0);
  g.lineTo(x0 + r, y0 + h0);
  g.quadraticCurveTo(x0, y0 + h0, x0, y0 + h0 - r);
  g.lineTo(x0, y0 + r);
  g.quadraticCurveTo(x0, y0, x0 + r, y0);
  g.closePath();
  g.fill();
  /* 肩部与臀部的小隆起 */
  g.beginPath(); g.ellipse(0.20 * L, yb(-H * 0.15), 0.20 * L, hs * 0.78, 0, 0, TAU); g.fill();
  g.beginPath(); g.ellipse(-0.34 * L, yb(-H * 0.13), 0.19 * L, hs * 0.72, 0, 0, TAU); g.fill();
  /* 腹下暗面（贴着当前朝下的那一侧） */
  g.fillStyle = col.shade;
  g.beginPath(); g.ellipse(-0.02 * L, bodyBot - hs * 0.22, 0.40 * L, hs * 0.42, 0, 0, TAU); g.fill();
  /* 花斑 */
  if (col.patch) {
    g.fillStyle = col.patch;
    g.beginPath(); g.ellipse(-0.22 * L, yb(-H * 0.03), 0.095 * L, hs * 0.53, 0.3, 0, TAU); g.fill();
    g.beginPath(); g.ellipse(0.12 * L, yb(H * 0.09), 0.070 * L, hs * 0.40, -0.2, 0, TAU); g.fill();
  }
  /* 尾巴 */
  g.strokeStyle = col.shade; g.lineWidth = L * 0.035; g.lineCap = 'round';
  g.beginPath();
  g.moveTo(-0.49 * L, yb(-H * 0.13));
  g.quadraticCurveTo(-0.58 * L, yb(H * 0.13), -0.54 * L, yb(H * 0.49));
  g.stroke();
  g.fillStyle = col.patch || col.shade;
  g.beginPath(); g.arc(-0.54 * L, yb(H * 0.51), L * 0.035, 0, TAU); g.fill();

  /* 脖子 + 头：绕肩点旋转，低头即吃草；竖向分量同样按 ct 投影。
   *
   * **脖子按"沿颈轴的垂直方向"给厚度，不要给固定的横/竖范围。**
   * 原先四角用的是 ±0.05L / ±0.01L 这类固定的横竖偏移，有两个毛病：
   *   ① 视觉粗细随俯仰角变化 —— 抬头时颈轴接近水平，那点竖向偏移几乎全成了颈厚；
   *      低头时颈轴接近竖直，横向偏移又成了颈厚。同一头牛在不同姿态下"胖瘦"不一样。
   *   ② 整体太细 —— 实测颈部厚度只有体高的 0.24 倍，看着像根细杆。
   * 真实牛的颈根接近体高的一半、靠头处约三成，所以取 0.48·hs / 0.28·hs 的半厚。 */
  const shx = 0.38 * L, shy = yb(-H * 0.13);
  const neck = lerp(0.52, 0.34, head) * L;
  const ang = lerp(1.15, 0.15, head);
  const hx = shx + Math.cos(ang) * neck;
  const hy = shy + Math.sin(ang) * neck * ct;
  /* 颈轴（已按 ct 投影）与其单位垂直向量 */
  const ax = Math.cos(ang), ay = Math.sin(ang) * ct;
  const alen = Math.hypot(ax, ay) || 1e-6;
  const px = -ay / alen, py = ax / alen;
  const rBase = hs * 0.48, rTip = hs * 0.28;      // 颈根 / 靠头处的半厚
  g.fillStyle = col.head;
  g.beginPath();
  g.moveTo(shx - px * rBase, shy - py * rBase);
  g.lineTo(hx - px * rTip, hy - py * rTip);
  g.lineTo(hx + px * rTip, hy + py * rTip);
  g.lineTo(shx + px * rBase, shy + py * rBase);
  g.closePath();
  g.fill();
  /* 耳朵 */
  g.beginPath(); g.ellipse(hx - L * 0.02, hy - hs * 0.26, L * 0.045, hs * 0.14, -0.5, 0, TAU); g.fill();
  g.beginPath(); g.ellipse(hx + L * 0.05, hy - hs * 0.24, L * 0.040, hs * 0.13, 0.4, 0, TAU); g.fill();
  /* 头 */
  g.beginPath(); g.ellipse(hx, hy, L * 0.105, hs * 0.30, ang * 0.35, 0, TAU); g.fill();
  /* 口鼻 */
  g.fillStyle = shade(col.head, -0.22);
  g.beginPath(); g.ellipse(hx + L * 0.070, hy + hs * 0.09, L * 0.055, hs * 0.16, ang * 0.35, 0, TAU); g.fill();
  /* 牛角 */
  if (col.horn) {
    g.strokeStyle = col.horn; g.lineWidth = L * 0.030;
    g.beginPath();
    g.moveTo(hx - L * 0.05, hy - hs * 0.26);
    g.quadraticCurveTo(hx - L * 0.11, hy - hs * 0.66, hx - L * 0.03, hy - hs * 0.76);
    g.stroke();
    g.beginPath();
    g.moveTo(hx + L * 0.03, hy - hs * 0.28);
    g.quadraticCurveTo(hx + L * 0.10, hy - hs * 0.66, hx + L * 0.02, hy - hs * 0.78);
    g.stroke();
  }
}

/* ---- 一只羊（毛团身体，短腿，头小）---- */
function drawSheep(g, col, head, gait, ct) {
  ct = ct === undefined ? 1 : ct;
  const L = 21, H = 15;
  const aB = H * 0.30, bB = H * 0.24;                  // 毛团的半高 / 半厚
  const st = Math.sqrt(Math.max(0, 1 - ct * ct));
  const hs = Math.sqrt(aB * aB * ct * ct + bB * bB * st * st);
  const kBody = hs / aB;
  const yBody = (-H * 0.68) * ct;
  const yBelly = yBody + aB * ct;
  const LEG_MIN = 0.22;
  const legLen = (H * 0.44) * (LEG_MIN + (1 - LEG_MIN) * Math.abs(ct));
  const yFoot = yBelly + (ct >= 0 ? 1 : -1) * legLen;
  const legW = L * 0.055;
  const sw = Math.sin(gait) * L * 0.075, sw2 = -sw;
  const yb = (dy) => yBody + dy * kBody;

  g.strokeStyle = col.head; g.lineWidth = legW; g.lineCap = 'round';
  for (const [lx, off] of [[-0.28 * L, sw], [-0.17 * L, sw2], [0.16 * L, sw2], [0.27 * L, sw]]) {
    g.beginPath();
    g.moveTo(lx, yBelly);
    g.lineTo(lx + off, yFoot);
    g.stroke();
  }

  /* 毛团：几个圆叠出蓬松轮廓。圆的半径只按躯干投影系数微调，
   * 不做整体压扁 —— 这样 90° 时仍然是一团有体积的羊毛。 */
  const blobs = [[-0.30 * L, -0.03 * H, 0.34 * L], [-0.06 * L, -0.13 * H, 0.37 * L],
                 [0.19 * L, -0.03 * H, 0.33 * L], [-0.17 * L, 0.15 * H, 0.28 * L],
                 [0.08 * L, 0.14 * H, 0.27 * L]];
  g.fillStyle = col.body;
  for (const [bx, by, br] of blobs) {
    g.beginPath(); g.ellipse(bx, yb(by), br, br * 0.80 * kBody, 0, 0, TAU); g.fill();
  }
  g.fillStyle = col.shade;
  g.beginPath(); g.ellipse(-0.04 * L, yb(0.26 * H), 0.34 * L, H * 0.16 * kBody, 0, 0, TAU); g.fill();

  /* 头 */
  const shx = 0.30 * L, shy = yb(-0.06 * H);
  const neck = lerp(0.40, 0.26, head) * L;
  const ang = lerp(1.28, 0.18, head);
  const hx = shx + Math.cos(ang) * neck;
  const hy = shy + Math.sin(ang) * neck * ct;
  g.fillStyle = col.head;
  g.beginPath(); g.ellipse(hx, hy, L * 0.130, H * 0.115 * kBody, ang * 0.3, 0, TAU); g.fill();
  /* 头顶的一撮毛 */
  g.fillStyle = col.body;
  g.beginPath(); g.ellipse(hx - L * 0.02, hy - H * 0.11 * kBody, L * 0.100, H * 0.075 * kBody, 0, 0, TAU); g.fill();
  /* 耳 */
  g.fillStyle = shade(col.head, -0.20);
  g.beginPath(); g.ellipse(hx - L * 0.07, hy - H * 0.03 * kBody, L * 0.065, H * 0.040 * kBody, -0.6, 0, TAU); g.fill();
  g.beginPath(); g.ellipse(hx + L * 0.07, hy - H * 0.03 * kBody, L * 0.065, H * 0.040 * kBody, 0.6, 0, TAU); g.fill();
}

/* ---- 建群 ---- */

/** 把 `total` 头牲口分摊到 k 个群，每群落在 [lo, hi] 内。
 *  先给每群下限，余量**逐头随机**分给还没满的群 —— 这样各群大小长短不一，
 *  比"前面几群吃满、后面只剩最低"自然得多。 */
function spreadHerdCounts(total, k, lo, hi, r) {
  if (k <= 0) return [];
  const out = new Array(k).fill(lo);
  let rest = Math.round(clamp(total, k * lo, k * hi)) - k * lo;
  let guard = 0;
  while (rest > 0 && guard++ < 100000) {
    const i = (r() * k) | 0;
    if (out[i] < hi) { out[i]++; rest--; }
  }
  return out;
}

function buildHerds() {
  herds = [];
  if (!CFG.animals || CFG.animalDensity <= 0) return;
  const r = mulberry32((CFG.seed ^ 0x2B77) >>> 0);
  herdRnd = mulberry32((CFG.seed ^ 0x71C3) >>> 0);
  /* 群数：原来按 VW/760 算是 2~4 群，现在放宽到 VW/520 得 3~5 群（1080p 约 4 群） */
  const nHerd = Math.round(clamp(VW / 520 * CFG.animalDensity, 2, 7));
  /* 群种用"等量列表 + 洗牌"而不是逐群掷骰子：随机会让某一侧偶然偏多，
   * 而元素用的是固定种子，这种偏差会在整个会话里一直存在。 */
  const kindPlan = [];
  for (let i = 0; i < nHerd; i++) kindPlan.push(HERD_KINDS[i % 2]);
  for (let i = kindPlan.length - 1; i > 0; i--) {
    const j = (r() * (i + 1)) | 0;
    const tmp = kindPlan[i]; kindPlan[i] = kindPlan[j]; kindPlan[j] = tmp;
  }

  /* ---------------- 数量：1:1 基准 + 一次性场景级随机偏差 ----------------
   * 基准总头数 = 群数 × 每群基准头数（容量区间中位数）。牛的头上取半数 + dev，
   * 羊的头上 = 总数 − 牛的头上 → **总数守恒**，两侧不会同时偏多或偏少。
   * dev 用三角分布（r()−r() 的分布峰值在 0），上限 max(1, round(半数 × 12%))：
   * 总数越多浮动上限越大，小场景也不会因为四舍五入而恒为 0。 */
  const midPerHerd = (HERD_CAP_LO + HERD_CAP_HI) / 2;
  const total = nHerd * midPerHerd;
  const half = total / 2;
  const devMax = Math.max(1, Math.round(half * HERD_RATIO_DEV));
  const dev = Math.round((r() - r()) * devMax);          // 三角分布，∈[-devMax, devMax]
  const nCowHerd = kindPlan.filter(k => k.id === 'cow').length;
  const nSheepHerd = nHerd - nCowHerd;
  let cowTotal = Math.round(half + dev);
  let sheepTotal = total - cowTotal;
  /* 夹到各自**可行区间**（群数 × 容量），否则分摊时会分不出来 */
  cowTotal = clamp(cowTotal, nCowHerd * HERD_CAP_LO, nCowHerd * HERD_CAP_HI);
  sheepTotal = clamp(sheepTotal, nSheepHerd * HERD_CAP_LO, nSheepHerd * HERD_CAP_HI);
  const cowSizes = spreadHerdCounts(cowTotal, nCowHerd, HERD_CAP_LO, HERD_CAP_HI, r);
  const sheepSizes = spreadHerdCounts(sheepTotal, nSheepHerd, HERD_CAP_LO, HERD_CAP_HI, r);
  let ci = 0, si = 0;

  for (let i = 0; i < nHerd; i++) {
    const kind = kindPlan[i];
    const cnt = kind.id === 'cow' ? cowSizes[ci++] : sheepSizes[si++];
    /* 只放在地平线以下的远景带里。gy 下限要留出牲口自身的高度，
     * 否则靠近地平线的那些会把头探出地平线、看着像浮在山前面。 */
    const gy = rnd(r, 0.068, 0.205);
    const gN = clamp01((gy - 0.068) / 0.137);
    const baseS = lerp(1.00, 1.38, gN) * uiScale;
    /* 横向落点向画面中部与右侧偏置：r^0.8 会把分布往大值压，
     * 0.34~0.96 的区间上均值约 0.68（原来是在 0.12~0.88 上均匀分布，均值 0.50）。 */
    const spread0 = rnd(r, 90, 200) * uiScale;
    let homeX = CFG.ox + (0.34 + Math.pow(r(), 0.8) * 0.62) * VW;
    /* 巡逻范围是 homeX ± span，靠右的那些要把出生点往回收，
     * 否则走到右边界时会走出屏幕。 */
    homeX = Math.min(homeX, CFG.ox + 0.97 * VW - spread0);
    const herd = {
      kind: kind, gy: gy,
      cx: homeX, homeX: homeX,
      dir: r() < 0.5 ? 1 : -1,
      speed: rnd(r, 5.0, 9.0) * uiScale,
      span: spread0,
      state: 'graze',
      timer: rnd(r, 2, 26),
      alpha: lerp(0.90, 1.0, gN),
      members: [],
    };
    for (let k = 0; k < cnt; k++) {
      /* 名次 rank：按索引在 [-1, +1] 上**等距分层**（+1 = 行进方向最前）。
       * 单只时 rank = 0（居中）。分层保证第一帧起个体就不重叠 ——
       * 原来用 rnd(-52,52) 随机撒，两只撞在一起是常事。抖动 ±5 让每群不呆板。 */
      const rank = clamp(cnt > 1 ? (k / (cnt - 1)) * 2 - 1 : 0, -1, 1);
      const dx0 = (rank * HERD_DX_SPAN + rnd(r, -5, 5)) * uiScale;
      herd.members.push({
        /* 被掀翻的状态：lockT > 0 表示动画进行中 */
        lockT: 0, stateT: 0, state: 'idle', roll: 0, tipDir: 1, anchorX: 0,
        rank: rank,                 // 前后名次，决定速度差的方向
        dx0: dx0,                   // 初始横向偏移
        dx: dx0,                    // 当前横向偏移（走路时朝 dxT 漂移）
        dxT: dx0 * HERD_STRETCH,    // 目标偏移：初始的 1.8 倍
        spd: 1 + HERD_SPD_SPREAD * rank,   // 速度因子：最前 ×1.08、最后 ×0.92
        dy: rnd(r, -0.014, 0.014),
        s: baseS * rnd(r, 0.86, 1.16),
        gait: r() * TAU,
        head: 0.05,
        look: false,
        lookTimer: rnd(r, 3, 16),
        nibble: r() * TAU,
        box: r() * TAU,
        col: kind.colors[(r() * kind.colors.length) | 0],
      });
    }
    herds.push(herd);
  }
}

/** 一头牲口在屏幕上的位置与包围盒。
 *  原点取四蹄中心，box 向上覆盖到伸长的脖子和头（低头吃草时头会探到体前下方，
 *  所以高度按体高的 1.85 倍算，宁可给宽一点也好点。 */
function animalScreenPos(h, a) {
  const wx = a.lockT > 0 ? a.anchorX : h.cx + a.dx * h.dir;
  const py = HY + GH * clamp01(h.gy + a.dy);
  return {
    x: wx - CFG.ox, y: py,
    w: h.kind.len * a.s * 1.30,
    h: h.kind.h * a.s * 1.85,
  };
}

/** 掀翻：记下倒地位置（动画期间脱开牛群的位移，免得被同伴拖走），开始计时 */
function knockOver(h, a, r) {
  a.anchorX = h.cx + a.dx * h.dir;
  a.lockT = KNOCK_TOTAL;
  a.stateT = 0;
  a.state = 'fall';
  a.roll = 0;
  a.tipDir = r() < 0.5 ? 1 : -1;
}

/** 推进五段状态机。roll 是绕**自身前后轴**的侧滚量：
 *  0 = 站立、0.5 = 侧躺（θ=90°）、1 = 四脚朝天（θ=180°）。 */
function advanceKnockdown(h, a, dt, t) {
  a.lockT -= dt;
  a.stateT += dt;
  if (a.lockT <= 0) {
    /* 动画结束：把它的相对偏移重新锚到牛群当前位置，避免归位时瞬移 */
    a.dx = (a.anchorX - h.cx) * h.dir;
    a.lockT = 0; a.stateT = 0; a.state = 'idle'; a.roll = 0;
    return;
  }
  let e = a.stateT;
  if (e < KNOCK.FALL) {
    /* 一：向侧边倒下（0 → 0.5，即 θ 0° → 90°），按 p² 加速，像重力作用 */
    a.state = 'fall';
    const p = e / KNOCK.FALL;
    a.roll = 0.5 * p * p;
  } else if ((e -= KNOCK.FALL) < KNOCK.FLIP) {
    /* 二：从侧躺连续翻到四脚朝天（0.5 → 1，即 θ 90° → 180°）。
     *
     * 这一段原先用 `easeInOutCubic(p)` 叠 `sin(4πp)·(1−p)·0.06` 的顿挫，两个毛病：
     *   ① **easeInOutCubic 在 p=0 处速度为 0** —— 侧躺之后要先"卡"一下才起动，
     *      读感是"躺平 → 停住 → 过一会儿才翻过去"，而不是一个连续的动作；
     *   ② 顿挫让 roll 来回摆动，把"卡顿"进一步放大。
     *
     * 现在改用 `easeOutCubic`，三个性质刚好都要：
     *   · f'(0) = 3 ≠ 0  → **立即起动**，没有停顿
     *   · f'(1) = 0      → 落定到四脚朝天，无过冲、不弹跳
     *   · f'(p) = 3(1−p)² ≥ 0 → **严格单调**，全程不回头
     * 与上一段的衔接也几乎 C¹ 连续（速度差 3.6%，肉眼不可辨）：
     *   倒下段结束速度  = 1 / FALL = 1/0.45          = 2.222 /s
     *   翻转段起始速度  = 0.5·3 / FLIP = 1.5/0.70    = 2.143 /s
     * 时长同时压到原来的一半（1.40s → 0.70s）。 */
    a.state = 'flip';
    const p = clamp01(e / KNOCK.FLIP);
    a.roll = clamp01(0.5 + 0.5 * easeOutCubic(p));
  } else if ((e -= KNOCK.FLIP) < KNOCK.DOWN) {
    a.state = 'down';
    a.roll = 1;                                           // 四脚朝天，一动不动
  } else if ((e -= KNOCK.DOWN) < KNOCK.RISE) {
    /* 四：起身 —— 从背部滚回侧面、再滚回脚下，单调经过 0.5，
     *     叠加随进度衰减的摆动（像翻身找支点），末尾轻微过冲 */
    a.state = 'rise';
    const p = e / KNOCK.RISE;
    const wob = Math.sin(p * Math.PI * 3.0) * (1 - p) * 0.13;
    a.roll = clamp01(1 - easeInOutCubic(p) + wob);
  } else {
    a.state = 'recover';
    const p = clamp01((e - KNOCK.RISE) / KNOCK.RECOVER);
    a.roll = Math.abs((1 - p) * Math.sin(p * Math.PI * 2)) * 0.06;
  }
}

/* ---- 状态机：吃草 ↔ 走动 ---- */
function updateHerds(dt, t) {
  const r = herdRnd;
  for (const h of herds) {
    h.timer -= dt;
    if (h.timer <= 0) {
      if (h.state === 'graze') { h.state = 'walk'; h.timer = rnd(r, 8, 18); }
      else { h.state = 'graze'; h.timer = rnd(r, 14, 34); }
    }
    if (h.state === 'walk') {
      h.cx += h.speed * h.dir * dt;
      if (h.cx < h.homeX - h.span) h.dir = 1;
      else if (h.cx > h.homeX + h.span) h.dir = -1;
    }
    for (const a of h.members) {
      /* 倒地动画优先：期间这只不参与群体的走动与吃草，也不再响应点击 */
      if (a.lockT > 0) {
        advanceKnockdown(h, a, dt, t);
        a.head += (0.12 - a.head) * Math.min(1, dt * 5);
        a.nibble += dt * 2.6;
        a.box += dt * 0.9;
        continue;
      }
      /* 前后速度差带来的横向漂移。要点三条：
       *   ① **只在走路时施加** —— 吃草时群体中心不动，那时挪位置会看着像自己侧滑；
       *   ② 朝各自的目标偏移 a.dxT（= 初始偏移 × 1.8）靠拢，**到位即停** ——
       *      于是间距随走动次数单调拉开、上限有界，不会无限发散；
       *   ③ spd = 1 ± 8% **恒为正**，所以个体速度永远与群体同向，不会反向。
       * 名次为正（靠前）的个体 spd > 1，越走越前；名次为负的越走越后 ——
       * 这正是"前后个体速度略有不同 → 逐渐拉开间距"的物理来源。 */
      if (h.state === 'walk') {
        const gap = a.dxT - a.dx;
        if (gap !== 0 && Math.sign(a.spd - 1) === Math.sign(gap)) {
          const before = gap;
          a.dx += (a.spd - 1) * h.speed * dt;
          /* 单帧就跨过目标时贴住，避免围绕目标来回抖 */
          if (Math.abs(a.dxT - a.dx) > Math.abs(before)) a.dx = a.dxT;
        }
      }
      /* 走路相位：走时明显摆，吃草时几乎不动（偶尔挪半步） */
      a.gait += dt * (h.state === 'walk' ? 2.1 : 0.30) * TAU * 0.5;
      a.nibble += dt * 2.6;
      a.box += dt * 0.9;
      /* 吃草期间偶尔抬头张望 */
      if (h.state === 'graze') {
        a.lookTimer -= dt;
        if (a.lookTimer <= 0) {
          a.look = !a.look;
          a.lookTimer = a.look ? rnd(r, 1.8, 4.0) : rnd(r, 7, 22);
        }
      } else { a.look = false; }
      const target = h.state === 'walk' ? 0.94 : (a.look ? 0.86 : 0.05);
      a.head += (target - a.head) * Math.min(1, dt * 2.4);
    }
  }
}

function drawHerds(g, t) {
  for (const h of herds) {
    for (const a of h.members) {
      const down = a.lockT > 0;
      const wx = down ? a.anchorX : h.cx + a.dx * h.dir;
      const py = HY + GH * clamp01(h.gy + a.dy);
      if (py < HY || py > VH) continue;
      const head = down ? 0.10 : clamp01(a.head);
      /* 翻转段四蹄蹬一下（幅度与频率都从原来的 1.1 / 16 收小到 0.8 / 12：
       * 这一段现在只有 0.70s，沿用旧值会让腿抖得比身体还抢眼，反而显乱） */
      const gaitArg = a.gait + (a.state === 'flip' ? Math.sin(t * 12 + a.box) * 0.8 : 0);
      const ctArg = Math.cos(Math.PI * (a.roll || 0));

      g.save();
      g.globalAlpha = h.alpha;
      g.translate(wx - CFG.ox, py);

      /* 地面投影不随翻倒旋转，否则会跟着立起来 */
      g.save();
      g.fillStyle = 'rgba(46,74,26,0.34)';
      g.beginPath();
      g.ellipse(0, 0.6 * a.s, h.kind.len * 0.40 * a.s, h.kind.h * 0.13 * a.s, 0, 0, TAU);
      g.fill();
      g.restore();

      /* ---- 侧滚 ----
       * 只把 cosθ 交给绘制函数，由它决定各部件的**投影位置**；
       * 整只动物不再做统一竖向缩放 —— 那会把头、腿、躯干一起压扁成纸片。
       * 躯干是有厚度的椭圆柱，竖向投影半高 = √(半高²cos²θ + 半厚²sin²θ)，
       * 到 90° 时只降到"体厚"，绝不会塌。这里只负责把整体抬到地面。 */
      const th = Math.PI * (a.roll || 0);
      const ctv = Math.cos(th), stv = Math.sin(th);
      const H0 = h.kind.h;
      const isCow = (h.kind.id === 'cow');
      const aB = H0 * (isCow ? 0.27 : 0.30);
      const bB = H0 * (isCow ? 0.215 : 0.24);
      const hs = Math.sqrt(aB * aB * ctv * ctv + bB * bB * stv * stv);
      const yBody = (-H0 * (isCow ? 0.73 : 0.68)) * ctv;
      const yBelly = yBody + aB * ctv;
      const legLen = (H0 * (isCow ? 0.46 : 0.44)) * (0.22 + 0.78 * Math.abs(ctv));
      const footY2 = yBelly + (ctv >= 0 ? 1 : -1) * legLen;
      const lowest = Math.max(yBody + hs, footY2, yBelly);
      /* 侧滚时附带一点画面内倾斜，免得每只倒得一模一样 */
      g.rotate(a.tipDir * ROLL_LEAN * stv);
      g.translate(0, -lowest * a.s);
      g.scale(a.s * h.dir, a.s);
      g.translate(0, Math.sin(a.box) * 0.30);

      const nib = (h.state === 'graze' && !a.look && !down)
        ? Math.sin(a.nibble) * 0.055 * (1 - head) : 0;
      if (h.kind.id === 'cow') drawCow(g, a.col, Math.min(1, head + nib), gaitArg, ctArg);
      else drawSheep(g, a.col, Math.min(1, head + nib), gaitArg, ctArg);
      g.restore();
      drawCalls++;
    }
  }
  g.setTransform(DBASE, 0, 0, DBASE, 0, 0);
}

/* =========================================================================
 * 9. 天空中的客机与云迹
 * -------------------------------------------------------------------------
 * 不定时（30~110 秒随机间隔）从天空一侧飞入、横穿后飞出，身后拖一条云迹。
 * 云迹按采样点存，越老越宽越淡 —— 这是真实的凝结尾迹的形态。
 * ======================================================================= */
let planes = [];
let nextPlaneAt = 0;
let planeRnd = mulberry32(0x5E11);
const TRAIL_LIFE = 20;      // 云迹存活秒数
const PLANE_TAIL_X = -17.5; // 机尾在机身局部坐标中的位置（机头在 +x 方向）
let planeCount = 0;         // 统计用

function spawnPlane(t, r) {
  const dir = r() < 0.5 ? 1 : -1;
  planes.push({
    x: dir > 0 ? CFG.ox - 0.14 * VW : CFG.ox + 1.14 * VW,
    y: rnd(r, 0.06, 0.36),                        // 天空高度比例
    /* 速度取原值的一半（原 92~168）。俯仰角由 vyR/|vx| 决定，
     * 所以 vyR 也同步减半，否则视觉上会变成机头翘得很高。 */
    vx: dir * rnd(r, 46, 84) * uiScale,
    vyR: rnd(r, -0.005, 0.005) * CFG.cloudSpeed,  // 轻微爬升 / 下降
    s: rnd(r, 0.86, 1.30) * uiScale,
    flip: dir,
    ang: 0,                                       // 机头朝向（每帧重算）
    trail: [],
    sampleT: 0,
  });
  planeCount++;
}

function updatePlanes(dt, t, r) {
  if (CFG.planes && t >= nextPlaneAt && planes.length < 2) {
    spawnPlane(t, r);
    /* 间隔在均值的 0.43~1.57 倍之间随机 —— 这就是"不定时" */
    nextPlaneAt = t + CFG.planeInterval * rnd(r, 0.43, 1.57);
  } else if (!CFG.planes) {
    nextPlaneAt = Math.max(nextPlaneAt, t + CFG.planeInterval);
  }
  for (let i = planes.length - 1; i >= 0; i--) {
    const p = planes[i];
    p.x += p.vx * dt;
    p.y += p.vyR * dt;

    /* 机头朝向 = 俯仰角，且**不能**把飞行方向角整个转过去：
     * 左飞时 atan2 本身就带 180° 翻转，再叠一次 scale(-1) 镜像会互相抵消、
     * 机头就朝后了。所以只取俯仰，方向交给镜像。 */
    const pitch = Math.atan2(p.vyR * HY, Math.abs(p.vx));
    p.ang = p.flip > 0 ? pitch : -pitch;

    p.sampleT -= dt;
    if (p.sampleT <= 0) {
      p.sampleT = 0.085;
      /* 采样点落在**机尾**而不是机身中心 —— 否则云迹看着像从机头冒出来 */
      const ca = Math.cos(p.ang), sa = Math.sin(p.ang);
      const tx = PLANE_TAIL_X * p.flip * p.s * ca;
      const ty = PLANE_TAIL_X * p.flip * p.s * sa;
      p.trail.push({ x: p.x + tx, y: p.y + ty / HY, a: 0 });
    }
    for (const sp of p.trail) sp.a += dt;
    while (p.trail.length && p.trail[0].a > TRAIL_LIFE) p.trail.shift();
    const sx = p.x - CFG.ox;
    if (sx < -0.30 * VW || sx > 1.30 * VW) planes.splice(i, 1);
  }
}

/** 机身：侧视客机，机头朝 +x。原点在机身中心。 */
function drawPlaneBody(g) {
  /* 主翼（后掠） */
  g.fillStyle = '#DDE6EE';
  g.beginPath();
  g.moveTo(3.5, -0.6); g.lineTo(-5.5, -12.5); g.lineTo(-9.5, -12.5); g.lineTo(-3.0, -0.6);
  g.closePath(); g.fill();
  g.beginPath();
  g.moveTo(3.5, 0.6); g.lineTo(-5.5, 12.5); g.lineTo(-9.5, 12.5); g.lineTo(-3.0, 0.6);
  g.closePath(); g.fill();
  /* 尾翼 */
  g.beginPath();
  g.moveTo(-11.5, -1.0); g.lineTo(-15.5, -8.5); g.lineTo(-18.0, -8.5); g.lineTo(-16.0, -1.0);
  g.closePath(); g.fill();
  g.beginPath();
  g.moveTo(-12.0, 0.8); g.lineTo(-16.5, 5.0); g.lineTo(-18.5, 5.0); g.lineTo(-15.0, 0.8);
  g.closePath(); g.fill();
  /* 发动机 */
  g.fillStyle = '#C2CEDB';
  g.beginPath(); g.ellipse(-2.0, -5.4, 2.0, 1.1, 0.18, 0, TAU); g.fill();
  g.beginPath(); g.ellipse(-2.0, 5.4, 2.0, 1.1, -0.18, 0, TAU); g.fill();
  /* 机身 */
  g.fillStyle = '#FBFDFE';
  g.beginPath();
  g.moveTo(18.5, 0);
  g.quadraticCurveTo(14.0, -2.5, 3.0, -2.5);
  g.lineTo(-14.0, -2.3);
  g.quadraticCurveTo(-17.5, -1.4, -17.5, 0);
  g.quadraticCurveTo(-17.5, 1.4, -14.0, 2.3);
  g.lineTo(3.0, 2.5);
  g.quadraticCurveTo(14.0, 2.5, 18.5, 0);
  g.closePath(); g.fill();
  /* 腹部阴影 + 舷窗 */
  g.fillStyle = '#D3DEE8';
  g.beginPath();
  g.moveTo(16.0, 0.6); g.quadraticCurveTo(6, 3.0, -13.5, 2.2);
  g.quadraticCurveTo(-16.5, 1.4, -17.0, 0.2);
  g.quadraticCurveTo(-6, 1.4, 16.0, 0.6);
  g.closePath(); g.fill();
  g.fillStyle = 'rgba(120,150,178,0.55)';
  for (let i = 0; i < 7; i++) {
    g.beginPath(); g.arc(8.5 - i * 3.1, -0.35, 0.42, 0, TAU); g.fill();
  }
}

function drawPlanes(g, t) {
  if (!planes.length) return;
  for (const p of planes) {
    const sprX = p.x - CFG.ox;
    /* 云迹：逐段画，越老越宽越淡（真实凝结尾迹会慢慢散开） */
    for (let i = 1; i < p.trail.length; i++) {
      const s0 = p.trail[i - 1], s1 = p.trail[i];
      const k = clamp01(s1.a / TRAIL_LIFE);
      let al = (1 - k) * (1 - k) * 0.88;
      al *= smoothstep(0, 0.9, s1.a);          // 紧贴机尾的一小段还没有迹
      al *= smoothstep(0.02, ICON_SAFE_X * 0.85, (s1.x - CFG.ox) / VW);
      if (al <= 0.006) continue;
      const w = lerp(1.5, 5.6, k) * p.s;
      g.strokeStyle = 'rgba(255,255,255,' + al.toFixed(3) + ')';
      g.lineWidth = w;
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(s0.x - CFG.ox, s0.y * HY);
      g.lineTo(s1.x - CFG.ox, s1.y * HY);
      g.stroke();
      drawCalls++;
    }
    /* 机身 */
    if (sprX < -80 || sprX > VW + 80) continue;
    const fade = smoothstep(-0.02, ICON_SAFE_X * 0.8, sprX / VW);
    if (fade <= 0.01) continue;
    const keep = g.globalAlpha;
    g.globalAlpha = keep * fade;
    g.save();
    g.translate(sprX, p.y * HY);
    g.rotate(p.ang);                 // 已按镜像方向取过符号
    g.scale(p.s * p.flip, p.s);
    drawPlaneBody(g);
    g.restore();
    g.globalAlpha = keep;
    drawCalls++;
  }
  g.setTransform(DBASE, 0, 0, DBASE, 0, 0);
}

/* =========================================================================
 * 9.5 低空红色双翼机 + 飞行员跳伞
 * -------------------------------------------------------------------------
 * 一架红色双翼螺旋桨飞机在**屏幕中部偏下、贴着地平线上方**低空掠过（比例
 * y ∈ [0.86, 0.94]，即屏幕 y ≈ 0.47~0.52 VH）。随机出现、屏幕内至多一架 ——
 * 这一点靠"上一架完全飞出屏幕后才允许生成下一架"保证，不是靠计数上限。
 *
 * 点中它触发彩蛋：飞行员从座舱弹出，先向上抛一下 → 自由落体 → 开伞 →
 * 飘落 → 落地收伞站起 → 渐隐。飞机无人驾驶继续飞出屏幕。
 *
 * 跳伞沿用第 11 节的坐标约定（x 世界坐标 + 屏幕像素 y），重力与 confetti
 * 共用 CONF_G，开伞后的垂直终端速度另设 CHUTE_VY。
 * ======================================================================= */
const BIPLANE_Y_LO = 0.86;   // 基础高度比例下限（贴地平线上方掠过）
const BIPLANE_Y_HI = 0.94;
const CM_TO_PX = 96 / 2.54;  // 1 厘米 ≈ 37.8 物理像素（96 DPI 基准，高分屏再乘 uiScale）
const CHUTE_VY = 35;         // 开伞后的垂直终端速度（世界单位/秒）
const CHUTE_VX = 22;         // 随风横向漂移速度（世界单位/秒）
let biplanes = [];
let nextBiplaneAt = 0;
let biplaneRnd = mulberry32(0x7D3F);
let paratroopers = [];

function spawnBiplane(t, r) {
  const dir = r() < 0.5 ? 1 : -1;
  /* 在基础高度区间上，每架再随机抬升 2~3 厘米：厘米按 96 DPI 折算物理像素，
   * 乘 uiScale 在高分屏自动补偿，除以 HY 转回高度比例。 */
  const lift = rnd(r, 2, 3) * CM_TO_PX * uiScale / HY;
  biplanes.push({
    x: dir > 0 ? CFG.ox - 0.16 * VW : CFG.ox + 1.16 * VW,
    y: rnd(r, BIPLANE_Y_LO, BIPLANE_Y_HI) - lift,
    vx: dir * rnd(r, 60, 110) * uiScale,   // 低空近景，比高空客机稍快
    s: rnd(r, 0.9, 1.15) * 1.3 * uiScale,  // 尺寸 +30%；飞行员继承 b.s，随飞机一起放大
    flip: dir,
    prop: r() * TAU,                        // 螺旋桨相位
    propSpd: rnd(r, 22, 30),                // 螺旋桨转速（rad/s）
    ejected: false,                         // 是否已触发跳伞
  });
}

function updateBiplanes(dt, t, r) {
  if (CFG.biplane && t >= nextBiplaneAt && biplanes.length < 1) {
    spawnBiplane(t, r);
    /* 间隔在均值的 0.5~1.6 倍之间随机 —— 与客机的"不定时"同一条思路 */
    nextBiplaneAt = t + CFG.biplaneInterval * rnd(r, 0.5, 1.6);
  } else if (!CFG.biplane) {
    nextBiplaneAt = Math.max(nextBiplaneAt, t + CFG.biplaneInterval);
  }
  for (let i = biplanes.length - 1; i >= 0; i--) {
    const b = biplanes[i];
    b.x += b.vx * dt;
    b.prop += b.propSpd * dt;
    const sx = b.x - CFG.ox;
    if (sx < -0.30 * VW || sx > 1.30 * VW) biplanes.splice(i, 1);
  }
}

/** 机头朝 +x 的侧视双翼机，原点在机身中心。 */
function drawBiplaneBody(g, b) {
  /* 螺旋桨盘（机头前方）：半透明残影 + 绕机头旋转的桨叶 */
  const px = 14.5, py = 0;
  g.fillStyle = 'rgba(120,120,130,0.22)';
  g.beginPath(); g.arc(px, py, 5.4, 0, TAU); g.fill();
  const ca = Math.cos(b.prop), sa = Math.sin(b.prop);
  g.strokeStyle = '#4A4A4A'; g.lineWidth = 1.8; g.lineCap = 'round';
  g.beginPath();
  g.moveTo(px - ca * 5.4, py - sa * 5.4);
  g.lineTo(px + ca * 5.4, py + sa * 5.4);
  g.stroke();

  /* 机身：红色胶囊，机头尖、机尾收 */
  g.fillStyle = '#E23B3B';
  g.beginPath();
  g.moveTo(16.5, 0);
  g.quadraticCurveTo(16.5, -2.9, 8, -3.1);
  g.lineTo(-10, -2.6);
  g.quadraticCurveTo(-14, -2.2, -14, 0);
  g.quadraticCurveTo(-14, 2.2, -10, 2.6);
  g.lineTo(8, 3.1);
  g.quadraticCurveTo(16.5, 2.9, 16.5, 0);
  g.closePath(); g.fill();
  /* 机身下缘暗部 */
  g.fillStyle = 'rgba(90,10,10,0.28)';
  g.beginPath();
  g.moveTo(9, 3.1); g.lineTo(-10, 2.6);
  g.quadraticCurveTo(-14, 2.2, -14, 0);
  g.quadraticCurveTo(-13, 1.4, -5, 1.6);
  g.lineTo(9, 1.5); g.closePath(); g.fill();

  /* 下翼（贴机身下方、略窄） */
  g.fillStyle = '#C82E2E';
  g.beginPath();
  g.moveTo(7, 1.6); g.lineTo(7, 3.9); g.lineTo(-9, 3.9); g.lineTo(-9.5, 1.6);
  g.closePath(); g.fill();
  /* 上翼（机身正上方、更靠上） */
  g.fillStyle = '#D43A3A';
  g.beginPath();
  g.moveTo(9, -5.6); g.lineTo(9, -8.4); g.lineTo(-10, -8.4); g.lineTo(-10.5, -5.6);
  g.closePath(); g.fill();

  /* 翼间支柱：三根 N 型支柱，双翼机的标志性结构 */
  g.strokeStyle = '#5A2E1E'; g.lineWidth = 1.15; g.lineCap = 'round';
  g.beginPath();
  g.moveTo(6, -5.6); g.lineTo(6, 1.6);
  g.moveTo(-1, -5.6); g.lineTo(-1, 1.6);
  g.moveTo(-8, -5.6); g.lineTo(-8, 1.6);
  g.stroke();

  /* 机尾：水平尾翼 + 垂直方向舵 */
  g.fillStyle = '#E23B3B';
  g.beginPath();
  g.moveTo(-12, -1); g.lineTo(-16.5, -3); g.lineTo(-16.5, -0.5); g.lineTo(-12, 0.2);
  g.closePath(); g.fill();
  g.beginPath();
  g.moveTo(-13, -2.2); g.lineTo(-15, -6.2); g.lineTo(-13.6, -6.2); g.lineTo(-12.4, -2.2);
  g.closePath(); g.fill();

  /* 起落架轮子 */
  g.fillStyle = '#333';
  g.beginPath(); g.arc(-3.5, 4.9, 1.5, 0, TAU); g.fill();
  g.beginPath(); g.arc(5, 4.9, 1.5, 0, TAU); g.fill();

  /* 座舱里的飞行员：跳伞离机后不再画（上翼在其上方，不再遮挡） */
  if (!b.ejected) {
    g.fillStyle = '#FFE0C0';                 // 脸
    g.beginPath(); g.arc(0.5, -4.2, 2.1, 0, TAU); g.fill();
    g.fillStyle = '#8B5A2B';                 // 头盔/护目镜带
    g.beginPath(); g.arc(0.5, -4.4, 2.1, Math.PI, TAU); g.fill();
    g.fillStyle = '#5A3A1E';                 // 衣服
    g.fillRect(-1.6, -2.4, 4.2, 3.6);
  }
}

function drawBiplanes(g, t) {
  if (!biplanes.length) return;
  for (const b of biplanes) {
    const sx = b.x - CFG.ox;
    if (sx < -120 || sx > VW + 120) continue;
    g.save();
    g.translate(sx, b.y * HY);
    g.scale(b.s * b.flip, b.s);
    drawBiplaneBody(g, b);
    g.restore();
    drawCalls++;
  }
  g.setTransform(DBASE, 0, 0, DBASE, 0, 0);
}

/* ------------------------------------------------------------ 跳伞飞行员 */

/** 飞行员从座舱弹出：继承机速（水平），垂直先向上抛一下再进入自由落体。 */
function spawnParatrooper(b, r) {
  paratroopers.push({
    x: b.x,
    y: b.y * HY,                               // 出舱点（屏幕像素 y）
    vx: b.vx,
    vy: -rnd(r, 40, 80) * uiScale,             // 出舱向上抛
    s: b.s,
    state: 'eject',                            // eject → fall → deploy → descend → land → fade
    t: 0,
    chute: 0,                                  // 伞展开程度 0~1
    landY: HY + GH * rnd(r, 0.20, 0.32),       // 落地（草地中前部，给飘落留出高度差）
    sway: r() * TAU,
    windDrift: rnd(r, 0.4, 1.2),
    fade: 1,
  });
}

function updateParatroopers(dt, t) {
  for (let i = paratroopers.length - 1; i >= 0; i--) {
    const p = paratroopers[i];
    p.t += dt;
    switch (p.state) {
      case 'eject':
        /* 出舱：先上抛，重力略弱，0.4s 后进入自由落体 */
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vy += CONF_G * 0.4 * dt;
        if (p.t > 0.4) { p.state = 'fall'; p.t = 0; }
        break;
      case 'fall':
        /* 自由落体：伞未开，重力稍弱（低空跳伞本来下落就短，压着点别一下落完） */
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vy += CONF_G * 0.8 * dt;
        p.vx *= (1 - 0.3 * dt);
        if (p.t > 0.5) { p.state = 'deploy'; p.t = 0; }
        break;
      case 'deploy':
        /* 开伞：伞 0→1 展开，垂直速度向终端速度收敛，水平速度向漂移收敛 */
        p.chute = Math.min(1, p.t / 0.5);
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vy += (CHUTE_VY - p.vy) * Math.min(1, 4 * dt);
        p.vx += (CHUTE_VX * p.windDrift - p.vx) * Math.min(1, 3 * dt);
        if (p.chute >= 1) { p.state = 'descend'; p.t = 0; }
        break;
      case 'descend':
        /* 飘落：接近匀速，横向轻微摆动，落地判定 */
        p.sway += dt;
        p.vx = CHUTE_VX * p.windDrift + Math.sin(p.sway * 1.4) * 14;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        if (p.y >= p.landY) { p.y = p.landY; p.state = 'land'; p.t = 0; }
        break;
      case 'land':
        /* 触地：收伞 + 站稳，0.9s 后进入渐隐 */
        p.chute = Math.max(0, 1 - p.t / 0.55);
        p.vx = 0;
        if (p.t > 0.9) { p.state = 'fade'; p.t = 0; }
        break;
      case 'fade':
        /* 站定渐隐 1.0s 后移除 */
        p.fade = 1 - p.t / 1.0;
        if (p.t > 1.0) { paratroopers.splice(i, 1); continue; }
        break;
    }
  }
}

/** 降落伞：红色半圆伞顶 + 白色分瓣 + 伞绳，展开程度由 chute 控制。 */
function drawChute(g, x, y, chute, s) {
  const len = 24 * s;                 // 伞绳长度
  const cy = y - len;                 // 伞顶圆心（伞底缘所在高度）
  const R = 17 * s * chute;           // 伞半径（随展开增大）
  /* 伞绳：从伞底缘放射状连到身体肩部 */
  g.strokeStyle = 'rgba(70,70,80,0.65)';
  g.lineWidth = 0.8;
  g.beginPath();
  for (const k of [-0.85, -0.42, 0, 0.42, 0.85]) {
    g.moveTo(x + k * R, cy);
    g.lineTo(x, y - 4 * s);
  }
  g.stroke();
  /* 红色伞顶：上半圆，底缘向内微收（真实伞的下缘不是一条直线） */
  g.fillStyle = '#E23B3B';
  g.beginPath();
  g.moveTo(x - R, cy);
  g.arc(x, cy, R, Math.PI, 0);                    // 上半圆（左缘 → 顶 → 右缘）
  g.quadraticCurveTo(x, cy + R * 0.18, x - R, cy); // 底缘微收
  g.closePath(); g.fill();
  /* 白色分瓣：从伞顶放射到伞缘，经典的红白条纹 */
  g.strokeStyle = 'rgba(255,255,255,0.9)';
  g.lineWidth = 1.2;
  g.beginPath();
  g.moveTo(x, cy - R);
  g.quadraticCurveTo(x - R * 0.55, cy - R * 0.55, x - R, cy);
  g.moveTo(x, cy - R);
  g.quadraticCurveTo(x, cy - R * 0.2, x, cy);
  g.moveTo(x, cy - R);
  g.quadraticCurveTo(x + R * 0.55, cy - R * 0.55, x + R, cy);
  g.stroke();
}

/** 飞行员小人：按姿态摆姿势。以脚底为原点。 */
function drawParatrooperBody(g, p) {
  let pose = 0;                         // 0 = 自由落体大字型，1 = 飘落拉伞绳，2 = 站起
  if (p.state === 'descend') pose = 1;
  else if (p.state === 'land' || p.state === 'fade') pose = 2;
  g.fillStyle = '#FFE0C0';
  g.beginPath(); g.arc(0, -7.5, 2.5, 0, TAU); g.fill();   // 头
  g.fillStyle = '#2E6B2E';
  g.fillRect(-2.4, -5.2, 4.8, 5.6);                        // 躯干
  g.strokeStyle = '#2E6B2E'; g.lineWidth = 2; g.lineCap = 'round';
  g.beginPath();
  if (pose === 0) {
    g.moveTo(0, -4.6); g.lineTo(-5, -8);   // 左臂
    g.moveTo(0, -4.6); g.lineTo(5, -8);    // 右臂
    g.moveTo(0, 0.4); g.lineTo(-4, 4.2);   // 左腿
    g.moveTo(0, 0.4); g.lineTo(4, 4.2);    // 右腿
  } else if (pose === 1) {
    g.moveTo(0, -4.6); g.lineTo(-3, -11);  // 双臂上举拉伞绳
    g.moveTo(0, -4.6); g.lineTo(3, -11);
    g.moveTo(0, 0.4); g.lineTo(-2.5, 4);
    g.moveTo(0, 0.4); g.lineTo(2.5, 4);
  } else {
    g.moveTo(0, -4.6); g.lineTo(-3, -1.4); // 手臂放下
    g.moveTo(0, -4.6); g.lineTo(3, -1.4);
    g.moveTo(0, 0.4); g.lineTo(-2, 5);     // 腿站直
    g.moveTo(0, 0.4); g.lineTo(2, 5);
  }
  g.stroke();
}

function drawParatroopers(g, t) {
  if (!paratroopers.length) return;
  for (const p of paratroopers) {
    const sx = p.x - CFG.ox;
    if (sx < -60 || sx > VW + 60) continue;
    const a = p.state === 'fade' ? p.fade : 1;
    const keepA = g.globalAlpha;
    g.globalAlpha = keepA * a;
    if (p.chute > 0.02) drawChute(g, sx, p.y, p.chute, p.s);
    g.save();
    g.translate(sx, p.y);
    g.scale(p.s, p.s);
    drawParatrooperBody(g, p);
    g.restore();
    g.globalAlpha = keepA;
    drawCalls++;
  }
  g.setTransform(DBASE, 0, 0, DBASE, 0, 0);
}

/* =========================================================================
 * 10. 开花波前
 * ======================================================================= */
const WAVE_LEN = 1500;    // 波前空间周期（世界单位）
const WAVE_SPEED = 118;   // 波前推进速度（世界单位/秒）

/**
 * 返回 0..1 的开花进度。p 是波前相位：
 *   p ∈ [0, 0.10) 张 开   [0.10, 0.32) 盛 开   [0.32, 0.46) 合 上   其余为花蕾
 * 于是任何时刻约 46% 的草地处在"开→盛→合"的过程中，整片草地呈现一道
 * 自左向右掠过的开花波，每一朵花都是被这道波依次点亮的。
 */
function waveOpen(wx, depth, t, jit) {
  const wc = wx * 0.94 + depth * GH * 0.36;
  const p = fract((t * WAVE_SPEED - wc) / WAVE_LEN + jit);
  if (p < 0.10) return easeOutBack(p / 0.10, 1.08);
  if (p < 0.32) return 1;
  if (p < 0.46) return 1 - easeInOutCubic((p - 0.32) / 0.14);
  return 0;
}

function windAt(wx, wy, t) {
  const ph = wx * 0.0022 + wy * 0.0035;
  return 0.62 * Math.sin(t * 0.55 + ph) + 0.28 * Math.sin(t * 1.13 + ph * 1.6 + 1.2);
}

/* =========================================================================
 * 11. 彩蛋：点中客机 → 洒落彩纸花
 * -------------------------------------------------------------------------
 * 物理按抛洒物的实际受力来算，不是简单加个重力：
 *   阻力以**气流**为参考系 —— v_rel = v − wind，a_drag = −k·|v_rel|·v_rel
 *   于是纸片既下落，也会被横向气流自然带走，终端速度 v_t = √(g/k)。
 *   再叠一项飘摆（纸片翻面时迎风截面变化产生的横向抖动），
 *   接近终端速度时飘摆收敛 —— 这一段才是"纸片"区别于"石子"的地方。
 * ======================================================================= */
const CONF_G = 380;        // 重力（世界单位/秒²）
const CONF_VT = 82;        // 终端速度，由此反推阻力系数 k = g / v_t²
/* ---- 云朵分裂 ----
 * 阈值看的是**渲染宽度**（spec.w × 缩放 × 横向拉伸），不是画布宽度 ——
 * 画布有大量透明留白，用它判断会高估。 */
const CLOUD_SPLIT_MIN = 100;    // 小于这个可视宽度就不再分裂
const CLOUD_SPLIT_SCALE = 0.62; // 每朵子云的宽度占母云的比例
/* 分裂过渡时长（秒）。0.22 → 0.58：原来的 0.22s 只够把母云横着压窄，
 * 压到最窄再"啪"地换成两朵，读感就是"瞬间分成两块"。
 * 拉长到 0.58s 才装得下"被拉扯 → 裂开 → 各自长成"三段可辨的过程。 */
const CLOUD_SPLIT_ANIM = 0.58;
/* 子云中心离母云中心的最终距离，按母云**可视宽度**的比例算。
 * 取 0.42 而不是原来的 0.20：母云可视宽 M、子云各 0.62M，
 * 中心距 2×0.42M=0.84M > 0.62M，两朵之间才有 0.22M 的空隙；
 * 沿用 0.20 的话两朵会大幅重叠，看起来还是"一坨"。 */
const CLOUD_SPLIT_SEP = 0.42;
let cloudSplits = 0;            // 统计用
let splitDiag = [];             // 诊断：分裂过渡期间每帧实际画了哪些部件

const CONF_MAX = 900;      // 同屏上限：单次投放最多 192 片，约可容纳 5 束并存
/* 彩纸落到地平线高度 85% 处开始逐渐淡出，到 102% 淡到 0 并被移除。
 * 淡出曲线用 smoothstep 而不是直线：线性淡出在起点会有"突然开始变淡"、
 * 终点会有"突然消失"的台阶感，两端各有一处可见的硬边。 */
const CONF_FADE_FROM = 0.85;
const CONF_FADE_TO = 1.02;
const CONF_COLORS = ['#FF5A6E', '#FFC93C', '#4FD1C5', '#7C86FF', '#FF8AC4',
                     '#8CE06A', '#FF9E4A', '#FFFFFF', '#B98CFF', '#FFE873'];
let confetti = [];

function spawnConfetti(cx, cy, vx0, vy0, r) {
  const n = Math.round(rnd(r, 132, 192));   // 原为 44~64
  /* 连点场景：先把最旧的挤出去，保证**每一次点击都能投放完整的一束**。
   * 旧写法是"到上限就不再添加"，于是连点到第四次之后就没有任何反应了。 */
  const over = confetti.length + n - CONF_MAX;
  if (over > 0) confetti.splice(0, over);
  for (let i = 0; i < n; i++) {
    /* 初速度 = 继承一部分机速 + 一个向下的抛洒锥 */
    /* 数量翻三倍后若播撒体积不变，纸片会挤成一坨。体积按 √3 放大
     * （面积随边长平方），初速范围也略放宽，让整团铺得开。 */
    const ang = -Math.PI / 2 + rnd(r, -1.24, 1.24);
    const sp = rnd(r, 20, 172) * uiScale;
    confetti.push({
      x: cx + rnd(r, -34, 34) * uiScale,
      y: cy + rnd(r, -20, 20) * uiScale,
      vx: vx0 * rnd(r, 0.30, 0.72) + Math.cos(ang) * sp,
      vy: vy0 * 0.45 + Math.sin(ang) * sp,
      w: rnd(r, 5.0, 12.0) * uiScale,      // 长边
      h: rnd(r, 2.4, 4.8) * uiScale,       // 短边（纸片宽度）
      col: CONF_COLORS[(r() * CONF_COLORS.length) | 0],
      rot: r() * TAU,
      spin: rnd(r, -8, 8),
      tumble: r() * TAU,                   // 绕长轴翻滚 → 视觉上宽度周期变化
      tumbleSpd: rnd(r, 3.0, 9.0),
      drag: CONF_G / (CONF_VT * CONF_VT) * rnd(r, 0.78, 1.32),
      flutP: r() * TAU,
      flutF: rnd(r, 3.5, 9.5),
      flutA: rnd(r, 55, 175),
      life: 0,
    });
  }
}

function updateConfetti(dt, t) {
  if (!confetti.length) return;
  const windX = windAt(0, VH * 0.3, t) * 26;      // 场景横向气流
  for (let i = confetti.length - 1; i >= 0; i--) {
    const c = confetti[i];
    c.life += dt;
    const vrx = c.vx - windX, vry = c.vy;
    const sp = Math.hypot(vrx, vry);
    let ax = -c.drag * sp * vrx;                  // 阻力相对气流
    let ay = CONF_G - c.drag * sp * vry;
    /* 飘摆：越接近终端速度越稳，抖动越小 */
    const stab = clamp(1 - Math.abs(c.vy) / CONF_VT, 0.18, 1);
    ax += Math.sin(t * c.flutF + c.flutP) * c.flutA * stab;
    ay += Math.cos(t * c.flutF * 0.7 + c.flutP) * c.flutA * 0.22 * stab;
    c.vx += ax * dt;
    c.vy += ay * dt;
    c.x += c.vx * dt;
    c.y += c.vy * dt;
    c.rot += c.spin * dt;
    c.tumble += c.tumbleSpd * dt;
    c.spin *= (1 - 0.22 * dt * Math.abs(Math.sin(c.tumble)));   // 翻到侧面时几乎不转
    if (c.y > HY * CONF_FADE_TO || c.x < -100 || c.x > VW + 100 || c.life > 24)
      confetti.splice(i, 1);
  }
}

function drawConfetti(g) {
  if (!confetti.length) return;
  const fadeFrom = HY * CONF_FADE_FROM;
  const fadeSpan = Math.max(1, HY * CONF_FADE_TO - fadeFrom);
  for (const c of confetti) {
    let a = 1;
    if (c.y > fadeFrom) {
      const k = clamp01((c.y - fadeFrom) / fadeSpan);
      a = 1 - k * k * (3 - 2 * k);          // smoothstep：两端平滑、中段最快
    }
    if (a <= 0.02) continue;
    const wid = c.h * Math.max(0.10, Math.abs(Math.cos(c.tumble)));   // 翻面 → 变窄
    const keepA = g.globalAlpha;
    g.globalAlpha = keepA * a;
    g.save();
    g.translate(c.x, c.y);
    g.rotate(c.rot);
    g.fillStyle = c.col;
    g.fillRect(-c.w * 0.5, -wid * 0.5, c.w, wid);
    if (wid > 1.0) {                                   // 一侧压深，才有翻面感
      g.fillStyle = 'rgba(30,40,60,0.18)';
      g.fillRect(-c.w * 0.5, wid * 0.5 - wid * 0.36, c.w, wid * 0.36);
    }
    g.restore();
    g.globalAlpha = keepA;
    drawCalls++;
  }
  g.setTransform(DBASE, 0, 0, DBASE, 0, 0);
}

/* =========================================================================
 * 12. 离屏：天空、后期（含图标区压暗）
 * ======================================================================= */
let skyCv = null, gradeCv = null;
const GRADE_SC = 0.5;

function buildSky() {
  const cv = document.createElement('canvas');
  cv.width = Math.max(1, Math.ceil(VW * DBASE));
  cv.height = Math.max(1, Math.ceil(HY * DBASE));
  const g = cv.getContext('2d');
  g.scale(DBASE, DBASE);
  const grd = g.createLinearGradient(0, 0, 0, HY);
  for (let i = 0; i < SKY.length; i++) grd.addColorStop(i / (SKY.length - 1), SKY[i]);
  g.fillStyle = grd;
  g.fillRect(0, 0, VW, HY);
  skyCv = cv;
}

/* 后期：图标区柔和压暗 + 极轻的光比。
 * 图标文字是白色带投影，压在浅蓝天空上的对比度只有约 1.6:1；
 * 这层压暗把它抬到 4:1 以上，是"易读性优先"的落点。 */
function buildGrade() {
  const w = Math.max(2, Math.round(VW * GRADE_SC)), h = Math.max(2, Math.round(VH * GRADE_SC));
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const g = cv.getContext('2d');
  g.setTransform(w / VW, 0, 0, h / VH, 0, 0);

  const sc = CFG.scrim;
  if (sc > 0.005) {
    /* 左列：图标与图标文字常驻之处，压得最重 */
    let grd = g.createLinearGradient(0, 0, VW * ICON_SAFE_X, 0);
    grd.addColorStop(0, 'rgba(9,24,40,' + sc.toFixed(3) + ')');
    grd.addColorStop(0.42, 'rgba(9,24,40,' + (sc * 0.58).toFixed(3) + ')');
    grd.addColorStop(1, 'rgba(9,24,40,0)');
    g.fillStyle = grd; g.fillRect(0, 0, VW * ICON_SAFE_X, VH);
    /* 顶部：图标自左上角往下排 */
    grd = g.createLinearGradient(0, 0, 0, VH * 0.30);
    grd.addColorStop(0, 'rgba(9,24,40,' + (sc * 0.70).toFixed(3) + ')');
    grd.addColorStop(1, 'rgba(9,24,40,0)');
    g.fillStyle = grd; g.fillRect(0, 0, VW, VH * 0.30);
    /* 左上角再补一层径向压暗，压住天空+云叠加出的最亮处 */
    grd = g.createRadialGradient(VW * 0.02, VH * 0.02, 0, VW * 0.02, VH * 0.02, Math.max(VW, VH) * 0.52);
    grd.addColorStop(0, 'rgba(8,22,38,' + (sc * 0.52).toFixed(3) + ')');
    grd.addColorStop(0.5, 'rgba(8,22,38,' + (sc * 0.18).toFixed(3) + ')');
    grd.addColorStop(1, 'rgba(8,22,38,0)');
    g.fillStyle = grd; g.fillRect(0, 0, VW * 0.55, VH * 0.72);
  }

  const V = CFG.veil;
  if (V > 0.01) {
    let grd = g.createLinearGradient(0, VH, 0, VH * 0.78);
    grd.addColorStop(0, 'rgba(18,36,10,' + (0.18 * V).toFixed(3) + ')');
    grd.addColorStop(1, 'rgba(18,36,10,0)');
    g.fillStyle = grd; g.fillRect(0, VH * 0.78, VW, VH * 0.22);

    grd = g.createLinearGradient(0, 0, 0, HY * 0.40);
    grd.addColorStop(0, 'rgba(12,44,80,' + (0.16 * V).toFixed(3) + ')');
    grd.addColorStop(1, 'rgba(12,44,80,0)');
    g.fillStyle = grd; g.fillRect(0, 0, VW, HY * 0.40);
  }
  gradeCv = cv;
}

/* =========================================================================
 * 13. 主渲染
 * ======================================================================= */
let drawCalls = 0;
const cam = { x: 0 };

function setSpriteM(g, px, py, cos, sin, sc, flip, shear) {
  const a = cos * sc * flip, b = sin * sc * flip;
  const c = -sin * sc, d = cos * sc;
  g.setTransform(
    DBASE * (a + c * shear), DBASE * (b + d * shear),
    DBASE * c, DBASE * d,
    DBASE * px, DBASE * py
  );
}

/** 推进每一朵云的年龄与位置，走完一生就换个地方重新开始 */
function updateClouds(dt, r) {
  const margin = 420 * uiScale;
  for (let i = clouds.length - 1; i >= 0; i--) {
    const c = clouds[i];
    c.age += dt;
    c.x -= c.v * dt;
    if (c.splitT > 0) {
      c.splitT -= dt;
      if (c.splitT <= 0) {
        /* 子云在**点击那一刻**就造好了，这里只是把它们接进主列表。
         * 过渡期间母云仍在飘，而子云的终点是点击时算好的固定位置 ——
         * 位移的差值由过渡里的 lerp 吸收掉了，所以这一帧没有任何跳变。 */
        const kids = c.splitKids || splitCloud(c, r);
        clouds.splice(i, 1);
        for (const k2 of kids) clouds.push(k2);
        cloudSplits++;
        continue;
      }
    }
    if (c.age >= c.life || c.x < CFG.ox - margin) {
      /* 重生前留一点随机等待，避免云量忽多忽少 */
      spawnCloud(c, r, -rnd(r, 0.02, 0.22));
    }
  }
}

/** 画一朵云的精灵本体（不含分裂过渡那套调度）。
 *  scMul / aMul：整体缩放与透明度的倍率。
 *  over：可选 {x, y}，用绝对位置**覆盖**云自己的位置 ——
 *        分裂过渡时子云要从母云中心"长"出来，位置得由调用方插值。 */
function blitCloud(g, c, scMul, aMul, over) {
  const p = c.age / c.life;
  const grow = clamp01(p / CLOUD_GROW);
  const fade = clamp01((p - (1 - CLOUD_FADE)) / CLOUD_FADE);
  /* 尺寸：生成时只有 42%，长到 100%；消散阶段再膨胀到 124%（像被风扯散） */
  const sc = c.s * lerp(0.42, 1.0, easeOutCubic(grow)) * lerp(1.0, 1.24, fade) * scMul;
  const sx = (over ? over.x : c.x) - CFG.ox;
  const sy = over ? over.y : c.y;
  /* 透明度：随生长淡入、随消散淡出 */
  let a = c.a0 * grow * (1 - smoothstep(0.30, 1.0, fade)) * aMul;
  /* 靠近左边缘时淡出，免得云"飘出屏幕时还活着" */
  a *= smoothstep(-0.05, 0.20, sx / VW);
  a *= smoothstep(0.04, ICON_SAFE_X, sx / VW);
  const spr = getCloudSprite(c.spec, c.vi);
  const m = spr.w * sc * c.sx * 0.5 + 24;
  if (a <= 0.008 || sx < -m || sx > VW + m) return 0;
  const keep = g.globalAlpha;
  g.globalAlpha = keep * Math.min(1, a);
  g.setTransform(DBASE * sc * c.sx * c.flip, 0, 0, DBASE * sc * c.sy,
                 DBASE * sx, DBASE * sy * HY);
  g.drawImage(spr.cv, -spr.ax, -spr.ay, spr.w, spr.h);
  g.globalAlpha = keep;
  drawCalls++;
  return a;
}

/** 分裂过渡 —— 这是"裂开"的全部秘密，**没有任何一帧是"凭空换成两块"**：
 *
 *   k=0  两朵子云还只有 42% 大小、完全透明，位置正好压在母云中心 →
 *        画面和点击前**逐像素相同**，所以起手看不出一丝跳变。
 *   k↑   母云被拉扯着收窄、后半段淡出；两朵子云同时从中心长出来、左右分开。
 *   k=1  子云已是最终尺寸与最终位置，母云已经淡到 0 →
 *        下一帧把它们接进主列表，画面上什么都不会变。
 *
 *  两处最容易写坏的地方：
 *   ① 子云的位置与纵向偏移必须**从母云处插值过去**。它们各自的 y 差可达 0.014
 *      （1080p 下约 15px），直接用终值会"蹦"一下。
 *   ② 母云横向只收窄到 74%，不要压得太狠 —— 压窄到一半就不再是"被拉扯"，
 *      而像是被横向压扁（这一条在轮廓上很扎眼）。 */
function drawSplitting(g, c) {
  const k = clamp01(1 - c.splitT / CLOUD_SPLIT_ANIM);
  const ek = smoothstep(0, 1, k);       // 缓起缓收：用于母云的形变
  const eo = easeOutCubic(k);           // 快起慢收：用于子云的"被拉开"

  const mA = blitCloud(g, c, lerp(1.0, 0.74, ek), 1 - smoothstep(0.30, 0.95, k), null);
  c.lastA = mA;

  const cMul = lerp(0.42, 1.0, eo);
  const aMul = smoothstep(0.10, 0.80, k);
  const kids = c.splitKids || [];
  const parts = [];
  for (const kid of kids) {
    const kx = lerp(c.x, kid.x, eo), ky2 = lerp(c.y, kid.y, eo);
    const a = blitCloud(g, kid, cMul, aMul, { x: kx, y: ky2 });
    parts.push({ a: Math.round(a * 1000) / 1000,
                 x: Math.round((kx - CFG.ox) * 10) / 10,
                 w: Math.round(kid.spec.w * kid.s * cMul * kid.sx),
                 h: Math.round(kid.spec.w * kid.s * cMul * kid.sy * 0.72) });
  }
  /* 诊断快照：给"裂开必须渐进、可见质量必须连续"这两条回归判据提供逐帧真值 */
  splitDiag.push({ k: Math.round(k * 1000) / 1000,
                   motherA: Math.round(mA * 1000) / 1000,
                   motherX: Math.round((c.x - CFG.ox) * 10) / 10,
                   motherW: Math.round(c.spec.w * c.s * lerp(1.0, 0.74, ek) * c.sx),
                   motherH: Math.round(c.spec.w * c.s * lerp(1.0, 0.74, ek) * c.sy * 0.72),
                   kids: parts });
}

/** 画云：普通云直接画；正在分裂的云走过渡 */
function drawClouds(g) {
  splitDiag.length = 0;
  for (const c of clouds) {
    if (c.age < 0) continue;                       // 等待重生
    if (c.splitT > 0) { drawSplitting(g, c); continue; }
    c.lastA = blitCloud(g, c, 1, 1, null);
  }
  g.setTransform(DBASE, 0, 0, DBASE, 0, 0);
}

function drawRidges(g) {
  const TW = TILE_W * uiScale;
  const off = cam.x * 0.05;
  const i0 = Math.floor(off / TW) - 1, i1 = Math.ceil((off + VW) / TW);
  for (const rg of ridges) {
    const H = rg.layer.h * GH;
    for (let i = i0; i <= i1; i++) {
      const tx = i * TW - off;
      g.beginPath();
      g.moveTo(tx, HY + 3);
      const STEP = TW / 48;
      for (let k = 0; k <= 48; k++) {
        const x = k * STEP;
        const hh = (1 + ridgeHeight(x, TW, rg.harm)) * H;
        g.lineTo(tx + x, HY - hh);
      }
      g.lineTo(tx + TW, HY + 3);
      g.closePath();
      const grd = g.createLinearGradient(0, HY - H * 1.5, 0, HY + 3);
      grd.addColorStop(0, rg.layer.top);
      grd.addColorStop(1, rg.layer.bot);
      g.fillStyle = grd;
      g.fill();
      drawCalls++;
    }
  }
}

function ridgeHeight(x, TW, harm) {
  let v = 0;
  for (const h of harm) v += h.a * Math.sin(TAU * h.n * x / TW + h.p);
  return v;
}

/** 草坡：5 层起伏平涂色阶（后 → 前），再叠花与草叶 */
function drawGround(g, t) {
  const TW = TILE_W * uiScale;
  const off = cam.x * 0.08;
  const i0 = Math.floor(off / TW) - 1, i1 = Math.ceil((off + VW) / TW);

  /* ---- 色阶 ---- */
  for (let k = 0; k < MEADOW.length; k++) {
    for (let i = i0; i <= i1; i++) {
      const tx = i * TW - off;
      g.beginPath();
      g.moveTo(tx, VH);
      g.lineTo(tx, bandEdgeY(k, i * TW));
      const STEP = TW / 56;
      for (let q = 1; q <= 56; q++) {
        const x = q * STEP;
        g.lineTo(tx + x, bandEdgeY(k, i * TW + x));
      }
      g.lineTo(tx + TW, VH);
      g.closePath();
      g.fillStyle = MEADOW[k];
      g.fill();
      drawCalls++;
    }
  }

  /* ---- 地平线雾带：把远山与草坡衔接起来，是纵深的关键 ---- */
  let grd = g.createLinearGradient(0, HY, 0, HY + GH * 0.17);
  grd.addColorStop(0, 'rgba(243,241,214,0.38)');
  grd.addColorStop(0.45, 'rgba(243,241,214,0.14)');
  grd.addColorStop(1, 'rgba(243,241,214,0)');
  g.fillStyle = grd;
  g.fillRect(0, HY, VW, GH * 0.17);

  /* ---- 斜向阳光：给草地一个明确的光向 ---- */
  grd = g.createLinearGradient(VW * 1.15, HY, VW * 0.05, VH);
  grd.addColorStop(0, 'rgba(255,250,196,0.14)');
  grd.addColorStop(0.55, 'rgba(255,250,196,0.05)');
  grd.addColorStop(1, 'rgba(255,250,196,0)');
  g.fillStyle = grd;
  g.fillRect(0, HY, VW, GH);

  /* ---- 草叶簇 ---- */
  for (const e of tufts) {
    const py = lerp(bandEdgeY(e.band, e.x), bandEdgeY(e.band + 1, e.x), e.tIn);
    if (py < HY || py > VH + 40) continue;
    for (let i = i0; i <= i1; i++) {
      const px = i * TW + e.x - off;
      if (px < -60 || px > VW + 60) continue;
      const wx = e.x + i * TW;
      const sway = windAt(wx, py, t) * CFG.wind * 2.2;
      const hh = 26 * e.s * (e.hMul === undefined ? 1 : e.hMul);
      g.save();
      g.translate(px, py);
      g.scale(e.flip * e.s, e.s);
      const nB = e.n === undefined ? 3 : e.n;
      const bias = e.leanBias === undefined ? 0 : e.leanBias;
      const spr = e.spread === undefined ? 1 : e.spread;
      const t0 = e.tone0 === undefined ? 0 : e.tone0;
      for (let k = 0; k < nB; k++) {
        const h2 = hh * (0.62 + 0.38 * ((k * 37 % 7) / 7));
        const lean = bias + (k - (nB - 1) * 0.5) * 0.46 * spr + sway / 26;
        const x0 = (k - (nB - 1) * 0.5) * 1.5;
        const tip = x0 + lean * h2;
        g.beginPath();
        g.moveTo(x0 - 1.5, 0);
        g.quadraticCurveTo(x0 + lean * h2 * 0.35, -h2 * 0.58, tip, -h2);
        g.quadraticCurveTo(x0 + lean * h2 * 0.35 + 1.6, -h2 * 0.58, x0 + 1.5, 0);
        g.closePath();
        g.fillStyle = TUFT_TONES[(t0 + k) % TUFT_TONES.length];
        g.fill();
      }
      g.restore();
      drawCalls++;
    }
  }

  /* ---- 野花 ---- */
  for (const e of flowers) {
    const yTop = bandEdgeY(e.band, e.x);
    const py = lerp(yTop, bandEdgeY(e.band + 1, e.x), e.tIn);
    if (py < HY - 6 || py > VH + 50) continue;
    for (let i = i0; i <= i1; i++) {
      const px = i * TW + e.x - off;
      if (px < -50 || px > VW + 50) continue;
      const wx = e.x + i * TW;
      const yTopI = bandEdgeY(e.band, wx);
      const pyI = lerp(yTopI, bandEdgeY(e.band + 1, wx), e.tIn);
      const open = waveOpen(wx, e.depth, t, e.jit);
      const sway = windAt(wx, pyI, t) * CFG.wind * e.sway * 1.8;
      const shear = -sway / Math.max(6, 16 * e.s);

      if (open <= 0.004 || open >= 0.996) {
        const spr = getFlowerSprite(e.sp, e.vi, open >= 0.996 ? 1 : 0);
        setSpriteM(g, px, pyI, Math.cos(e.rot), Math.sin(e.rot), e.s, e.flip, shear);
        g.drawImage(spr.cv, -spr.ax, -spr.ay, spr.w, spr.h);
        drawCalls++;
      } else {
        /* 正在开合：矢量绘制，花瓣逐片张开 */
        g.setTransform(DBASE, 0, 0, DBASE, 0, 0);
        g.save();
        g.translate(px, pyI);
        g.rotate(e.rot);
        g.scale(e.flip * e.s, e.s);
        g.transform(1, 0, shear, 1, 0, 0);
        drawFlower(g, e.sp, open, e.jit * 4);
        g.restore();
        drawCalls++;
      }
    }
  }
  g.setTransform(DBASE, 0, 0, DBASE, 0, 0);
}

/** 底部前景草叶：贴屏幕下沿 */
function drawFringe(g, t) {
  if (!fringe) return;
  const fh = fringe.screenH * VH;
  const sc = fh / fringe.h;
  const tw = fringe.w * sc;
  const off = cam.x * 0.42;
  const i0 = Math.floor(off / tw) - 1, i1 = Math.ceil((off + VW) / tw);
  const sway = windAt(off, VH, t) * CFG.wind;
  for (let i = i0; i <= i1; i++) {
    const tx = i * tw - off;
    g.save();
    g.translate(tx, VH - fh);
    g.scale(sc, sc);
    g.transform(1, 0, -sway * 2.4 / fringe.w, 1, 0, 0);
    g.drawImage(fringe.cv, 0, 0, fringe.w, fringe.h);
    g.restore();
    drawCalls++;
  }
}

/* =========================================================================
 * 14. 尺寸与主循环
 * ======================================================================= */
/** 由 CFG 派生的几何量：地平线高度 HY 与草地高度 GH。
 *
 *  **必须被 rebuildScene() 也调用。** 这里踩过一个真实的坑：
 *  `horizon` 在 `set()` 的分级里属于"轻量重建"（needScene），
 *  而 HY/GH 原先只写在 computeScale() 里、computeScale() 只被 rebuildAll() 调用 ——
 *  于是改地平线走 rebuildScene() 时 HY 保持不变，
 *  渲染时 `drawImage(skyCv, 0, 0, VW, HY)` 仍用旧值，**选项看起来完全没反应**。
 *  取值一路绑定都是对的（菜单 → 配置 → set() → CFG.horizon），漏的是这一步重算。 */
function applyDerivedGeometry() {
  HY = Math.round(VH * CFG.horizon);
  GH = VH - HY;
}

function computeScale() {
  /* S = 把 CSS 布局视口折算成物理像素的系数。
   * 只在**浏览器预览**分支（没有宿主传参）里参与计算；宿主分支的 VW/VH 直接来自
   * CFG.pw/ph，S 不参与坐标运算，仅作为诊断量经 stats().s 上报。
   * 这就是 SKILL 里那条"坐标计算不依赖 devicePixelRatio"的准确含义。 */
  if (CFG.pw > 0 && CFG.ph > 0) {
    VW = Math.round(CFG.pw); VH = Math.round(CFG.ph);
    S = CFG.sf > 0 ? CFG.sf : (window.devicePixelRatio || 1);
  } else {
    S = window.devicePixelRatio || 1;
    VW = Math.round((CFG.vl > 0 ? CFG.vl : window.innerWidth) * S);
    VH = Math.round((CFG.vt > 0 ? CFG.vt : window.innerHeight) * S);
  }
  VW = Math.max(64, VW); VH = Math.max(64, VH);

  applyDerivedGeometry();

  uiScale = clamp(Math.sqrt(VW * VH / (1920 * 1080)), 1, 1.8);

  let k = CFG.renderScale;
  const budget = CFG.budget > 200000 ? CFG.budget : 4700000;
  if (k <= 0) k = Math.min(1, Math.sqrt(budget / (VW * VH)));
  k = clamp(k, 0.45, 2);
  DBASE = k;
  BS = clamp(k, 0.85, 1.8);

  canvas.width = Math.max(1, Math.round(VW * k));
  canvas.height = Math.max(1, Math.round(VH * k));
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  ctx.setTransform(k, 0, 0, k, 0, 0);
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
}

function prebake() {
  spriteCache.clear();
  for (const sp of FLOWERS) for (let v = 0; v < 2; v++) { getFlowerSprite(sp, v, 1); getFlowerSprite(sp, v, 0); }
  for (const sp of CLOUD_SPECS) for (let v = 0; v < 3; v++) getCloudSprite(sp, v);
}

/** 全量重建：连精灵一起重烘（改了尺寸倍率或种子时才需要） */
function rebuildAll() {
  computeScale();
  prebake();
  buildSky();
  buildGrade();
  buildScene();
}

/** 轻量重建：只重排元素与配色，精灵缓存照用。改密度 / 配色 / 地平线走这条 ——
 *  全量重建要重烘 60 个云精灵，会有肉眼可见的停顿。 */
function rebuildScene() {
  applyDerivedGeometry();   // ← horizon 改了靠这一行生效（computeScale 不会跑）
  buildScene();
  buildGrade();
}

let running = true, lastFrame = 0, frameCount = 0, fpsAcc = 0, fpsVal = 0, frame = 0;
const t0 = CFG.t0 > 0 ? CFG.t0 : Date.now();
const nowSec = () => (Date.now() - t0) / 1000;

function tick(ts) {
  requestAnimationFrame(tick);
  if (!running) return;
  const interval = 1000 / Math.max(1, CFG.fps);
  if (ts - lastFrame < interval - 1.5) return;
  const prev = lastFrame;
  lastFrame = ts;
  const dt = prev > 0 ? Math.min(0.2, (ts - prev) / 1000) : interval / 1000;

  const t = nowSec();
  if (CFG.drift > 0) { cam.x += CFG.drift * dt; if (cam.x > 40000) cam.x -= 80000; }
  updateClouds(dt, cloudRnd);
  updatePlanes(dt, t, planeRnd);
  updateBiplanes(dt, t, biplaneRnd);
  updateParatroopers(dt, t);
  updateHerds(dt, t);
  updateConfetti(dt, t);

  drawCalls = 0;
  ctx.globalAlpha = 1;
  ctx.setTransform(DBASE, 0, 0, DBASE, 0, 0);

  ctx.drawImage(skyCv, 0, 0, VW, HY);
  drawClouds(ctx);
  drawPlanes(ctx, t);
  drawRidges(ctx);
  drawGround(ctx, t);
  drawHerds(ctx, t);
  drawBiplanes(ctx, t);                 // 低空飞机在草地之上、前景草叶之下
  ctx.setTransform(DBASE, 0, 0, DBASE, 0, 0);
  drawFringe(ctx, t);
  ctx.setTransform(DBASE, 0, 0, DBASE, 0, 0);
  drawConfetti(ctx);                    // 彩纸在近景，压在草叶之上
  drawParatroopers(ctx, t);             // 跳伞是彩蛋，压在最上层
  ctx.setTransform(DBASE, 0, 0, DBASE, 0, 0);
  ctx.globalAlpha = 1;
  ctx.drawImage(gradeCv, 0, 0, VW, VH);


  if (CFG.debug) {
    ctx.save();
    ctx.strokeStyle = 'rgba(255,0,0,0.6)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, HY); ctx.lineTo(VW, HY); ctx.stroke();
    ctx.strokeStyle = 'rgba(0,255,255,0.5)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, VH * 0.26); ctx.lineTo(VW, VH * 0.26); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(VW * 0.34, 0); ctx.lineTo(VW * 0.34, VH); ctx.stroke();
    ctx.restore();
  }

  if (bootEl && frame === 0) {
    let embedded = false;
    try { embedded = !!(window.chrome && chrome.webview); } catch (e) { }
    if (!embedded) bootEl.classList.add('hide');     // 浏览器预览：直接淡出
    /* 壁纸模式下遮罩先留着 —— 它不是"加载提示"，而是用来盖住
     * "首帧已画好但还没被合成呈现"的那一小段。宿主挂载完会调 reveal() 收走它。 */
    else setTimeout(() => { if (bootEl) bootEl.classList.add('hide'); }, 4000);
    /* 首帧画完就通知宿主"可以挂到桌面层了" */
    try { if (embedded) chrome.webview.postMessage({ type: 'ready' }); } catch (e) { }
  }

  frameCount++; fpsAcc += dt;
  if (fpsAcc >= 1) { fpsVal = frameCount / fpsAcc; frameCount = 0; fpsAcc = 0; reportStats(); }
  frame++;
}

function reportStats() {
  try {
    if (!window.chrome || !chrome.webview) return;
    /* 每秒上报的这条消息是宿主唯一的遥测来源（托盘状态、彩蛋瞄准、日志）。
     * 注意别只发 fps/calls —— stats() 里加过的新字段必须同步过来，
     * 否则宿主永远读到默认值。 */
    const p0 = planes.length ? planes[0] : null;
    chrome.webview.postMessage({
      type: 'stats',
      fps: Math.round(fpsVal),
      calls: drawCalls,
      planes: planes.length,
      planeX: p0 ? Math.round(p0.x - CFG.ox) : -1,
      planeY: p0 ? Math.round(p0.y * HY) : -1,
      confetti: confetti.length,
    });
  } catch (e) { }
}

/* =========================================================================
 * 16. 对外接口
 * ======================================================================= */
window.meadow = {
  get config() { return CFG; },
  set: function (o) {
    let needFull = false, needScene = false;
    for (const k in o) {
      if (!Object.prototype.hasOwnProperty.call(o, k)) continue;
      const v = o[k];
      if (CFG[k] !== v) {
        /* 分级重建：只有改变精灵烘焙尺寸或种子的参数才走全量重建；
         * 数量、配色这类重建元素表就够了 —— 全量重建要重烘 60 个云精灵，
         * 会有肉眼可见的停顿。 */
        if (k === 'seed' || k === 'renderScale' || k === 'budget') needFull = true;
        else if (k === 'density' || k === 'veil' || k === 'scrim' || k === 'horizon' ||
                 k === 'cloudLife' || k === 'cloudDensity' || k === 'cloudSpeed' ||
                 k === 'animals' || k === 'animalDensity' || k === 'planes' ||
                 k === 'planeInterval' || k === 'biplane' || k === 'biplaneInterval') needScene = true;
      }
      CFG[k] = v;
    }
    CFG.density = clamp(CFG.density, 0.2, 2.2);
    if (needFull) rebuildAll();
    else if (needScene) rebuildScene();
    return true;
  },
  pause: function () { running = false; },
  resume: function () { running = true; lastFrame = 0; },
  toggle: function () { running = !running; if (running) lastFrame = 0; return running; },
  running: function () { return running; },
  stats: function () {
    const t = nowSec();
    let openN = 0;
    for (const e of flowers) if (waveOpen(e.x, e.depth, t, e.jit) > 0.5) openN++;
    let nAnimal = 0, herdsGrazing = 0, herdsWalking = 0;
    let nCow = 0, nSheep = 0, spanSum = 0, spanN = 0, spdMin = 9, spdMax = 0;
    for (const h of herds) {
      nAnimal += h.members.length;
      if (h.kind.id === 'cow') nCow += h.members.length; else nSheep += h.members.length;
      if (h.state === 'walk') herdsWalking++; else herdsGrazing++;
      /* 每群当前的横向跨度（最前与最后个体的 dx 之差），用于验证"间距随时间拉开" */
      if (h.members.length >= 2) {
        const d = h.members.map(a => a.dx);
        spanSum += Math.max.apply(null, d) - Math.min.apply(null, d);
        spanN++;
      }
      for (const a of h.members) {
        if (a.spd < spdMin) spdMin = a.spd;
        if (a.spd > spdMax) spdMax = a.spd;
      }
    }
    let vSum = 0, nLive = 0, grow = 0, hold = 0, fade = 0;
    for (const c of clouds) {
      if (c.age < 0) continue;
      nLive++; vSum += c.v;
      const pp = c.age / c.life;
      if (pp < CLOUD_GROW) grow++; else if (pp > 1 - CLOUD_FADE) fade++; else hold++;
    }
    return { fps: Math.round(fpsVal * 10) / 10, calls: drawCalls,
             flowers: flowers.length, tufts: tufts.length, clouds: clouds.length,
             cloudLive: nLive, cloudGrow: grow, cloudHold: hold, cloudFade: fade,
             cloudSpeedPx: Math.round(vSum / Math.max(1, nLive) * 10) / 10,
             cloudLife: Math.round(CFG.cloudLife),
             planes: planes.length, planeTotal: planeCount, confetti: confetti.length,
             biplanes: biplanes.length, chutes: paratroopers.length,
             confVy: confetti.length ? Math.round(confetti.reduce((a,c)=>a+c.vy,0)/confetti.length) : 0,
             confMaxY: confetti.length ? Math.round(Math.max(...confetti.map(c=>c.y))) : 0,
             /* 淡出是否真的在 85% 处起效，靠这一项判定：最淡的那片的不透明度 */
             confMinA: confetti.length ? (function () {
               const ff = HY * CONF_FADE_FROM, sp = Math.max(1, HY * CONF_FADE_TO - ff);
               let mn = 1;
               for (const c of confetti) {
                 let a = 1;
                 if (c.y > ff) { const k = clamp01((c.y - ff) / sp); a = 1 - k * k * (3 - 2 * k); }
                 if (a < mn) mn = a;
               }
               return Math.round(mn * 100) / 100;
             })() : 1,
             confSpread: confetti.length ? Math.round(Math.max(...confetti.map(c=>c.x)) - Math.min(...confetti.map(c=>c.x))) : 0,
             planeX: planes.length ? Math.round(planes[0].x - CFG.ox) : -1,
             planeY: planes.length ? Math.round(planes[0].y * HY) : -1,
             planeDir: planes.length ? (planes[0].flip > 0 ? 1 : -1) : 0,
             herds: herds.length, animals: nAnimal,
             /* 牛羊分开计数，供 1:1 比例回归用；herdSpan 是"平均每群横向跨度"，
                供"间距随时间拉开"回归用；spdMin/spdMax 应恒在 [0.92, 1.08] 内 */
             cows: nCow, sheeps: nSheep,
             herdSpan: spanN ? Math.round(spanSum / spanN) : 0,
             spdMin: Math.round(spdMin * 1000) / 1000,
             spdMax: Math.round(spdMax * 1000) / 1000,
             animalsDown: (function () { let k = 0; for (const h of herds) for (const a of h.members) if (a.lockT > 0) k++; return k; })(),
             cloudSplits: cloudSplits,
             herdsGrazing: herdsGrazing, herdsWalking: herdsWalking,
             /* 各群中心的横向位置（占屏宽比例），用于确认是否偏向中右 */
             herdX: herds.map(h => Math.round((h.homeX - CFG.ox) / VW * 100) / 100),
             open: openN,
             vw: VW, vh: VH, horizon: HY, s: S, scale: Math.round(DBASE * 1000) / 1000,
             canvas: canvas.width + 'x' + canvas.height, ui: Math.round(uiScale * 1000) / 1000,
             scrim: CFG.scrim };
  },
  /** 诊断用：每群的种类、方向、速度，以及每头个体的名次 / 偏移 / 速度因子。
   *  供两个回归用：① 牛羊数量比例；② 个体间距是否随时间单调拉开、速度因子是否恒正。 */
  __herds: function () {
    return herds.map(function (h) {
      return {
        kind: h.kind.id, dir: h.dir, speed: Math.round(h.speed * 100) / 100,
        state: h.state, n: h.members.length,
        cx: Math.round(h.cx * 100) / 100,
        /* 屏幕坐标 = (cx + dx·dir − ox, HY + GH·gy)，供截图脚本定位取景 */
        gy: h.gy, ox: CFG.ox, hy: HY, gh: GH,
        members: h.members.map(function (a) {
          return {
            rank: Math.round(a.rank * 1000) / 1000,
            dx0: Math.round(a.dx0 * 100) / 100,
            dx: Math.round(a.dx * 100) / 100,
            dxT: Math.round(a.dxT * 100) / 100,
            spd: Math.round(a.spd * 1000) / 1000,
          };
        }),
      };
    });
  },
  /** 诊断用：把一头牛按指定姿态单独画出来，返回 PNG dataURL —— 用于修复前后的视觉对比
   *  （场景里的牛只有十几像素高，直接截图看不清脖子这类细节）。
   *  real=false 时用探针配色（躯干绿、脖子/头洋红），便于机器量测。 */
  __cowPng: function (head, ct, z, real) {
    const Z = z || 5, CW = 460, CH = 300, OX = 140, OY = 255;
    const cv = document.createElement('canvas');
    cv.width = CW; cv.height = CH;
    const g2 = cv.getContext('2d');
    g2.fillStyle = '#EDF3FA'; g2.fillRect(0, 0, CW, CH);
    g2.save(); g2.translate(OX, OY); g2.scale(Z, Z);
    const hd = head === undefined ? 0.94 : head;
    const col = real === false
      ? { body: '#00FF00', shade: '#00FF00', patch: '#00FF00', head: '#FF00FF', horn: null }
      : HERD_KINDS[0].colors[0];
    drawCow(g2, col, hd, 0, ct === undefined ? 1 : ct);
    g2.restore();
    return cv.toDataURL('image/png');
  },
  /** 诊断用：量测**实际渲染出来的**牛脖子厚度与躯干高度，返回二者的比值。
   *  做法：把牛的躯干画成绿色、脖子/头画成洋红（其余部件画成黑色或跳过），
   *  然后在**颈部中段的列**上量洋红像素的连续长度、在躯干中段的列上量绿色的连续长度。
   *  取 head=0.94（走路姿态，颈轴接近水平）时，竖向连续长度≈颈的垂直厚度。
   *  这样量的是真像素，而不是把绘制公式重算一遍 —— 后者测不出"画出来的样子"。 */
  __neckProbe: function (head) {
    /* 放大 4 倍绘制：颈部厚度只有几个世界单位，按 1:1 画的话像素量化让比值只有
     * 1/13 的分辨率，判据的判别力全被舍入吃掉了。放大后 1 世界单位 = 4px。 */
    const Z = 4, CW = 700, CH = 420, OX = 320, OY = 340;
    const cv = document.createElement('canvas');
    cv.width = CW; cv.height = CH;
    const g2 = cv.getContext('2d', { willReadFrequently: true });
    g2.clearRect(0, 0, CW, CH);
    const hd = head === undefined ? 0.94 : head;
    const L = 30, H = 19;
    g2.save();
    g2.translate(OX, OY);
    g2.scale(Z, Z);
    /* 一次绘制就把两种颜色分干净：躯干**连同腹下暗面与花斑**都用绿（否则那些部件会
     * 用 shade/patch 色把躯干的下半截割断，量到的"体高"会少 2~5px）；
     * 脖子与头用洋红（同一个 col.head，但颈部中段那一列不会被头/耳覆盖）。
     * 另外躯干中段那一列（x=0）不会被颈部覆盖 —— 颈根从 0.38L 起，故两段互不干扰。 */
    drawCow(g2, { body: '#00FF00', shade: '#00FF00', patch: '#00FF00',
                  head: '#FF00FF', horn: null }, hd, 0, 1);
    g2.restore();

    const img = g2.getImageData(0, 0, CW, CH).data;
    const at = (x, y) => ((y * CW + x) * 4);
    const isGreen = (x, y) => { const i = at(x, y); return img[i + 1] > 180 && img[i] < 120 && img[i + 2] < 120; };
    const isMag = (x, y) => { const i = at(x, y); return img[i] > 180 && img[i + 2] > 180 && img[i + 1] < 120; };

    /* 最长连续段（沿某一列向下扫） */
    function runLen(x, test) {
      let best = 0, cur = 0;
      for (let y = 0; y < CH; y++) {
        if (test(x, y)) { cur++; if (cur > best) best = cur; }
        else cur = 0;
      }
      return best;
    }
    /* 颈部中段的列：肩点与头心的中点（与 drawCow 用同一套公式，再乘放大倍数） */
    const shx = 0.38 * L, neck = lerp(0.52, 0.34, hd) * L, ang = lerp(1.15, 0.15, hd);
    const colNeck = Math.round(OX + Z * (shx + shx + Math.cos(ang) * neck) / 2);
    /* 体高参照取躯干中段（x=0）：该列不会被颈部覆盖（颈根从 0.38L 起），
     * 腹下暗面与花斑也已用躯干色画，所以量到的是完整的躯干高度。 */
    const colBody = OX;
    const neckThick = runLen(colNeck, isMag);
    const bodyH = runLen(colBody, isGreen);
    return { head: hd, colNeck: colNeck, neckThick: neckThick, bodyH: bodyH,
             ratio: bodyH > 0 ? Math.round(neckThick / bodyH * 1000) / 1000 : 0 };
  },
  /** 诊断用：云朵轮廓的"直边"程度。
   *  判据取的是视觉感受而非逐列平滑度：滑动窗口内轮廓高度的总落差 ≤ FLAT_PX
   *  就算一段直边。逐列差分判据会把正常的圆弧也算成直边，不能用。 */
  __silhouette: function () {
    const FLAT_PX = 2.0;
    const limitOf = (w, top) => cloudFlatLimit(w, top);
    const out = [];
    const cv = document.createElement('canvas');
    for (const spec of CLOUD_SPECS) {
      for (let vi = 0; vi < CLOUD_VARIANTS; vi++) {
        const spr = getCloudSprite(spec, vi);
        cv.width = spr.cv.width; cv.height = spr.cv.height;
        const g = cv.getContext('2d');
        g.clearRect(0, 0, cv.width, cv.height);
        g.drawImage(spr.cv, 0, 0);
        const d = g.getImageData(0, 0, cv.width, cv.height).data;
        const W = cv.width, H = cv.height;
        const edge = (dir) => {
          const a = new Int32Array(W).fill(-1);
          for (let x = 0; x < W; x++) {
            if (dir < 0) { for (let y = 0; y < H; y++) if (d[(y * W + x) * 4 + 3] > 24) { a[x] = y; break; } }
            else { for (let y = H - 1; y >= 0; y--) if (d[(y * W + x) * 4 + 3] > 24) { a[x] = y; break; } }
          }
          return a;
        };
        const longestFlat = (a) => {
          let best = 0;
          for (let x0 = 0; x0 < W; x0++) {
            if (a[x0] < 0) continue;
            let mn = a[x0], mx = a[x0], x = x0;
            while (x + 1 < W && a[x + 1] >= 0) {
              const nx = a[x + 1];
              const nmn = Math.min(mn, nx), nmx = Math.max(mx, nx);
              if (nmx - nmn > FLAT_PX) break;
              mn = nmn; mx = nmx; x++;
            }
            if (x - x0 + 1 > best) best = x - x0 + 1;
          }
          return best;
        };
        out.push({ id: spec.id + '#' + vi, kind: spec.kind, w: spec.w,
                   topFlat: longestFlat(edge(-1)), botFlat: longestFlat(edge(1)) });
      }
    }
    const agg = {};
    for (const o of out) {
      o.limitTop = Math.round(limitOf(o.w, true));
      o.limitBot = Math.round(limitOf(o.w, false));
      o.pass = o.topFlat <= o.limitTop && o.botFlat <= o.limitBot;
      if (!agg[o.kind] || agg[o.kind] < o.topFlat) agg[o.kind] = o.topFlat;
    }
    return { maxTopFlat: agg, all: out,
             fail: out.filter(o => !o.pass).map(o => o.id) };
  },
  __clouds: function () {
    return clouds.filter(c => c.age >= 0 && c.splitT <= 0).map(c => ({
      x: Math.round(c.x - CFG.ox), y: Math.round(c.y * 1000) / 1000,
      py: Math.round(c.y * HY),
      a0: Math.round(c.a0 * 1000) / 1000, s: Math.round(c.s * 100) / 100,
      w: c.spec.w, sx: Math.round(c.sx * 100) / 100,
      rw: Math.round(c.spec.w * 1.6 * c.s * c.sx),   // 精灵画布宽（含留白）
      rwBody: Math.round(c.spec.w * c.s * c.sx),     // 云体可视宽度
      a: Math.round((c.lastA || 0) * 100) / 100 }));
  },
  /** 诊断用：分裂过渡期间**每帧实际画出来的部件**（母云 + 两朵子云）。
   *  用来验证"裂开是渐进的、可见质量是连续的"，而不是靠肉眼看截图：
   *    · k        过渡进度 0→1
   *    · motherA  母云这一帧的实际透明度
   *    · motherW  母云这一帧的实际渲染宽（可视宽）
   *    · kids[]   子云的实际透明度与渲染宽高
   *  每帧调用一次即可拿到上一帧的真值（splitDiag 在 drawClouds 开头清空）。 */
  __splits: function () {
    return { inFlight: clouds.filter(c => c.splitT > 0).length,
             lastFrame: splitDiag.slice(0, 4) };
  },
  /** 诊断用：分裂阈值与过渡时长（回归脚本读它，避免在脚本里重抄一遍常量）。 */
  __cloudSplitMin: CLOUD_SPLIT_MIN,
  __cloudSplitAnim: CLOUD_SPLIT_ANIM,
  /** 诊断用：每头牲口的屏幕坐标、包围盒与倒地状态 */
  __animals: function () {
    const out = [];
    let i = 0;
    for (const h of herds) for (const a of h.members) {
      const b = animalScreenPos(h, a);
      out.push({ i: i++, kind: h.kind.id, x: Math.round(b.x), y: Math.round(b.y),
                 w: Math.round(b.w), h: Math.round(b.h),
                 state: a.state, roll: Math.round(a.roll * 1000) / 1000,
                 lockT: Math.round(a.lockT * 100) / 100 });
    }
    return out;
  },
  /** 诊断用：把一只动物按指定的 roll 单独画在离屏画布上，返回**实际着墨的包围盒**。
   *  用途是把「任意角度都不该塌成纸片」变成可断言的数字，而不是靠肉眼盯截图：
   *    · inkH  / inkW  着墨包围盒的高与宽
   *    · cy            着墨重心的竖向偏移（相对原点）；过 90° 应翻到另一侧，
   *                    用来确认是"整体翻面"而不是"上下镜像"
   *  roll: 0 = 站立，0.5 = 侧躺(θ=90°)，1 = 四脚朝天(θ=180°)。 */
  __rollProbe: function (roll, kind) {
    kind = kind || 'cow';
    const isCow = (kind === 'cow');
    const W = 260, Hc = 400, OY = Math.round(Hc * 0.70);
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = Hc;
    const g2 = cv.getContext('2d', { willReadFrequently: true });
    const col = isCow
      ? { body: '#000', shade: '#000', patch: '#000', head: '#000', horn: '#000' }
      : { body: '#000', shade: '#000', head: '#000' };
    const ct = Math.cos(Math.PI * roll);
    g2.translate(W / 2, OY);            // 平移不影响高度；但影响重心读数，故记下 OY
    if (isCow) drawCow(g2, col, 0.10, 0, ct);
    else drawSheep(g2, col, 0.10, 0, ct);

    const px = g2.getImageData(0, 0, W, Hc).data;
    let top = 1e9, bot = -1e9, lft = 1e9, rgt = -1e9, n = 0, ys = 0;
    for (let y = 0; y < Hc; y++) {
      for (let x = 0; x < W; x++) {
        if (px[(y * W + x) * 4 + 3] > 8) {
          n++; ys += y - OY;
          if (y < top) top = y;
          if (y > bot) bot = y;
          if (x < lft) lft = x;
          if (x > rgt) rgt = x;
        }
      }
    }
    return { roll: Math.round(roll * 1000) / 1000, deg: Math.round(180 * roll), kind: kind,
             inkH: n ? (bot - top + 1) : 0, inkW: n ? (rgt - lft + 1) : 0,
             cy: n ? Math.round(ys / n * 100) / 100 : 0, fill: n };
  },
  rebuild: rebuildAll,

  /** 诊断用：强制生成一架低空双翼机（绕过随机间隔），返回其屏幕坐标。
   *  仅当屏上还没有时生效，保持"至多一架"的约束不被破坏。 */
  __spawnBiplane: function () {
    if (biplanes.length) return null;
    spawnBiplane(0, mulberry32((Date.now() & 0xffff) >>> 0));
    const b = biplanes[biplanes.length - 1];
    return b ? { x: Math.round(b.x - CFG.ox), y: Math.round(b.y * HY) } : null;
  },
  /** 诊断用：低空双翼机当前屏幕坐标（供回归脚本定位点击） */
  __biplanes: function () {
    return biplanes.map(b => ({
      x: Math.round(b.x - CFG.ox), y: Math.round(b.y * HY),
      ejected: b.ejected, s: Math.round(b.s * 100) / 100,
    }));
  },
  /** 诊断用：跳伞中的飞行员（含状态机阶段与落地高度） */
  __paratroopers: function () {
    return paratroopers.map(p => ({
      x: Math.round(p.x - CFG.ox), y: Math.round(p.y),
      state: p.state, chute: Math.round(p.chute * 100) / 100,
      landY: Math.round(p.landY), fade: Math.round(p.fade * 100) / 100,
    }));
  },

  /** 宿主转发来的鼠标点击（坐标 = 显示器内的物理像素 = 本页的世界单位）。
   *  命中客机就洒一把彩纸，命中半径给得比机身大，否则移动中的飞机点不着。 */
  click: function (pt) {
    if (!CFG.egg) return 'off';
    const x = pt && typeof pt.x === 'number' ? pt.x : 0;
    const y = pt && typeof pt.y === 'number' ? pt.y : 0;

    /* 1) 客机：圆形判定，半径 62（机身约 40×32）。
     *    移动目标给宽一点，否则很难点中。 */
    const R = 62 * uiScale;
    for (const p of planes) {
      const px = p.x - CFG.ox, py = p.y * HY;
      if (Math.hypot(x - px, y - py) > R) continue;
      spawnConfetti(px, py, p.vx, p.vyR * HY, planeRnd);
      return 'plane';
    }

    /* 1.5) 低空双翼机：点击触发飞行员跳伞。已触发过的（无人驾驶中）不再响应。 */
    const RB = 50 * uiScale;
    for (const b of biplanes) {
      if (b.ejected) continue;
      const bx = b.x - CFG.ox, by = b.y * HY;
      if (Math.hypot(x - bx, y - by) > RB) continue;
      spawnParatrooper(b, biplaneRnd);
      b.ejected = true;
      return 'biplane';
    }

    /* 2) 牛羊：以四蹄中心为原点的矩形包围盒（高度已含低头时的头）。
     *    **一次点击会掀翻所有被点中的个体**，而不是只取第一个 ——
     *    牛羊是成团紧挨着的，只倒一只会让人觉得"明明点中了好几只"。
     *    倒地动画进行中的不可再点，这是动画期间的交互限制；不同个体各有
     *    自己的计时，所以可以同时有多只处于倒地状态。 */
    let downKind = null, downN = 0;
    for (const h of herds) {
      for (const a of h.members) {
        if (a.lockT > 0) continue;
        const b = animalScreenPos(h, a);
        if (x < b.x - b.w * 0.5 || x > b.x + b.w * 0.5) continue;
        if (y < b.y - b.h || y > b.y + 5 * uiScale) continue;
        knockOver(h, a, herdRnd);
        downN++;
        if (!downKind || h.kind.id === 'cow') downKind = h.kind.id;
      }
    }
    if (downN > 0) return downKind;            // 'cow' 或 'sheep'

    /* 3) 白云：用精灵的实际绘制矩形再内缩 20%。
     *    画布留白很大，直接用整块会把没云的地方也判成命中。 */
    for (const c of clouds) {
      if (c.age < 0 || c.splitT > 0 || (c.lastA || 0) < 0.25) continue;
      const spr = getCloudSprite(c.spec, c.vi);
      const w = spr.w * c.s * c.sx * 0.80;
      const hgt = spr.h * c.s * c.sy * 0.75;
      const cx = c.x - CFG.ox, cy = c.y * HY;
      if (x < cx - w * 0.5 || x > cx + w * 0.5) continue;
      if (y < cy - hgt * 0.70 || y > cy + hgt * 0.30) continue;
      /* 阈值按**云体可视宽度**判定，不用精灵画布宽 —— 画布含大量透明留白，
       * 拿它当判据会把阈值放大 1.6 倍。 */
      if (c.spec.w * c.s * c.sx < CLOUD_SPLIT_MIN) return 'cloud-small';
      /* 子云立刻造好并挂到母云上：过渡期间要把它们画出来（从母云中心长出去），
       * 走完再由 updateClouds 接进主列表。 */
      c.splitKids = splitCloud(c, cloudRnd);
      c.splitT = CLOUD_SPLIT_ANIM;
      return 'cloud';
    }
    return 'miss';
  },
  /** 宿主挂载完成后调用：收走起始遮罩，露出完整画面。 */
  reveal: function () {
    if (bootEl) { bootEl.classList.add('hide'); }
    return true;
  },
  seedBloom: function () { rebuildAll(); }
};

let resizeTimer = 0;
window.addEventListener('resize', function () {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(rebuildAll, 180);
});
document.addEventListener('visibilitychange', function () {
  if (document.hidden) running = false;
  else { running = true; lastFrame = 0; }
});

rebuildAll();
requestAnimationFrame(tick);

})();
