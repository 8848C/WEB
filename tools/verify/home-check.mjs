/**
 * ENTER THE FLOW —— 端到端验证
 *
 * 不只截图。这个脚本要证明几件「看不见」的事：
 *   · 鼠标划过真的把速度写进了场（而不是只画了个拖尾）
 *   · 扰动会向外扩散（靠近处的能量先升后降，远处延迟升高）
 *   · 松手后会缓慢衰减回静息，而不是硬停
 *   · 文字被推开后能完全回弹，且不会因为量位置时的正反馈越推越远
 *   · 滚动真的换了场（方向 / 频率 / 色温 / 密度）
 *   · 移动端降密度、reduced motion 出静帧
 *
 * 用法：node tools/verify/home-check.mjs [url]
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { createRecorder, makeHelpers, openBrowser, sleep } from './cdp.mjs'

const TARGET = process.argv[2] ?? 'http://127.0.0.1:5173/home/index.html'
const PROJECT_ROOT = path.resolve(import.meta.dirname, '..', '..')
const ARTIFACTS = path.join(PROJECT_ROOT, 'artifacts')
const PROFILE = path.join(PROJECT_ROOT, '.tmp', 'chrome-home')

/* ---------------------------------- 探针 --------------------------------- */

const INK_PROBE = `(() => {
  const c = document.getElementById('flow')
  if (!c || !c.width) return null
  const p = document.createElement('canvas')
  p.width = c.width
  p.height = c.height
  const g = p.getContext('2d')
  g.drawImage(c, 0, 0)
  const d = g.getImageData(0, 0, c.width, c.height).data
  let ink = 0, n = 0, sum = 0, max = 0
  for (let i = 3; i < d.length; i += 4 * 7) {
    const a = d[i]
    n += 1
    if (a > 4) { ink += 1; sum += a }
    if (a > max) max = a
  }
  return { sampled: n, coverage: +(ink / n).toFixed(4), meanAlpha: +(sum / n).toFixed(3), maxAlpha: max }
})()`

const CHAR_PROBE = `(() => {
  const list = [...document.querySelectorAll('#title .ch')]
  if (!list.length) return null
  const items = list.map((el) => {
    const m = new DOMMatrixReadOnly(getComputedStyle(el).transform)
    const r = el.getBoundingClientRect()
    return {
      ch: el.textContent,
      tx: +m.m41.toFixed(2),
      ty: +m.m42.toFixed(2),
      sx: +m.m11.toFixed(4),
      cx: +(r.left + r.width / 2).toFixed(1),
      cy: +(r.top + r.height / 2).toFixed(1),
    }
  })
  const xs = items.map((i) => i.cx)
  return {
    items,
    spread: +(Math.max(...xs) - Math.min(...xs)).toFixed(1),
    moved: items.filter((i) => Math.abs(i.tx) > 0.5 || Math.abs(i.ty) > 0.5).length,
  }
})()`

/* ---------------------------------- 主流程 -------------------------------- */

async function main() {
  mkdirSync(ARTIFACTS, { recursive: true })

  // 预检：连不上就直接说清楚，不要等无头浏览器打开一个错误页再报奇怪的空指针
  try {
    const res = await fetch(TARGET, { redirect: 'follow' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
  } catch (error) {
    throw new Error(
      `打不开 ${TARGET}（${error.message}）。先把前端跑起来：.\\start-all.cmd`,
    )
  }

  const browser = await openBrowser({ port: 9336, profileDir: PROFILE })
  const { send, browserPath } = browser
  const recorder = createRecorder(browser.cdp)
  const { evaluate, setViewport, setMotion, navigate, move, click, stroke } = makeHelpers(send)

  console.log(`[verify] 浏览器 : ${browserPath}`)
  console.log(`[verify] 目标页 : ${TARGET}`)

  try {
    await run({ browser, send, recorder, evaluate, setViewport, setMotion, navigate, move, click, stroke })
  } finally {
    // 一定要关：CDP 的 WebSocket 会一直吊着事件循环，出错时不关就永远不退出
    await browser.close()
  }
}

async function run({
  browser,
  send,
  recorder,
  evaluate,
  setViewport,
  setMotion,
  navigate,
  move,
  click,
  stroke,
}) {
  const shoot = async (name) => {
    const { data } = await send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: false,
    })
    writeFileSync(path.join(ARTIFACTS, `${name}.png`), Buffer.from(data, 'base64'))
    console.log(`[verify] 截图 -> artifacts/${name}.png`)
  }

  const report = { target: TARGET, steps: {} }

  /* ---------------------------- 1. 首屏 ---------------------------- */
  await setMotion('no-preference')
  await setViewport(1600, 900)
  await navigate(TARGET, 2600)

  report.steps.initial = await evaluate(`window.__flow ? window.__flow.debug() : null`)
  report.steps.initialInk = await evaluate(INK_PROBE)
  await shoot('h1-hero')

  /* ------------------------ 2. 文字反应 + 回弹 ------------------------ */
  const resting = await evaluate(CHAR_PROBE)
  if (!resting || !resting.items.length) throw new Error('找不到标题字符节点 #title .ch')

  // 光标停在某个字母的斜下方：正好落在字母上时位移方向是零向量，看不出效果
  const anchor = resting.items[3]
  const focusX = anchor.cx + 34
  const focusY = anchor.cy + 28

  const approach = []
  for (let i = 1; i <= 10; i += 1) {
    approach.push([focusX - 300 + (300 * i) / 10, focusY + 46 - (46 * i) / 10])
  }
  await stroke(approach, 22)
  await sleep(900)

  const hovered = await evaluate(CHAR_PROBE)
  await shoot('h2-hover-title')

  // 手离开
  await stroke([[focusX + 620, focusY - 360]], 1)
  await sleep(3600)
  const recovered = await evaluate(CHAR_PROBE)

  report.steps.text = {
    focus: { x: Math.round(focusX), y: Math.round(focusY) },
    restingSpread: resting.spread,
    hoveredSpread: hovered.spread,
    recoveredSpread: recovered.spread,
    maxShift: Math.max(...hovered.items.map((i) => Math.abs(i.tx))),
    maxStretch: Math.max(...hovered.items.map((i) => i.sx)),
    hoveredMoved: hovered.moved,
    recoveredMoved: recovered.moved,
    sample: hovered.items.slice(0, 6).map((i) => ({ ch: i.ch, tx: i.tx, ty: i.ty, sx: i.sx })),
  }

  /* ------------------- 3. 流体：写入 / 传播 / 恢复 ------------------- */
  const cx = 1120
  const cy = 470
  const FAR = 240
  const probe = (x, y, r) => evaluate(`window.__flow.pertEnergyNear(${x}, ${y}, ${r})`)
  const near0 = () => probe(cx, cy, 55)
  const far0 = () => probe(cx + FAR, cy, 75)

  const base = { near: await near0(), far: await far0() }

  // 绕小圈摩擦水面
  const orbit = []
  for (let rev = 0; rev < 4; rev += 1) {
    for (let s = 0; s < 24; s += 1) {
      const a = (s / 24) * Math.PI * 2 + rev * 0.4
      orbit.push([cx + Math.cos(a) * 42, cy + Math.sin(a) * 42])
    }
  }
  await stroke(orbit, 16)

  const t0 = { near: await near0(), far: await far0() }
  await shoot('h3-stroke')

  await sleep(1700)
  const t1 = { near: await near0(), far: await far0() }

  await sleep(6500)
  const t2 = { near: await near0(), far: await far0() }

  report.steps.fluid = {
    farProbeDistance: FAR,
    before: base,
    rightAfterStroke: t0,
    after1_7s: t1,
    after8_2s: t2,
    // 扩散的特征不是「远处能量绝对升高」，而是「能量剖面被抹平」：
    // 能量在划线的 1.6 秒里就已经扩散出去了，所以要在划线前后比远处，
    // 再看 远处/近处 的比值怎么随时间变化。
    profile: {
      farOverNear_rightAfter: +(t0.far / Math.max(t0.near, 1e-6)).toFixed(4),
      farOverNear_after1_7s: +(t1.far / Math.max(t1.near, 1e-6)).toFixed(4),
    },
    assertions: {
      injected: t0.near > 3,
      reachedFarField: t0.far > base.far * 20,
      profileFlattens: t1.far / Math.max(t1.near, 1e-6) > (t0.far / Math.max(t0.near, 1e-6)) * 2,
      decayedNearCursor: t1.near < t0.near,
      recovered: t2.near < 0.35 && t2.far < 0.35,
    },
  }

  /* ---------------------------- 4. 点击涟漪 ---------------------------- */
  const rx = 470
  const ry = 640
  await click(rx, ry)
  // 截图等到涟漪扩散到有存在感的时候，而不是刚生成的那一帧
  await sleep(900)
  report.steps.ripple = {
    debug: await evaluate(`window.__flow.debug()`),
    energyNearClick: await probe(rx, ry, 90),
    energyOnRing: await probe(rx + 220, ry, 90),
  }
  await shoot('h4-ripple')
  await sleep(1200)

  /* ---------------------------- 5. 滚动换场 ---------------------------- */
  const beforeScroll = await evaluate(`window.__flow.debug()`)

  await evaluate(`(() => {
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' })
    return window.scrollY
  })()`)
  await sleep(2800)
  const chapter3 = await evaluate(`({
    debug: window.__flow.debug(),
    readout: document.getElementById('chapterReadout')?.textContent ?? null,
    scrollY: Math.round(window.scrollY),
  })`)
  await shoot('h5-chapter-03')

  await evaluate(`(() => {
    const mid = (document.documentElement.scrollHeight - innerHeight) / 2
    window.scrollTo({ top: mid, behavior: 'instant' })
    return window.scrollY
  })()`)
  await sleep(2800)
  const chapter2 = await evaluate(`({
    debug: window.__flow.debug(),
    readout: document.getElementById('chapterReadout')?.textContent ?? null,
  })`)
  await shoot('h6-chapter-02')

  report.steps.scroll = {
    before: beforeScroll.params,
    chapter2: chapter2.debug.params,
    chapter3: chapter3.debug.params,
    readoutAtChapter3: chapter3.readout,
    readoutAtChapter2: chapter2.readout,
    assertions: {
      rotationChanged:
        Math.abs(chapter3.debug.params.rot - beforeScroll.params.rot) > 0.25,
      frequencyChanged:
        chapter2.debug.params.freq > beforeScroll.params.freq * 1.2,
      tintChanged: chapter3.debug.params.tint > beforeScroll.params.tint + 0.5,
      densityChanged: chapter2.debug.params.density < beforeScroll.params.density,
      readoutFollows: chapter3.readout === '03' && chapter2.readout === '02',
    },
  }

  await evaluate(`window.scrollTo({ top: 0, behavior: 'instant' })`)
  await sleep(2600)

  /* ------------------------------ 5b. MENU ------------------------------ */
  // 用真实鼠标点，而不是 element.click()：
  // element.click() 绕过命中检测，覆盖层把按钮盖住了它照样「成功」。
  const toggleBox = await evaluate(`(() => {
    const r = document.getElementById('menuToggle').getBoundingClientRect()
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
  })()`)

  await click(toggleBox.x, toggleBox.y)
  await sleep(1100)
  const menuOpen = await evaluate(`({
    hidden: document.getElementById('menu').hidden,
    visible: document.getElementById('menu').classList.contains('is-visible'),
    expanded: document.getElementById('menuToggle').getAttribute('aria-expanded'),
    items: document.querySelectorAll('.menu__item').length,
    topmostAtToggle: (document.elementFromPoint(${toggleBox.x}, ${toggleBox.y}) || {}).id
      || (document.elementFromPoint(${toggleBox.x}, ${toggleBox.y}) || {}).className,
  })`)
  await shoot('h9-menu')

  await click(toggleBox.x, toggleBox.y)
  await sleep(1200)
  const menuClosed = await evaluate(`({
    hidden: document.getElementById('menu').hidden,
    expanded: document.getElementById('menuToggle').getAttribute('aria-expanded'),
  })`)

  report.steps.menu = {
    open: menuOpen,
    closed: menuClosed,
    assertions: {
      opened: menuOpen.visible && !menuOpen.hidden && menuOpen.expanded === 'true',
      // 真正能点到的证明：按钮位置上最顶层的元素应该还是按钮自己
      toggleReachable: String(menuOpen.topmostAtToggle).includes('menu-toggle'),
      closed: menuClosed.hidden && menuClosed.expanded === 'false',
      itemCount: menuOpen.items,
    },
  }

  /* ------------------------------ 6. 移动端 ------------------------------ */
  await setViewport(390, 844, true)
  await navigate(TARGET, 2600)
  report.steps.mobile = {
    debug: await evaluate(`window.__flow.debug()`),
    ink: await evaluate(INK_PROBE),
    innerWidth: await evaluate('innerWidth'),
  }
  await shoot('h7-mobile')

  /* --------------------------- 7. reduced motion --------------------------- */
  await setMotion('reduce')
  await setViewport(1600, 900)
  await navigate(TARGET, 2200)
  report.steps.reducedMotion = {
    debug: await evaluate(`window.__flow.debug()`),
    ink: await evaluate(INK_PROBE),
  }
  await shoot('h8-reduced-motion')

  /* -------------------------------- 汇总 -------------------------------- */
  report.consoleErrors = recorder.consoleMessages.filter((m) => m.level === 'error')
  report.consoleWarnings = recorder.consoleMessages.filter((m) => m.level === 'warning')
  report.exceptions = recorder.exceptions
  report.failedRequests = recorder.failedRequests

  const a = report.steps.fluid.assertions
  const s = report.steps.scroll.assertions

  report.summary = {
    '左键注入扰动': a.injected,
    '扰动传到 240px 外': a.reachedFarField,
    '能量剖面随时间抹平（扩散）': a.profileFlattens,
    '鼠标附近先衰减': a.decayedNearCursor,
    '约 8 秒回到静息': a.recovered,
    '点击生成涟漪': report.steps.ripple.debug.ripples > 0,
    'MENU 能开能关': report.steps.menu.assertions.opened && report.steps.menu.assertions.closed,
    'MENU 按钮未被覆盖层挡住': report.steps.menu.assertions.toggleReachable,
    '文字被推开': report.steps.text.hoveredMoved >= 6,
    '文字拉伸': report.steps.text.maxStretch > 1.05,
    '文字完全回弹': report.steps.text.recoveredMoved === 0,
    '滚动改变方向': s.rotationChanged,
    '滚动改变频率': s.frequencyChanged,
    '滚动改变色温': s.tintChanged,
    '滚动改变密度': s.densityChanged,
    '章节读数跟随': s.readoutFollows,
    '移动端降低密度': report.steps.mobile.debug.lines < report.steps.initial.lines,
    'reduced motion 有静帧': report.steps.reducedMotion.ink.coverage > 0.001,
    '无控制台错误': report.consoleErrors.length === 0 && report.exceptions.length === 0,
  }

  writeFileSync(
    path.join(ARTIFACTS, 'home-verify-report.json'),
    `${JSON.stringify(report, null, 2)}\n`,
    'utf8',
  )

  console.log('\n================ 验证结果 ================')
  console.log(JSON.stringify({ summary: report.summary, steps: report.steps }, null, 2))
  console.log('\n控制台错误 :', report.consoleErrors.length)
  console.log('未捕获异常 :', report.exceptions.length)
  console.log('网络失败   :', JSON.stringify(report.failedRequests))
  console.log('==========================================')
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('[verify] 失败:', error)
    process.exit(1)
  })
