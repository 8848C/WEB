<script setup>
/**
 * 右侧 1/3 区域的登录 / 注册卡片。
 */
import { computed, nextTick, reactive, ref, watch } from 'vue'

import { useAuthStore } from '@/stores/auth'

const emit = defineEmits(['success'])

const auth = useAuthStore()

const mode = ref('login') // 'login' | 'register'
const showPassword = ref(false)
const capsLock = ref(false)
const touched = reactive({})
const localErrors = reactive({})

const loginForm = reactive({ account: '', password: '', remember: true })
const registerForm = reactive({ username: '', email: '', password: '', confirm: '' })

const isRegister = computed(() => mode.value === 'register')

const USERNAME_RE = /^[A-Za-z][A-Za-z0-9_]{2,31}$/
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

const DEMO = { account: 'admin', password: 'admin12345' }

/* ----------------------------- 校验 ----------------------------- */

function validateLogin() {
  localErrors.account = loginForm.account.trim() ? '' : '请输入用户名或邮箱'
  localErrors.password = loginForm.password ? '' : '请输入密码'
}

function validateRegister() {
  const { username, email, password, confirm } = registerForm

  if (!username.trim()) localErrors.username = '请输入用户名'
  else if (!USERNAME_RE.test(username.trim()))
    localErrors.username = '字母开头，3-32 位，仅限字母 / 数字 / 下划线'
  else localErrors.username = ''

  if (!email.trim()) localErrors.email = '请输入邮箱'
  else if (!EMAIL_RE.test(email.trim())) localErrors.email = '邮箱格式不正确'
  else localErrors.email = ''

  if (!password) localErrors.password = '请输入密码'
  else if (password.length < 8) localErrors.password = '密码至少 8 位'
  else if (!/[A-Za-z]/.test(password) || !/\d/.test(password))
    localErrors.password = '密码需同时包含字母和数字'
  else localErrors.password = ''

  if (!confirm) localErrors.confirm = '请再次输入密码'
  else if (confirm !== password) localErrors.confirm = '两次输入的密码不一致'
  else localErrors.confirm = ''
}

function validate() {
  if (isRegister.value) validateRegister()
  else validateLogin()
  return !Object.values(localErrors).some(Boolean)
}

/** 出错时把焦点送到第一个有问题的输入框 */
async function focusFirstError() {
  await nextTick()
  const el = document.querySelector('.auth-form [aria-invalid="true"]')
  el?.focus()
}

/* ----------------------------- 交互 ----------------------------- */

function switchMode(next) {
  if (mode.value === next) return
  mode.value = next
  auth.clearFeedback()
  Object.keys(localErrors).forEach((key) => (localErrors[key] = ''))
  Object.keys(touched).forEach((key) => (touched[key] = false))
  capsLock.value = false
}

function fillDemo() {
  switchMode('login')
  loginForm.account = DEMO.account
  loginForm.password = DEMO.password
  loginForm.remember = true
  localErrors.account = ''
  localErrors.password = ''
  auth.clearFeedback()
}

function onCapsCheck(event) {
  capsLock.value = Boolean(event.getModifierState?.('CapsLock'))
}

async function onSubmit() {
  if (auth.submitting) return

  // 提交时把所有字段标记为已触碰，让错误一次性显示出来
  Object.keys(isRegister.value ? registerForm : loginForm).forEach((key) => (touched[key] = true))

  if (!validate()) {
    focusFirstError()
    return
  }

  const ok = isRegister.value
    ? await auth.register({
        username: registerForm.username.trim(),
        email: registerForm.email.trim(),
        password: registerForm.password,
      })
    : await auth.login({
        account: loginForm.account.trim(),
        password: loginForm.password,
        remember: loginForm.remember,
      })

  if (ok) emit('success')
}

/** 输入时清掉该字段的旧错误，避免红字一直挂着 */
watch(
  () => [loginForm.account, loginForm.password],
  () => {
    if (isRegister.value) return
    if (touched.account) localErrors.account = ''
    if (touched.password) localErrors.password = ''
    auth.clearFeedback()
  },
)

watch(
  () => [registerForm.username, registerForm.email, registerForm.password, registerForm.confirm],
  () => {
    if (!isRegister.value) return
    auth.clearFeedback()
  },
)
</script>

<template>
  <section class="auth-panel">
    <div class="auth-card">
      <!-- 顶部光带 -->
      <span class="auth-card__beam" aria-hidden="true" />

      <header class="auth-head">
        <span class="auth-head__badge">
          <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
            <path
              d="M12 2.8 20 6.4v5.2c0 4.6-3.3 8.3-8 9.6-4.7-1.3-8-5-8-9.6V6.4L12 2.8Z"
              fill="none"
              stroke="currentColor"
              stroke-width="1.6"
            />
          </svg>
          安全登录
        </span>
        <h2>{{ isRegister ? '创建你的账号' : '欢迎回来' }}</h2>
        <p>{{ isRegister ? '填写下面的信息，几秒钟即可开始' : '登录后即可进入控制台查看你的账户信息' }}</p>
      </header>

      <!-- 模式切换 -->
      <div class="tabs" role="tablist" aria-label="登录或注册">
        <button
          type="button"
          role="tab"
          class="tab"
          :class="{ 'tab--active': !isRegister }"
          :aria-selected="!isRegister"
          @click="switchMode('login')"
        >
          登录
        </button>
        <button
          type="button"
          role="tab"
          class="tab"
          :class="{ 'tab--active': isRegister }"
          :aria-selected="isRegister"
          @click="switchMode('register')"
        >
          注册
        </button>
        <span class="tabs__slider" :class="{ 'tabs__slider--right': isRegister }" aria-hidden="true" />
      </div>

      <form class="auth-form" novalidate @submit.prevent="onSubmit">
        <!-- 登录：账号 -->
        <template v-if="!isRegister">
          <label class="field">
            <span class="field__label">用户名 / 邮箱</span>
            <span class="field__control" :class="{ 'field__control--error': localErrors.account && touched.account }">
              <span class="field__icon">
                <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                  <circle cx="12" cy="8.4" r="3.6" fill="none" stroke="currentColor" stroke-width="1.6" />
                  <path d="M4.8 20c.7-3.6 3.7-5.6 7.2-5.6s6.5 2 7.2 5.6" fill="none" stroke="currentColor" stroke-width="1.6" />
                </svg>
              </span>
              <input
                v-model="loginForm.account"
                type="text"
                name="account"
                autocomplete="username"
                placeholder="admin 或 admin@kun.dev"
                :aria-invalid="Boolean(localErrors.account && touched.account)"
                @blur="touched.account = true"
              />
            </span>
            <span v-if="localErrors.account && touched.account" class="field__error">{{ localErrors.account }}</span>
          </label>

          <!-- 登录：密码 -->
          <label class="field">
            <span class="field__label">密码</span>
            <span class="field__control" :class="{ 'field__control--error': localErrors.password && touched.password }">
              <span class="field__icon">
                <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                  <rect x="4.8" y="10" width="14.4" height="9.6" rx="2.2" fill="none" stroke="currentColor" stroke-width="1.6" />
                  <path d="M8.4 10V7.8a3.6 3.6 0 0 1 7.2 0V10" fill="none" stroke="currentColor" stroke-width="1.6" />
                </svg>
              </span>
              <input
                v-model="loginForm.password"
                :type="showPassword ? 'text' : 'password'"
                name="password"
                autocomplete="current-password"
                placeholder="请输入密码"
                :aria-invalid="Boolean(localErrors.password && touched.password)"
                @blur="touched.password = true"
                @keyup="onCapsCheck"
                @keydown="onCapsCheck"
              />
              <button
                type="button"
                class="field__toggle"
                :aria-label="showPassword ? '隐藏密码' : '显示密码'"
                @click="showPassword = !showPassword"
              >
                <svg v-if="showPassword" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                  <path d="M3 12s3.4-6 9-6 9 6 9 6-3.4 6-9 6-9-6-9-6Z" fill="none" stroke="currentColor" stroke-width="1.6" />
                  <circle cx="12" cy="12" r="2.6" fill="none" stroke="currentColor" stroke-width="1.6" />
                </svg>
                <svg v-else viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                  <path d="M3 12s3.4-6 9-6c1.7 0 3.2.5 4.5 1.2M21 12s-3.4 6-9 6c-1.7 0-3.2-.5-4.5-1.2" fill="none" stroke="currentColor" stroke-width="1.6" />
                  <path d="M4 4l16 16" fill="none" stroke="currentColor" stroke-width="1.6" />
                </svg>
              </button>
            </span>
            <span v-if="localErrors.password && touched.password" class="field__error">{{ localErrors.password }}</span>
          </label>

          <p v-if="capsLock" class="caps-hint">⚠ 大写锁定已开启</p>

          <div class="row">
            <label class="checkbox">
              <input v-model="loginForm.remember" type="checkbox" />
              <span class="checkbox__box" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="12" height="12"><path d="M5 12.5l4.2 4.2L19 7" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" /></svg>
              </span>
              <span class="checkbox__text">记住我</span>
            </label>
            <button type="button" class="link" @click="fillDemo">使用演示账号</button>
          </div>
        </template>

        <!-- 注册 -->
        <template v-else>
          <label class="field">
            <span class="field__label">用户名</span>
            <span class="field__control" :class="{ 'field__control--error': localErrors.username }">
              <span class="field__icon">
                <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                  <circle cx="12" cy="8.4" r="3.6" fill="none" stroke="currentColor" stroke-width="1.6" />
                  <path d="M4.8 20c.7-3.6 3.7-5.6 7.2-5.6s6.5 2 7.2 5.6" fill="none" stroke="currentColor" stroke-width="1.6" />
                </svg>
              </span>
              <input
                v-model="registerForm.username"
                type="text"
                name="new-username"
                autocomplete="username"
                placeholder="字母开头，3-32 位"
                :aria-invalid="Boolean(localErrors.username)"
                @blur="touched.username = true"
              />
            </span>
            <span v-if="localErrors.username" class="field__error">{{ localErrors.username }}</span>
          </label>

          <label class="field">
            <span class="field__label">邮箱</span>
            <span class="field__control" :class="{ 'field__control--error': localErrors.email }">
              <span class="field__icon">
                <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                  <rect x="3.4" y="5.6" width="17.2" height="12.8" rx="2.4" fill="none" stroke="currentColor" stroke-width="1.6" />
                  <path d="M4.4 7.4 12 13l7.6-5.6" fill="none" stroke="currentColor" stroke-width="1.6" />
                </svg>
              </span>
              <input
                v-model="registerForm.email"
                type="email"
                name="email"
                autocomplete="email"
                placeholder="you@example.com"
                :aria-invalid="Boolean(localErrors.email)"
                @blur="touched.email = true"
              />
            </span>
            <span v-if="localErrors.email" class="field__error">{{ localErrors.email }}</span>
          </label>

          <label class="field">
            <span class="field__label">密码</span>
            <span class="field__control" :class="{ 'field__control--error': localErrors.password }">
              <span class="field__icon">
                <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                  <rect x="4.8" y="10" width="14.4" height="9.6" rx="2.2" fill="none" stroke="currentColor" stroke-width="1.6" />
                  <path d="M8.4 10V7.8a3.6 3.6 0 0 1 7.2 0V10" fill="none" stroke="currentColor" stroke-width="1.6" />
                </svg>
              </span>
              <input
                v-model="registerForm.password"
                :type="showPassword ? 'text' : 'password'"
                name="new-password"
                autocomplete="new-password"
                placeholder="至少 8 位，含字母和数字"
                :aria-invalid="Boolean(localErrors.password)"
                @blur="touched.password = true"
                @keyup="onCapsCheck"
                @keydown="onCapsCheck"
              />
              <button
                type="button"
                class="field__toggle"
                :aria-label="showPassword ? '隐藏密码' : '显示密码'"
                @click="showPassword = !showPassword"
              >
                <svg v-if="showPassword" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                  <path d="M3 12s3.4-6 9-6 9 6 9 6-3.4 6-9 6-9-6-9-6Z" fill="none" stroke="currentColor" stroke-width="1.6" />
                  <circle cx="12" cy="12" r="2.6" fill="none" stroke="currentColor" stroke-width="1.6" />
                </svg>
                <svg v-else viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                  <path d="M3 12s3.4-6 9-6c1.7 0 3.2.5 4.5 1.2M21 12s-3.4 6-9 6c-1.7 0-3.2-.5-4.5-1.2" fill="none" stroke="currentColor" stroke-width="1.6" />
                  <path d="M4 4l16 16" fill="none" stroke="currentColor" stroke-width="1.6" />
                </svg>
              </button>
            </span>
            <span v-if="localErrors.password" class="field__error">{{ localErrors.password }}</span>
          </label>

          <label class="field">
            <span class="field__label">确认密码</span>
            <span class="field__control" :class="{ 'field__control--error': localErrors.confirm }">
              <span class="field__icon">
                <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                  <path d="M5 12.5l4.2 4.2L19 7" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" />
                </svg>
              </span>
              <input
                v-model="registerForm.confirm"
                :type="showPassword ? 'text' : 'password'"
                name="confirm-password"
                autocomplete="new-password"
                placeholder="再输入一次"
                :aria-invalid="Boolean(localErrors.confirm)"
                @blur="touched.confirm = true"
              />
            </span>
            <span v-if="localErrors.confirm" class="field__error">{{ localErrors.confirm }}</span>
          </label>
        </template>

        <!-- 服务端反馈 -->
        <Transition name="fade">
          <p v-if="auth.error" class="alert alert--error" role="alert">
            <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
              <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.7" />
              <path d="M12 7.6v5.2" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" />
              <circle cx="12" cy="16.2" r="1.1" fill="currentColor" />
            </svg>
            {{ auth.error }}
          </p>
        </Transition>

        <Transition name="fade">
          <p v-if="auth.notice" class="alert alert--success" role="status">
            <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
              <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.7" />
              <path d="M8 12.4l2.6 2.6L16 9.6" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" />
            </svg>
            {{ auth.notice }}
          </p>
        </Transition>

        <button type="submit" class="submit" :disabled="auth.submitting">
          <span v-if="auth.submitting" class="submit__spinner" aria-hidden="true" />
          <span>{{ auth.submitting ? '处理中…' : isRegister ? '注册并进入' : '登 录' }}</span>
          <svg v-if="!auth.submitting" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <path d="M5 12h13M12.5 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </button>
      </form>

      <p class="demo">
        演示账号
        <code>admin</code>
        <span>/</span>
        <code>admin12345</code>
        <button type="button" class="link" @click="fillDemo">一键填入</button>
      </p>
    </div>
  </section>
</template>

<style scoped>
.auth-panel {
  position: relative;
  z-index: 4;
  display: grid;
  place-items: center;
  height: 100%;
  padding: clamp(20px, 3vw, 46px);
  overflow-y: auto;
}

.auth-card {
  position: relative;
  width: 100%;
  max-width: 400px;
  padding: clamp(24px, 2.4vw, 36px);
  border-radius: var(--radius-lg);
  border: 1px solid var(--line-strong);
  background: linear-gradient(165deg, rgba(22, 27, 48, 0.86), rgba(9, 11, 22, 0.92));
  backdrop-filter: blur(22px) saturate(140%);
  box-shadow: var(--shadow-card);
  overflow: hidden;
}

/* 顶部一条流动的光带 */
.auth-card__beam {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 2px;
  background: linear-gradient(90deg, transparent, var(--accent), var(--accent-2), transparent);
  background-size: 220% 100%;
  animation: beam 5.5s linear infinite;
}

@keyframes beam {
  from {
    background-position: 200% 0;
  }
  to {
    background-position: -100% 0;
  }
}

/* ------------------------------- 头部 ------------------------------- */
.auth-head {
  display: flex;
  flex-direction: column;
  gap: 9px;
  margin-bottom: 24px;
}

.auth-head__badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  align-self: flex-start;
  padding: 4px 11px;
  border-radius: 999px;
  font-size: 11.5px;
  letter-spacing: 0.4px;
  color: var(--accent);
  background: rgba(34, 211, 238, 0.1);
  border: 1px solid rgba(34, 211, 238, 0.22);
}

.auth-head h2 {
  font-size: 24px;
  font-weight: 680;
  letter-spacing: -0.3px;
}

.auth-head p {
  font-size: 13px;
  color: var(--text-dim);
  line-height: 1.65;
}

/* ------------------------------- 选项卡 ------------------------------- */
.tabs {
  position: relative;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px;
  padding: 4px;
  margin-bottom: 22px;
  border-radius: 12px;
  background: rgba(8, 10, 20, 0.7);
  border: 1px solid var(--line);
}

.tab {
  position: relative;
  z-index: 2;
  padding: 9px 0;
  border-radius: 9px;
  font-size: 13.5px;
  font-weight: 560;
  color: var(--text-dim);
  transition: color 0.28s ease;
}

.tab--active {
  color: #04121a;
}

.tabs__slider {
  position: absolute;
  z-index: 1;
  top: 4px;
  left: 4px;
  width: calc(50% - 6px);
  height: calc(100% - 8px);
  border-radius: 9px;
  background: linear-gradient(120deg, var(--accent), #67e8f9);
  box-shadow: 0 8px 22px -12px var(--accent);
  transition: transform 0.32s cubic-bezier(0.4, 0, 0.2, 1);
}

.tabs__slider--right {
  transform: translateX(calc(100% + 4px));
}

/* ------------------------------- 表单 ------------------------------- */
.auth-form {
  display: flex;
  flex-direction: column;
  gap: 15px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 7px;
}

.field__label {
  font-size: 12.5px;
  font-weight: 520;
  color: var(--text-muted);
}

.field__control {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 0 12px;
  height: 46px;
  border-radius: 12px;
  border: 1px solid var(--line-strong);
  background: rgba(6, 8, 16, 0.66);
  transition: border-color 0.25s ease, box-shadow 0.25s ease, background 0.25s ease;
}

.field__control:focus-within {
  border-color: rgba(34, 211, 238, 0.62);
  background: rgba(8, 12, 24, 0.9);
  box-shadow: 0 0 0 3px rgba(34, 211, 238, 0.14);
}

.field__control--error {
  border-color: rgba(251, 113, 133, 0.7);
}

.field__control--error:focus-within {
  box-shadow: 0 0 0 3px rgba(251, 113, 133, 0.14);
}

.field__icon {
  display: grid;
  place-items: center;
  color: var(--text-dim);
  transition: color 0.25s ease;
}

.field__control:focus-within .field__icon {
  color: var(--accent);
}

.field__control input {
  flex: 1;
  min-width: 0;
  height: 100%;
  border: none;
  outline: none;
  background: transparent;
  font-size: 14px;
}

.field__control input::placeholder {
  color: #4a5372;
}

/* 关掉浏览器自带的密码眼睛，用我们自己的 */
.field__control input::-ms-reveal,
.field__control input::-ms-clear {
  display: none;
}

.field__toggle {
  display: grid;
  place-items: center;
  padding: 4px;
  border-radius: 7px;
  color: var(--text-dim);
  transition: color 0.2s ease, background 0.2s ease;
}

.field__toggle:hover {
  color: var(--accent);
  background: rgba(34, 211, 238, 0.1);
}

.field__error {
  font-size: 11.5px;
  color: var(--danger);
}

.caps-hint {
  margin-top: -6px;
  font-size: 11.5px;
  color: #fbbf24;
}

/* ------------------------------- 记住我 ------------------------------- */
.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: -2px;
}

.checkbox {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  user-select: none;
}

.checkbox input {
  position: absolute;
  opacity: 0;
  width: 0;
  height: 0;
}

.checkbox__box {
  display: grid;
  place-items: center;
  width: 17px;
  height: 17px;
  border-radius: 5px;
  border: 1px solid var(--line-strong);
  background: rgba(6, 8, 16, 0.8);
  color: transparent;
  transition: all 0.22s ease;
}

.checkbox input:checked + .checkbox__box {
  background: linear-gradient(120deg, var(--accent), #38bdf8);
  border-color: transparent;
  color: #04121a;
}

.checkbox input:focus-visible + .checkbox__box {
  box-shadow: var(--ring);
}

.checkbox__text {
  font-size: 12.5px;
  color: var(--text-muted);
}

.link {
  padding: 2px 0;
  font-size: 12.5px;
  color: var(--accent);
  transition: opacity 0.2s ease;
}

.link:hover {
  opacity: 0.75;
  text-decoration: underline;
}

/* ------------------------------- 提示条 ------------------------------- */
.alert {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 10px 12px;
  border-radius: 11px;
  font-size: 12.5px;
  line-height: 1.6;
}

.alert svg {
  flex: 0 0 auto;
  margin-top: 2px;
}

.alert--error {
  color: #fecdd3;
  background: rgba(251, 113, 133, 0.1);
  border: 1px solid rgba(251, 113, 133, 0.32);
}

.alert--success {
  color: #bbf7d0;
  background: rgba(52, 211, 153, 0.1);
  border: 1px solid rgba(52, 211, 153, 0.3);
}

/* ------------------------------- 提交按钮 ------------------------------- */
.submit {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 9px;
  height: 47px;
  margin-top: 4px;
  border-radius: 12px;
  font-size: 14.5px;
  font-weight: 620;
  letter-spacing: 0.6px;
  color: #04121a;
  background: linear-gradient(120deg, var(--accent), #60a5fa 52%, var(--accent-2));
  background-size: 180% 100%;
  box-shadow: 0 16px 34px -18px rgba(34, 211, 238, 0.95);
  transition: background-position 0.5s ease, transform 0.18s ease, box-shadow 0.3s ease;
  overflow: hidden;
}

.submit:hover:not(:disabled) {
  background-position: 100% 0;
  transform: translateY(-1px);
  box-shadow: 0 22px 40px -18px rgba(139, 92, 246, 0.95);
}

.submit:active:not(:disabled) {
  transform: translateY(0) scale(0.995);
}

.submit:disabled {
  opacity: 0.72;
  cursor: progress;
}

.submit__spinner {
  width: 15px;
  height: 15px;
  border-radius: 50%;
  border: 2px solid rgba(4, 18, 26, 0.28);
  border-top-color: #04121a;
  animation: spin 0.7s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

/* ------------------------------- 演示账号 ------------------------------- */
.demo {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 20px;
  padding-top: 16px;
  border-top: 1px dashed var(--line);
  font-size: 12px;
  color: var(--text-dim);
}

.demo code {
  padding: 1px 7px;
  border-radius: 6px;
  font-family: var(--font-mono);
  font-size: 11.5px;
  color: #a5f3fc;
  background: rgba(34, 211, 238, 0.1);
  border: 1px solid rgba(34, 211, 238, 0.18);
}

@media (max-width: 1023px) {
  .auth-panel {
    padding: 18px;
  }

  .auth-card {
    max-width: 460px;
    padding: 24px 20px;
  }
}
</style>
