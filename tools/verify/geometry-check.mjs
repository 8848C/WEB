/**
 * 流线几何随时间的退化体检。
 *
 * 全程不做任何输入，只在几个时间点读 __flow.geometry()。
 * 如果「挤成团的线」随时间单调增长，就说明张力松弛在持续收缩曲线，
 * 点会在高曲率处堆积 —— 渲染出来就是那些深色硬块。
 *
 * 用法：node tools/verify/geometry-check.mjs [url]
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { makeHelpers, openBrowser, sleep } from './cdp.mjs'

const TARGET = process.argv[2] ?? 'http://127.0.0.1:5173/index.html'
const PROJECT_ROOT = path.resolve(import.meta.dirname, '..', '..')
const ARTIFACTS = path.join(PROJECT_ROOT, 'artifacts')
const MARKS = [3, 8, 15, 25, 40, 60]

async function main() {
  mkdirSync(ARTIFACTS, { recursive: true })

  const browser = await openBrowser({
    port: 9339,
    profileDir: path.join(PROJECT_ROOT, '.tmp', 'chrome-geom'),
  })
  const { send } = browser
  const { evaluate, setViewport, setMotion, navigate } = makeHelpers(send)

  const shoot = async (name) => {
    const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
    writeFileSync(path.join(ARTIFACTS, `${name}.png`), Buffer.from(data, 'base64'))
    console.log(`[geom] 截图 -> artifacts/${name}.png`)
  }

  try {
    await setMotion('no-preference')
    await setViewport(1600, 900)
    await navigate(TARGET, 2000)

    const started = Date.now()
    const rows = []

    for (const mark of MARKS) {
      const wait = mark * 1000 - (Date.now() - started)
      if (wait > 0) await sleep(wait)
      const g = await evaluate('window.__flow.geometry()')
      rows.push({ t: mark, ...g })
      if (mark === 3) await shoot('geom-early-3s')
    }
    await shoot('geom-late-60s')

    console.log('\n=== 流线几何随时间 ===')
    const heads = [
      't(s)',
      'drawn',
      'cells',
      'worst',
      'worstMin',
      'medianMin',
      'crushed',
      'meanLen',
      'medianTurn',
      'maxTurn',
      'minR',
      'nbDir',
    ]
    const widths = [5, 6, 6, 6, 9, 10, 8, 9, 11, 9, 7, 7]
    console.log(heads.map((h, i) => h.padEnd(widths[i])).join(''))
    for (const r of rows) {
      console.log(
        [
          String(r.t),
          String(r.drawn),
          String(r.occupiedCells),
          String(r.worstBucket),
          String(r.worstMinSegment),
          String(r.medianOfLocalMins),
          String(r.crushedLines),
          String(r.meanLength),
          String(r.medianTurnDeg),
          String(r.maxTurnDeg),
          String(r.minRadius),
          String(r.neighborDirDeg),
        ]
          .map((v, i) => v.padEnd(widths[i]))
          .join(''),
      )
    }
    console.log(`\n标称 spacing = ${rows[0].nominalSpacing}px，总线条 ${rows[0].totalLines} 根`)
    console.log('worst=最挤的格子有几根  crushed=点距被压到标称 40% 以下的线数')
    console.log('medianTurn/maxTurn=每段折角(度)  minR=最小弯曲半径(px)  nbDir=相邻线平均方向差(度)')
    console.log('毛发感判据：medianTurn 应 < 2.5°，maxTurn 应 < 9°，nbDir 应 < 12°')

    // 凌乱度判定：曲率与方向差是「头发 vs 水」的直接指标
    const lastQ = rows[rows.length - 1]
    const hairCheck = {
      '中位折角 < 2.5°': lastQ.medianTurnDeg < 2.5,
      '最大折角 < 9°': lastQ.maxTurnDeg < 9,
      '最小弯曲半径 > 70px': lastQ.minRadius > 70,
      '相邻线平均方向差 < 12°': lastQ.neighborDirDeg < 12,
    }
    console.log('\n凌乱度：')
    for (const [k, v] of Object.entries(hairCheck)) console.log(`  ${v ? '✓' : '✗'} ${k}`)

    // 判定基准不是 t=3s 的初始值 —— 初始撒点用的是抖动网格，比随机更均匀，
    // 无散度流会把这份「人为的均匀」剪切掉，格子数必然下降一点，那不算退化。
    // 真正的基准是「均匀随机的期望占用格数」：
    //   E = bins * (1 - (1 - 1/bins)^n)
    const binsPerRow = Math.ceil(1600 / 120)
    const binsPerCol = Math.ceil(900 / 120)
    const bins = binsPerRow * binsPerCol
    const n = rows[0].totalLines
    const poisson = Math.round(bins * (1 - (1 - 1 / bins) ** n))

    const last = rows[rows.length - 1]
    const stable =
      Object.values(hairCheck).every(Boolean) &&
      last.crushedRatio < 0.05 &&
      last.drawn >= rows[0].drawn * 0.9 &&
      last.occupiedCells >= poisson * 0.78 &&
      last.medianOfLocalMins > rows[0].nominalSpacing * 0.85

    console.log(`均匀随机期望占用格数 ≈ ${poisson}（${bins} 格 / ${n} 根）`)
    console.log('判定：', stable ? '稳定（已收敛到均匀分布，无河道化、无点堆积）' : '仍在退化')
  } finally {
    await browser.close()
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('[geom] 失败:', error)
    process.exit(1)
  })
