/**
 * 线条与场的对齐度。
 *
 * 如果线条是流线，那么「线上每一段的切线方向」应该等于「该点的场方向」。
 * 偏差大 = 线条没有贴着场走，管线上有问题（而不是场的问题）。
 */

import path from 'node:path'
import { makeHelpers, openBrowser, sleep } from './cdp.mjs'

const ROOT = path.resolve(import.meta.dirname, '..', '..')
const browser = await openBrowser({ port: 9356, profileDir: path.join(ROOT, '.tmp', 'chrome-align') })
const { evaluate, setViewport, setMotion, navigate } = makeHelpers(browser.send)

try {
  await setMotion('no-preference')
  await setViewport(1600, 900)
  await navigate('http://127.0.0.1:5173/home/index.html', 4000)
  await sleep(2500)

  // 必须先冻结动画：边跑边读会读到不同帧混在一起的撕裂状态
  await evaluate('window.__flow.lab.pause()')
  await sleep(120)

  const out = await evaluate(`(() => {
    const f = window.__flow
    const g = f.geometry()
    const d = f.debug()
    const M = d.points
    const diffs = []
    const byPos = { head: [], mid: [], tail: [] }
    let lines = 0
    let slow = 0
    // 从 __flow 拿不到 lines 数组，改用 worstTurn 同款的采样方式：
    // 这里用内部暴露的 debug 不够，所以直接读 window 上的私有钩子
    const L = f.lines
    if (!L) return { error: 'no __flowLines hook' }
    for (const line of L) {
      if (line.alpha < 0.05) continue
      lines += 1
      for (let k = 0; k < M - 1; k += 1) {
        const ax = line.xs[k]
        const ay = line.ys[k]
        const bx = line.xs[k + 1]
        const by = line.ys[k + 1]
        const segA = Math.atan2(by - ay, bx - ax)
        const v = f.sample((ax + bx) / 2, (ay + by) / 2)
        const mag = Math.hypot(v.x, v.y)
        // 只统计场速度足够大的地方：滞止点附近方向本身是病态的
        // （矢量穿过原点时可以瞬间翻转 180°），把那些算进来只会得到假异常
        if (mag < 15) { slow += 1; continue }
        const fA = Math.atan2(v.y, v.x)
        let diff = Math.abs(segA - fA)
        if (diff > Math.PI) diff = 2 * Math.PI - diff
        const deg = (diff * 180) / Math.PI
        diffs.push(deg)
        const t = k / (M - 1)
        if (t < 0.15) byPos.head.push(deg)
        else if (t > 0.85) byPos.tail.push(deg)
        else byPos.mid.push(deg)
      }
    }
    // 顺便把最脱轨的那一段的现场抓出来
    let worst = null
    for (const line of L) {
      if (line.alpha < 0.05) continue
      for (let k = 0; k < M - 1; k += 1) {
        const ax = line.xs[k], ay = line.ys[k], bx = line.xs[k + 1], by = line.ys[k + 1]
        const segA = Math.atan2(by - ay, bx - ax)
        const v = f.sample((ax + bx) / 2, (ay + by) / 2)
        const mag = Math.hypot(v.x, v.y)
        if (mag < 1e-6) continue
        const fA = Math.atan2(v.y, v.x)
        let diff = Math.abs(segA - fA)
        if (diff > Math.PI) diff = 2 * Math.PI - diff
        const deg = (diff * 180) / Math.PI
        if (!worst || deg > worst.deg) {
          const from = Math.max(0, k - 3), to = Math.min(M - 1, k + 4)
          const pts = []
          for (let q = from; q <= to; q += 1) pts.push([+line.xs[q].toFixed(1), +line.ys[q].toFixed(1)])
          worst = { deg: +deg.toFixed(1), k, segLen: +Math.hypot(bx - ax, by - ay).toFixed(2),
                    segDir: +((segA * 180) / Math.PI).toFixed(1), fieldDir: +((fA * 180) / Math.PI).toFixed(1),
                    fieldMag: +mag.toFixed(1), fieldMagAtPts: pts.map((p) => +Math.hypot(f.sample(p[0], p[1]).x, f.sample(p[0], p[1]).y).toFixed(1)),
                    pts }
        }
      }
    }
    const stat = (arr) => {
      if (!arr.length) return null
      const s = [...arr].sort((p, q) => p - q)
      return {
        n: s.length,
        med: Number(s[s.length >> 1].toFixed(2)),
        p90: Number(s[Math.floor(s.length * 0.9)].toFixed(2)),
        max: Number(s[s.length - 1].toFixed(2)),
      }
    }
    return {
      最脱轨段: worst,
      线条数: lines,
      被跳过的低速点: slow,
      总体: stat(diffs),
      头部: stat(byPos.head),
      中段: stat(byPos.mid),
      尾部: stat(byPos.tail),
    }
  })()`)

  await evaluate('window.__flow.lab.resume()')

  console.log('\n=== 线条切线方向 vs 场方向 的夹角（度，0 = 完全贴合）===')
  console.log(JSON.stringify(out, null, 2))
} finally {
  await browser.close()
}
process.exit(0)
