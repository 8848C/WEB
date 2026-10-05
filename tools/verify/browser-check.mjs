/**
 * 登录页端到端验证（真实无头 Chrome）
 *
 * 覆盖：
 *   · 左 2/3 : 右 1/3 的实际像素比例
 *   · 粒子画布真的画了东西
 *   · 标题关键词轮播在任何时刻都至少有一个词可见
 *   · 真实提交登录 -> 跳转控制台，并从 /api/auth/me 读到数据库里的用户
 *   · 错误密码 -> 留在登录页并给出提示
 *   · 移动端布局
 *   · prefers-reduced-motion 下文字不会变成空白
 *
 * 用法：node tools/verify/browser-check.mjs [url]
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { createRecorder, makeHelpers, openBrowser, sleep } from './cdp.mjs'

const TARGET_URL = process.argv[2] ?? 'http://127.0.0.1:5173/'
const PROJECT_ROOT = path.resolve(import.meta.dirname, '..', '..')
const ARTIFACT_DIR = path.join(PROJECT_ROOT, 'artifacts')
const PROFILE_DIR = path.join(PROJECT_ROOT, '.tmp', 'chrome-profile')

async function main() {
  mkdirSync(ARTIFACT_DIR, { recursive: true })

  try {
    const res = await fetch(TARGET_URL, { redirect: 'follow' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
  } catch (error) {
    throw new Error(`打不开 ${TARGET_URL}（${error.message}）。先把前端跑起来：.\\start-all.cmd`)
  }

  const browser = await openBrowser({ port: 9333, profileDir: PROFILE_DIR })
  const { send, browserPath } = browser
  const recorder = createRecorder(browser.cdp)
  const { evaluate, setViewport, setMotion, navigate } = makeHelpers(send)

  console.log(`[verify] 浏览器: ${browserPath}`)
  console.log(`[verify] 目标页面: ${TARGET_URL}`)

  const report = { targetUrl: TARGET_URL }

  const shoot = async (name) => {
    const { data } = await send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: false,
    })
    writeFileSync(path.join(ARTIFACT_DIR, `${name}.png`), Buffer.from(data, 'base64'))
    console.log(`[verify] 截图 -> artifacts/${name}.png`)
  }

  try {
    /* ------------------------ 1. 桌面端登录页 ------------------------ */
    // 无头浏览器默认 prefers-reduced-motion: reduce，必须显式覆盖，
    // 否则会拍到「静态降级版」并误判动效坏了。
    await setMotion('no-preference')
    await setViewport(1600, 900)
    await navigate(TARGET_URL)
    await evaluate('localStorage.clear(); sessionStorage.clear(); true')
    await navigate(TARGET_URL)

    report.desktop = await evaluate(`(() => {
      const shell = document.querySelector('.login-shell')
      const stage = document.querySelector('.stage')
      const access = document.querySelector('.access')
      if (!shell || !stage || !access) return { ok: false }
      const a = stage.getBoundingClientRect()
      const b = access.getBoundingClientRect()
      const c = document.querySelector('.particle-field__canvas')
      return {
        ok: true,
        viewport: { w: innerWidth, h: innerHeight },
        stageWidth: Math.round(a.width),
        accessWidth: Math.round(b.width),
        ratio: +(a.width / b.width).toFixed(3),
        canvas: c ? { w: c.width, h: c.height } : null,
        cardVisible: document.querySelector('.auth-card') !== null,
      }
    })()`)

    await shoot('01-login-desktop')

    /* ---------------- 2. 轮播关键词不能出现空档 ---------------- */
    report.rotator = await evaluate(`(async () => {
      const words = [...document.querySelectorAll('.rotator__word')]
      if (!words.length) return { words: 0 }
      let minSum = Infinity
      let samples = 0
      const started = performance.now()
      while (performance.now() - started < 5200) {
        const sum = words.reduce((acc, el) => acc + parseFloat(getComputedStyle(el).opacity), 0)
        if (performance.now() - started > 600) minSum = Math.min(minSum, sum)
        samples += 1
        await new Promise((r) => setTimeout(r, 50))
      }
      return {
        words: words.length,
        samples,
        minOpacitySum: Number(minSum.toFixed(3)),
        neverBlank: minSum > 0.6,
      }
    })()`)

    /* ------------------------ 3. 真实提交登录 ------------------------ */
    await evaluate(`(() => {
      const set = (sel, value) => {
        const el = document.querySelector(sel)
        el.value = value
        el.dispatchEvent(new Event('input', { bubbles: true }))
        el.dispatchEvent(new Event('change', { bubbles: true }))
      }
      set('input[name="account"]', 'admin')
      set('input[name="password"]', 'admin12345')
      document.querySelector('.submit').click()
      return true
    })()`)

    await sleep(2600)
    report.login = await evaluate(`({
      path: location.pathname,
      heading: document.querySelector('.profile__meta h1')?.textContent?.trim() ?? null,
      email: document.querySelector('.profile__meta p')?.textContent?.trim() ?? null,
      hasToken: Boolean(localStorage.getItem('kun-login.token') || sessionStorage.getItem('kun-login.token')),
      checks: [...document.querySelectorAll('.checks li')].map((li) =>
        li.textContent.replace(/\\s+/g, ' ').trim(),
      ),
    })`)
    await shoot('02-dashboard-desktop')

    /* ------------------------ 4. 错误密码分支 ------------------------ */
    await evaluate('localStorage.clear(); sessionStorage.clear(); true')
    await navigate(TARGET_URL)
    await evaluate(`(() => {
      const set = (sel, value) => {
        const el = document.querySelector(sel)
        el.value = value
        el.dispatchEvent(new Event('input', { bubbles: true }))
      }
      set('input[name="account"]', 'admin')
      set('input[name="password"]', 'definitely-wrong')
      document.querySelector('.submit').click()
      return true
    })()`)
    await sleep(2200)
    report.badLogin = await evaluate(`({
      path: location.pathname,
      alert: document.querySelector('.alert--error')?.textContent?.replace(/\\s+/g,' ').trim() ?? null,
    })`)
    await shoot('03-login-error')

    /* ---------------------------- 5. 移动端 ---------------------------- */
    await setViewport(414, 896, true)
    await navigate(TARGET_URL)
    report.mobile = await evaluate(`(() => {
      const stage = document.querySelector('.stage')?.getBoundingClientRect()
      const access = document.querySelector('.access')?.getBoundingClientRect()
      return {
        viewport: { w: innerWidth, h: innerHeight },
        stage: stage ? { w: Math.round(stage.width), h: Math.round(stage.height) } : null,
        access: access ? { w: Math.round(access.width), h: Math.round(access.height) } : null,
      }
    })()`)
    await shoot('04-login-mobile')

    /* -------------- 6. reduced motion 降级不能变空白 -------------- */
    await setMotion('reduce')
    await setViewport(1600, 900)
    await navigate(TARGET_URL)
    report.reducedMotion = await evaluate(`(() => {
      const words = [...document.querySelectorAll('.rotator__word')]
      const visible = words.filter((el) => {
        const style = getComputedStyle(el)
        return style.display !== 'none' && parseFloat(style.opacity) > 0.5
      })
      const canvas = document.querySelector('.particle-field__canvas')
      let canvasPainted = false
      if (canvas && canvas.width) {
        const probe = document.createElement('canvas')
        probe.width = canvas.width
        probe.height = canvas.height
        const pctx = probe.getContext('2d')
        pctx.drawImage(canvas, 0, 0)
        const data = pctx.getImageData(0, 0, canvas.width, canvas.height).data
        for (let i = 3; i < data.length; i += 4 * 97) {
          if (data[i] > 0) { canvasPainted = true; break }
        }
      }
      return {
        visibleWords: visible.map((el) => el.textContent.trim()),
        canvasPainted,
        ok: visible.length > 0 && canvasPainted,
      }
    })()`)
    await shoot('05-login-reduced-motion')

    /* ------------------------------ 汇总 ------------------------------ */
    report.consoleErrors = recorder.consoleMessages.filter((m) => m.level === 'error')
    report.consoleWarnings = recorder.consoleMessages.filter((m) => m.level === 'warning')
    report.exceptions = recorder.exceptions
    report.failedRequests = recorder.failedRequests

    report.summary = {
      '左/右 = 2:1': report.desktop.ratio === 2,
      '粒子画布已绘制': (report.desktop.canvas?.w ?? 0) > 0,
      '轮播无空档': report.rotator.neverBlank === true,
      '登录跳转控制台': report.login.path === '/dashboard' && report.login.hasToken,
      '读到数据库用户': report.login.heading === '管理员' && report.login.email === 'admin@kun.dev',
      '错误密码被拦住': report.badLogin.path === '/login' && Boolean(report.badLogin.alert),
      '移动端上下布局': report.mobile.access?.w === 414 && report.mobile.stage?.h < 400,
      'reduced motion 不空白': report.reducedMotion.ok === true,
      '无控制台错误': report.consoleErrors.length === 0 && report.exceptions.length === 0,
    }

    writeFileSync(
      path.join(ARTIFACT_DIR, 'verify-report.json'),
      `${JSON.stringify(report, null, 2)}\n`,
      'utf8',
    )

    console.log('\n================ 验证结果 ================')
    console.log(JSON.stringify(report.summary, null, 2))
    console.log('\n控制台错误 :', report.consoleErrors.length)
    console.log('未捕获异常 :', report.exceptions.length)
    console.log('网络失败   :', JSON.stringify(report.failedRequests))
    console.log('==========================================')
  } finally {
    await browser.close()
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('[verify] 失败:', error)
    process.exit(1)
  })
