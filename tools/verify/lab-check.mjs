/**
 * 调参台（/home/lab.html）验证
 *
 * 重点不是「面板长得对」，而是证明滑杆**真的驱动了作品**：
 *   · 把 preset.speed 拖到 0    -> 背景应该完全静止
 *   · 把 preset.speed 拖到 60   -> 背景应该明显在动
 *   · 点「恢复默认」             -> 应该回到 19
 * 全程用真实鼠标事件操作滑杆，不用 element.click() 绕过命中检测。
 *
 * 用法：node tools/verify/lab-check.mjs
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { createRecorder, makeHelpers, openBrowser, sleep } from './cdp.mjs'

const TARGET = process.argv[2] ?? 'http://127.0.0.1:5173/home/lab.html'
const PROJECT_ROOT = path.resolve(import.meta.dirname, '..', '..')
const ARTIFACTS = path.join(PROJECT_ROOT, 'artifacts')

/** 降采样 iframe 里那块 canvas 的 alpha，当运动指纹 */
const FINGERPRINT = `(() => {
  const w = document.getElementById('frame').contentWindow
  const c = w.document.getElementById('flow')
  if (!c || !c.width) return null
  const W = 160, H = 90
  const p = w.document.createElement('canvas')
  p.width = W; p.height = H
  const g = p.getContext('2d')
  g.drawImage(c, 0, 0, W, H)
  const d = g.getImageData(0, 0, W, H).data
  const out = new Array(W * H)
  for (let i = 0, j = 0; i < d.length; i += 4, j += 1) out[j] = d[i + 3]
  return out
})()`

function compare(a, b) {
  if (!a || !b) return { meanAbsDiff: -1, changedPixels: -1 }
  let sum = 0
  let moved = 0
  for (let i = 0; i < a.length; i += 1) {
    const delta = Math.abs(a[i] - b[i])
    sum += delta
    if (delta > 2) moved += 1
  }
  return {
    meanAbsDiff: Number((sum / a.length).toFixed(3)),
    changedPixels: Number((moved / a.length).toFixed(4)),
  }
}

async function main() {
  mkdirSync(ARTIFACTS, { recursive: true })

  try {
    const res = await fetch(TARGET, { redirect: 'follow' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
  } catch (error) {
    throw new Error(`打不开 ${TARGET}（${error.message}）。先跑 .\\start-all.cmd`)
  }

  const browser = await openBrowser({ port: 9341, profileDir: path.join(PROJECT_ROOT, '.tmp', 'chrome-lab') })
  const { send } = browser
  const recorder = createRecorder(browser.cdp)
  const { evaluate, setViewport, setMotion, navigate, click } = makeHelpers(send)

  const shoot = async (name) => {
    const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
    writeFileSync(path.join(ARTIFACTS, `${name}.png`), Buffer.from(data, 'base64'))
    console.log(`[lab] 截图 -> artifacts/${name}.png`)
  }

  const report = {}

  /** 用真实鼠标把某个滑杆拖到指定值 */
  const dragSlider = async (pathName, value) => {
    const box = await evaluate(`(() => {
      const ctl = [...document.querySelectorAll('.ctl')].find(
        (c) => c.querySelector('.ctl__path')?.textContent === ${JSON.stringify(pathName)},
      )
      if (!ctl) return null
      const r = ctl.querySelector('input[type=range]').getBoundingClientRect()
      const input = ctl.querySelector('input[type=range]')
      return {
        left: r.left, top: r.top, width: r.width, height: r.height,
        min: Number(input.min), max: Number(input.max),
      }
    })()`)
    if (!box) throw new Error(`面板里找不到 ${pathName} 的滑杆`)

    const ratio = Math.max(0, Math.min(1, (value - box.min) / (box.max - box.min)))
    const y = box.top + box.height / 2
    const x0 = box.left + 3
    const x1 = box.left + 3 + (box.width - 6) * ratio

    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: x0, y, button: 'left', buttons: 1, clickCount: 1 })
    // 分几步移动，触发真实的 input 事件序列（就是拖拽的样子）
    for (let i = 1; i <= 6; i += 1) {
      await send('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: x0 + ((x1 - x0) * i) / 6,
        y,
        button: 'left',
        buttons: 1,
      })
      await sleep(25)
    }
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x1, y, button: 'left', buttons: 0, clickCount: 1 })
    await sleep(300)
  }

  const labGet = (p) => evaluate(`document.getElementById('frame').contentWindow.__flow.lab.get(${JSON.stringify(p)})`)
  const labSpec = () => evaluate(`document.getElementById('frame').contentWindow.__flow.lab.spec()`)
  const artDebug = () => evaluate(`document.getElementById('frame').contentWindow.__flow.debug()`)

  const measureMotion = async (label, seconds = 2.5) => {
    await sleep(600)
    const a = await evaluate(FINGERPRINT)
    await sleep(seconds * 1000)
    const b = await evaluate(FINGERPRINT)
    return { label, ...compare(a, b) }
  }

  try {
    await setMotion('no-preference')
    await setViewport(1700, 1000)
    await navigate(TARGET, 2800)

    /* ------------------------- 1. 面板是否建起来 ------------------------- */
    report.panel = await evaluate(`({
      controls: document.querySelectorAll('.ctl').length,
      tabs: [...document.querySelectorAll('.tab')].map((n) => n.textContent),
      activeTab: document.querySelector('.tab.on')?.textContent ?? null,
      rangeInputs: document.querySelectorAll('.ctl input[type=range]').length,
      numberInputs: document.querySelectorAll('.ctl input[type=number]').length,
      metricsRows: document.querySelectorAll('.metrics dt').length,
      presetLabel: document.getElementById('presetName').textContent,
      chapterLabel: document.getElementById('chapterLabel').textContent,
    })`)

    const spec = await labSpec()
    report.spec = {
      presetName: spec.presetName,
      chapterCount: spec.chapterCount,
      groups: spec.groups.map((g) => ({ group: g.group, items: g.items.length })),
      speedItem: spec.groups[0].items.find((i) => i.path === 'preset.speed'),
    }

    await shoot('lab-01-overview')

    /* -------------------- 2. 拖到 0 -> 背景应该静止 -------------------- */
    await dragSlider('preset.speed', 0)
    report.speedZero = {
      value: await labGet('preset.speed'),
      motion: await measureMotion('speed=0'),
      debug: await artDebug(),
    }
    await shoot('lab-02-speed-zero')

    /* -------------------- 3. 拖到 60 -> 应该明显在动 -------------------- */
    await dragSlider('preset.speed', 60)
    report.speedSixty = {
      value: await labGet('preset.speed'),
      motion: await measureMotion('speed=60'),
      debug: await artDebug(),
    }
    await shoot('lab-03-speed-sixty')

    /* -------------------- 4. 恢复默认 -------------------- */
    const resetBox = await evaluate(`(() => {
      const r = document.getElementById('resetBtn').getBoundingClientRect()
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
    })()`)
    await click(resetBox.x, resetBox.y)
    await sleep(600)
    report.afterReset = {
      speed: await labGet('preset.speed'),
      motion: await measureMotion('reset'),
    }

    /* -------------------- 5. 线条数滑杆 -> 真的重建了吗 -------------------- */
    const before = await artDebug()
    await dragSlider('preset.lines', 40)
    await sleep(900) // 等 main.js 的防抖重建
    const after = await artDebug()
    report.linesSlider = {
      requested: 40,
      value: await labGet('preset.lines'),
      linesBefore: before.lines,
      linesAfter: after.lines,
      // 滑杆是拖出来的，落点不可能精确；只要进了这段区间就说明真的生效了
      withinTolerance: Math.abs((await labGet('preset.lines')) - 40) <= 5,
    }

    /* -------------------- 6. 视口预设 -------------------- */
    const vpBox = await evaluate(`(() => {
      const b = [...document.querySelectorAll('#viewportRow button')].find((x) => x.dataset.view === '390x844')
      const r = b.getBoundingClientRect()
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
    })()`)
    await click(vpBox.x, vpBox.y)
    await sleep(1200)
    report.viewport = await evaluate(`(() => {
      const r = document.getElementById('frameWrap').getBoundingClientRect()
      const w = document.getElementById('frame').contentWindow
      return {
        wrap: { w: Math.round(r.width), h: Math.round(r.height) },
        innerWidth: w.innerWidth,
        labPreset: w.__flow.debug().presetName,
        narrowLines: w.__flow.debug().lines,
        active: [...document.querySelectorAll('#viewportRow button')].find((b) => b.classList.contains('on'))?.dataset.view,
      }
    })()`)
    await shoot('lab-04-phone')

    await evaluate(`(() => {
      const b = [...document.querySelectorAll('#viewportRow button')].find((x) => x.dataset.view === 'fit')
      b.click(); return true
    })()`)
    await sleep(900)

    /* -------------------- 7. 章节按钮 + 导入导出 -------------------- */
    const nextBox = await evaluate(`(() => {
      const r = document.getElementById('chapterNext').getBoundingClientRect()
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
    })()`)
    await click(nextBox.x, nextBox.y)
    await sleep(1400)
    report.chapter = await evaluate(`(() => {
      const w = document.getElementById('frame').contentWindow
      return {
        label: document.getElementById('chapterLabel').textContent,
        scrollProgress: w.__flow.debug().scrollProgress,
      }
    })()`)

    report.io = await evaluate(`(() => {
      document.getElementById('exportBtn').click()
      const text = document.getElementById('json').value
      let parsed = null
      try { parsed = JSON.parse(text) } catch (e) { return { ok: false, error: String(e) } }
      return {
        ok: true,
        bytes: text.length,
        presetKeys: Object.keys(parsed.preset).length,
        chapterCount: parsed.chapters.length,
        tuningKeys: Object.keys(parsed.tuning).length,
        speedInExport: parsed.preset.speed,
      }
    })()`)

    /* ------------------------------ 汇总 ------------------------------ */
    report.consoleErrors = recorder.consoleMessages.filter((m) => m.level === 'error')
    report.exceptions = recorder.exceptions
    report.failedRequests = recorder.failedRequests

    const zero = report.speedZero.motion.changedPixels
    const sixty = report.speedSixty.motion.changedPixels
    const resetMotion = report.afterReset.motion.changedPixels

    report.summary = {
      '面板按分组生成了滑杆': report.panel.controls >= 5 && report.panel.rangeInputs === report.panel.controls,
      '分组选项卡齐全': report.panel.tabs.length >= 6 && report.panel.tabs.length === report.spec.groups.length,
      '实时指标有数据': report.panel.metricsRows >= 10,
      'speed 滑杆真的改到了 0': report.speedZero.value === 0,
      'speed=0 背景静止': zero >= 0 && zero < 0.02,
      'speed=60 背景明显在动': sixty > zero * 4 && sixty > 0.08,
      '恢复默认回到代码里的默认值':
        Math.abs(report.afterReset.speed - report.spec.speedItem.defaultValue) < 0.01,
      '恢复默认后恢复运动': resetMotion > 0.08,
      '线条数滑杆真的重建': report.linesSlider.linesAfter !== 94 && report.linesSlider.withinTolerance,
      '视口预设生效（390×844）': report.viewport.wrap.w === 390 && report.viewport.innerWidth === 390,
      '窄视口切到 narrow 预设': report.viewport.labPreset === 'narrow',
      '章节按钮滚动成功': report.chapter.scrollProgress > 0.4,
      '导出 JSON 可用': report.io.ok && report.io.presetKeys > 5 && report.io.chapterCount === 3,
      '无控制台错误': report.consoleErrors.length === 0 && report.exceptions.length === 0,
    }

    writeFileSync(
      path.join(ARTIFACTS, 'lab-verify-report.json'),
      `${JSON.stringify(report, null, 2)}\n`,
      'utf8',
    )

    console.log('\n================ 调参台验证 ================')
    console.log(JSON.stringify(report.summary, null, 2))
    console.log('\n运动对比:')
    console.log('  speed=0  ', JSON.stringify(report.speedZero.motion))
    console.log('  speed=60 ', JSON.stringify(report.speedSixty.motion))
    console.log('  reset    ', JSON.stringify(report.afterReset.motion))
    console.log('\n控制台错误 :', report.consoleErrors.length)
    console.log('未捕获异常 :', report.exceptions.length)
    if (report.exceptions.length) console.log(JSON.stringify(report.exceptions, null, 2))
    console.log('============================================')
  } finally {
    await browser.close()
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('[lab] 失败:', error)
    process.exit(1)
  })
