/* ==========================================================================
   ENTER THE FLOW — 交互式流场
   --------------------------------------------------------------------------
   物理模型（三层，都是慢的）：

     1. 基场  baseX/baseY
        由「值噪声势场 ψ」的旋度生成：v = (∂ψ/∂y, −∂ψ/∂x)。
        旋度场天然无散度 —— 流线不会自发堆积成黑块，这是画面能保持通透的关键。
        只取方向，速度大小另由一层极低频噪声调制，所以流线几何不受影响。
        为了不让「重算网格」造成周期性卡顿，每帧只滚动更新 1/7 的行。

     2. 扰动场  pertX/pertY
        鼠标划过的速度被「写入」网格（局部漩涡 + 轻微推开）。
        每帧做一次拉普拉斯扩散 + 指数衰减：
          · 扩散  → 扰动缓慢向外传播，远处的线是「延迟响应」而不是同时抖动
          · 衰减  → 手离开后场一点点忘记，约 4 秒回到静息，不会突然停住

     3. 流线
        每根线是一串点，按采样到的速度平流；之后再做一次轻微的「张力」松弛
        （每个点往邻居中点靠一点），保证曲线永远顺滑、不打结、不直角。

   渲染：Canvas 2D 真 hairline。WebGL 画 1px 线要靠导数抗锯齿硬凑，
   反而没有这里的细腻，而且每根线需要独立状态才能做出连锁反应。
   ========================================================================== */

(() => {
  'use strict'

  const canvas = document.getElementById('flow')
  if (!canvas) return
  const ctx = canvas.getContext('2d', { alpha: true })
  if (!ctx) return

  const TAU = Math.PI * 2

  /*
   * prefers-reduced-motion 判断要「宁动勿静」：
   * 只有浏览器明确报出 reduce 才进静态模式。matchMedia 不存在、抛异常、
   * 或者 matches 不是布尔 true，一律当作「正常动」。
   * （早期版本直接读 motionQuery.matches，一旦这个 API 在某个环境里缺失，
   *   整页会静悄悄地停在静帧上，而且没有任何提示。）
   */
  let motionQuery = null
  try {
    motionQuery = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null
  } catch {
    motionQuery = null
  }
  const prefersReduced = () => motionQuery?.matches === true

  /*
   * 强制动态开关。
   *
   * 背景：Windows 的「设置 → 辅助功能 → 视觉效果 → 动画效果」关掉之后，
   * Chrome 会报 prefers-reduced-motion: reduce，本作品就按无障碍规范进静帧。
   * 这是对的，但用户会看到一片不动的画面，而且**完全不知道为什么** ——
   * 调参台里滑杆怎么拖都没反应，看起来像坏了。
   *
   * 所以给一条明确的逃生通道：
   *   ?motion=full   强制完整动态（不管系统怎么设）
   *   ?motion=auto   回到跟随系统
   * 也记进 localStorage，这样调参台 iframe 重载后仍然有效。
   */
  const MOTION_KEY = 'flow.motionOverride'
  const readStoredOverride = () => {
    try {
      return window.localStorage?.getItem(MOTION_KEY) === 'full'
    } catch {
      return false
    }
  }
  const storeOverride = (on) => {
    try {
      window.localStorage?.setItem(MOTION_KEY, on ? 'full' : 'auto')
    } catch {
      /* 隐私模式下 localStorage 可能不可写，忽略即可 */
    }
  }

  let motionOverride = readStoredOverride()
  try {
    const wanted = new URLSearchParams(window.location.search).get('motion')
    if (wanted === 'full') motionOverride = true
    else if (wanted === 'auto') motionOverride = false
  } catch {
    /* 没有 search 就算了 */
  }

  const shouldReduce = () => !motionOverride && prefersReduced()
  let reduceMotion = shouldReduce()

  /* ====================================================================== */
  /* 1. 预设与章节                                                          */
  /* ====================================================================== */

  const PRESET = {
    wide: { lines: 94, points: 116, spacing: 11.5, cell: 30, speed: 44, chunks: 3 },
    narrow: { lines: 38, points: 76, spacing: 11, cell: 42, speed: 34, chunks: 2 },
  }

  /**
   * 调参面板（/home/lab.html）能改的全部数值。
   *
   * 原则：写死的常量一律搬到这里。想调任何一个手感都只改这一处，
   * 不用在几千行里翻。面板会从 window.__flow.lab.spec() 读出这些定义自动生成 UI，
   * 所以加一个新参数只需要在这里加一行。
   */
  const tuning = {
    // 流线
    tension: 0.03, // 曲率松弛的基础系数（没超限的弯用这个）
    maxTurnDeg: 4, // 每段允许的最大折角；超过就按超出比例加压压平
    turnBoost: 10, // 超限点的平滑权重放大倍数（0 = 退回纯均匀松弛）
    lineWidthScale: 1, // 线宽倍数
    ink: 1, // 整体墨色浓度倍数

    // 流动感
    speedSpread: 0.28, // 每根线的速度随机系数 ±28% -> 0.72~1.28，避免整体像一张贴图在平移
    breathAmount: 0.05, // 全局「呼吸」幅度（3%~7% 之间，几秒到十几秒一轮）
    breathPerLine: 0.02, // 每根线额外的相位呼吸
    maxSpeed: 300, // 采样限速，防止局部叠加后飞出去

    // 鼠标扰动（手划过水面）
    mouseRadius: 230, // 注入半径 px —— 宽而柔的偏转区，不是把线条打散
    mouseMagBase: 26, // 基础推力
    mouseMagSpeed: 2.4, // 随鼠标速度增加的推力
    mouseDrag: 0.95, // 沿运动方向「拖水」的比重（尾迹的来源，主导项）
    mouseSwirl: 0.4, // 垂直方向的漩涡比重（压低：漩涡是「打散」的主要来源）
    mousePush: 0.35, // 从光标向外推开的比重
    pertCap: 150, // 单个网格的最大扰动速度
    pertDiffuse: 0.115, // 拉普拉斯扩散系数（传播速度）
    pertDecay: 0.62, // 指数衰减速率（遗忘速度）

    // 点击涟漪
    rippleLife: 3.4,
    rippleSpeed: 235,
    rippleBand: 60,
    ripplePower: 120,
    rippleInk: 0.26, // 圆环的不透明度上限
    rippleInkInner: 0.14, // 内圈

    // 文字
    textRadius: 232,
    textPush: 22,
    textPushY: 15,
    textStretch: 0.3,
    labelPush: 16,
    labelPushLarge: 21,

    // 文字作为流场障碍
    obstacleMargin: 0.075, // 相对 min(W,H)
    obstacleStrength: 34,

    // 线中点互相排斥的速率（按流速缩放，见 spreadMidpoints）
    spreadRate: 34,
  }

  /**
   * 滚动 = 进入另一个空间：方向、密度、形态、色温全都在缓慢换档。
   *
   * bias 是关键：它是常量漂移 D 相对旋度项的倍数，直接决定「方向能偏多少」。
   * 合成方向偏离主方向的最大角度 = atan(1 / bias)：
   *
   *   bias 0.34 -> ±71°   相邻线可以一条向左一条向右，各走各的（散）
   *   bias 0.50 -> ±63°   勉强算有主方向
   *   bias 1.55 -> ±33°   明确的集体流向，仍保留宽缓摆动  ← 现在
   *   bias 3.0  -> ±18°   接近平行拉丝，失去水面感
   *
   * 注意：旋度场仍然是无散度的，bias 只是叠加一个常量 —— 不破坏面积守恒。
   */
  const CHAPTERS = [
    { rot: 0.0, freq: 0.00175, speed: 1.0, density: 1.0, tint: 0.12, biasAngle: -0.32, bias: 1.55 },
    { rot: 0.52, freq: 0.0024, speed: 1.16, density: 0.83, tint: 0.62, biasAngle: 0.66, bias: 1.75 },
    { rot: -0.4, freq: 0.00195, speed: 0.86, density: 0.92, tint: 1.0, biasAngle: -0.9, bias: 1.4 },
  ]
  // 有效速度 = PRESET.wide.speed(44) × speed -> 44 / 51 / 38 px/s

  const params = {
    rot: 0,
    freq: 0.00175,
    speed: 1,
    density: 1,
    tint: 0.12,
    biasAngle: -0.32,
    bias: 1.55,
  }
  let rotCos = 1
  let rotSin = 0

  /* ---------------------------------------------------------------------- */
  /* 调参面板：参数表 + 取值/写值                                            */
  /* ---------------------------------------------------------------------- */

  /** 代码里的原始值，供「恢复默认」用 */
  const DEFAULTS = {
    preset: JSON.parse(JSON.stringify(PRESET)),
    chapters: JSON.parse(JSON.stringify(CHAPTERS)),
    tuning: { ...tuning },
  }

  /** 面板当前正在编辑哪一章（只影响面板，不影响渲染 —— 渲染永远按滚动进度插值） */
  let activeChapter = 0

  const LAB_SPEC = [
    {
      group: '流线 · PRESET',
      hint: 'preset.speed 就是 PRESET.wide.speed',
      items: [
        { path: 'preset.speed', label: '基准速度', unit: 'px/s', min: 0, max: 90, step: 0.5 },
        { path: 'preset.lines', label: '线条数', unit: '根', min: 8, max: 220, step: 1, rebuild: true },
        { path: 'preset.points', label: '每根线点数', unit: '', min: 24, max: 220, step: 2, rebuild: true },
        { path: 'preset.spacing', label: '点间距', unit: 'px', min: 5, max: 26, step: 0.5, rebuild: true },
        { path: 'preset.cell', label: '场网格', unit: 'px', min: 12, max: 80, step: 1, rebuild: true },
        { path: 'preset.chunks', label: '分段上色', unit: '段', min: 1, max: 6, step: 1, rebuild: true },
        { path: 'tuning.tension', label: '曲率松弛', unit: '', min: 0, max: 0.12, step: 0.002 },
        { path: 'tuning.maxTurnDeg', label: '最大折角', unit: '°/段', min: 1, max: 20, step: 0.5 },
        { path: 'tuning.turnBoost', label: '超限加压', unit: '×', min: 0, max: 20, step: 0.5 },
        { path: 'tuning.lineWidthScale', label: '线宽倍数', unit: '×', min: 0.2, max: 4, step: 0.05 },
        { path: 'tuning.ink', label: '墨色浓度', unit: '×', min: 0.2, max: 4, step: 0.05 },
      ],
    },
    {
      group: '场 · 章节参数',
      hint: '只影响所选章节；滚动到对应章节才看得到效果',
      chapter: true,
      items: [
        { path: 'chapter.freq', label: '噪声频率', unit: '', min: 0.0003, max: 0.007, step: 0.00005 },
        { path: 'chapter.speed', label: '速度系数', unit: '×', min: 0, max: 3, step: 0.02 },
        { path: 'chapter.density', label: '线条密度', unit: '×', min: 0.15, max: 1.5, step: 0.01 },
        { path: 'chapter.tint', label: '色温（青/紫）', unit: '', min: 0, max: 1.5, step: 0.01 },
        { path: 'chapter.rot', label: '场旋转', unit: 'rad', min: -1.6, max: 1.6, step: 0.01 },
        { path: 'chapter.bias', label: '主流强度', unit: '×旋度', min: 0, max: 4, step: 0.05 },
        { path: 'chapter.biasAngle', label: '偏置角度', unit: 'rad', min: -3.15, max: 3.15, step: 0.01 },
      ],
    },
    {
      group: '流动感',
      hint: '速度、错开、呼吸、限速。judge 流动是否明显主要看这一组。',
      items: [
        { path: 'tuning.speedSpread', label: '每线速度差', unit: '±', min: 0, max: 0.6, step: 0.01 },
        { path: 'tuning.breathAmount', label: '全局呼吸', unit: '±', min: 0, max: 0.15, step: 0.005 },
        { path: 'tuning.breathPerLine', label: '每线呼吸', unit: '±', min: 0, max: 0.1, step: 0.002 },
        { path: 'tuning.maxSpeed', label: '采样限速', unit: 'px/s', min: 60, max: 900, step: 10 },
      ],
    },
    {
      group: '交互 · 鼠标扰动',
      hint: '扰动先影响近处，再靠扩散传到远处。尾迹长度由「衰减速率」决定。',
      items: [
        { path: 'tuning.mouseRadius', label: '注入半径', unit: 'px', min: 20, max: 600, step: 5 },
        { path: 'tuning.mouseMagBase', label: '基础推力', unit: '', min: 0, max: 200, step: 2 },
        { path: 'tuning.mouseMagSpeed', label: '随速度推力', unit: '', min: 0, max: 10, step: 0.1 },
        { path: 'tuning.mouseDrag', label: '沿向拖水', unit: '', min: 0, max: 2, step: 0.05 },
        { path: 'tuning.mouseSwirl', label: '漩涡', unit: '', min: 0, max: 2, step: 0.05 },
        { path: 'tuning.mousePush', label: '向外推开', unit: '', min: 0, max: 2, step: 0.05 },
        { path: 'tuning.pertCap', label: '扰动上限', unit: 'px/s', min: 5, max: 600, step: 5 },
        { path: 'tuning.pertDiffuse', label: '扩散系数', unit: '', min: 0, max: 0.24, step: 0.005 },
        { path: 'tuning.pertDecay', label: '衰减速率', unit: '/s', min: 0.05, max: 3, step: 0.02 },
      ],
    },
    {
      group: '交互 · 点击涟漪',
      items: [
        { path: 'tuning.ripplePower', label: '推力', unit: '', min: 0, max: 400, step: 5 },
        { path: 'tuning.rippleSpeed', label: '扩散速度', unit: 'px/s', min: 40, max: 900, step: 5 },
        { path: 'tuning.rippleBand', label: '波带宽度', unit: 'px', min: 8, max: 220, step: 2 },
        { path: 'tuning.rippleLife', label: '寿命', unit: 's', min: 0.4, max: 10, step: 0.1 },
        { path: 'tuning.rippleInk', label: '圆环浓度', unit: '', min: 0, max: 0.8, step: 0.01 },
        { path: 'tuning.rippleInkInner', label: '内圈浓度', unit: '', min: 0, max: 0.8, step: 0.01 },
      ],
    },
    {
      group: '文字反应',
      items: [
        { path: 'tuning.textRadius', label: '影响半径', unit: 'px', min: 30, max: 700, step: 5 },
        { path: 'tuning.textPush', label: '横向位移', unit: 'px', min: 0, max: 90, step: 1 },
        { path: 'tuning.textPushY', label: '纵向位移', unit: 'px', min: 0, max: 90, step: 1 },
        { path: 'tuning.textStretch', label: '拉伸', unit: '', min: 0, max: 1, step: 0.01 },
        { path: 'tuning.labelPush', label: '小标签位移', unit: 'px', min: 0, max: 80, step: 1 },
        { path: 'tuning.labelPushLarge', label: '段落位移', unit: 'px', min: 0, max: 80, step: 1 },
      ],
    },
    {
      group: '文字作为流场障碍',
      hint: '流线在文字附近折射绕行。推力会跟着流速一起缩放 —— 速度调到 0 时整片水面静止。',
      items: [
        { path: 'tuning.obstacleMargin', label: '影响范围', unit: '×min(W,H)', min: 0, max: 0.3, step: 0.005 },
        { path: 'tuning.obstacleStrength', label: '推开强度', unit: 'px/s@19', min: 0, max: 160, step: 2 },
      ],
    },
    {
      group: '线条散布',
      hint: '中点互相排斥，防止长期聚集成河道。速率按流速缩放。',
      items: [
        { path: 'tuning.spreadRate', label: '排斥速率', unit: '', min: 0, max: 120, step: 1 },
      ],
    },
  ]

  function readPath(path) {
    if (path.startsWith('preset.')) return preset[path.slice(7)]
    if (path.startsWith('tuning.')) return tuning[path.slice(7)]
    if (path.startsWith('chapter.')) return CHAPTERS[activeChapter][path.slice(8)]
    return undefined
  }

  /** 代码里的原始值，面板用它标出「这项被改过」 */
  function readDefault(path) {
    if (path.startsWith('preset.')) {
      const which = preset === PRESET.wide ? 'wide' : 'narrow'
      return DEFAULTS.preset[which][path.slice(7)]
    }
    if (path.startsWith('tuning.')) return DEFAULTS.tuning[path.slice(7)]
    if (path.startsWith('chapter.')) return DEFAULTS.chapters[activeChapter][path.slice(8)]
    return undefined
  }

  /** 面板拖动滑杆时会连发 input 事件；重建（重新撒线、重算网格）要防抖 */
  let rebuildTimer = 0
  function scheduleRebuild() {
    clearTimeout(rebuildTimer)
    rebuildTimer = setTimeout(setup, 130)
  }

  function writePath(path, value) {
    const num = Number(value)
    if (!Number.isFinite(num)) return { ok: false, value: undefined, reason: 'not a number' }

    const needsRebuild = LAB_SPEC.some((group) =>
      group.items.some((item) => item.path === path && item.rebuild),
    )

    if (path.startsWith('preset.')) {
      preset[path.slice(7)] = num
    } else if (path.startsWith('tuning.')) {
      tuning[path.slice(7)] = num
    } else if (path.startsWith('chapter.')) {
      CHAPTERS[activeChapter][path.slice(8)] = num
    } else {
      return { ok: false, value: undefined, reason: 'unknown path' }
    }

    if (needsRebuild) scheduleRebuild()
    return { ok: true, value: readPath(path), rebuilt: needsRebuild }
  }

  /* ====================================================================== */
  /* 2. 值噪声                                                              */
  /* ====================================================================== */

  const PERM = new Uint8Array(512)
  const VALS = new Float32Array(256)

  /** 确定性 PRNG：调参面板里换 seed 可复现同一片地形 */
  function mulberry32(a) {
    return function next() {
      a |= 0
      a = (a + 0x6d2b79f5) | 0
      let t = Math.imul(a ^ (a >>> 15), 1 | a)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
  }

  let currentSeed = 0

  function seedNoise(rng) {
    const random = rng ?? Math.random
    const p = new Uint8Array(256)
    for (let i = 0; i < 256; i += 1) p[i] = i
    for (let i = 255; i > 0; i -= 1) {
      const j = (random() * (i + 1)) | 0
      const t = p[i]
      p[i] = p[j]
      p[j] = t
    }
    for (let i = 0; i < 512; i += 1) PERM[i] = p[i & 255]
    for (let i = 0; i < 256; i += 1) VALS[i] = random() * 2 - 1
  }

  seedNoise()

  /** 二维值噪声，返回 [-1, 1]；smoothstep 插值保证一阶连续（求梯度不会抖） */
  function noise2(x, y) {
    const xi = Math.floor(x)
    const yi = Math.floor(y)
    const xf = x - xi
    const yf = y - yi
    const u = xf * xf * (3 - 2 * xf)
    const v = yf * yf * (3 - 2 * yf)
    const X = xi & 255
    const Y = yi & 255
    const a = VALS[PERM[X + PERM[Y]]]
    const b = VALS[PERM[X + 1 + PERM[Y]]]
    const c = VALS[PERM[X + PERM[Y + 1]]]
    const d = VALS[PERM[X + 1 + PERM[Y + 1]]]
    const top = a + (b - a) * u
    const bot = c + (d - c) * u
    return top + (bot - top) * v
  }

  /* ====================================================================== */
  /* 3. 调色：整体灰，只有区域性的极淡青 / 蓝 / 紫                          */
  /* ====================================================================== */

  const TINT_STOPS = [
    [0.0, 17, 24, 31, 0.088],
    [0.3, 17, 24, 31, 0.052],
    [0.48, 12, 88, 118, 0.055],
    [0.64, 8, 145, 178, 0.049],
    [0.8, 37, 99, 235, 0.043],
    [0.92, 109, 40, 217, 0.039],
    [1.0, 124, 58, 237, 0.055],
  ]
  const PALETTE_N = 48
  const palette = []

  ;(function buildPalette() {
    for (let i = 0; i < PALETTE_N; i += 1) {
      const t = i / (PALETTE_N - 1)
      let a = TINT_STOPS[0]
      let b = TINT_STOPS[TINT_STOPS.length - 1]
      for (let s = 0; s < TINT_STOPS.length - 1; s += 1) {
        if (t >= TINT_STOPS[s][0] && t <= TINT_STOPS[s + 1][0]) {
          a = TINT_STOPS[s]
          b = TINT_STOPS[s + 1]
          break
        }
      }
      const span = b[0] - a[0] || 1
      const k = (t - a[0]) / span
      const r = Math.round(a[1] + (b[1] - a[1]) * k)
      const g = Math.round(a[2] + (b[2] - a[2]) * k)
      const bl = Math.round(a[3] + (b[3] - a[3]) * k)
      const al = a[4] + (b[4] - a[4]) * k
      palette.push(`rgba(${r},${g},${bl},${al.toFixed(3)})`)
    }
  })()

  /** 大尺度色温场：只有约一半区域会被「点亮」，其余保持纯灰 */
  function tintAt(x, y) {
    const n = noise2(x * 0.00085 + time * 0.016, y * 0.00085 - time * 0.012)
    let t = (n * 0.5 + 0.5 - 0.52) * 2.4
    if (t < 0) t = 0
    else if (t > 1) t = 1
    return t * params.tint
  }

  /* ====================================================================== */
  /* 4. 场网格                                                              */
  /* ====================================================================== */

  let W = 1
  let H = 1
  let dpr = 1
  let lw = 0.85
  let cell = 30
  let cols = 4
  let rows = 4
  let baseX, baseY, pertX, pertY, tmpX, tmpY
  let baseCursor = 0
  /** |∇ψ| 的滑动均值，用来把速度自校准到目标值（手算噪声统计量太脆） */
  let gMean = 0.006
  /** 速度归一系数：令场速度均值精确等于目标值（|v| 对它线性，所以一次算准） */
  let speedTrim = 1
  /** trim=1 时的场速度均值，用来解出 speedTrim */
  let v0Mean = 44

  let preset = PRESET.wide
  let lineCount = preset.lines
  let pointCount = preset.points
  let spacing = preset.spacing
  let chunks = preset.chunks
  let chunkStart = new Int32Array(chunks)
  let chunkEnd = new Int32Array(chunks)

  // 弧长重采样用的临时缓冲，按 pointCount 分配一次，逐帧复用（不产生 GC）
  let resampleX = new Float32Array(1)
  let resampleY = new Float32Array(1)
  let resampleCum = new Float32Array(1)

  // 中点排斥用的每根线累积位移
  let spreadDX = new Float32Array(0)
  let spreadDY = new Float32Array(0)

  const obstacles = []
  const vec = { x: 0, y: 0 }
  let time = 0

  /**
   * 流函数 ψ。四层八度，权重按「振幅 × 频率」配平 ——
   * 因为梯度正比于振幅×频率，光看振幅会被高频层悄悄压过去。
   * 梯度方向就是流线方向，所以这张表**直接决定线条弯得急不急**。
   *
   * 层的分配要满足：一条线在较长距离内保持相近方向。
   * 线条长 1322px，所以弯曲波长必须远大于 1322px 才谈得上「宽缓」——
   * 波长 440px 的层会在一条线上走完 3 个完整弯曲周期，那就是毛发。
   *
   *   主弯层   7.5 × 0.17f -> 1.275  波长约 3400px  能量 76%   宽缓的大弧
   *   次弯层   1.5 × 0.42f -> 0.630  波长约 1360px  能量 19%   让弧线不雷同
   *   扰动层   0.32 × 1.05f -> 0.336 波长约 540px   能量 5%    一点点手感
   *   纹理层   0.05 × 2.6f -> 0.130  波长约 220px   能量 1%    几乎看不见
   *
   * 早先版本是 1.36 / 0.80 / 0.72 / 0.50，高频两层占了 **21% 的梯度能量**，
   * 波长只有 440px 和 184px —— 一条线上要经历 3~7 个弯曲周期。
   * 实测后果：中位折角只有 0.35°（大部分地方是顺的），
   * 但**最大折角 19~51°、最小弯曲半径 13px** —— 每条线上都散布着几个发卡弯，
   * 视觉上就是「飘动的头发」。
   */
  function potential(x, y, t, freq) {
    return (
      noise2(x * freq * 0.17 + 5.1 + t * 0.009, y * freq * 0.17 - 2.7 + t * 0.007) * 7.5 +
      noise2(x * freq * 0.42 + 17.4 + t * 0.014, y * freq * 0.42 - 8.9 + t * 0.011) * 1.5 +
      noise2(x * freq * 1.05 + 39.2 + t * 0.026, y * freq * 1.05 - 12.6 + t * 0.02) * 0.32 +
      noise2(x * freq * 2.6 - 71.5 + t * 0.042, y * freq * 2.6 + 58.3 + t * 0.032) * 0.05
    )
  }

  /**
   * 滚动更新其中若干行，把重算成本摊平，避免每 7 帧卡一下。
   *
   * 关于「无散度」这件事，这里踩了三次坑，最终形态是这样：
   *
   *   v = scale · sm(ψ) · curl(ψ) + D
   *
   *   · curl(ψ) 本身无散度，且**绝不能归一化** ——
   *     normalize 会把无散度性质扔掉，流线随即开始汇成河道。
   *     速度大小改用 sm(ψ)，而 sm 只是 ψ 的函数：
   *         div(f(ψ)·curl(ψ)) = f'(ψ)·(curl(ψ)·∇ψ) + f(ψ)·div(curl ψ) = 0
   *     因为 curl(ψ)·∇ψ ≡ 0（旋度与梯度垂直），所以这一项严格无散度。
   *   · scale 是**常数**，常数缩放同样不破坏无散度。
   *   · D 是**常量**向量，散度为零；它保证驻点附近也不会完全静止，
   *     同时给每一章一个不同的主导方向。
   *
   * 无散度 = 面积守恒 = 初始均匀分布的质点永远保持均匀 ——
   * 这是「画面不会慢慢空掉、也不会汇成几条深色河道」的数学保证。
   */
  function recomputeRows(startRow, rowCount) {
    const t = time
    const freq = params.freq
    const cr = rotCos
    const sr = rotSin
    const h = 0.25 / Math.max(1e-5, freq)
    const obCount = obstacles.length
    const targetSpeed = preset.speed * params.speed
    /*
     * 速度自校准 —— 一次算准，不用迭代。
     *
     * 关键性质：|v| 对 speedTrim 是**严格线性**的（trim 是个正标量，乘在整条矢量上）。
     * 所以只要先按 trim=1 统计一遍场速度均值 v0Mean，
     * 就能直接令 speedTrim = 目标 / v0Mean，一步到位。
     *
     * 之前用的是「实测/目标」的迭代反馈，问题很多：环路有 20 帧延迟、
     * 增益靠试、还可能发散（实测 trim 一会儿 1.007 一会儿 1.37）。
     * 既然关系是线性的，就不该用迭代去逼近它。
     */
    const scale = targetSpeed / Math.max(gMean, 1e-7)
    const trim = v0Mean > 1e-6 && targetSpeed > 0.5 ? targetSpeed / v0Mean : 1
    speedTrim = Math.max(0.2, Math.min(4, trim))
    const driftX = Math.cos(params.biasAngle) * targetSpeed * params.bias
    const driftY = Math.sin(params.biasAngle) * targetSpeed * params.bias
    // 障碍推力也要跟着流速走：静止的水面不该为文字让路。
    // （漏掉这一步时，把速度调到 0 画布仍然在动，只是动的只有文字周围。）
    const obstacleScale = flowFactor()

    let gSum = 0
    let gCount = 0
    let v0Sum = 0

    for (let n = 0; n < rowCount; n += 1) {
      const j = (startRow + n) % rows
      const rowBase = j * cols
      const py = (j + 0.5) * cell

      for (let i = 0; i < cols; i += 1) {
        const px = (i + 0.5) * cell
        const rx = px * cr + py * sr
        const ry = -px * sr + py * cr

        // 旋度：v = (∂ψ/∂y, −∂ψ/∂x)，以及 ψ 本身（给 sm 定标）
        const pA = potential(rx, ry + h, t, freq)
        const pB = potential(rx, ry - h, t, freq)
        const pC = potential(rx + h, ry, t, freq)
        const pD = potential(rx - h, ry, t, freq)
        const psi = potential(rx, ry, t, freq)

        const gx = pA - pB
        const gy = -(pC - pD)
        gSum += Math.sqrt(gx * gx + gy * gy)
        gCount += 1

        // 从「场坐标」旋回世界坐标（旋转是刚性的，不改变向量长度）
        const wx = gx * cr - gy * sr
        const wy = gx * sr + gy * cr

        // ψ 的缓急调制。范围刻意收在 0.68~1.32：
        // 旋度分量和常量漂移是矢量相加，如果 sm 太极端（比如 0.55），
        // 旋度会和漂移正好抵消，画面上就会出现一大片几乎静止的死区。
        const psiN = psi > 2.6 ? 1 : psi < -2.6 ? -1 : psi / 2.6
        const sm = 0.68 + 0.64 * (psiN * 0.5 + 0.5)

        // speedTrim 作用在**最终速度**上（含漂移），这样「实测 = 目标」才成立。
        // 顺手把 trim=1 时的速度幅值累计起来，给下一趟算精确的 trim。
        const bvx = wx * scale * sm + driftX
        const bvy = wy * scale * sm + driftY
        v0Sum += Math.sqrt(bvx * bvx + bvy * bvy)

        let vx = bvx * speedTrim
        let vy = bvy * speedTrim

        // 文字是障碍：流线在它附近折射、绕行。
        // 用「到矩形的距离」而不是「到中心的距离」，否则宽标题只有正中一小块起作用。
        for (let k = 0; k < obCount; k += 1) {
          const ob = obstacles[k]
          const qx = px < ob.x0 ? ob.x0 : px > ob.x1 ? ob.x1 : px
          const qy = py < ob.y0 ? ob.y0 : py > ob.y1 ? ob.y1 : py
          let dx = px - qx
          let dy = py - qy
          let d = Math.sqrt(dx * dx + dy * dy)

          if (d < 1e-4) {
            dx = px - ob.cx
            dy = py - ob.cy
            d = Math.sqrt(dx * dx + dy * dy) || 1
          }
          if (d >= ob.margin) continue

          const f = 1 - d / ob.margin
          const push = f * f * ob.strength * obstacleScale
          const nx = dx / d
          const ny = dy / d
          // 法向推开 + 一点切向分量，读起来像「绕流」而不是「弹开」
          vx += nx * push - ny * push * 0.6
          vy += ny * push + nx * push * 0.6
        }

        const idx = rowBase + i
        baseX[idx] = vx
        baseY[idx] = vy
      }
    }

    // 梯度均值与「trim=1 时的速度均值」的慢速 EMA：下一趟据此一次算准 trim
    // 精确校准在 setup() 里一次做完；这里的 EMA 只负责「调参后缓慢跟踪」，
    // 所以系数压得很低，别去扰动那个精确解。
    if (gCount) {
      gMean += (gSum / gCount - gMean) * 0.02
      v0Mean += (v0Sum / gCount - v0Mean) * 0.02
    }
  }

  /**
   * 一次性速度校准（满网格，不靠 EMA 慢慢收敛）。
   *
   * |v| 对 speedTrim 严格线性，所以分两步就能精确解出：
   *   1. 统计 |∇ψ| 的均值          -> 定出 scale
   *   2. 统计 |scale·sm·∇ψ + D| 的均值 -> 定出 speedTrim
   *
   * 为什么需要这个：静帧模式只重算一趟网格，靠 EMA 是来不及收敛的 ——
   * 实测 speedTrim 会停在 0.20 这种错值上（初值 gMean=0.006 离真值太远）。
   * 静态帧也得是「正确流速下的静帧」。
   */
  function calibrateSpeed() {
    const t = time
    const freq = params.freq
    const cr = rotCos
    const sr = rotSin
    const h = 0.25 / Math.max(1e-5, freq)
    const targetSpeed = preset.speed * params.speed

    let gSum = 0
    let n = 0
    for (let j = 0; j < rows; j += 1) {
      const py = (j + 0.5) * cell
      for (let i = 0; i < cols; i += 1) {
        const px = (i + 0.5) * cell
        const rx = px * cr + py * sr
        const ry = -px * sr + py * cr
        const gx = potential(rx, ry + h, t, freq) - potential(rx, ry - h, t, freq)
        const gy = -(potential(rx + h, ry, t, freq) - potential(rx - h, ry, t, freq))
        gSum += Math.sqrt(gx * gx + gy * gy)
        n += 1
      }
    }
    if (!n) return
    gMean = gSum / n

    const scale = targetSpeed / Math.max(gMean, 1e-7)
    const driftX0 = Math.cos(params.biasAngle) * targetSpeed * params.bias
    const driftY0 = Math.sin(params.biasAngle) * targetSpeed * params.bias

    let vSum = 0
    for (let j = 0; j < rows; j += 1) {
      const py = (j + 0.5) * cell
      for (let i = 0; i < cols; i += 1) {
        const px = (i + 0.5) * cell
        const rx = px * cr + py * sr
        const ry = -px * sr + py * cr
        const gx = potential(rx, ry + h, t, freq) - potential(rx, ry - h, t, freq)
        const gy = -(potential(rx + h, ry, t, freq) - potential(rx - h, ry, t, freq))
        const psi = potential(rx, ry, t, freq)
        const wx = gx * cr - gy * sr
        const wy = gx * sr + gy * cr
        const psiN = psi > 2.6 ? 1 : psi < -2.6 ? -1 : psi / 2.6
        const sm = 0.68 + 0.64 * (psiN * 0.5 + 0.5)
        const bx = wx * scale * sm + driftX0
        const by = wy * scale * sm + driftY0
        vSum += Math.sqrt(bx * bx + by * by)
      }
    }
    v0Mean = vSum / n
    speedTrim =
      targetSpeed > 0.5 && v0Mean > 1e-6
        ? Math.max(0.2, Math.min(4, targetSpeed / v0Mean))
        : 1
  }

  function stepBase() {
    const rowsPer = Math.max(2, Math.ceil(rows / 7))
    recomputeRows(baseCursor, rowsPer)
    baseCursor = (baseCursor + rowsPer) % rows
  }

  /**
   * 流速系数：相对本预设的默认速度（wide=44 / narrow=34）。
   *
   * 所有「修正性」的力（曲率松弛、线中点排斥、文字障碍）都要乘上它。
   * 它们本质是在修正平流带来的副作用；水不流了就没有东西需要修正，
   * 否则把速度调到 0 画面仍然在自己慢慢整理 —— 那不是静止。
   */
  function flowFactor() {
    const speed = preset.speed * params.speed
    if (speed <= 0) return 0
    const ref = preset === PRESET.wide ? DEFAULTS.preset.wide.speed : DEFAULTS.preset.narrow.speed
    return Math.min(3, speed / Math.max(1, ref))
  }

  /**
   * 全局「呼吸」：让整片水的强度在几秒到十几秒的尺度上缓慢起伏。
   *
   * 用三个**不可通约**的周期叠加（约 30s / 47s / 72s），而不是单个正弦 ——
   * 单个正弦听得出机械节拍，三个叠起来在几分钟内都不会显出重复。
   * 幅度默认 ±5%，落在要求的 3%~7% 区间里。
   */
  function breathGlobal() {
    const v =
      Math.sin(time * 0.21) * 0.5 + Math.sin(time * 0.133 + 1.7) * 0.33 + Math.sin(time * 0.087 + 4.1) * 0.17
    return 1 + v * tuning.breathAmount
  }

  /** 双线性采样 + 限速 */
  function sampleField(x, y, out) {
    let gx = x / cell
    let gy = y / cell
    let i = gx | 0
    let j = gy | 0
    if (i < 0) i = 0
    else if (i > cols - 2) i = cols - 2
    if (j < 0) j = 0
    else if (j > rows - 2) j = rows - 2

    let fx = gx - i
    let fy = gy - j
    if (fx < 0) fx = 0
    else if (fx > 1) fx = 1
    if (fy < 0) fy = 0
    else if (fy > 1) fy = 1

    const i0 = j * cols + i
    const i1 = i0 + 1
    const i2 = i0 + cols
    const i3 = i2 + 1

    const w00 = (1 - fx) * (1 - fy)
    const w10 = fx * (1 - fy)
    const w01 = (1 - fx) * fy
    const w11 = fx * fy

    out.x =
      (baseX[i0] + pertX[i0]) * w00 +
      (baseX[i1] + pertX[i1]) * w10 +
      (baseX[i2] + pertX[i2]) * w01 +
      (baseX[i3] + pertX[i3]) * w11
    out.y =
      (baseY[i0] + pertY[i0]) * w00 +
      (baseY[i1] + pertY[i1]) * w10 +
      (baseY[i2] + pertY[i2]) * w01 +
      (baseY[i3] + pertY[i3]) * w11

    const m = out.x * out.x + out.y * out.y
    const cap = tuning.maxSpeed
    if (m > cap * cap) {
      const s = cap / Math.sqrt(m)
      out.x *= s
      out.y *= s
    }
  }

  /* ====================================================================== */
  /* 5. 扰动场：扩散（传播）+ 衰减（忘记）                                  */
  /* ====================================================================== */

  const pertCap = () => tuning.pertCap

  function stepPerturbation(dt) {
    const d = tuning.pertDiffuse
    tmpX.set(pertX)
    tmpY.set(pertY)

    for (let j = 1; j < rows - 1; j += 1) {
      const row = j * cols
      for (let i = 1; i < cols - 1; i += 1) {
        const idx = row + i
        tmpX[idx] =
          pertX[idx] +
          d * (pertX[idx - 1] + pertX[idx + 1] + pertX[idx - cols] + pertX[idx + cols] - 4 * pertX[idx])
        tmpY[idx] =
          pertY[idx] +
          d * (pertY[idx - 1] + pertY[idx + 1] + pertY[idx - cols] + pertY[idx + cols] - 4 * pertY[idx])
      }
    }

    let swap = pertX
    pertX = tmpX
    tmpX = swap
    swap = pertY
    pertY = tmpY
    tmpY = swap

    // 约 4 秒回到静息，而不是「啪」地停住
    const decay = Math.exp(-dt * tuning.pertDecay)
    const n = cols * rows
    for (let i = 0; i < n; i += 1) {
      pertX[i] *= decay
      pertY[i] *= decay
    }
  }

  /**
   * 往网格里写入一块速度（鼠标尾迹、涟漪都走这里）。
   *
   * `push` 是额外的「从光标向外推开」分量：只有 inject 知道每个格子相对光标的
   * 方位，所以径向分量必须在这里加，不能在外面算好一个统一向量传进来。
   * 法向推开 + 切向漩涡合起来才像「手插进水里」，纯推开只会像吹气。
   */
  function inject(x, y, vx, vy, radius, push) {
    const i0 = Math.max(0, Math.floor((x - radius) / cell))
    const i1 = Math.min(cols - 1, Math.ceil((x + radius) / cell))
    const j0 = Math.max(0, Math.floor((y - radius) / cell))
    const j1 = Math.min(rows - 1, Math.ceil((y + radius) / cell))
    const r2 = radius * radius
    const cap = tuning.pertCap
    const radial = push ?? 0

    for (let j = j0; j <= j1; j += 1) {
      const dy = (j + 0.5) * cell - y
      const row = j * cols
      for (let i = i0; i <= i1; i += 1) {
        const dx = (i + 0.5) * cell - x
        const d2 = dx * dx + dy * dy
        if (d2 > r2) continue
        const dist = Math.sqrt(d2)
        const f = 1 - dist / radius
        const w = f * f
        const idx = row + i

        let ax = vx
        let ay = vy
        if (radial !== 0 && dist > 0.5) {
          const inv = 1 / dist
          ax += dx * inv * radial
          ay += dy * inv * radial
        }

        let nvx = pertX[idx] + ax * w
        let nvy = pertY[idx] + ay * w
        if (nvx > cap) nvx = cap
        else if (nvx < -cap) nvx = -cap
        if (nvy > cap) nvy = cap
        else if (nvy < -cap) nvy = -cap

        pertX[idx] = nvx
        pertY[idx] = nvy
      }
    }
  }

  /* ====================================================================== */
  /* 6. 点击涟漪：环形推力 + 一圈极淡的圆                                   */
  /* ====================================================================== */

  const ripples = []

  function spawnRipple(x, y) {
    ripples.push({
      x,
      y,
      age: 0,
      life: tuning.rippleLife,
      speed: tuning.rippleSpeed,
      band: tuning.rippleBand,
      power: tuning.ripplePower,
    })
    if (ripples.length > 4) ripples.shift()
  }

  function stepRipples(dt) {
    for (let k = ripples.length - 1; k >= 0; k -= 1) {
      const r = ripples[k]
      r.age += dt
      const fade = 1 - r.age / r.life
      if (fade <= 0) {
        ripples.splice(k, 1)
        continue
      }

      const radius = r.speed * r.age
      const lo = radius - r.band
      const hi = radius + r.band
      const lo2 = lo > 0 ? lo * lo : 0
      const hi2 = hi * hi
      const outer = hi

      const i0 = Math.max(0, Math.floor((r.x - outer) / cell))
      const i1 = Math.min(cols - 1, Math.ceil((r.x + outer) / cell))
      const j0 = Math.max(0, Math.floor((r.y - outer) / cell))
      const j1 = Math.min(rows - 1, Math.ceil((r.y + outer) / cell))
      const power = r.power * fade * fade

      for (let j = j0; j <= j1; j += 1) {
        const dy = (j + 0.5) * cell - r.y
        const row = j * cols
        for (let i = i0; i <= i1; i += 1) {
          const dx = (i + 0.5) * cell - r.x
          const d2 = dx * dx + dy * dy
          if (d2 < lo2 || d2 > hi2) continue
          const dist = Math.sqrt(d2) || 1
          const f = 1 - Math.abs(dist - radius) / r.band
          const w = f * f * power
          const idx = row + i
          pertX[idx] += (dx / dist) * w
          pertY[idx] += (dy / dist) * w
        }
      }
    }
  }

  /* ====================================================================== */
  /* 7. 流线                                                               */
  /* ====================================================================== */

  const lines = []
  let activeLines = 0
  let quality = 1
  let qualityCooldown = 0
  let avgFrame = 16.7

  function makeLine(cx, cy, angle, index) {
    const M = pointCount
    // 每根线一个固定的速度系数（0.72~1.28）——
    // 全部同速会像一张贴图在整体平移；有了差异，同一片流场里
    // 有的线先走、有的线后走，才会互相错开、产生滞后响应。
    // 注意：常数缩放不改变流线几何（方向没变），所以不会破坏无散度。
    const spread = tuning.speedSpread
    return {
      xs: new Float32Array(M),
      ys: new Float32Array(M),
      cx,
      cy,
      angle,
      index,
      speedMul: 1 + (Math.random() * 2 - 1) * spread,
      phase: Math.random() * TAU,
      alpha: 0,
      baseAlpha: 0.5 + Math.random() * 0.5,
      target: 0,
      visible: true,
      pending: false,
    }
  }

  /** 沿场积分出一条稳态流线 —— 初始化用它，所以一上来就是弯的，不会先直后弯 */
  function traceLine(line) {
    const M = pointCount
    const c0 = (M - 1) >> 1
    const stepLen = spacing
    const xs = line.xs
    const ys = line.ys

    let x = line.cx
    let y = line.cy
    xs[c0] = x
    ys[c0] = y

    for (let k = c0 + 1; k < M; k += 1) {
      sampleField(x, y, vec)
      const len = Math.sqrt(vec.x * vec.x + vec.y * vec.y) || 1
      x += (vec.x / len) * stepLen
      y += (vec.y / len) * stepLen
      xs[k] = x
      ys[k] = y
    }

    x = line.cx
    y = line.cy
    for (let k = c0 - 1; k >= 0; k -= 1) {
      sampleField(x, y, vec)
      const len = Math.sqrt(vec.x * vec.x + vec.y * vec.y) || 1
      x -= (vec.x / len) * stepLen
      y -= (vec.y / len) * stepLen
      xs[k] = x
      ys[k] = y
    }
  }

  function reseed(line) {
    line.cx = W * (0.06 + Math.random() * 0.88)
    line.cy = H * (0.06 + Math.random() * 0.88)
    line.angle = Math.random() * TAU
    traceLine(line)
    line.alpha = 0
    line.baseAlpha = 0.5 + Math.random() * 0.5
  }

  function createLines() {
    lines.length = 0
    spreadDX = new Float32Array(lineCount)
    spreadDY = new Float32Array(lineCount)
    const spots = []
    const gx = Math.max(2, Math.ceil(W / 118))
    const gy = Math.max(2, Math.ceil(H / 118))
    for (let j = 0; j < gy; j += 1) {
      for (let i = 0; i < gx; i += 1) {
        spots.push([
          ((i + 0.12 + Math.random() * 0.76) * W) / gx,
          ((j + 0.12 + Math.random() * 0.76) * H) / gy,
        ])
      }
    }
    // 洗牌：分布均匀但不规则
    for (let i = spots.length - 1; i > 0; i -= 1) {
      const j = (Math.random() * (i + 1)) | 0
      const t = spots[i]
      spots[i] = spots[j]
      spots[j] = t
    }

    for (let n = 0; n < lineCount; n += 1) {
      const s = spots[n % spots.length]
      const line = makeLine(s[0], s[1], Math.random() * TAU, n)
      traceLine(line)
      lines.push(line)
    }
  }

  /**
   * 按**弦长**等距重采样。
   *
   * 为什么不是按弧长：折线的「弧长」就是各段长度之和。按弧长取点，
   * 取出来的相邻点之间是弦，而弦必然短于弧 —— 每重采样一次线就短一点，
   * 逐帧复利（实测 60 秒缩了约 7%）。更要命的是这让重采样**不幂等**：
   * 即使场完全静止，点也在每帧缓慢自我整理，速度调到 0 也冻不住。
   *
   * 按弦长取点则严格满足 |O[k+1] − O[k]| = step，重采样幂等：
   * 再次采样会算出完全一样的点。干净的静止就是真的静止，
   * 线的长度也不会随时间漂移。
   */
  /**
   * 沿折线全长均匀铺 M 个点（间距 = 总长/(M-1)）。
   *
   * 两个地方用：折线本身比目标短时的退化分支，以及弦长遍历出了重合点时的兜底。
   * 这个分支是幂等的 —— 对它的输出再跑一次会得到同一批点。
   */
  function fillUniform(xs, ys, M, total, last, cum, outX, outY) {
    const step = total / last
    let cursor = 0
    let seg = 0
    for (let k = 0; k < M; k += 1) {
      while (seg < last - 1 && cum[seg + 1] < cursor) seg += 1
      const segLen = cum[seg + 1] - cum[seg]
      const t = segLen > 1e-6 ? (cursor - cum[seg]) / segLen : 0
      outX[k] = xs[seg] + (xs[seg + 1] - xs[seg]) * t
      outY[k] = ys[seg] + (ys[seg + 1] - ys[seg]) * t
      cursor += step
    }
  }

  function resampleLine(xs, ys, M) {
    const cum = resampleCum
    let total = 0
    cum[0] = 0
    for (let k = 1; k < M; k += 1) {
      const dx = xs[k] - xs[k - 1]
      const dy = ys[k] - ys[k - 1]
      total += Math.sqrt(dx * dx + dy * dy)
      cum[k] = total
    }
    if (total < 1e-3) return total

    const last = M - 1
    const target = last * spacing
    const outX = resampleX
    const outY = resampleY

    // 折线太短、铺不下 M 个等弦长的点：退化成沿全长均匀铺开（间距等比缩小）。
    // 这个分支同样是幂等的 —— 下次重采样会得到同一批点。
    if (total < target * 0.995) {
      fillUniform(xs, ys, M, total, last, cum, outX, outY)
      xs.set(outX)
      ys.set(outY)
      return total
    }

    // 起点落在弧长中点，保证线的重心不因为重采样而漂移
    let cursor = (total - target) * 0.5
    let seg = 0
    while (seg < last - 1 && cum[seg + 1] < cursor) seg += 1
    const firstLen = cum[seg + 1] - cum[seg]
    let curT = firstLen > 1e-6 ? (cursor - cum[seg]) / firstLen : 0
    let px = xs[seg] + (xs[seg + 1] - xs[seg]) * curT
    let py = ys[seg] + (ys[seg + 1] - ys[seg]) * curT
    outX[0] = px
    outY[0] = py

    /*
     * 沿折线前进，每步找「与上一个输出点直线距离 = step」的位置。
     * 段内是个二次方程：|A + t·u − prev|² = step²。
     *
     * 关键约束：解必须**严格落在当前弧长位置之后**（t > curT）。
     *
     * 这一步踩过两次坑：
     *   · 取较大的根（出口）—— 在两个根都合法时会跳过一整段，
     *     在折线自我靠近的地方凭空造出拐角；
     *   · 取较小的根（入口）但不管先后 —— 入口可能落在当前位置**之前**，
     *     于是输出点向后跳，折线开始自我折返。实测 60 秒后线长从 1322px
     *     塌到 844px、相邻点距缩到 0.1px、挤团 4 根。
     *
     * 正确做法是：取「大于 curT 的最小根」。seg 只前进不回退，整趟 O(M)。
     */
    const stepSq = spacing * spacing
    for (let k = 1; k < M; k += 1) {
      let placed = false
      while (seg < last) {
        const ax = xs[seg]
        const ay = ys[seg]
        const ux = xs[seg + 1] - ax
        const uy = ys[seg + 1] - ay
        const a = ux * ux + uy * uy
        if (a < 1e-12) {
          seg += 1
          curT = 0
          continue
        }
        const wx = ax - px
        const wy = ay - py
        const b = 2 * (wx * ux + wy * uy)
        const c = wx * wx + wy * wy - stepSq
        const disc = b * b - 4 * a * c
        if (disc >= 0) {
          const sq = Math.sqrt(disc)
          const t1 = (-b - sq) / (2 * a)
          const t2 = (-b + sq) / (2 * a)
          const floor = curT + 1e-6
          let t = NaN
          if (t1 >= floor && t1 <= 1) t = t1
          else if (t2 >= floor && t2 <= 1) t = t2
          if (!Number.isNaN(t)) {
            px = ax + ux * t
            py = ay + uy * t
            curT = t
            placed = true
            break
          }
        }
        seg += 1
        curT = 0
      }
      if (!placed) {
        // 走到头了（长度检查已经排除，这里是兜底）：沿末段方向补一个点
        const dx = xs[last] - xs[last - 1]
        const dy = ys[last] - ys[last - 1]
        const len = Math.sqrt(dx * dx + dy * dy) || 1
        px += (dx / len) * spacing
        py += (dy / len) * spacing
      }
      outX[k] = px
      outY[k] = py
    }

    xs.set(outX)
    ys.set(outY)

    /*
     * 防御：万一弦长遍历在折线末端漏掉一段，会留下两个几乎重合的点。
     * 重合点的「切线方向」是 atan2(0,0) —— 纯数值噪声，
     * 在对齐度体检里表现为 180° 的假脱轨（实测抓到过好几个）。
     * 更实际的影响是这个假方向会喂给曲率限制器，让它去压一个不存在的拐角。
     *
     * 检测到就退回「沿全长均匀铺点」—— 那个分支同样是幂等的。
     */
    const minSegSq = spacing * spacing * 0.36
    let degenerate = false
    for (let k = 1; k < M; k += 1) {
      const dx = outX[k] - outX[k - 1]
      const dy = outY[k] - outY[k - 1]
      if (dx * dx + dy * dy < minSegSq) {
        degenerate = true
        break
      }
    }
    if (degenerate) fillUniform(xs, ys, M, total, last, cum, outX, outY)

    xs.set(outX)
    ys.set(outY)
    return total
  }

  /**
   * 线中点之间的软排斥。
   *
   * 速度场本身已经严格无散度（面积守恒），理论上点密度不会系统性变化。
   * 但还有两个非理想的来源：
   *   · 场随时间缓慢演化，流线本身会漂移、靠近；
   *   · resampleLine 每帧把线剪成固定长度的窗口 —— 这个「滑动窗口」不是物质操作，
   *     所以前面那套守恒论证并不完全适用。
   * 实测几十秒后仍会有十几根线挤进同一个 120px 格子，画面上就是几条深色带。
   *
   * 与其继续推导，不如加一道直接的保险：中点靠太近就互相推开一点。
   * 平均每根线占 1.5 万 px²，天然间距约 124px，所以 R 取 105 只会碰到最近的邻居，
   * 最终稳定在蓝噪声式的均匀分布上，不会排成网格。
   */
  function spreadMidpoints(dt) {
    const n = lines.length
    const mid = (pointCount - 1) >> 1
    const R = 105
    const R2 = R * R
    // 排斥是在「修正平流带来的聚集」，所以跟流速成比例：
    // 速度调到 0 时整个场应当彻底冻结，而不是还在慢慢自我整理。
    const rate = tuning.spreadRate * dt * flowFactor()
    if (rate <= 0) return

    for (let i = 0; i < n; i += 1) {
      spreadDX[i] = 0
      spreadDY[i] = 0
    }

    for (let a = 0; a < n; a += 1) {
      const la = lines[a]
      if (la.alpha < 0.05) continue
      const ax = la.xs[mid]
      const ay = la.ys[mid]

      for (let b = a + 1; b < n; b += 1) {
        const lb = lines[b]
        if (lb.alpha < 0.05) continue
        const dx = lb.xs[mid] - ax
        const dy = lb.ys[mid] - ay
        const d2 = dx * dx + dy * dy
        if (d2 > R2 || d2 < 1e-6) continue
        const d = Math.sqrt(d2)
        const f = ((1 - d / R) * rate) / d
        const px = dx * f
        const py = dy * f
        spreadDX[a] -= px
        spreadDY[a] -= py
        spreadDX[b] += px
        spreadDY[b] += py
      }
    }

    // 累积完再整根平移一次，避免逐对操作 O(n²·M)
    for (let i = 0; i < n; i += 1) {
      const dx = spreadDX[i]
      const dy = spreadDY[i]
      if (dx === 0 && dy === 0) continue
      const xs = lines[i].xs
      const ys = lines[i].ys
      for (let k = 0; k < pointCount; k += 1) {
        xs[k] += dx
        ys[k] += dy
      }
    }
  }

  /**
   * 最大曲率限制：把每段的折角压到 maxTurnRad 以内。
   *
   * 按**超出比例**加压 —— 没超限的点只用基础系数（保留自然弯曲），
   * 超限的点按超出比例放大平滑权重。这样急转弯被单独压平，宽缓的弧原样保留。
   * 单纯的固定系数松弛做不到这一点：要压住 13px 半径的尖角，
   * 系数得大到把整条线一起拉直。
   *
   * 常规路径只用点积比较（cosT < cosMax），不需要 acos；
   * 只有确实超限的少数点才去算角度。
   *
   * cap 是单帧位移上限。调大会过冲：把某点拉向邻点中点会改变相邻段的折角，
   * 下一帧又超限，来回震荡反而造出更糟的拐角（实测 cap 0.5 时
   * 最大折角从 11° 恶化到 32°）。
   */
  function limitCurvature(xs, ys, M, base, maxTurnRad, boost, cap) {
    if (base <= 0) return
    const cosMax = Math.cos(maxTurnRad)
    const last = M - 1
    for (let k = 1; k < last; k += 1) {
      const ax = xs[k] - xs[k - 1]
      const ay = ys[k] - ys[k - 1]
      const bx = xs[k + 1] - xs[k]
      const by = ys[k + 1] - ys[k]
      const la = Math.sqrt(ax * ax + ay * ay) || 1e-6
      const lb = Math.sqrt(bx * bx + by * by) || 1e-6
      let cosT = (ax * bx + ay * by) / (la * lb)
      if (cosT > 1) cosT = 1
      else if (cosT < -1) cosT = -1

      let w = base
      if (cosT < cosMax) {
        const over = (Math.acos(cosT) - maxTurnRad) / maxTurnRad
        w = base * (1 + over * boost)
        if (w > cap) w = cap
      }

      xs[k] += ((xs[k - 1] + xs[k + 1]) * 0.5 - xs[k]) * w
      ys[k] += ((ys[k - 1] + ys[k + 1]) * 0.5 - ys[k]) * w
    }
  }

  function advect(dt) {
    const active = Math.round(lineCount * params.density * quality)
    activeLines = 0
    // 松弛是「修正平流副作用」的力，跟着流速缩放：速度为 0 时曲线应当完全冻住
    const tension = tuning.tension * flowFactor()
    const rate = 1 - Math.exp(-dt * 0.85)
    const M = pointCount
    const last = M - 1
    const minLength = (M - 1) * spacing * 0.4
    const breath = breathGlobal()

    for (let n = 0; n < lines.length; n += 1) {
      const line = lines[n]
      line.visible = n < active

      if (line.pending) {
        line.target = 0
        if (line.alpha < 0.015) {
          reseed(line)
          line.pending = false
          line.target = line.baseAlpha
        }
      } else {
        line.target = line.visible ? line.baseAlpha : 0
      }

      line.alpha += (line.target - line.alpha) * rate
      if (line.alpha < 0.012) continue
      activeLines += 1

      const xs = line.xs
      const ys = line.ys
      let sx = 0
      let sy = 0

      /*
       * 每根线自己的有效速度：
       *   固定系数 lineMul（0.72~1.28，制造错开与滞后）
       * × 全局呼吸（整片水一起缓急，几秒到十几秒一轮）
       * × 每线相位呼吸（幅度小得多，避免所有线同时胀缩）
       */
      const lineMul =
        line.speedMul *
        breath *
        (1 + Math.sin(time * 0.17 + line.phase) * tuning.breathPerLine)

      for (let k = 0; k < M; k += 1) {
        sampleField(xs[k], ys[k], vec)
        const nx = xs[k] + vec.x * dt * lineMul
        const ny = ys[k] + vec.y * dt * lineMul
        xs[k] = nx
        ys[k] = ny
        sx += nx
        sy += ny
      }

      /*
       * 曲率松弛 + 最大曲率限制（第一遍，在重采样**之前**）。
       * 先把形状里的急转弯压平，再让重采样均匀铺点。
       */
      const maxTurnRad = (tuning.maxTurnDeg * Math.PI) / 180
      limitCurvature(xs, ys, M, tension, maxTurnRad, tuning.turnBoost, 0.25)

      // 弧长重采样：把点重新铺匀。
      // 不做这一步的话，速度场在空间上不均匀会让点沿流线堆积，
      // 间距从 11.5px 压到 2px 以内，同一根线在几个像素里反复描边，
      // 叠加成深色硬块（用户反馈的「过了几秒部分特别粗」）。
      const length = resampleLine(xs, ys, M)
      if (length < minLength) line.pending = true

      /*
       * 曲率限制第二遍，在重采样**之后**。
       *
       * 这是必需的，不是保险：实测抓到过一个 51° 的拐角，
       * 而同一处的场方向在 9 个采样点上只从 12° 变到 18°（几乎均匀）——
       * 场是直的，拐角纯由重采样造出来。限制器只放在重采样之前的话，
       * 这类拐角每帧被造一次、要等下一帧才被压，永远慢一拍。
       *
       * 代价是会让间距产生零点几像素的扰动，下一帧的重采样会抹平。
       */
      limitCurvature(xs, ys, M, tension, maxTurnRad, tuning.turnBoost, 0.25)

      // 整根飘远了就慢慢淡出、换个地方重生（不硬跳）
      const mx = sx / M
      const my = sy / M
      if (mx < -W * 0.42 || mx > W * 1.42 || my < -H * 0.42 || my > H * 1.42) line.pending = true
    }

    spreadMidpoints(dt)
  }

  /* ====================================================================== */
  /* 8. 渲染                                                               */
  /* ====================================================================== */

  function draw() {
    ctx.clearRect(0, 0, W, H)
    ctx.lineWidth = lw
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'

    for (let n = 0; n < lines.length; n += 1) {
      const line = lines[n]
      if (line.alpha < 0.012) continue

      const a = line.alpha * tuning.ink
      ctx.globalAlpha = a > 1 ? 1 : a
      const xs = line.xs
      const ys = line.ys

      // 分段上色：让色温沿着线随区域变化，而不是一根线一个死色
      for (let c = 0; c < chunks; c += 1) {
        const a = chunkStart[c]
        const b = chunkEnd[c]
        if (b <= a) continue
        const mid = (a + b) >> 1
        const tint = tintAt(xs[mid], ys[mid])
        ctx.strokeStyle = palette[(tint * (PALETTE_N - 1)) | 0]
        ctx.beginPath()
        ctx.moveTo(xs[a], ys[a])
        for (let k = a + 1; k <= b; k += 1) ctx.lineTo(xs[k], ys[k])
        ctx.stroke()
      }
    }

    ctx.globalAlpha = 1

    // 点击涟漪：两圈几乎看不见的圆。数值偏保守，但比第一版明显得多 ——
    // 太淡的话点击会像没反应，用户会以为坏了。
    for (let k = 0; k < ripples.length; k += 1) {
      const r = ripples[k]
      const fade = 1 - r.age / r.life
      const radius = r.speed * r.age
      ctx.beginPath()
      ctx.arc(r.x, r.y, radius, 0, TAU)
      ctx.strokeStyle = `rgba(18,24,31,${(fade * fade * tuning.rippleInk).toFixed(3)})`
      ctx.lineWidth = 1
      ctx.stroke()

      // 内圈跟着走，读起来才有「扩散」而不是「一个圈在变大」
      if (radius > 26) {
        ctx.beginPath()
        ctx.arc(r.x, r.y, radius - 22, 0, TAU)
        ctx.strokeStyle = `rgba(18,24,31,${(fade * fade * fade * tuning.rippleInkInner).toFixed(3)})`
        ctx.lineWidth = 0.75
        ctx.stroke()
      }
    }

    ctx.lineWidth = lw
  }

  /* ====================================================================== */
  /* 9. 文字反应堆                                                          */
  /* ====================================================================== */

  const pointer = { x: -9999, y: -9999, active: false, lastX: -9999, lastY: -9999 }
  const textRadius = () => tuning.textRadius
  const reactors = []
  const chars = []

  function collectText() {
    reactors.length = 0
    chars.length = 0

    document.querySelectorAll('[data-react]').forEach((el) => {
      if (el.classList.contains('title')) return
      reactors.push({
        el,
        docX: 0,
        docY: 0,
        push:
          el.classList.contains('lede') ||
          el.classList.contains('note') ||
          el.classList.contains('outro')
            ? tuning.labelPush
            : tuning.labelPushLarge,
        inf: 0,
        ox: 0,
        oy: 0,
        sx: 1,
      })
    })

    const title = document.getElementById('title')
    if (title) {
      title.querySelectorAll('.ch').forEach((el, i) => {
        chars.push({
          el,
          docX: 0,
          docY: 0,
          phase: i * 0.55,
          inf: 0,
          ox: 0,
          oy: 0,
          sx: 1,
          sy: 1,
        })
      })
    }
  }

  /**
   * 量基准位置。必须先清掉 transform —— getBoundingClientRect 会把变换算进去，
   * 不清就会量到「被推开之后」的位置，形成正反馈把字越推越远。
   */
  function measureText() {
    const all = []
    for (let i = 0; i < reactors.length; i += 1) all.push(reactors[i].el)
    for (let i = 0; i < chars.length; i += 1) all.push(chars[i].el)

    const saved = all.map((el) => el.style.transform)
    for (let i = 0; i < all.length; i += 1) all[i].style.transform = 'none'
    void document.body.offsetHeight

    const sx = window.scrollX
    const sy = window.scrollY

    for (let i = 0; i < reactors.length; i += 1) {
      const r = reactors[i].el.getBoundingClientRect()
      reactors[i].docX = r.left + sx + r.width / 2
      reactors[i].docY = r.top + sy + r.height / 2
    }
    for (let i = 0; i < chars.length; i += 1) {
      const r = chars[i].el.getBoundingClientRect()
      chars[i].docX = r.left + sx + r.width / 2
      chars[i].docY = r.top + sy + r.height / 2
    }

    for (let i = 0; i < all.length; i += 1) all[i].style.transform = saved[i]
  }

  /**
   * 快进慢出。
   * 只用 inf 和 prev 比大小不够 —— 鼠标停住时 inf == prev，会被判成「离开」，
   * 于是用慢速率去追，效果永远到不了位。改成看「当前有没有影响」：
   * 有影响就跟得紧，影响消失才放慢回弹。
   */
  function blendRate(inf, dt, attack, release) {
    return 1 - Math.exp(-dt * (inf > 0.002 ? attack : release))
  }

  function stepText(dt) {
    const sx = window.scrollX
    const sy = window.scrollY
    const wobble = time * 1.5
    const tr = textRadius()

    for (let i = 0; i < chars.length; i += 1) {
      const ch = chars[i]
      const vx = ch.docX - sx
      const vy = ch.docY - sy
      let inf = 0
      let tx = 0
      let ty = 0
      let tsx = 1
      let tsy = 1

      if (pointer.active) {
        const dx = vx - pointer.x
        const dy = vy - pointer.y
        const d = Math.sqrt(dx * dx + dy * dy)
        if (d < tr) {
          inf = 1 - d / tr
          inf *= inf
          const nx = d > 0.001 ? dx / d : 0
          const ny = d > 0.001 ? dy / d : 0
          tx = nx * inf * tuning.textPush
          ty = ny * inf * tuning.textPushY + Math.sin(wobble + ch.phase) * inf * 3.4
          tsx = 1 + inf * tuning.textStretch
          tsy = 1 - inf * tuning.textStretch * 0.34
        }
      }

      const k = blendRate(inf, dt, 7, 1.5)
      ch.inf = inf
      ch.ox += (tx - ch.ox) * k
      ch.oy += (ty - ch.oy) * k
      ch.sx += (tsx - ch.sx) * k
      ch.sy += (tsy - ch.sy) * k

      if (ch.ox * ch.ox + ch.oy * ch.oy < 0.0004 && ch.sx > 0.9995 && ch.sy < 1.0005 && ch.sy > 0.9995) {
        if (ch.el.style.transform !== '') ch.el.style.transform = ''
        continue
      }
      ch.el.style.transform =
        `translate3d(${ch.ox.toFixed(2)}px,${ch.oy.toFixed(2)}px,0) scale(${ch.sx.toFixed(3)},${ch.sy.toFixed(3)})`
    }

    for (let i = 0; i < reactors.length; i += 1) {
      const it = reactors[i]
      const vx = it.docX - sx
      const vy = it.docY - sy
      let inf = 0
      let tx = 0
      let ty = 0
      let tsx = 1

      if (pointer.active) {
        const dx = vx - pointer.x
        const dy = vy - pointer.y
        const d = Math.sqrt(dx * dx + dy * dy)
        if (d < tr) {
          inf = 1 - d / tr
          inf *= inf
          const nx = d > 0.001 ? dx / d : 0
          const ny = d > 0.001 ? dy / d : 0
          tx = nx * inf * it.push
          ty = ny * inf * it.push * 0.7
          tsx = 1 + inf * 0.085
        }
      }

      const k = blendRate(inf, dt, 7, 1.4)
      it.inf = inf
      it.ox += (tx - it.ox) * k
      it.oy += (ty - it.oy) * k
      it.sx += (tsx - it.sx) * k

      if (Math.abs(it.ox) < 0.02 && Math.abs(it.oy) < 0.02 && Math.abs(it.sx - 1) < 0.0008) {
        if (it.el.style.transform !== '') it.el.style.transform = ''
        continue
      }
      it.el.style.transform =
        `translate3d(${it.ox.toFixed(2)}px,${it.oy.toFixed(2)}px,0) scale(${it.sx.toFixed(4)},1)`
    }
  }

  /* ====================================================================== */
  /* 10. 指针 / 滚动 / 菜单                                                 */
  /* ====================================================================== */

  let lastInject = 0

  /**
   * 鼠标 = 手划过水面。
   *
   * 每个 pointermove 都往网格里写一块速度，于是鼠标「经过」的路径自然留下一串
   * 逐渐衰减的注入点 —— 这就是尾迹。写进去的速度由三部分构成：
   *
   *   沿运动方向「拖水」 (mouseDrag)  —— 尾迹会跟着手走，而不是散在原地
   *   垂直方向的漩涡   (mouseSwirl) —— 让线条弯曲、错开、轻微旋转
   *   从光标向外推开   (mousePush)  —— 让线条从手的两侧让开
   *
   * 之后完全交给场自己：拉普拉斯扩散让它向外传播，指数衰减让它 1~2 秒后
   * 缓慢消失。手停下来之后没有任何持续的力，所以恢复是自然的。
   */
  function onPointerMove(event) {
    const x = event.clientX
    const y = event.clientY

    if (!pointer.active) {
      pointer.lastX = x
      pointer.lastY = y
      pointer.active = true
    }

    const dx = x - pointer.lastX
    const dy = y - pointer.lastY
    const speed = Math.sqrt(dx * dx + dy * dy)

    pointer.x = x
    pointer.y = y
    pointer.lastX = x
    pointer.lastY = y

    if (reduceMotion || speed < 0.35) return

    const now = performance.now()
    if (now - lastInject < 14) return
    lastInject = now

    const s = Math.min(speed, 34)
    const nx = dx / (speed || 1)
    const ny = dy / (speed || 1)
    // 运动方向的垂线，用来做漩涡
    const px = -ny
    const py = nx

    const vx = nx * tuning.mouseDrag + px * tuning.mouseSwirl
    const vy = ny * tuning.mouseDrag + py * tuning.mouseSwirl
    const mag = tuning.mouseMagBase + s * tuning.mouseMagSpeed

    inject(x, y, vx * mag, vy * mag, tuning.mouseRadius, tuning.mousePush * mag)
  }

  function onPointerLeave() {
    pointer.active = false
    pointer.x = -9999
    pointer.y = -9999
  }

  function onPointerDown(event) {
    spawnRipple(event.clientX, event.clientY)
  }

  /* --- 滚动 ------------------------------------------------------------- */

  let scrollProgress = 0
  let targetProgress = 0

  function readScroll() {
    const max = document.documentElement.scrollHeight - window.innerHeight
    targetProgress = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0
  }

  function smoothstep(t) {
    if (t <= 0) return 0
    if (t >= 1) return 1
    return t * t * (3 - 2 * t)
  }

  function stepParams() {
    const p = scrollProgress * (CHAPTERS.length - 1)
    const i0 = Math.min(CHAPTERS.length - 1, Math.floor(p))
    const i1 = Math.min(CHAPTERS.length - 1, i0 + 1)
    const f = smoothstep(p - i0)
    const a = CHAPTERS[i0]
    const b = CHAPTERS[i1]

    params.rot = a.rot + (b.rot - a.rot) * f
    params.freq = a.freq + (b.freq - a.freq) * f
    params.speed = a.speed + (b.speed - a.speed) * f
    params.density = a.density + (b.density - a.density) * f
    params.tint = a.tint + (b.tint - a.tint) * f
    params.biasAngle = a.biasAngle + (b.biasAngle - a.biasAngle) * f
    params.bias = a.bias + (b.bias - a.bias) * f

    rotCos = Math.cos(params.rot)
    rotSin = Math.sin(params.rot)
  }

  const readout = document.getElementById('chapterReadout')
  let lastReadout = ''

  function updateReadout() {
    const c = String(Math.round(scrollProgress * (CHAPTERS.length - 1)) + 1).padStart(2, '0')
    if (c !== lastReadout && readout) {
      lastReadout = c
      readout.textContent = c
    }
  }

  /* --- 障碍 ------------------------------------------------------------- */

  function refreshObstacles() {
    obstacles.length = 0
    const list = document.querySelectorAll('[data-obstacle]')
    const margin = Math.min(W, H) * tuning.obstacleMargin

    for (let i = 0; i < list.length; i += 1) {
      const r = list[i].getBoundingClientRect()
      if (r.width < 4 || r.bottom < -100 || r.top > H + 100) continue
      obstacles.push({
        x0: r.left,
        y0: r.top,
        x1: r.right,
        y1: r.bottom,
        cx: r.left + r.width / 2,
        cy: r.top + r.height / 2,
        margin,
        strength: tuning.obstacleStrength,
      })
    }
  }

  /* --- 菜单 ------------------------------------------------------------- */

  const menu = document.getElementById('menu')
  const menuToggle = document.getElementById('menuToggle')

  function setMenu(open) {
    if (!menu || !menuToggle) return
    const label = menuToggle.querySelector('.menu-toggle__label')
    if (open) {
      menu.hidden = false
      document.body.classList.add('is-menu-open')
      menuToggle.setAttribute('aria-expanded', 'true')
      if (label) label.textContent = 'CLOSE'
      requestAnimationFrame(() => menu.classList.add('is-visible'))
    } else {
      menu.classList.remove('is-visible')
      document.body.classList.remove('is-menu-open')
      menuToggle.setAttribute('aria-expanded', 'false')
      if (label) label.textContent = 'MENU'
      window.setTimeout(() => {
        if (!menu.classList.contains('is-visible')) menu.hidden = true
      }, 900)
    }
  }

  function initMenu() {
    if (!menu || !menuToggle) return
    menu.querySelectorAll('.menu__item').forEach((el, i) => el.style.setProperty('--i', String(i)))
    menuToggle.addEventListener('click', () => setMenu(menu.hidden))
    menu.querySelectorAll('.menu__item').forEach((el) =>
      el.addEventListener('click', () => setMenu(false)),
    )
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !menu.hidden) setMenu(false)
    })
  }

  /* ====================================================================== */
  /* 11. 尺寸 / 初始化                                                      */
  /* ====================================================================== */

  function sizeCanvas() {
    dpr = Math.min(window.devicePixelRatio || 1, 2)
    const r = canvas.getBoundingClientRect()
    W = Math.max(1, Math.round(r.width))
    H = Math.max(1, Math.round(r.height))
    canvas.width = Math.round(W * dpr)
    canvas.height = Math.round(H * dpr)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    lw = (dpr >= 2 ? 0.75 : 0.95) * tuning.lineWidthScale
  }

  function allocateGrid() {
    cols = Math.max(4, Math.ceil(W / cell) + 1)
    rows = Math.max(4, Math.ceil(H / cell) + 1)
    const n = cols * rows
    baseX = new Float32Array(n)
    baseY = new Float32Array(n)
    pertX = new Float32Array(n)
    pertY = new Float32Array(n)
    tmpX = new Float32Array(n)
    tmpY = new Float32Array(n)
    baseCursor = 0
  }

  function buildChunks() {
    chunkStart = new Int32Array(chunks)
    chunkEnd = new Int32Array(chunks)
    for (let c = 0; c < chunks; c += 1) {
      chunkStart[c] = Math.floor((c * (pointCount - 1)) / chunks)
      chunkEnd[c] = c === chunks - 1 ? pointCount - 1 : Math.floor(((c + 1) * (pointCount - 1)) / chunks)
    }
    resampleX = new Float32Array(pointCount)
    resampleY = new Float32Array(pointCount)
    resampleCum = new Float32Array(pointCount)
  }

  function applyPreset() {
    preset = window.innerWidth < 900 ? PRESET.narrow : PRESET.wide
    cell = preset.cell
    lineCount = preset.lines
    pointCount = preset.points
    spacing = preset.spacing
    chunks = preset.chunks
    buildChunks()
  }

  function setup() {
    applyPreset()
    sizeCanvas()
    allocateGrid()
    refreshObstacles()
    calibrateSpeed()
    recomputeRows(0, rows)
    createLines()
    collectText()
    measureText()
    for (let i = 0; i < lines.length; i += 1) lines[i].alpha = 0
    ripples.length = 0
    lastReadout = ''
    readScroll()
    buildSpeedProbe()
    if (reduceMotion) renderStatic()
  }

  /* ====================================================================== */
  /* 12. 主循环                                                             */
  /* ====================================================================== */

  let rafId = 0
  let last = 0
  let frameCount = 0
  let frameAccum = 0
  let frameSamples = 0
  let running = false
  let lastFrameAt = 0

  /* 实测流速：在画面上撒一组固定探针，逐帧量它们的场速度并取滑动均值。
     这是「画面到底有没有在动」的直接证据，比看配置里的数字可靠得多。 */
  let speedProbe = new Float32Array(0)
  let speedProbeCount = 0
  let measuredSpeed = 0
  let driftX = 0
  let driftY = 0

  function buildSpeedProbe() {
    const nx = 8
    const ny = 6
    speedProbe = new Float32Array(nx * ny * 2)
    speedProbeCount = nx * ny
    let p = 0
    for (let j = 0; j < ny; j += 1) {
      for (let i = 0; i < nx; i += 1) {
        speedProbe[p] = ((i + 0.5) * W) / nx
        speedProbe[p + 1] = ((j + 0.5) * H) / ny
        p += 2
      }
    }
  }

  function stepSpeedProbe() {
    let sum = 0
    let dx = 0
    let dy = 0
    for (let i = 0; i < speedProbe.length; i += 2) {
      sampleField(speedProbe[i], speedProbe[i + 1], vec)
      sum += Math.sqrt(vec.x * vec.x + vec.y * vec.y)
      dx += vec.x
      dy += vec.y
    }
    const n = Math.max(1, speedProbeCount)
    measuredSpeed += (sum / n - measuredSpeed) * 0.05

    /*
     * 整体漂移 = 场速度的**空间矢量均值**。
     * 旋度分量在大范围上互相抵消，只有常量漂移 D 会留下净矢量 ——
     * 所以这个量就是「线条整体从一侧漂向另一侧」的精确度量。
     * 比拿图像互相关去猜可靠得多：线条图案是准周期的，相关会锁到错误周期上。
     */
    driftX += (dx / n - driftX) * 0.05
    driftY += (dy / n - driftY) * 0.05
  }

  // speedTrim 的求解放在 recomputeRows 里（那边才有 trim=1 的速度均值），
  // 这里只负责独立地量一次实际流速与整体漂移，用来验证校准结果。

  /** 给面板和验证脚本看的「动画到底在不在跑」 */
  function animationState() {
    if (reduceMotion) return 'static:reduced-motion'
    if (motionOverride && prefersReduced()) return 'running:forced'
    if (document.hidden) return 'idle:hidden'
    if (!running) return 'paused'
    if (performance.now() - lastFrameAt > 1500) return 'stalled'
    return 'running'
  }

  function adaptQuality() {
    if (qualityCooldown > 0) {
      qualityCooldown -= 1
      return
    }
    if (avgFrame > 23 && quality > 0.56) {
      quality = quality === 1 ? 0.76 : 0.56
      qualityCooldown = 6
    } else if (avgFrame < 13.5 && quality < 1) {
      quality = quality === 0.56 ? 0.76 : 1
      qualityCooldown = 6
    }
  }

  function frame(now) {
    rafId = requestAnimationFrame(frame)
    lastFrameAt = now
    if (!last) {
      last = now
      return
    }
    let dt = (now - last) / 1000
    last = now
    if (dt > 0.05) dt = 0.05
    if (dt <= 0) return

    time += dt
    frameCount += 1

    frameAccum += dt
    frameSamples += 1
    if (frameSamples >= 45) {
      avgFrame = (frameAccum / frameSamples) * 1000
      frameAccum = 0
      frameSamples = 0
      adaptQuality()
    }

    scrollProgress += (targetProgress - scrollProgress) * (1 - Math.exp(-dt * 3.2))

    stepParams()
    stepBase()
    stepPerturbation(dt)
    stepRipples(dt)
    if (frameCount % 8 === 0) refreshObstacles()

    advect(dt)
    stepSpeedProbe()
    draw()
    stepText(dt)
    updateReadout()
  }

  function start() {
    if (running || reduceMotion) return
    running = true
    last = 0
    lastFrameAt = performance.now()
    rafId = requestAnimationFrame(frame)
  }

  function stop() {
    running = false
    if (rafId) cancelAnimationFrame(rafId)
    rafId = 0
  }

  /*
   * 看门狗。
   *
   * 动画「莫名其妙不动了」是最难查的一类问题：可能是 rAF 被某个分支漏掉、
   * 可能是标签页切回来的事件没派发、也可能是别的脚本报错把循环打断了。
   * 与其逐个推理，不如每 1.5 秒直接检查一次：
   *   · 该动却没在跑  -> 重新 start()
   *   · 在跑但 2 秒没出帧 -> 停掉重启
   * 只有在 reduceMotion 或标签页隐藏时才允许什么都不做。
   */
  window.setInterval(() => {
    if (reduceMotion || document.hidden) return
    if (!running) {
      start()
      return
    }
    if (performance.now() - lastFrameAt > 2000) {
      stop()
      start()
    }
  }, 1500)

  /** reduced motion：只出一帧静态的场（流线仍沿场弯曲，不是一堆直线） */
  function renderStatic() {
    recomputeRows(0, rows)
    for (let i = 0; i < lines.length; i += 1) {
      lines[i].alpha = lines[i].baseAlpha
      traceLine(lines[i])
    }
    activeLines = lines.length
    ripples.length = 0
    // 静帧也要给出真实的流速读数，否则调参台里实测流速/整体漂移全是 0，
    // 看起来像「坏了」而不是「按无障碍规范停了」。
    for (let i = 0; i < 60; i += 1) stepSpeedProbe()
    draw()
    for (let i = 0; i < chars.length; i += 1) chars[i].el.style.transform = ''
    for (let i = 0; i < reactors.length; i += 1) reactors[i].el.style.transform = ''
  }

  /* ====================================================================== */
  /* 13. 颗粒                                                               */
  /* ====================================================================== */

  function paintGrain() {
    const node = document.getElementById('grain')
    if (!node) return
    const size = 128
    const c = document.createElement('canvas')
    c.width = size
    c.height = size
    const g = c.getContext('2d')
    const img = g.createImageData(size, size)
    const d = img.data
    for (let i = 0; i < d.length; i += 4) {
      const v = 214 + ((Math.random() * 41) | 0)
      d[i] = v
      d[i + 1] = v
      d[i + 2] = v
      d[i + 3] = 255
    }
    g.putImageData(img, 0, 0)
    node.style.backgroundImage = `url(${c.toDataURL('image/png')})`
  }

  /* ====================================================================== */
  /* 14. 事件绑定与启动                                                     */
  /* ====================================================================== */

  let resizeTimer = 0

  function onResize() {
    window.clearTimeout(resizeTimer)
    resizeTimer = window.setTimeout(setup, 170)
  }

  function onVisibility() {
    if (document.hidden) stop()
    else start()
  }

  paintGrain()
  initMenu()
  setup()
  readScroll()
  scrollProgress = targetProgress
  start()

  if (!reduceMotion) {
    window.addEventListener('pointermove', onPointerMove, { passive: true })
    window.addEventListener('pointerdown', onPointerDown, { passive: true })
    document.addEventListener('mouseleave', onPointerLeave)
    window.addEventListener('blur', onPointerLeave)
  }
  window.addEventListener('scroll', readScroll, { passive: true })
  window.addEventListener('resize', onResize)
  document.addEventListener('visibilitychange', onVisibility)

  // 系统偏好变化时才切换静态/动态；motionQuery 不存在时跳过（那就一直是动态）
  motionQuery?.addEventListener?.('change', () => {
    reduceMotion = shouldReduce()
    if (reduceMotion) {
      stop()
      renderStatic()
    } else {
      start()
    }
  })

  /* ====================================================================== */
  /* 15. 调试接口（给验证脚本用）                                            */
  /* ====================================================================== */

  const probe = { x: 0, y: 0 }

  function perturbationEnergy() {
    let sum = 0
    for (let i = 0; i < pertX.length; i += 1) sum += Math.abs(pertX[i]) + Math.abs(pertY[i])
    return sum / (pertX.length * 2)
  }

  window.__flow = {
    /** 调试用：直接拿到所有流线的点数组（只读，别改） */
    get lines() {
      return lines
    },
    /** 采样某个点的场速度，用来证明「鼠标确实改变了场」 */
    sample(x, y) {
      sampleField(x, y, probe)
      return { x: Number(probe.x.toFixed(3)), y: Number(probe.y.toFixed(3)) }
    },
    /** 只看扰动场（不含基场），用来验证传播与衰减 */
    pertAt(x, y) {
      const i = Math.max(0, Math.min(cols - 1, (x / cell) | 0))
      const j = Math.max(0, Math.min(rows - 1, (y / cell) | 0))
      const idx = j * cols + i
      return {
        x: Number(pertX[idx].toFixed(3)),
        y: Number(pertY[idx].toFixed(3)),
        mag: Number(Math.sqrt(pertX[idx] * pertX[idx] + pertY[idx] * pertY[idx]).toFixed(3)),
      }
    },
    /**
     * 最坏折角的现场：把那个顶点和它左右的点坐标、相邻段长都吐出来。
     * 排查「拐折到底长什么样」用 —— 是发卡弯、锯齿，还是两个点几乎重合。
     */
    worstTurn() {
      let best = null
      for (let n = 0; n < lines.length; n += 1) {
        const line = lines[n]
        if (line.alpha < 0.05) continue
        const xs = line.xs
        const ys = line.ys
        for (let k = 1; k < pointCount - 1; k += 1) {
          const ax = xs[k] - xs[k - 1]
          const ay = ys[k] - ys[k - 1]
          const bx = xs[k + 1] - xs[k]
          const by = ys[k + 1] - ys[k]
          const la = Math.sqrt(ax * ax + ay * ay)
          const lb = Math.sqrt(bx * bx + by * by)
          if (la < 1e-6 || lb < 1e-6) continue
          let cosT = (ax * bx + ay * by) / (la * lb)
          if (cosT > 1) cosT = 1
          else if (cosT < -1) cosT = -1
          const turn = (Math.acos(cosT) * 180) / Math.PI
          if (!best || turn > best.turnDeg) {
            best = {
              line: n,
              k,
              turnDeg: Number(turn.toFixed(2)),
              segBefore: Number(la.toFixed(2)),
              segAfter: Number(lb.toFixed(2)),
            }
          }
        }
      }
      if (!best) return null
      // 附上该顶点前后各 4 个点，方便看形状
      const line = lines[best.line]
      const from = Math.max(0, best.k - 4)
      const to = Math.min(pointCount - 1, best.k + 4)
      const pts = []
      for (let k = from; k <= to; k += 1) {
        pts.push([Number(line.xs[k].toFixed(1)), Number(line.ys[k].toFixed(1))])
      }
      // 顺便量一下这一带的场方向：折角是场造成的还是管线造成的
      const fieldDirs = pts.map((p) => {
        const v = window.__flow.sample(p[0], p[1])
        return Number(((Math.atan2(v.y, v.x) * 180) / Math.PI).toFixed(1))
      })
      return { ...best, points: pts, fieldDirs }
    },
    /** 某块圆形区域里的平均扰动强度 */
    pertEnergyNear(x, y, radius) {
      const i0 = Math.max(0, Math.floor((x - radius) / cell))
      const i1 = Math.min(cols - 1, Math.ceil((x + radius) / cell))
      const j0 = Math.max(0, Math.floor((y - radius) / cell))
      const j1 = Math.min(rows - 1, Math.ceil((y + radius) / cell))
      const r2 = radius * radius
      let sum = 0
      let n = 0
      for (let j = j0; j <= j1; j += 1) {
        const dy = (j + 0.5) * cell - y
        for (let i = i0; i <= i1; i += 1) {
          const dx = (i + 0.5) * cell - x
          if (dx * dx + dy * dy > r2) continue
          const idx = j * cols + i
          sum += Math.abs(pertX[idx]) + Math.abs(pertY[idx])
          n += 1
        }
      }
      return n ? Number((sum / (n * 2)).toFixed(4)) : 0
    },
    energy: perturbationEnergy,
    /**
     * 流线几何体检：点有没有在局部挤成一团。
     * 挤压的表现是「相邻点间距的最小值」远小于标称 spacing，
     * 一旦挤到接近 0，同一根线就会在几个像素内反复描边，渲染成深色硬块。
     */
    geometry() {
      const localMins = []
      let worstMin = Infinity
      let totalLen = 0
      let crushed = 0
      let counted = 0
      let pending = 0
      let faint = 0
      let offscreen = 0

      for (let n = 0; n < lines.length; n += 1) {
        const line = lines[n]
        if (line.pending) pending += 1
        if (line.alpha > 0.012 && line.alpha < 0.35) faint += 1
        if (line.alpha < 0.05) continue

        counted += 1
        const xs = line.xs
        const ys = line.ys
        let len = 0
        let localMin = Infinity
        let midX = 0
        let midY = 0

        for (let k = 0; k < pointCount - 1; k += 1) {
          const dx = xs[k + 1] - xs[k]
          const dy = ys[k + 1] - ys[k]
          const d = Math.sqrt(dx * dx + dy * dy)
          len += d
          if (d < localMin) localMin = d
        }
        for (let k = 0; k < pointCount; k += pointCount >> 2) {
          midX += xs[k]
          midY += ys[k]
        }
        midX /= 5
        midY /= 5
        if (midX < 0 || midX > W || midY < 0 || midY > H) offscreen += 1

        totalLen += len
        localMins.push(localMin)
        if (localMin < worstMin) worstMin = localMin
        if (localMin < spacing * 0.3) crushed += 1
      }

      localMins.sort((a, b) => a - b)

      /*
       * 曲率体检：逐点看相邻两段的折角。
       * 折角 = 曲率 × 点间距，所以「每段折多少度」直接就是「弯得急不急」。
       * 毛发感的本质就是这个值在高频上反复变大 —— 换成「半径」更直观：
       *   R = 11.5px / 折角(rad)
       * 每段 2° -> R≈330px（宽缓）；每段 12° -> R≈55px（打卷）。
       */
      const turns = []
      let maxTurn = 0
      for (let n = 0; n < lines.length; n += 1) {
        const line = lines[n]
        if (line.alpha < 0.05) continue
        const xs = line.xs
        const ys = line.ys
        for (let k = 1; k < pointCount - 1; k += 1) {
          const ax = xs[k] - xs[k - 1]
          const ay = ys[k] - ys[k - 1]
          const bx = xs[k + 1] - xs[k]
          const by = ys[k + 1] - ys[k]
          const la = Math.sqrt(ax * ax + ay * ay) || 1e-6
          const lb = Math.sqrt(bx * bx + by * by) || 1e-6
          let cosT = (ax * bx + ay * by) / (la * lb)
          if (cosT > 1) cosT = 1
          else if (cosT < -1) cosT = -1
          const turn = Math.acos(cosT)
          turns.push(turn)
          if (turn > maxTurn) maxTurn = turn
        }
      }
      turns.sort((a, b) => a - b)
      const medianTurn = turns.length ? turns[(turns.length / 2) | 0] : 0
      const toDeg = (rad) => Number(((rad * 180) / Math.PI).toFixed(2))

      /*
       * 相邻线方向差：每根线取中点处的切线方向，找最近的另一根线算夹角。
       * 这是「集体运动」的直接度量 —— 头发感的特征是相邻线各走各的，
       * 这个值会很大；同一片水的特征是相邻线基本平行。
       * 90° 是折叠后的上限（方向不分正负）。
       */
      const mids = []
      for (let n = 0; n < lines.length; n += 1) {
        const line = lines[n]
        if (line.alpha < 0.05) continue
        const m = (pointCount - 1) >> 1
        mids.push({
          x: line.xs[m],
          y: line.ys[m],
          a: Math.atan2(line.ys[m] - line.ys[m - 1], line.xs[m] - line.xs[m - 1]),
        })
      }
      const dirDiffs = []
      for (let i = 0; i < mids.length; i += 1) {
        let bestD2 = Infinity
        let bestA = 0
        for (let j = 0; j < mids.length; j += 1) {
          if (i === j) continue
          const dx = mids[j].x - mids[i].x
          const dy = mids[j].y - mids[i].y
          const d2 = dx * dx + dy * dy
          if (d2 < bestD2) {
            bestD2 = d2
            bestA = mids[j].a
          }
        }
        if (bestD2 === Infinity) continue
        let diff = Math.abs(mids[i].a - bestA)
        if (diff > Math.PI / 2) diff = Math.PI - diff
        dirDiffs.push((diff * 180) / Math.PI)
      }
      dirDiffs.sort((a, b) => a - b)
      const neighborMeanDeg = dirDiffs.length
        ? Number((dirDiffs.reduce((s, v) => s + v, 0) / dirDiffs.length).toFixed(2))
        : 0
      const neighborMaxDeg = dirDiffs.length ? Number(dirDiffs[dirDiffs.length - 1].toFixed(2)) : 0

      /*
       * 覆盖均匀度：把画面切成 120px 的格子，数线中点落在多少个格子里。
       * 如果格子数随时间塌缩，说明线正挤到同几条流线上互相重叠 ——
       * 画面会「看起来变空」，其实是重叠后那条变深、其余位置没有线。
       */
      const buckets = new Map()
      for (let n = 0; n < lines.length; n += 1) {
        const line = lines[n]
        if (line.alpha < 0.05) continue
        const mid = (pointCount - 1) >> 1
        const gx = Math.floor(line.xs[mid] / 120)
        const gy = Math.floor(line.ys[mid] / 120)
        const key = gx * 4096 + gy
        buckets.set(key, (buckets.get(key) ?? 0) + 1)
      }
      let crowded = 0
      let worstBucket = 0
      for (const count of buckets.values()) {
        if (count > 1) crowded += count - 1
        if (count > worstBucket) worstBucket = count
      }

      return {
        nominalSpacing: Number(spacing.toFixed(2)),
        totalLines: lines.length,
        drawn: counted,
        pending,
        faint,
        offscreen,
        // 曲率：每段折角，以及换算出来的最小弯曲半径
        maxTurnDeg: toDeg(maxTurn),
        medianTurnDeg: toDeg(medianTurn),
        minRadius: maxTurn > 1e-6 ? Number((spacing / maxTurn).toFixed(0)) : 99999,
        // 集体性：相邻线方向差
        neighborDirDeg: neighborMeanDeg,
        neighborDirMaxDeg: neighborMaxDeg,
        neighborSpreadDeg: Number((neighborMaxDeg - neighborMeanDeg).toFixed(2)),
        // 覆盖均匀度
        occupiedCells: buckets.size,
        crowdedLines: crowded,
        worstBucket,
        worstMinSegment: Number(worstMin.toFixed(3)),
        medianOfLocalMins: Number((localMins[localMins.length >> 1] ?? 0).toFixed(3)),
        crushedLines: crushed,
        crushedRatio: Number((crushed / Math.max(1, counted)).toFixed(3)),
        meanLength: Number((totalLen / Math.max(1, counted)).toFixed(1)),
      }
    },
    debug() {
      return {
        lines: lines.length,
        points: pointCount,
        activeLines,
        cols,
        rows,
        cell,
        canvas: { w: canvas.width, h: canvas.height, dpr },
        avgFrameMs: Number(avgFrame.toFixed(2)),
        quality,
        ripples: ripples.length,
        perturbation: Number(perturbationEnergy().toFixed(4)),
        obstacles: obstacles.length,
        reactors: reactors.length,
        chars: chars.length,
        scrollProgress: Number(scrollProgress.toFixed(3)),
        params: {
          rot: Number(params.rot.toFixed(3)),
          freq: Number(params.freq.toFixed(6)),
          tint: Number(params.tint.toFixed(3)),
          density: Number(params.density.toFixed(3)),
          bias: Number(params.bias.toFixed(3)),
          biasAngle: Number(params.biasAngle.toFixed(3)),
        },
        reduceMotion,
        // 把判定依据摊开：用户看到 static 时，一眼能知道是谁要求的
        motion: {
          apiSupported: Boolean(motionQuery),
          systemPrefersReduce: prefersReduced(),
          override: motionOverride,
          reducing: reduceMotion,
        },
        pointerActive: pointer.active,
        presetName: preset === PRESET.wide ? 'wide' : 'narrow',
        paused: !running,
        seed: currentSeed,
        // 「动画到底在不在跑」的权威答案，比 paused 明确：
        // paused 把「用户按了暂停」和「reduced motion 静帧」混成了一种状态
        animation: animationState(),
        running,
        hidden: document.hidden,
        lastFrameAgoMs: Number((performance.now() - lastFrameAt).toFixed(0)),
        // 画面上实测的平均流速，和配置里的目标值对照着看
        measuredSpeed: Number(measuredSpeed.toFixed(2)),
        drift: {
          x: Number(driftX.toFixed(2)),
          y: Number(driftY.toFixed(2)),
          mag: Number(Math.hypot(driftX, driftY).toFixed(2)),
        },
        targetSpeed: Number((preset.speed * params.speed).toFixed(2)),
        speedTrim: Number(speedTrim.toFixed(3)),
        breath: Number(breathGlobal().toFixed(4)),
        breathAmount: tuning.breathAmount,
        speedSpread: tuning.speedSpread,
        frames: frameCount,
      }
    },

    /* ================================================================== */
    /* 调参面板 API（/home/lab.html 用）                                   */
    /* ================================================================== */

    lab: {
      /** 参数表：分组 + 每项的元信息与当前值。面板据此自动生成 UI。 */
      spec() {
        return {
          presetName: preset === PRESET.wide ? 'wide' : 'narrow',
          chapterCount: CHAPTERS.length,
          activeChapter,
          paused: !running,
          seed: currentSeed,
          motion: {
            apiSupported: Boolean(motionQuery),
            systemPrefersReduce: prefersReduced(),
            override: motionOverride,
            reducing: reduceMotion,
            animation: animationState(),
          },
          groups: LAB_SPEC.map((group) => ({
            group: group.group,
            hint: group.hint ?? null,
            chapter: Boolean(group.chapter),
            items: group.items.map((item) => ({
              ...item,
              value: readPath(item.path),
              defaultValue: readDefault(item.path),
            })),
          })),
        }
      },

      get(path) {
        return readPath(path)
      },

      set(path, value) {
        return writePath(path, value)
      },

      /** 批量应用，返回需要重建的次数 */
      apply(patch) {
        let applied = 0
        for (const key of Object.keys(patch)) {
          const result = writePath(key, patch[key])
          if (result.ok) applied += 1
        }
        return applied
      },

      /** 回到代码里的原始值 */
      reset() {
        // 注意是 Object.keys(PRESET.wide) —— 参数名在预设**里面**。
        // 写成 Object.keys(PRESET) 拿到的是 ['wide','narrow'] 这两个预设名，
        // 结果会往 PRESET.wide.wide 上写 undefined，参数一个都没复位。
        for (const key of Object.keys(PRESET.wide)) {
          PRESET.wide[key] = DEFAULTS.preset.wide[key]
          PRESET.narrow[key] = DEFAULTS.preset.narrow[key]
        }
        for (const key of Object.keys(tuning)) tuning[key] = DEFAULTS.tuning[key]
        for (let i = 0; i < CHAPTERS.length; i += 1) {
          for (const key of Object.keys(CHAPTERS[i])) CHAPTERS[i][key] = DEFAULTS.chapters[i][key]
        }
        setup()
        return true
      },

      /** 切换/设置当前编辑的章节，并（可选）把页面滚过去 */
      chapter(index, scroll) {
        activeChapter = Math.max(0, Math.min(CHAPTERS.length - 1, index | 0))
        if (scroll) {
          const max = document.documentElement.scrollHeight - window.innerHeight
          const top = (max * activeChapter) / (CHAPTERS.length - 1)
          window.scrollTo({ top, behavior: 'smooth' })
        }
        return activeChapter
      },

      /** 重新播种噪声，换一片完全不同的地形（同一个 seed 可复现） */
      seed(value) {
        currentSeed = value | 0
        seedNoise(mulberry32(currentSeed))
        setup()
        return currentSeed
      },

      /**
       * 强制动态 / 回到跟随系统。
       *
       * 系统开着「减少动态效果」时（Windows：设置 → 辅助功能 → 视觉效果 → 动画效果），
       * 页面按无障碍规范进静帧。这条通道让调参时能绕开它看到完整效果 ——
       * 不然滑杆怎么拖都没反应，看起来像坏了。
       */
      setMotionOverride(on) {
        motionOverride = Boolean(on)
        storeOverride(motionOverride)
        reduceMotion = shouldReduce()
        stop()
        setup() // setup 内部会按需 renderStatic()，并重新做精确校准
        if (!reduceMotion) start()
        return {
          override: motionOverride,
          reducing: reduceMotion,
          animation: animationState(),
        }
      },

      pause() {
        stop()
        return true
      },

      resume() {
        start()
        return true
      },

      /** 导出当前全部参数，方便贴回来 */
      export() {
        const out = { preset: {}, chapters: [], tuning: {} }
        for (const key of Object.keys(PRESET.wide)) {
          out.preset[key] = preset[key]
        }
        for (const chapter of CHAPTERS) out.chapters.push({ ...chapter })
        Object.assign(out.tuning, tuning)
        return out
      },
    },
  }
})()
