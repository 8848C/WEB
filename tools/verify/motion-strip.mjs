/**
 * 抓三帧（间隔 1.2 秒）拼成动感条，用来直观核对验收标准：
 * 「盯 1~2 秒就能明显判断这些线正在流动」。
 *
 * 用法：node tools/verify/motion-strip.mjs
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { makeHelpers, openBrowser, sleep } from './cdp.mjs'

const TARGET = process.argv[2] ?? 'http://127.0.0.1:5173/home/index.html'
const ROOT = path.resolve(import.meta.dirname, '..', '..')
const OUT = path.join(ROOT, 'artifacts')

const browser = await openBrowser({ port: 9346, profileDir: path.join(ROOT, '.tmp', 'chrome-strip') })
const { send } = browser
const { setViewport, setMotion, navigate } = makeHelpers(send)

try {
  mkdirSync(OUT, { recursive: true })
  await setMotion('no-preference')
  await setViewport(1600, 900)
  await navigate(TARGET, 4000)
  await sleep(1500)

  for (let i = 0; i < 3; i += 1) {
    const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
    const file = path.join(OUT, `strip-${i}.png`)
    writeFileSync(file, Buffer.from(data, 'base64'))
    console.log(`-> ${file}`)
    if (i < 2) await sleep(1200)
  }
} finally {
  await browser.close()
}

process.exit(0)
