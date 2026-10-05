/**
 * 分离测量：场的固有曲率 vs 流线的实际曲率。
 *
 * 沿一条流线以极小步长（1px）积分，量「每走 11.5px 方向转多少度」——
 * 这就是场本身的固有曲率。如果它很小而线条的实际折角很大，
 * 那拐折就来自积分/重采样，而不是场。
 */

import path from 'node:path'
import { makeHelpers, openBrowser, sleep } from './cdp.mjs'

const ROOT = path.resolve(import.meta.dirname, '..', '..')
const browser = await openBrowser({ port: 9354, profileDir: path.join(ROOT, '.tmp', 'chrome-field') })
const { evaluate, setViewport, setMotion, navigate } = makeHelpers(browser.send)

try {
  await setMotion('no-preference')
  await setViewport(1600, 900)
  await navigate('http://127.0.0.1:5173/index.html', 4000)
  await sleep(1500)

  const out = await evaluate(`(() => {
    const f = window.__flow
    const d = f.debug()
    const W = d.canvas.w
    const H = d.canvas.h
    const step = 1          // 积分步长
    const probe = 11.5      // 每走这么远，量一次方向

    // 从若干个起点沿场积分，记录方向变化
    const starts = []
    for (let i = 1; i <= 5; i += 1) {
      for (let j = 1; j <= 4; j += 1) {
        starts.push([(W * i) / 6, (H * j) / 5])
      }
    }

    const perStep = []      // 每 11.5px 的折角（度）
    for (const [sx, sy] of starts) {
      let x = sx
      let y = sy
      let prevA = null
      let acc = 0
      for (let n = 0; n < 1400; n += 1) {
        const v = f.sample(x, y)
        const len = Math.hypot(v.x, v.y)
        if (len < 1e-6) break
        const a = Math.atan2(v.y, v.x)
        if (prevA !== null) {
          let diff = Math.abs(a - prevA)
          if (diff > Math.PI) diff = 2 * Math.PI - diff
          acc += diff
        }
        prevA = a
        x += (v.x / len) * step
        y += (v.y / len) * step
        if (x < -200 || x > W + 200 || y < -200 || y > H + 200) break
        // 每走满 probe 距离结算一次
        if ((n + 1) % Math.round(probe / step) === 0) {
          perStep.push((acc * 180) / Math.PI)
          acc = 0
        }
      }
    }
    perStep.sort((p, q) => p - q)
    const at = (q) => Number((perStep[Math.floor(perStep.length * q)] ?? 0).toFixed(2))
    return {
      采样数: perStep.length,
      '场固有折角 中位(度/11.5px)': at(0.5),
      '场固有折角 p90': at(0.9),
      '场固有折角 p99': at(0.99),
      '场固有折角 最大': Number((perStep[perStep.length - 1] ?? 0).toFixed(2)),
      等效最小半径px: perStep[perStep.length - 1]
        ? Number((11.5 / ((perStep[perStep.length - 1] * Math.PI) / 180)).toFixed(0))
        : 99999,
      bias: d.params.bias,
    }
  })()`)

  const worst = await evaluate('window.__flow.worstTurn()')
  console.log('\n=== 最坏折角的现场 ===')
  console.log(JSON.stringify(worst, null, 2))
  console.log('\n=== 场本身的固有曲率 ===')
  for (const [k, v] of Object.entries(out)) console.log(`  ${k.padEnd(28)} ${v}`)
  console.log('\n线条实际: maxTurn 40~93°/段 (关掉加压时)')
} finally {
  await browser.close()
}
process.exit(0)
