/**
 * 极简 API 客户端：统一拼地址、带 token、把后端错误转成可读中文。
 * 开发环境走 vite 的 /api 代理，所以 BASE 默认为空。
 */

const BASE = import.meta.env.VITE_API_BASE ?? ''

export class ApiError extends Error {
  constructor(message, status = 0, payload = null) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.payload = payload
  }
}

/** 把 FastAPI 的三种错误体（字符串 / 校验数组 / 自定义）统一成一句话。 */
function extractDetail(payload, fallback) {
  if (!payload || typeof payload !== 'object') return fallback
  const detail = payload.detail

  if (typeof detail === 'string' && detail.trim()) return detail

  if (Array.isArray(detail)) {
    const messages = detail
      .map((item) => String(item?.msg ?? '').replace(/^Value error,\s*/, '').trim())
      .filter(Boolean)
    if (messages.length) return messages.join('；')
  }

  if (typeof payload.message === 'string' && payload.message.trim()) return payload.message
  return fallback
}

export async function request(path, { method = 'GET', body, token, signal } = {}) {
  const headers = { Accept: 'application/json' }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (token) headers.Authorization = `Bearer ${token}`

  let response
  try {
    response = await fetch(`${BASE}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    })
  } catch (error) {
    if (error?.name === 'AbortError') throw error
    throw new ApiError('连不上后端服务，请确认 FastAPI 已在 127.0.0.1:8000 运行', 0, null)
  }

  const raw = await response.text()
  let payload = null
  if (raw) {
    try {
      payload = JSON.parse(raw)
    } catch {
      payload = null
    }
  }

  if (!response.ok) {
    const message =
      response.status === 429
        ? extractDetail(payload, '操作过于频繁，请稍后再试')
        : extractDetail(payload, `请求失败（HTTP ${response.status}）`)
    throw new ApiError(message, response.status, payload)
  }

  return payload
}

/* ----------------------------- 认证接口 ----------------------------- */

export const authApi = {
  login: ({ account, password, remember }) =>
    request('/api/auth/login', {
      method: 'POST',
      body: { account, password, remember: Boolean(remember) },
    }),

  register: ({ username, email, password }) =>
    request('/api/auth/register', {
      method: 'POST',
      body: { username, email, password },
    }),

  me: (token, signal) => request('/api/auth/me', { token, signal }),

  logout: (token) => request('/api/auth/logout', { method: 'POST', token }),

  health: (signal) => request('/api/health', { signal }),
}
