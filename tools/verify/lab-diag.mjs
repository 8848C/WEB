/** 一次性诊断：滑杆的坐标上到底是什么元素 */
import path from 'node:path'
import { makeHelpers, openBrowser, sleep } from './cdp.mjs'

const ROOT = path.resolve(import.meta.dirname, '..', '..')

const browser = await openBrowser({ port: 9342, profileDir: path.join(ROOT, '.tmp', 'chrome-diag') })
const { evaluate, setViewport, navigate } = makeHelpers(browser.send)

try {
  await setViewport(1700, 1000)
  await navigate('http://127.0.0.1:5173/lab.html', 2800)

  const info = await evaluate(`(() => {
    const out = {}
    const panel = document.getElementById('panel')
    const pr = panel.getBoundingClientRect()
    out.panel = { top: pr.top, bottom: pr.bottom, height: pr.height, width: pr.width }
    const scroll = document.getElementById('scroll')
    const sr = scroll.getBoundingClientRect()
    out.scroll = { top: sr.top, bottom: sr.bottom, height: sr.height, scrollH: scroll.scrollHeight }
    out.viewportH = innerHeight
    out.activeTab = document.querySelector('.tab.on')?.textContent

    const ctl = [...document.querySelectorAll('.ctl')].find(
      (c) => c.querySelector('.ctl__path')?.textContent === 'preset.speed',
    )
    out.foundCtl = Boolean(ctl)
    if (!ctl) return out
    const r = ctl.querySelector('input[type=range]').getBoundingClientRect()
    out.slider = { left: r.left, right: r.right, top: r.top, bottom: r.bottom, w: r.width, h: r.height }
    const cx = Math.round(r.left + r.width / 2)
    const cy = Math.round(r.top + r.height / 2)
    const hit = document.elementFromPoint(cx, cy)
    out.probe = { cx, cy, hitTag: hit?.tagName, hitClass: hit?.className, hitType: hit?.type }
    return out
  })()`)

  console.log(JSON.stringify(info, null, 2))

  // 直接派发一次原生鼠标事件看有没有反应
  const before = await evaluate(`document.getElementById('frame').contentWindow.__flow.lab.get('preset.speed')`)
  const { x, y } = { x: Math.round(info.slider.left + info.slider.w * 0.7), y: Math.round(info.slider.top + info.slider.h / 2) }
  await browser.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 })
  await browser.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 })
  await sleep(500)
  const after = await evaluate(`document.getElementById('frame').contentWindow.__flow.lab.get('preset.speed')`)
  console.log(`\n点击 (${x}, ${y})  ->  speed ${before} -> ${after}`)
} finally {
  await browser.close()
}
