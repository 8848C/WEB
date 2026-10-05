<script setup>
/**
 * 登录后的控制台：把 /api/auth/me 返回的数据展示出来，
 * 用来证明 token 真的能换到用户信息。
 */
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'

import { authApi } from '@/api/client'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
const router = useRouter()

const health = ref(null)
const healthError = ref('')
const busy = ref(false)

const user = computed(() => auth.user ?? {})

const avatarStyle = computed(() => {
  const hue = user.value.avatar_hue ?? 200
  return {
    background: `linear-gradient(140deg, hsl(${hue} 85% 62%), hsl(${(hue + 58) % 360} 82% 52%))`,
    boxShadow: `0 14px 34px -16px hsl(${hue} 85% 55% / 0.95)`,
  }
})

function formatTime(value) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return date.toLocaleString('zh-CN', { hour12: false })
}

function tokenPreview(token) {
  if (!token) return '—'
  return `${token.slice(0, 26)}…${token.slice(-12)}`
}

/**
 * 模板里拿不到 localStorage（它不是组件实例上的属性），
 * 必须在这里算好再交给模板。
 */
const tokenStore = computed(() =>
  localStorage.getItem('kun-login.token') ? 'localStorage' : 'sessionStorage',
)

async function refresh() {
  busy.value = true
  healthError.value = ''
  try {
    health.value = await authApi.health()
  } catch (error) {
    health.value = null
    healthError.value = error?.message ?? '健康检查失败'
  } finally {
    busy.value = false
  }
}

async function onLogout() {
  await auth.logout()
  router.replace({ name: 'login' })
}

onMounted(refresh)
</script>

<template>
  <main class="dash">
    <div class="dash__glow" aria-hidden="true" />

    <header class="dash__bar">
      <div class="brandline">
        <span class="brandline__mark" />
        <strong>Kun Login</strong>
        <span class="brandline__sep">/</span>
        <span class="brandline__page">控制台</span>
      </div>
      <button class="ghost" :disabled="busy" @click="refresh">
        {{ busy ? '刷新中…' : '重新自检' }}
      </button>
    </header>

    <section class="dash__body">
      <!-- 用户卡 -->
      <article class="card card--profile">
        <div class="profile">
          <div class="avatar" :style="avatarStyle">{{ auth.initials }}</div>
          <div class="profile__meta">
            <h1>{{ user.display_name || user.username }}</h1>
            <p>{{ user.email }}</p>
            <div class="chips">
              <span class="chip" :class="{ 'chip--accent': user.is_superuser }">
                {{ user.is_superuser ? '超级管理员' : '普通用户' }}
              </span>
              <span class="chip">ID #{{ user.id }}</span>
            </div>
          </div>
        </div>

        <dl class="facts">
          <div>
            <dt>注册时间</dt>
            <dd>{{ formatTime(user.created_at) }}</dd>
          </div>
          <div>
            <dt>上次登录</dt>
            <dd>{{ formatTime(user.last_login_at) }}</dd>
          </div>
          <div>
            <dt>头像色相</dt>
            <dd>{{ user.avatar_hue }}°</dd>
          </div>
        </dl>

        <button class="danger" @click="onLogout">退出登录</button>
      </article>

      <!-- 令牌 & 服务 -->
      <div class="column">
        <article class="card">
          <h2>当前令牌</h2>
          <p class="hint">JWT（HS256），前端持有，服务端不存会话。</p>
          <code class="token">{{ tokenPreview(auth.token) }}</code>
          <p class="note">
            打开 DevTools → Application → Storage 可以看到它存在 {{ tokenStore }} 里。
          </p>
        </article>

        <article class="card">
          <h2>后端自检</h2>
          <p v-if="healthError" class="bad">{{ healthError }}</p>
          <ul v-else-if="health" class="checks">
            <li>
              <span>服务</span>
              <strong :class="health.ok ? 'ok' : 'bad'">{{ health.ok ? '正常' : '异常' }}</strong>
            </li>
            <li>
              <span>应用</span>
              <strong>{{ health.app }}（{{ health.env }}）</strong>
            </li>
            <li>
              <span>数据库</span>
              <strong :class="health.database?.ok ? 'ok' : 'bad'">
                {{ health.database?.ok ? `MySQL ${health.database.version}` : health.database?.error }}
              </strong>
            </li>
            <li>
              <span>Schema</span>
              <strong>{{ health.database?.schema }}</strong>
            </li>
          </ul>
          <p v-else class="hint">检测中…</p>
        </article>
      </div>
    </section>
  </main>
</template>

<style scoped>
.dash {
  position: relative;
  height: 100%;
  overflow-y: auto;
  padding: clamp(22px, 3vw, 42px);
  background: radial-gradient(120% 100% at 85% 0%, #0b1226 0%, #05060c 60%, #04050a 100%);
}

.dash__glow {
  position: fixed;
  top: -30%;
  right: -12%;
  width: 60vw;
  height: 60vw;
  border-radius: 50%;
  filter: blur(120px);
  background: radial-gradient(circle, rgba(34, 211, 238, 0.24), transparent 68%);
  pointer-events: none;
}

.dash__bar {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  max-width: 1020px;
  margin: 0 auto 26px;
  padding-bottom: 18px;
  border-bottom: 1px solid var(--line);
}

.brandline {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 14px;
}

.brandline__mark {
  width: 12px;
  height: 12px;
  border-radius: 4px;
  background: linear-gradient(140deg, var(--accent), var(--accent-2));
  box-shadow: 0 0 16px rgba(34, 211, 238, 0.8);
}

.brandline__sep,
.brandline__page {
  color: var(--text-dim);
}

.ghost {
  padding: 8px 15px;
  border-radius: 10px;
  font-size: 12.5px;
  color: var(--text-muted);
  border: 1px solid var(--line-strong);
  background: rgba(12, 16, 30, 0.7);
  transition: color 0.22s ease, border-color 0.22s ease;
}

.ghost:hover:not(:disabled) {
  color: var(--accent);
  border-color: rgba(34, 211, 238, 0.5);
}

.dash__body {
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr);
  gap: 20px;
  max-width: 1020px;
  margin: 0 auto;
  align-items: start;
}

.column {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.card {
  padding: 24px;
  border-radius: var(--radius-lg);
  border: 1px solid var(--line-strong);
  background: linear-gradient(165deg, rgba(20, 25, 46, 0.8), rgba(9, 11, 22, 0.88));
  backdrop-filter: blur(18px);
  box-shadow: var(--shadow-card);
}

.card h2 {
  font-size: 15px;
  font-weight: 620;
  margin-bottom: 8px;
}

.profile {
  display: flex;
  align-items: center;
  gap: 18px;
  margin-bottom: 22px;
}

.avatar {
  display: grid;
  place-items: center;
  width: 66px;
  height: 66px;
  border-radius: 20px;
  font-size: 26px;
  font-weight: 700;
  color: #06121b;
}

.profile__meta h1 {
  font-size: 21px;
  font-weight: 660;
  letter-spacing: -0.2px;
}

.profile__meta p {
  font-size: 13px;
  color: var(--text-muted);
}

.chips {
  display: flex;
  gap: 8px;
  margin-top: 10px;
  flex-wrap: wrap;
}

.chip {
  padding: 3px 10px;
  border-radius: 999px;
  font-size: 11.5px;
  color: var(--text-muted);
  background: rgba(139, 160, 210, 0.12);
  border: 1px solid var(--line);
}

.chip--accent {
  color: var(--accent);
  background: rgba(34, 211, 238, 0.12);
  border-color: rgba(34, 211, 238, 0.28);
}

.facts {
  display: grid;
  gap: 12px;
  margin: 0 0 22px;
  padding: 16px 0 0;
  border-top: 1px solid var(--line);
}

.facts > div {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 14px;
}

.facts dt {
  font-size: 12.5px;
  color: var(--text-dim);
}

.facts dd {
  margin: 0;
  font-family: var(--font-mono);
  font-size: 12.5px;
  color: var(--text);
}

.danger {
  width: 100%;
  height: 44px;
  border-radius: 12px;
  font-size: 14px;
  font-weight: 600;
  color: #ffe4e6;
  background: rgba(251, 113, 133, 0.12);
  border: 1px solid rgba(251, 113, 133, 0.36);
  transition: background 0.25s ease, transform 0.18s ease;
}

.danger:hover {
  background: rgba(251, 113, 133, 0.22);
  transform: translateY(-1px);
}

.hint {
  font-size: 12.5px;
  color: var(--text-dim);
}

.note {
  margin-top: 12px;
  font-size: 11.5px;
  line-height: 1.7;
  color: var(--text-dim);
}

.token {
  display: block;
  margin-top: 12px;
  padding: 12px 14px;
  border-radius: 11px;
  font-family: var(--font-mono);
  font-size: 12px;
  word-break: break-all;
  color: #a5f3fc;
  background: rgba(6, 8, 16, 0.8);
  border: 1px solid var(--line);
}

.checks {
  display: grid;
  gap: 11px;
  margin: 12px 0 0;
  padding: 0;
  list-style: none;
}

.checks li {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 14px;
  font-size: 12.5px;
}

.checks span {
  color: var(--text-dim);
}

.checks strong {
  font-family: var(--font-mono);
  font-size: 12.5px;
  font-weight: 500;
  text-align: right;
}

.ok {
  color: var(--success);
}

.bad {
  color: var(--danger);
  font-size: 12.5px;
}

@media (max-width: 860px) {
  .dash__body {
    grid-template-columns: 1fr;
  }
}
</style>
