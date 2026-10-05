/**
 * 「减少动态效果」场景验证
 *
 * 背景：Windows 的「设置 → 辅助功能 → 视觉效果 → 动画效果」关掉之后，
 * Chrome 会报 prefers-reduced-motion: reduce，作品按无障碍规范进静帧。
 * 这是**正确行为**，但用户会看到一片不动的画面而且不知道原因 ——
 * 调参台里滑杆怎么拖都没反应，看起来像坏了。
 *
 * 所以这里验证三件事：
 *   1. 系统报 reduce 时，页面确实进静帧，而且**给出真实读数**（不是全 0）
 *   2. ?motion=full 能强制动态，且真的有运动
 *   3. 调参台的「强制动态 / 跟随系统」开关能来回切
 *
 * 用法：node tools/verify/motion-override-check.mjs
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { makeHelpers, openBrowser, sleep } from './cdp.mjs'

const BASE = 'http://127.0.0.1:5173/home'
const ROOT = path.resolve(import.meta.dirname, '..', '..')
const ARTIFACTS = path.join(ROOT, 'artifacts')

const FINGERPRINT = `(() => {
  const c = document.getElementById('flow')
  if (!c || !c.width) return null
  const W = 160, H = 90
  const p = document.createElement('canvas')
  p.width = W; p.height = H
  const g = p.getContext('2d', { willReadFrequently: true })
  g.drawImage(c, 0, 0, W, H)
  const d = g.getImageData(0, 0, W, H).data
  const out = new Array(W * H)
  for (let i = 0, j = 0; i < d.length; i += 4, j += 1) out[j] = d[i + 3]
  return out
})()`

function compare(a, b) {
  if (!a || !b) return -1
  let moved = 0
  for (let i = 0; i < a.length; i += 1) if (Math.abs(a[i] - b[i]) > 2) moved += 1
  return Number((moved / a.length).toFixed(4))
}

async function main() {
  mkdirSync(ARTIFACTS, { recursive: true })

  const browser = await openBrowser({
    port: 9350,
    profileDir: path.join(ROOT, '.tmp', 'chrome-override'),
  })
  const { send } = browser
  const { evaluate, setViewport, setMotion, navigate, click } = makeHelpers(send)

  const shoot = async (name) => {
    const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
    writeFileSync(path.join(ARTIFACTS, `${name}.png`), Buffer.from(data, 'base64'))
  }

  const report = {}

  try {
    await setViewport(1600, 900)
    // 先清掉可能残留的强制动态开关
    await navigate(`${BASE}/index.html`, 1500)
    await evaluate(`localStorage.removeItem('flow.motionOverride'); true`)

    /* ---------- 1. 系统报 reduce（模拟用户现场） ---------- */
    await setMotion('reduce')
    await navigate(`${BASE}/index.html`, 3200)
    const a1 = await evaluate(FINGERPRINT)
    await sleep(2000)
    const b1 = await evaluate(FINGERPRINT)
    report.systemReduce = {
      debug: await evaluate(`window.__flow.debug()`),
      changedPixels: compare(a1, b1),
    }

    /* ---------- 2. 调参台在静帧下的提示与开关 ---------- */
    await navigate(`${BASE}/lab.html`, 3000)
    report.labNoticeBefore = await evaluate(`({
      visible: !document.getElementById('motionNotice').hidden,
      forcedStyle: document.getElementById('motionNotice').classList.contains('is-forced'),
      text: document.getElementById('motionNoticeText').textContent.replace(/\\s+/g, ' ').trim().slice(0, 160),
      animation: document.getElementById('frame').contentWindow.__flow.debug().animation,
    })`)
    await shoot('override-01-lab-static')

    const forceBox = await evaluate(`(() => {
      const r = document.getElementById('forceMotion').getBoundingClientRect()
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
    })()`)
    await click(forceBox.x, forceBox.y)
    await sleep(2200)

    const labDebug = await evaluate(`document.getElementById('frame').contentWindow.__flow.debug()`)
    const a2 = await evaluate(`(() => {
      const w = document.getElementById('frame').contentWindow
      const c = w.document.getElementById('flow')
      const p = w.document.createElement('canvas')
      p.width = 160; p.height = 90
      const g = p.getContext('2d', { willReadFrequently: true })
      g.drawImage(c, 0, 0, 160, 90)
      const d = g.getImageData(0, 0, 160, 90).data
      const out = new Array(160 * 90)
      for (let i = 0, j = 0; i < d.length; i += 4, j += 1) out[j] = d[i + 3]
      return out
    })()`)
    await sleep(2000)
    const b2 = await evaluate(`(() => {
      const w = document.getElementById('frame').contentWindow
      const c = w.document.getElementById('flow')
      const p = w.document.createElement('canvas')
      p.width = 160; p.height = 90
      const g = p.getContext('2d', { willReadFrequently: true })
      g.drawImage(c, 0, 0, 160, 90)
      const d = g.getImageData(0, 0, 160, 90).data
      const out = new Array(160 * 90)
      for (let i = 0, j = 0; i < d.length; i += 4, j += 1) out[j] = d[i + 3]
      return out
    })()`)

    report.afterForce = {
      debug: labDebug,
      changedPixels: compare(a2, b2),
      notice: await evaluate(`({
        visible: !document.getElementById('motionNotice').hidden,
        forcedStyle: document.getElementById('motionNotice').classList.contains('is-forced'),
        text: document.getElementById('motionNoticeText').textContent.replace(/\\s+/g, ' ').trim().slice(0, 120),
      })`),
      stored: await evaluate(`localStorage.getItem('flow.motionOverride')`),
    }
    await shoot('override-02-lab-forced')

    /* ---------- 3. 回退到跟随系统 ---------- */
    const sysBox = await evaluate(`(() => {
      const r = document.getElementById('followSystem').getBoundingClientRect()
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
    })()`)
    await click(sysBox.x, sysBox.y)
    await sleep(1800)
    report.backToSystem = {
      debug: await evaluate(`document.getElementById('frame').contentWindow.__flow.debug()`),
      stored: await evaluate(`localStorage.getItem('flow.motionOverride')`),
    }

    /* ---------- 4. ?motion=full 直接进（不依赖 localStorage） ---------- */
    await evaluate(`localStorage.removeItem('flow.motionOverride'); true`)
    await navigate(`${BASE}/index.html?motion=full`, 3000)
    const a3 = await evaluate(FINGERPRINT)
    await sleep(2000)
    const b3 = await evaluate(FINGERPRINT)
    report.urlForce = {
      debug: await evaluate(`window.__flow.debug()`),
      changedPixels: compare(a3, b3),
    }

    /* ---------- 5. 正常环境不受影响 ---------- */
    await setMotion('no-preference')
    await navigate(`${BASE}/index.html`, 3000)
    report.normal = { debug: await evaluate(`window.__flow.debug()`) }

    /* ----------------------------- 判定 ----------------------------- */
    const s = report.systemReduce
    const f = report.afterForce
    const u = report.urlForce

    report.summary = {
      '系统报 reduce 时进静帧': s.debug.animation === 'static:reduced-motion' && s.changedPixels === 0,
      '静帧下仍给出真实流速（不是 0）': s.debug.measuredSpeed > 20,
      '静帧下速度归一是收敛值（不是 0.2）': s.debug.speedTrim > 0.4 && s.debug.speedTrim < 2.5,
      '静帧下线条数正确': s.debug.activeLines === s.debug.lines,
      '调参台显示了原因提示': report.labNoticeBefore.visible && !report.labNoticeBefore.forcedStyle,
      '提示文案点明了 Windows 设置位置': /辅助功能|Windows/.test(report.labNoticeBefore.text),
      '点「强制动态」后真的在动': f.debug.animation.startsWith('running') && f.changedPixels > 0.05,
      '强制动态后提示切换为已覆盖': f.notice.visible && f.notice.forcedStyle,
      '开关记进了 localStorage': f.stored === 'full',
      '「跟随系统」能切回静帧': report.backToSystem.debug.animation === 'static:reduced-motion',
      '跟随系统后清掉了 localStorage': report.backToSystem.stored === 'auto',
      '?motion=full 也能强制动态': u.debug.animation.startsWith('running') && u.changedPixels > 0.05,
      '正常环境（no-preference）不受影响': report.normal.debug.animation === 'running',
    }

    writeFileSync(
      path.join(ARTIFACTS, 'motion-override-report.json'),
      `${JSON.stringify(report, null, 2)}\n`,
      'utf8',
    )

    console.log('\n================ 减少动态效果场景 ================')
    console.log(JSON.stringify(report.summary, null, 2))
    console.log('\n系统 reduce 时:', JSON.stringify({
      animation: s.debug.animation,
      measuredSpeed: s.debug.measuredSpeed,
      speedTrim: s.debug.speedTrim,
      activeLines: `${s.debug.activeLines}/${s.debug.lines}`,
      changedPixels: s.changedPixels,
    }))
    console.log('强制动态后:', JSON.stringify({
      animation: f.debug.animation,
      measuredSpeed: f.debug.measuredSpeed,
      changedPixels: f.changedPixels,
    }))
    console.log('提示文案:', report.labNoticeBefore.text)
    console.log('==================================================')
  } finally {
    await browser.close()
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('[override] 失败:', error)
    process.exit(1)
  })
