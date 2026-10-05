/**
 * FLOW LAB —— 调参台逻辑
 *
 * 面板本身不认识任何参数：它从作品里的 window.__flow.lab.spec() 读出
 * 「有哪些参数、范围多少、当前值多少」，据此自动生成 UI。
 * 以后往 main.js 的 LAB_SPEC 里加一行，面板就自动多一根滑杆。
 *
 * 作品跑在同源的 iframe 里，面板只是套在外面 —— 不用复制一份 HTML，
 * 也不会出现「改了首页忘了改测试页」的漂移。
 */

(() => {
  'use strict'

  const frame = document.getElementById('frame')
  const frameWrap = document.getElementById('frameWrap')
  const panel = document.getElementById('panel')
  const tabsEl = document.getElementById('tabs')
  const controlsEl = document.getElementById('controls')
  const metricsEl = document.getElementById('metrics')
  const presetNameEl = document.getElementById('presetName')
  const chapterLabel = document.getElementById('chapterLabel')
  const seedInput = document.getElementById('seedInput')
  const json = document.getElementById('json')
  const ioStatus = document.getElementById('ioStatus')
  const scrollWithChapter = document.getElementById('scrollWithChapter')
  const pauseBtn = document.getElementById('pauseBtn')
  const hideTextBtn = document.getElementById('hideTextBtn')
  const reopen = document.getElementById('reopen')

  scrollWithChapter.checked = true

  let flow = null
  let spec = null
  let controls = []
  let activeTab = 0
  let textHidden = false
  let paused = false
  let chapter = 0

  const whenReady = () =>
    new Promise((resolve) => {
      const check = () => {
        const api = frame.contentWindow?.__flow
        if (api && api.lab) resolve(api)
        else setTimeout(check, 60)
      }
      check()
    })

  /* ------------------------------------------------------------------ */
  /* 选项卡                                                              */
  /* ------------------------------------------------------------------ */

  function buildTabs() {
    tabsEl.replaceChildren()
    spec.groups.forEach((group, index) => {
      const tab = document.createElement('button')
      tab.type = 'button'
      tab.className = 'tab'
      tab.textContent = group.group
      tab.classList.toggle('on', index === activeTab)
      tab.addEventListener('click', () => {
        activeTab = index
        buildTabs()
        buildControls()
      })
      tabsEl.appendChild(tab)
    })
  }

  function buildControls() {
    controlsEl.replaceChildren()
    controls = []

    const group = spec.groups[activeTab]
    if (!group) return

    if (group.hint) {
      const hint = document.createElement('p')
      hint.className = 'group-hint'
      hint.textContent = group.hint
      controlsEl.appendChild(hint)
    }

    for (const item of group.items) controlsEl.appendChild(buildControl(item))
    syncValues()
  }

  function buildControl(item) {
    const wrap = document.createElement('div')
    wrap.className = 'ctl'

    const label = document.createElement('div')
    label.className = 'ctl__label'
    const name = document.createElement('span')
    name.className = 'ctl__name'
    name.textContent = item.unit ? `${item.label}  (${item.unit})` : item.label
    const path = document.createElement('span')
    path.className = 'ctl__path'
    path.textContent = item.path
    label.append(name, path)
    wrap.appendChild(label)

    const range = document.createElement('input')
    range.type = 'range'
    range.min = String(item.min)
    range.max = String(item.max)
    range.step = String(item.step)
    wrap.appendChild(range)

    const number = document.createElement('input')
    number.type = 'number'
    number.min = String(item.min)
    number.max = String(item.max)
    number.step = String(item.step)
    wrap.appendChild(number)

    const record = { item, wrap, range, number, value: item.value }
    controls.push(record)

    const commit = (raw) => {
      const value = Number(raw)
      if (!Number.isFinite(value)) return
      const result = flow.lab.set(item.path, value)
      if (!result.ok) return
      record.value = result.value
      range.value = String(result.value)
      number.value = String(result.value)
      markChanged(record)
    }

    range.addEventListener('input', () => commit(range.value))
    number.addEventListener('change', () => commit(number.value))

    return wrap
  }

  function markChanged(record) {
    const base = Number(record.item.defaultValue)
    const now = Number(record.value)
    const changed = Number.isFinite(base) && now !== base
    record.wrap.classList.toggle('is-changed', changed)
  }

  /* ------------------------------------------------------------------ */
  /* 同步                                                                */
  /* ------------------------------------------------------------------ */

  function refreshSpec() {
    spec = flow.lab.spec()
    presetNameEl.textContent = `preset: ${spec.presetName} · 基准 ${readItem('preset.speed')} px/s`
    chapter = spec.activeChapter
    chapterLabel.textContent = String(chapter + 1).padStart(2, '0')
    paused = spec.paused
    pauseBtn.textContent = paused ? '继续' : '暂停'
    seedInput.value = String(spec.seed)
    renderMotionNotice()
  }

  /**
   * 把「为什么不动」摆在最显眼的地方。
   *
   * 系统开着「减少动态效果」时（Windows：设置 → 辅助功能 → 视觉效果 → 动画效果），
   * 页面按无障碍规范进静帧 —— 此时滑杆全都没反应。不解释清楚的话，
   * 用户只会以为面板坏了。
   */
  function renderMotionNotice() {
    const m = spec.motion
    const notice = document.getElementById('motionNotice')
    const text = document.getElementById('motionNoticeText')
    if (!m) {
      notice.hidden = true
      return
    }

    if (m.reducing) {
      notice.hidden = false
      notice.classList.remove('is-forced')
      text.innerHTML =
        '你的浏览器报告 <code>prefers-reduced-motion: reduce</code>，' +
        '作品按无障碍规范停在<b>静帧模式</b>：rAF 没有启动，' +
        '所以滑杆、流速、漂移全都不动 —— 这不是面板坏了。<br>' +
        'Windows 上关掉它的位置：<b>设置 → 辅助功能 → 视觉效果 → 动画效果</b>。' +
        '想先看效果就点下面的按钮。'
      return
    }

    if (m.override && m.systemPrefersReduce) {
      notice.hidden = false
      notice.classList.add('is-forced')
      text.innerHTML =
        '已<b>强制动态</b>，绕过了系统的「减少动态效果」设置。' +
        '这只影响本作品（记在 localStorage），刷新后仍然有效。'
      return
    }

    notice.hidden = true
  }

  function readItem(path) {
    for (const group of spec.groups) {
      for (const item of group.items) if (item.path === path) return item.value
    }
    return '—'
  }

  /** 把所有控件刷成模型里的当前值（重置 / 导入 / iframe 尺寸变化后调用） */
  function syncValues() {
    const flat = new Map()
    for (const group of spec.groups) {
      for (const item of group.items) flat.set(item.path, item)
    }
    for (const record of controls) {
      const item = flat.get(record.item.path)
      if (!item) continue
      record.item = item
      record.value = item.value
      record.range.value = String(item.value)
      record.number.value = String(item.value)
      markChanged(record)
    }
  }

  function sync() {
    refreshSpec()
    // 参数组的数量或顺序变了（例如重置后）才重建选项卡
    if (tabsEl.children.length !== spec.groups.length) {
      activeTab = Math.min(activeTab, spec.groups.length - 1)
      buildTabs()
      buildControls()
    } else {
      syncValues()
    }
  }

  /* ------------------------------------------------------------------ */
  /* 实时指标                                                            */
  /* ------------------------------------------------------------------ */

  const METRIC_ROWS = [
    ['帧时间', (d) => `${d.avgFrameMs.toFixed(2)}ms`, (d) => d.avgFrameMs > 22],
    ['动画状态', (d) => d.animation, (d) => d.animation !== 'running'],
    [
      '实测/目标流速',
      (d) => `${d.measuredSpeed.toFixed(1)}/${d.targetSpeed.toFixed(1)}`,
      (d) => d.targetSpeed > 0 && d.measuredSpeed < d.targetSpeed * 0.5,
    ],
    [
      '整体漂移',
      (d) => `${d.drift.mag.toFixed(1)} (${d.drift.x.toFixed(0)},${d.drift.y.toFixed(0)})`,
      (d) => d.targetSpeed > 5 && d.drift.mag < 4,
    ],
    ['速度归一', (d) => `${d.speedTrim.toFixed(2)}×`, () => false],
    ['呼吸', (d) => `${((d.breath - 1) * 100).toFixed(1)}%`, () => false],
    ['线条', (d) => `${d.activeLines}/${d.lines}`, () => false],
    ['质量', (d) => `${Math.round(d.quality * 100)}%`, (d) => d.quality < 1],
    ['场网格', (d) => `${d.cols}×${d.rows}`, () => false],
    ['扰动', (d) => d.perturbation.toFixed(2), () => false],
    [
      '章节',
      (d) => `${Math.round(d.scrollProgress * (spec.chapterCount - 1)) + 1}/${spec.chapterCount}`,
      () => false,
    ],
    ['距上帧', (d) => `${d.lastFrameAgoMs}ms`, (d) => d.lastFrameAgoMs > 800],
  ]

  const GEO_ROWS = [
    ['挤团', (g) => `${g.crushedLines}/${g.drawn}`, (g) => g.crushedLines > 0],
    [
      '点距',
      (g) => `${g.medianOfLocalMins.toFixed(1)}/${g.nominalSpacing}`,
      (g) => g.medianOfLocalMins < g.nominalSpacing * 0.8,
    ],
    // 曲率：判断「是不是变成头发了」最直接的两个数
    ['中位折角', (g) => `${g.medianTurnDeg.toFixed(2)}°`, (g) => g.medianTurnDeg > 1.5],
    [
      '最大折角',
      (g) => `${g.maxTurnDeg.toFixed(1)}°`,
      (g) => g.maxTurnDeg > 12,
    ],
    // 集体性：相邻线方向差。头发感的特征是各走各的，这个值会很大
    ['邻线方向差', (g) => `${g.neighborDirDeg.toFixed(1)}°`, (g) => g.neighborDirDeg > 15],
    ['最小弯径', (g) => `${g.minRadius}px`, (g) => g.minRadius < 60],
    ['占格', (g) => `${g.occupiedCells}`, () => false],
    ['最挤', (g) => `${g.worstBucket}根`, (g) => g.worstBucket > 3],
  ]

  function renderMetrics() {
    if (!flow || !spec) return
    const d = flow.debug()
    const g = flow.geometry()

    // 两组探针读的不是同一份数据，分开跑，别把 d 传给 g 的判据
    const cells = [
      ...METRIC_ROWS.map(([label, read, warn]) => [label, read(d), warn(d)]),
      ...GEO_ROWS.map(([label, read, warn]) => [label, read(g), warn(g)]),
    ]

    metricsEl.replaceChildren()
    for (const [label, value, isWarn] of cells) {
      const dt = document.createElement('dt')
      dt.textContent = label
      const dd = document.createElement('dd')
      dd.textContent = value
      if (isWarn) dd.classList.add('warn')
      metricsEl.append(dt, dd)
    }
  }

  /* ------------------------------------------------------------------ */
  /* 视口 / 章节 / 运行                                                  */
  /* ------------------------------------------------------------------ */

  function setViewport(preset) {
    for (const button of document.querySelectorAll('#viewportRow button')) {
      button.classList.toggle('on', button.dataset.view === preset)
    }

    if (preset === 'fit') {
      frameWrap.style.width = '100%'
      frameWrap.style.height = '100%'
    } else {
      const [w, h] = preset.split('x').map(Number)
      frameWrap.style.width = `${w}px`
      frameWrap.style.height = `${h}px`
    }

    // iframe 尺寸一变，作品内部会重新 setup()，生效的预设可能换了一套，稍后再刷
    setTimeout(sync, 450)
  }

  for (const button of document.querySelectorAll('#viewportRow button')) {
    button.addEventListener('click', () => setViewport(button.dataset.view))
  }

  function goChapter(next) {
    chapter = (next + spec.chapterCount) % spec.chapterCount
    flow.lab.chapter(chapter, scrollWithChapter.checked)
    chapterLabel.textContent = String(chapter + 1).padStart(2, '0')
    setTimeout(sync, scrollWithChapter.checked ? 700 : 0)
  }

  document.getElementById('chapterPrev').addEventListener('click', () => goChapter(chapter - 1))
  document.getElementById('chapterNext').addEventListener('click', () => goChapter(chapter + 1))

  pauseBtn.addEventListener('click', () => {
    paused = !paused
    if (paused) flow.lab.pause()
    else flow.lab.resume()
    pauseBtn.textContent = paused ? '继续' : '暂停'
  })

  hideTextBtn.addEventListener('click', () => {
    const doc = frame.contentDocument
    const existing = doc.getElementById('lab-hide-text')
    if (existing) {
      existing.remove()
      textHidden = false
    } else {
      const style = doc.createElement('style')
      style.id = 'lab-hide-text'
      style.textContent = '.document, .topbar, .footbar { display: none !important; }'
      doc.head.appendChild(style)
      textHidden = true
    }
    hideTextBtn.classList.toggle('on', textHidden)
    hideTextBtn.textContent = textHidden ? '显示文字' : '隐藏文字'
  })

  document.getElementById('resetBtn').addEventListener('click', () => {
    flow.lab.reset()
    flow.lab.chapter(chapter, false)
    setTimeout(sync, 150)
    say('已恢复默认')
  })

  document.getElementById('seedBtn').addEventListener('click', () => {
    const value = flow.lab.seed(Number(seedInput.value) || 0)
    seedInput.value = String(value)
    setTimeout(sync, 150)
    say(`地形已换成 seed ${value}`)
  })

  /* ------------------------------------------------------------------ */
  /* 强制动态 / 跟随系统                                                 */
  /* ------------------------------------------------------------------ */

  function setMotionOverride(on) {
    const result = flow.lab.setMotionOverride(on)
    setTimeout(sync, 250)
    say(
      result.override
        ? `已强制动态（${result.animation}）`
        : `已回到跟随系统（${result.animation}）`,
    )
  }

  document.getElementById('forceMotion').addEventListener('click', () => setMotionOverride(true))
  document.getElementById('followSystem').addEventListener('click', () => setMotionOverride(false))

  /* ------------------------------------------------------------------ */
  /* 导入导出                                                            */
  /* ------------------------------------------------------------------ */

  function say(message, isError) {
    ioStatus.textContent = message
    ioStatus.classList.toggle('err', Boolean(isError))
  }

  const prefix = (head, object) => {
    const out = {}
    for (const key of Object.keys(object)) {
      if (typeof object[key] === 'number') out[`${head}.${key}`] = object[key]
    }
    return out
  }

  document.getElementById('exportBtn').addEventListener('click', () => {
    json.value = JSON.stringify(flow.lab.export(), null, 2)
    say('已导出到下面，可复制')
  })

  document.getElementById('copyBtn').addEventListener('click', async () => {
    if (!json.value.trim()) json.value = JSON.stringify(flow.lab.export(), null, 2)
    try {
      await navigator.clipboard.writeText(json.value)
      say('已复制到剪贴板')
    } catch {
      json.select()
      say('浏览器不让写剪贴板，已帮你全选，Ctrl+C 即可')
    }
  })

  document.getElementById('importBtn').addEventListener('click', () => {
    let data
    try {
      data = JSON.parse(json.value)
    } catch (error) {
      say(`JSON 解析失败：${error.message}`, true)
      return
    }

    let applied = 0
    if (data.preset) applied += flow.lab.apply(prefix('preset', data.preset))
    if (data.tuning) applied += flow.lab.apply(prefix('tuning', data.tuning))

    if (Array.isArray(data.chapters)) {
      const keep = chapter
      data.chapters.forEach((chapterData, index) => {
        flow.lab.chapter(index, false)
        applied += flow.lab.apply(prefix('chapter', chapterData))
      })
      flow.lab.chapter(keep, false)
    }

    setTimeout(sync, 200)
    say(`已应用 ${applied} 项`)
  })

  /* ------------------------------------------------------------------ */
  /* 面板收起 / 展开                                                     */
  /* ------------------------------------------------------------------ */

  document.getElementById('collapse').addEventListener('click', () => {
    panel.classList.add('is-collapsed')
    reopen.hidden = false
  })

  reopen.addEventListener('click', () => {
    panel.classList.remove('is-collapsed')
    reopen.hidden = true
  })

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      panel.classList.toggle('is-collapsed')
      reopen.hidden = !panel.classList.contains('is-collapsed')
    }
  })

  /* ------------------------------------------------------------------ */
  /* 启动                                                                */
  /* ------------------------------------------------------------------ */

  frame.addEventListener('load', async () => {
    flow = await whenReady()
    refreshSpec()
    buildTabs()
    buildControls()

    let resizeTimer = 0
    frame.contentWindow.addEventListener('resize', () => {
      clearTimeout(resizeTimer)
      resizeTimer = setTimeout(sync, 450)
    })

    renderMetrics()
    setInterval(renderMetrics, 260)
  })
})()
