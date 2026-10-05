import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import { ApiError, authApi } from '@/api/client'

const TOKEN_KEY = 'kun-login.token'

/**
 * token 的存放位置：
 *  - 勾选「记住我」-> localStorage（关掉浏览器仍在）
 *  - 否则          -> sessionStorage（关掉标签页即失效）
 * 读取时两边都查，登出时两边都清。
 */
const storage = {
  read() {
    return localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY) || ''
  },
  write(token, remember) {
    storage.clear()
    if (!token) return
    ;(remember ? localStorage : sessionStorage).setItem(TOKEN_KEY, token)
  },
  clear() {
    localStorage.removeItem(TOKEN_KEY)
    sessionStorage.removeItem(TOKEN_KEY)
  },
}

export const useAuthStore = defineStore('auth', () => {
  const token = ref(storage.read())
  const user = ref(null)
  const booting = ref(Boolean(token.value))
  const submitting = ref(false)
  const error = ref('')
  const notice = ref('')

  const isAuthenticated = computed(() => Boolean(token.value && user.value))
  const initials = computed(() => {
    const name = user.value?.display_name || user.value?.username || ''
    return name.trim().slice(0, 1).toUpperCase() || '?'
  })

  function applySession(payload, remember) {
    token.value = payload.access_token
    user.value = payload.user
    storage.write(payload.access_token, remember)
  }

  function clearSession() {
    token.value = ''
    user.value = null
    storage.clear()
  }

  function clearFeedback() {
    error.value = ''
    notice.value = ''
  }

  /** 页面刷新后用已存 token 换取用户信息。 */
  async function restore() {
    if (!token.value) {
      booting.value = false
      return
    }
    booting.value = true
    try {
      user.value = await authApi.me(token.value)
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) clearSession()
      else error.value = err?.message ?? '恢复登录状态失败'
    } finally {
      booting.value = false
    }
  }

  async function login({ account, password, remember = false }) {
    submitting.value = true
    clearFeedback()
    try {
      applySession(await authApi.login({ account, password, remember }), remember)
      notice.value = `欢迎回来，${user.value.display_name || user.value.username}`
      return true
    } catch (err) {
      error.value = err?.message ?? '登录失败，请稍后再试'
      return false
    } finally {
      submitting.value = false
    }
  }

  async function register({ username, email, password }) {
    submitting.value = true
    clearFeedback()
    try {
      applySession(await authApi.register({ username, email, password }), true)
      notice.value = '注册成功，已自动登录'
      return true
    } catch (err) {
      error.value = err?.message ?? '注册失败，请稍后再试'
      return false
    } finally {
      submitting.value = false
    }
  }

  async function logout() {
    const current = token.value
    clearSession()
    clearFeedback()
    if (!current) return
    try {
      await authApi.logout(current)
    } catch {
      // JWT 无状态：服务端失败也不影响本地登出
    }
  }

  return {
    token,
    user,
    booting,
    submitting,
    error,
    notice,
    isAuthenticated,
    initials,
    restore,
    login,
    register,
    logout,
    clearFeedback,
    clearSession,
  }
})
