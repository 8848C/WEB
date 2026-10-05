/**
 * 复用的 Chrome DevTools Protocol 客户端（Node 内置 WebSocket，零依赖）。
 * browser-check.mjs 与 home-check.mjs 都基于它。
 */

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

export { sleep }

const CANDIDATES = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean)

export function findBrowser() {
  const hit = CANDIDATES.find((candidate) => existsSync(candidate))
  if (!hit) throw new Error('找不到 Chrome/Edge，可用 CHROME_PATH 指定')
  return hit
}

/* -------------------------------------------------------------------------- */

export class Cdp {
  #ws
  #nextId = 1
  #pending = new Map()
  #listeners = new Map()

  constructor(ws) {
    this.#ws = ws
    ws.addEventListener('message', (event) => this.#onMessage(event.data))
  }

  static async connect(url) {
    const ws = new WebSocket(url)
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true })
      ws.addEventListener('error', () => reject(new Error(`WebSocket 连接失败：${url}`)), {
        once: true,
      })
    })
    return new Cdp(ws)
  }

  #onMessage(raw) {
    const message = JSON.parse(raw)
    if (message.id && this.#pending.has(message.id)) {
      const { resolve, reject } = this.#pending.get(message.id)
      this.#pending.delete(message.id)
      if (message.error) reject(new Error(`${message.error.message} (${message.error.code})`))
      else resolve(message.result ?? {})
      return
    }
    const handlers = this.#listeners.get(message.method)
    if (handlers) for (const handler of handlers) handler(message.params ?? {}, message.sessionId)
  }

  on(method, handler) {
    if (!this.#listeners.has(method)) this.#listeners.set(method, new Set())
    this.#listeners.get(method).add(handler)
  }

  send(method, params = {}, sessionId) {
    const id = this.#nextId++
    const payload = { id, method, params }
    if (sessionId) payload.sessionId = sessionId
    this.#ws.send(JSON.stringify(payload))
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject })
      setTimeout(() => {
        if (this.#pending.has(id)) {
          this.#pending.delete(id)
          reject(new Error(`CDP 超时：${method}`))
        }
      }, 30_000)
    })
  }

  close() {
    this.#ws.close()
  }
}

/* -------------------------------------------------------------------------- */

/** 启动无头浏览器，返回 { child, cdp, sessionId, send, close } */
export async function openBrowser({ port = 9333, profileDir }) {
  const browserPath = findBrowser()
  rmSync(profileDir, { recursive: true, force: true })
  mkdirSync(profileDir, { recursive: true })

  const child = spawn(
    browserPath,
    [
      '--headless',
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profileDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--disable-background-networking',
      '--hide-scrollbars',
      '--force-device-scale-factor=1',
      '--remote-allow-origins=*',
      'about:blank',
    ],
    { stdio: 'ignore' },
  )

  let wsUrl = null
  for (let attempt = 0; attempt < 80 && !wsUrl; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`)
      if (response.ok) wsUrl = (await response.json()).webSocketDebuggerUrl
    } catch {
      /* 还没起来 */
    }
    if (!wsUrl) await sleep(250)
  }
  if (!wsUrl) {
    child.kill()
    throw new Error('无头浏览器没能在 20 秒内启动')
  }

  const cdp = await Cdp.connect(wsUrl)
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true })

  const send = (method, params) => cdp.send(method, params, sessionId)

  await send('Page.enable')
  await send('Runtime.enable')
  await send('Log.enable')

  return {
    child,
    cdp,
    sessionId,
    send,
    browserPath,
    async close() {
      cdp.close()
      child.kill()
      await sleep(300)
    },
  }
}

/* -------------------------------------------------------------------------- */

/** 收集 console / 未捕获异常 / 网络错误 */
export function createRecorder(cdp) {
  const consoleMessages = []
  const exceptions = []
  const failedRequests = []

  cdp.on('Runtime.consoleAPICalled', (params) => {
    consoleMessages.push({
      level: params.type,
      text: (params.args ?? [])
        .map((arg) => arg.value ?? arg.description ?? arg.unserializableValue ?? arg.type)
        .join(' '),
    })
  })
  cdp.on('Runtime.exceptionThrown', (params) => {
    const d = params.exceptionDetails ?? {}
    exceptions.push({
      text: d.exception?.description ?? d.text ?? '未知异常',
      url: d.url,
      line: d.lineNumber,
    })
  })
  cdp.on('Log.entryAdded', (params) => {
    const entry = params.entry ?? {}
    if (entry.level === 'error') {
      failedRequests.push(`${entry.source}: ${entry.text}${entry.url ? ` (${entry.url})` : ''}`)
    }
  })

  return { consoleMessages, exceptions, failedRequests }
}

/* -------------------------------------------------------------------------- */

export function makeHelpers(send) {
  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    })
    if (result.exceptionDetails) {
      throw new Error(
        `页面内脚本报错: ${
          result.exceptionDetails.exception?.description ?? result.exceptionDetails.text
        }`,
      )
    }
    return result.result?.value
  }

  const setViewport = (width, height, mobile = false) =>
    send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile,
      screenWidth: width,
      screenHeight: height,
    })

  const setMotion = (value) =>
    send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value }],
    })

  const navigate = async (url, settle = 2200) => {
    await send('Page.navigate', { url })
    await sleep(settle)
  }

  const move = (x, y) =>
    send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', buttons: 0 })

  const click = async (x, y) => {
    await send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x,
      y,
      button: 'left',
      buttons: 1,
      clickCount: 1,
    })
    await sleep(60)
    await send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x,
      y,
      button: 'left',
      buttons: 0,
      clickCount: 1,
    })
  }

  /** 沿一条路径连续移动鼠标：场是按「事件之间的位移」注入扰动的 */
  const stroke = async (points, stepMs = 16) => {
    for (const [x, y] of points) {
      await move(x, y)
      await sleep(stepMs)
    }
  }

  return { evaluate, setViewport, setMotion, navigate, move, click, stroke }
}
