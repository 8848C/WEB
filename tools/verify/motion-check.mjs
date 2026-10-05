/**
 * 流动感验收
 *
 * 验收标准是「用户第一次打开，盯 1~2 秒就能明显判断这些线正在流动」。
 * 这句话必须能测，所以量三件事：
 *
 *   1. 瞬时流速 —— 全分辨率小区块 + **短窗口**（100ms）二维互相关。
 *      为什么必须短：线条间距只有 11.5px，图案是准周期的，
 *      位移一旦超过半个间距，互相关就会锁到错误周期上（长窗口实测能给出
 *      83px/s 这种明显假匹配）。100ms 对应的位移约 4px，无歧义。
 *   2. 整体漂移 —— 在画面四处分别测瞬时速度，**取矢量和**。
 *      纯环流的速度和会互相抵消，只有真正「整体从一侧漂到另一侧」才留下净矢量。
 *   3. 观感变化量 —— 1/2/3 秒的帧间变化像素占比。
 *      注意这个量**不是**随时间单调递增的：图案准周期，墨线走过整数倍间距后
 *      画面会重新变得相似。所以只把 1 秒那一档当门槛用。
 *
 * 同时读 __flow.debug() 的 animation / measuredSpeed / targetSpeed / frames，
 * 确认动画确实在持续跑、实测流速和配置目标对得上。
 *
 * 用法：node tools/verify/motion-check.mjs
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { createRecorder, makeHelpers, openBrowser, sleep } from './cdp.mjs'

const TARGET = process.argv[2] ?? 'http://127.0.0.1:5173/index.html'
const PROJECT_ROOT = path.resolve(import.meta.dirname, '..', '..')

const PATCHES = [
  [0.55, 0.08],
  [0.55, 0.55],
  [0.2, 0.72],
  [0.2, 0.2],
]

/** 瞬时流速 + 净漂移：四处区块，短窗口，矢量平均 */
const velocityProbe = (ms) => `(async () => {
  const c = document.getElementById('flow')
  const PW = 260
  const PH = 220
  const tmp = document.createElement('canvas')
  tmp.width = PW
  tmp.height = PH
  const g = tmp.getContext('2d', { willReadFrequently: true })
  const spots = ${JSON.stringify(PATCHES)}

  const grab = (ox, oy) => {
    g.clearRect(0, 0, PW, PH)
    g.drawImage(c, ox, oy, PW, PH, 0, 0, PW, PH)
    const d = g.getImageData(0, 0, PW, PH).data
    const out = new Float32Array(PW * PH)
    for (let i = 0, j = 0; i < d.length; i += 4, j += 1) out[j] = d[i + 3]
    return out
  }
  const at = (p) => grab(Math.round(c.width * p[0]), Math.round(c.height * p[1]))

  const A = spots.map(at)
  await new Promise((r) => setTimeout(r, ${ms}))
  const B = spots.map(at)

  const S = 5 // 搜索半径必须 **小于半个线距**(5.75px)，否则准周期图案会混叠
  const scoreAt = (a, b, dx, dy) => {
    let sum = 0
    let n = 0
    for (let y = S; y < PH - S; y += 2) {
      const ra = y * PW
      const rb = (y + dy) * PW
      for (let x = S; x < PW - S; x += 2) {
        const d = a[ra + x] - b[rb + x + dx]
        sum += d * d
        n += 1
      }
    }
    return n ? sum / n : Infinity
  }

  const locals = []
  for (let k = 0; k < spots.length; k += 1) {
    let best = { dx: 0, dy: 0, score: Infinity }
    for (let dy = -S; dy <= S; dy += 1) {
      for (let dx = -S; dx <= S; dx += 1) {
        const s = scoreAt(A[k], B[k], dx, dy)
        if (s < best.score) best = { dx: dx, dy: dy, score: s }
      }
    }
    const zero = scoreAt(A[k], B[k], 0, 0)

    /*
     * 亚像素精修：整数像素在 150ms 窗口下就是 6.7px/s 的量化台阶，
     * 实测能测出 62.5 / 55.9 这种台阶值。用最优邻域的 SSD 做抛物线拟合，
     * 精度能到 ~0.1px（约 0.7px/s）。
     */
    const sC = best.score
    const sXm = scoreAt(best.dx - 1, best.dy)
    const sXp = scoreAt(best.dx + 1, best.dy)
    const sYm = scoreAt(best.dx, best.dy - 1)
    const sYp = scoreAt(best.dx, best.dy + 1)
    const denX = 2 * (sXm - 2 * sC + sXp)
    const denY = 2 * (sYm - 2 * sC + sYp)
    const subX = denX > 1e-9 ? best.dx + (sXm - sXp) / denX : best.dx
    const subY = denY > 1e-9 ? best.dy + (sYm - sYp) / denY : best.dy

    locals.push({ dx: subX, dy: subY, better: best.score < zero * 0.9 })
  }

  const dt = ${ms} / 1000
  const vels = locals.map((l) => ({ vx: l.dx / dt, vy: l.dy / dt, ok: l.better }))
  const good = vels.filter((v) => v.ok)
  const n = Math.max(1, good.length)
  const meanX = good.reduce((s, v) => s + v.vx, 0) / n
  const meanY = good.reduce((s, v) => s + v.vy, 0) / n

  // 交叉验证：同时读该点的**场速度真值**。
  // 「互相关测出来慢」和「那片区域真的是滞止区」是两回事，只有对着真值才能分开。
  const truth = spots.map((p) => {
    const v = window.__flow.sample(c.width * p[0] + 130, c.height * p[1] + 110)
    return +Math.hypot(v.x, v.y).toFixed(1)
  })

  return {
    windowMs: ${ms},
    resolved: good.length,
    of: vels.length,
    truthSpeeds: truth,
    locals: vels.map((v) => ({ vx: +v.vx.toFixed(1), vy: +v.vy.toFixed(1), ok: v.ok })),
    localSpeeds: vels.map((v) => +Math.hypot(v.vx, v.vy).toFixed(1)),
    drift: {
      x: +meanX.toFixed(1),
      y: +meanY.toFixed(1),
      mag: +Math.hypot(meanX, meanY).toFixed(1),
    },
  }
})()`

/** 帧间变化像素占比（全分辨率区块，避不开的准周期效应见文件头注释） */
const changeProbe = (ms) => `(async () => {
  const c = document.getElementById('flow')
  const PW = 500
  const PH = 340
  const tmp = document.createElement('canvas')
  tmp.width = PW
  tmp.height = PH
  const g = tmp.getContext('2d', { willReadFrequently: true })
  const ox = Math.max(0, Math.round(c.width * 0.5))
  const oy = Math.max(0, Math.round(c.height * 0.2))
  const grab = () => {
    g.clearRect(0, 0, PW, PH)
    g.drawImage(c, ox, oy, PW, PH, 0, 0, PW, PH)
    const d = g.getImageData(0, 0, PW, PH).data
    const out = new Float32Array(PW * PH)
    for (let i = 0, j = 0; i < d.length; i += 4, j += 1) out[j] = d[i + 3]
    return out
  }
  const a = grab()
  await new Promise((r) => setTimeout(r, ${ms}))
  const b = grab()
  let changed = 0
  for (let i = 0; i < a.length; i += 1) if (Math.abs(a[i] - b[i]) > 2) changed += 1
  return { windowMs: ${ms}, changedPixels: Number((changed / a.length).toFixed(4)) }
})()`

async function main() {
  const browser = await openBrowser({
    port: 9344,
    profileDir: path.join(PROJECT_ROOT, '.tmp', 'chrome-motion'),
  })
  const { send } = browser
  const recorder = createRecorder(browser.cdp)
  const { evaluate, setViewport, setMotion, navigate } = makeHelpers(send)

  mkdirSync(path.join(PROJECT_ROOT, 'artifacts'), { recursive: true })

  const report = {}

  try {
    /* ------------------ 正常模式：必须真的在动 ------------------ */
    await setMotion('no-preference')
    await setViewport(1600, 900)
    await navigate(TARGET, 3500)
    await sleep(2500) // 等闭环把实测流速收敛到目标

    report.animation = await evaluate(`window.__flow.debug()`)

    report.velocityA = await evaluate(velocityProbe(60))
    await sleep(400)
    report.velocityB = await evaluate(velocityProbe(60))

    report.changes = []
    for (const ms of [1000, 2000, 3000]) report.changes.push(await evaluate(changeProbe(ms)))

    /*
     * 固定 1 秒的变化量受「时间混叠」影响很大：墨线走过的距离除以线距(11.5px)
     * 的小数部分，决定了两帧有多像。同一份代码实测能跳出 14%~26%。
     * 取邻近三个窗口的均值，把这个相位依赖平均掉。
     */
    const near = []
    for (const ms of [880, 1000, 1120]) near.push(await evaluate(changeProbe(ms)))
    report.change1s = {
      samples: near.map((n) => n.changedPixels),
      mean: Number((near.reduce((s, n) => s + n.changedPixels, 0) / near.length).toFixed(4)),
    }

    /* ------------------ 持续性：不能动一下就停 ------------------ */
    const f0 = await evaluate(`window.__flow.debug()`)
    await sleep(5000)
    const f1 = await evaluate(`window.__flow.debug()`)
    report.sustained = {
      framesAdded: f1.frames - f0.frames,
      speedBefore: f0.measuredSpeed,
      speedAfter: f1.measuredSpeed,
      state: f1.animation,
      lastFrameAgoMs: f1.lastFrameAgoMs,
    }

    /* ---------- 呼吸：幅度要在 3%~7%，且瞬时值不越界 ---------- */
    const breathSamples = []
    for (let i = 0; i < 20; i += 1) {
      breathSamples.push(await evaluate(`window.__flow.debug().breath`))
      await sleep(700)
    }
    report.breath = {
      amount: report.animation.breathAmount,
      min: Number(Math.min(...breathSamples).toFixed(4)),
      max: Number(Math.max(...breathSamples).toFixed(4)),
      samples: breathSamples.length,
    }

    /* ---------- reduced motion：必须是真的静止 ---------- */
    await setMotion('reduce')
    await navigate(TARGET, 2500)
    report.reducedMotion = {
      debug: await evaluate(`window.__flow.debug()`),
      change: await evaluate(changeProbe(2000)),
    }

    /* ----------------------------- 判定 ----------------------------- */
    const vA = report.velocityA
    const vB = report.velocityB
    const one = report.changes[0]
    const amount = report.animation.breathAmount
    const lo = 1 - amount - 0.002
    const hi = 1 + amount + 0.002

    // 交叉验证：互相关测出来的慢点，场速度真值是不是也慢

    report.summary = {
      '动画状态 = running': report.animation.animation === 'running',
      '实测流速落在 36~52':
        report.animation.measuredSpeed >= 36 && report.animation.measuredSpeed <= 52,
      '实测流速与目标差 < 6px/s':
        Math.abs(report.animation.measuredSpeed - report.animation.targetSpeed) < 6,

      '至少 3/4 区块被判定为「在动」': vA.resolved >= 3 && vB.resolved >= 3,

      '整体漂移（场速度矢量均值）> 12px/s': report.animation.drift.mag > 12,
      '1 秒内变化像素（三窗口均值）> 8%': report.change1s.mean > 0.08,
      '每线速度差 ±0.28（即 0.72~1.28）': Math.abs(report.animation.speedSpread - 0.28) < 0.001,
      '持续 5 秒仍在跑': report.sustained.state === 'running' && report.sustained.framesAdded > 250,
      '呼吸幅度配置在 3%~7%': amount >= 0.03 && amount <= 0.07,
      '呼吸瞬时值始终在幅度带内': report.breath.min >= lo && report.breath.max <= hi,
      'reduced motion 状态正确': report.reducedMotion.debug.animation === 'static:reduced-motion',
      'reduced motion 确实静止': report.reducedMotion.change.changedPixels < 0.01,
      '无控制台错误': recorder.consoleMessages.filter((m) => m.level === 'error').length === 0,
    }

    writeFileSync(
      path.join(PROJECT_ROOT, 'artifacts', 'motion-report.json'),
      `${JSON.stringify(report, null, 2)}\n`,
      'utf8',
    )

    console.log('\n================ 流动感验收 ================')
    console.log(JSON.stringify(report.summary, null, 2))
    console.log('\n瞬时流速（' + vA.windowMs + 'ms 窗口，四处区块）:')
    for (const [name, v] of [['A', vA], ['B', vB]]) {
      console.log(
        `  ${name}: 解出 ${v.resolved}/${v.of} 处  ` +
          `互相关 ${v.localSpeeds.join(' / ')} px/s  ` +
          `场真值 ${v.truthSpeeds.join(' / ')} px/s  ` +
          `净漂移 ${v.drift.mag} px/s (${v.drift.x}, ${v.drift.y})`,
      )
    }
    console.log('\n观感变化量（全分辨率 500x340）:')
    for (const c of report.changes) {
      console.log(`  ${String(c.windowMs).padStart(4)}ms  ${(c.changedPixels * 100).toFixed(1)}%`)
    }
    console.log(
      '\n流速: 实测',
      report.animation.measuredSpeed,
      '目标',
      report.animation.targetSpeed,
      'trim',
      report.animation.speedTrim,
    )
    console.log('场整体漂移:', JSON.stringify(report.animation.drift))
    console.log('持续:', JSON.stringify(report.sustained))
    console.log('呼吸:', JSON.stringify(report.breath))
    console.log('reduced motion:', JSON.stringify(report.reducedMotion.change))
    console.log('异常 :', recorder.exceptions.length)
    console.log('============================================')
    if (recorder.exceptions.length) console.log(JSON.stringify(recorder.exceptions, null, 2))
  } finally {
    await browser.close()
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('[motion] 失败:', error)
    process.exit(1)
  })
