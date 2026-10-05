/**
 * 证明「背景是不是静态的」
 *
 * 全程不派发任何输入事件（不移动鼠标、不点击、不滚动），
 * 每隔几秒把 canvas 降采样成 160×90 的 alpha 指纹，
 * 比较相邻两次的逐像素平均差。
 *
 *   · 正常模式   -> 差异应该明显 > 0（流线在持续平流，基场也在缓慢演化）
 *   · reduced motion -> 差异应该 ≈ 0（只出一帧静帧）
 *
 * 用法：node tools/verify/background-check.mjs [url]
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { makeHelpers, openBrowser, sleep } from './cdp.mjs'

const TARGET = process.argv[2] ?? 'http://127.0.0.1:5173/index.html'
const PROJECT_ROOT = path.resolve(import.meta.dirname, '..', '..')
const ARTIFACTS = path.join(PROJECT_ROOT, 'artifacts')

/** 把 canvas 缩成 160×90，取 alpha 通道当指纹 */
const FINGERPRINT = `(() => {
  const c = document.getElementById('flow')
  if (!c || !c.width) return null
  const w = 160
  const h = 90
  const p = document.createElement('canvas')
  p.width = w
  p.height = h
  const g = p.getContext('2d')
  g.drawImage(c, 0, 0, w, h)
  const d = g.getImageData(0, 0, w, h).data
  const out = new Array(w * h)
  for (let i = 0, j = 0; i < d.length; i += 4, j += 1) out[j] = d[i + 3]
  return out
})()`

function compare(a, b) {
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

  const browser = await openBrowser({ port: 9338, profileDir: path.join(PROJECT_ROOT, '.tmp', 'chrome-still') })
  const { send } = browser
  const { evaluate, setViewport, setMotion, navigate } = makeHelpers(send)

  const shoot = async (name) => {
    const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
    writeFileSync(path.join(ARTIFACTS, `${name}.png`), Buffer.from(data, 'base64'))
  }

  const report = {}

  try {
    /* ---------------- 正常模式：不做任何输入 ---------------- */
    await setMotion('no-preference')
    await setViewport(1600, 900)
    await navigate(TARGET, 3000)

    const t0 = await evaluate(FINGERPRINT)
    await shoot('still-a')
    await sleep(3000)
    const t1 = await evaluate(FINGERPRINT)
    await sleep(3000)
    const t2 = await evaluate(FINGERPRINT)
    await shoot('still-b')

    report.animated = {
      step1_0s_to_3s: compare(t0, t1),
      step2_3s_to_6s: compare(t1, t2),
      debug: await evaluate('window.__flow.debug()'),
    }

    /* ---------------- reduced motion：应完全静止 ---------------- */
    await setMotion('reduce')
    await navigate(TARGET, 2500)

    const r0 = await evaluate(FINGERPRINT)
    await sleep(4000)
    const r1 = await evaluate(FINGERPRINT)

    report.reducedMotion = {
      step_0s_to_4s: compare(r0, r1),
      debug: await evaluate('window.__flow.debug()'),
    }

    console.log('\n================ 背景是否在动 ================')
    console.log('正常模式（无任何输入）')
    console.log('  0s → 3s  :', JSON.stringify(report.animated.step1_0s_to_3s))
    console.log('  3s → 6s  :', JSON.stringify(report.animated.step2_3s_to_6s))
    console.log('  avgFrameMs:', report.animated.debug.avgFrameMs, ' quality:', report.animated.debug.quality)
    console.log('\nprefers-reduced-motion: reduce')
    console.log('  0s → 4s  :', JSON.stringify(report.reducedMotion.step_0s_to_4s))
    console.log('  avgFrameMs:', report.reducedMotion.debug.avgFrameMs)
    console.log('==============================================')
    console.log('对照图：artifacts/still-a.png 与 artifacts/still-b.png')
  } finally {
    await browser.close()
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('[still] 失败:', error)
    process.exit(1)
  })
