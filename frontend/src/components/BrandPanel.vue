<script setup>
/**
 * 左侧 2/3 区域的品牌 / 信息层。
 * 只负责「内容 + 装饰」，粒子背景由父级单独铺一层。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

import { authApi } from '@/api/client'

const ROTATING_WORDS = ['安全', '可靠', '优雅', '高性能']

const features = [
  {
    title: '无状态鉴权',
    desc: 'JWT + Bearer，服务端不存会话，横向扩容零成本',
    icon: 'shield',
  },
  {
    title: '密码不明文',
    desc: 'PBKDF2-SHA256 随机盐，60 万次迭代，恒定时间比对',
    icon: 'lock',
  },
  {
    title: '数据落库',
    desc: 'SQLAlchemy 2.0 + MySQL，索引唯一约束由数据库兜底',
    icon: 'database',
  },
]

const clock = ref('')
const backend = ref({ state: 'checking', text: '检测中' })
let clockTimer = 0
let healthTimer = 0

const statusClass = computed(() => `status--${backend.value.state}`)

function tickClock() {
  const now = new Date()
  clock.value = now.toLocaleTimeString('zh-CN', { hour12: false })
}

async function checkHealth() {
  try {
    const payload = await authApi.health()
    const version = payload?.database?.version ?? '未知'
    backend.value = {
      state: payload?.ok ? 'online' : 'degraded',
      text: payload?.ok ? `MySQL ${version}` : '数据库不可用',
    }
  } catch {
    backend.value = { state: 'offline', text: '后端未连接' }
  }
}

onMounted(() => {
  tickClock()
  clockTimer = window.setInterval(tickClock, 1000)
  checkHealth()
  healthTimer = window.setInterval(checkHealth, 30_000)
})

onBeforeUnmount(() => {
  window.clearInterval(clockTimer)
  window.clearInterval(healthTimer)
})
</script>

<template>
  <div class="brand">
    <!-- 四角装饰 -->
    <span class="corner corner--tl" />
    <span class="corner corner--tr" />
    <span class="corner corner--bl" />
    <span class="corner corner--br" />

    <!-- 顶部：Logo + 状态 -->
    <header class="brand__top">
      <div class="logo">
        <span class="logo__mark">
          <svg viewBox="0 0 32 32" width="22" height="22" aria-hidden="true">
            <defs>
              <linearGradient id="logoGrad" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stop-color="#22d3ee" />
                <stop offset="100%" stop-color="#8b5cf6" />
              </linearGradient>
            </defs>
            <path
              d="M16 2.6 27.4 9v14L16 29.4 4.6 23V9L16 2.6Z"
              fill="none"
              stroke="url(#logoGrad)"
              stroke-width="1.6"
            />
            <path
              d="M16 9.4l6.2 3.6v7.2L16 23.8l-6.2-3.6V13L16 9.4Z"
              fill="url(#logoGrad)"
              opacity="0.9"
            />
          </svg>
        </span>
        <span class="logo__text">
          <strong>Kun Login</strong>
          <em>Vue 3 · FastAPI · MySQL</em>
        </span>
      </div>

      <div class="status" :class="statusClass">
        <span class="status__dot" />
        <span class="status__text">{{ backend.text }}</span>
        <span class="status__clock">{{ clock }}</span>
      </div>
    </header>

    <!-- 主体文案 -->
    <div class="brand__body">
      <p class="eyebrow">
        <span class="eyebrow__line" />
        全栈登录方案
      </p>

      <h1 class="headline">
        让每一次登录<br />
        <span class="headline__rotator">
          <span class="headline__static">都足够</span>
          <span class="rotator">
            <span
              v-for="(word, index) in ROTATING_WORDS"
              :key="word"
              class="rotator__word"
              :style="{ animationDelay: `${index * 2.4}s` }"
            >
              {{ word }}
            </span>
          </span>
        </span>
      </h1>

      <p class="lede">
        前端 Vue 3 组合式 API，后端 FastAPI 全异步，数据落在 MySQL。
        密码加盐哈希、令牌有过期、失败有限流 —— 该做的都做了。
      </p>

      <ul class="features">
        <li v-for="item in features" :key="item.title" class="feature">
          <span class="feature__icon" :data-icon="item.icon">
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <template v-if="item.icon === 'shield'">
                <path
                  d="M12 3l7 3v6c0 4.2-2.9 7.6-7 9-4.1-1.4-7-4.8-7-9V6l7-3Z"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.5"
                />
                <path d="M9 12.2l2.1 2.1L15 10.4" fill="none" stroke="currentColor" stroke-width="1.6" />
              </template>
              <template v-else-if="item.icon === 'lock'">
                <rect x="4.8" y="10" width="14.4" height="10" rx="2.4" fill="none" stroke="currentColor" stroke-width="1.5" />
                <path d="M8.4 10V7.8a3.6 3.6 0 0 1 7.2 0V10" fill="none" stroke="currentColor" stroke-width="1.5" />
                <circle cx="12" cy="15" r="1.4" fill="currentColor" />
              </template>
              <template v-else>
                <ellipse cx="12" cy="6.6" rx="7" ry="2.8" fill="none" stroke="currentColor" stroke-width="1.5" />
                <path d="M5 6.6v10.8c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8V6.6" fill="none" stroke="currentColor" stroke-width="1.5" />
                <path d="M5 12c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8" fill="none" stroke="currentColor" stroke-width="1.5" />
              </template>
            </svg>
          </span>
          <span class="feature__text">
            <strong>{{ item.title }}</strong>
            <em>{{ item.desc }}</em>
          </span>
        </li>
      </ul>
    </div>

    <!-- 底部指标 -->
    <footer class="brand__foot">
      <div class="metric">
        <strong>HS256</strong>
        <span>签名算法</span>
      </div>
      <div class="metric">
        <strong>600k</strong>
        <span>PBKDF2 迭代</span>
      </div>
      <div class="metric">
        <strong>utf8mb4</strong>
        <span>字符集</span>
      </div>
      <div class="metric">
        <strong>2h</strong>
        <span>令牌有效期</span>
      </div>
    </footer>

    <!-- 装饰：旋转光环 -->
    <div class="halo" aria-hidden="true">
      <span class="halo__ring halo__ring--outer" />
      <span class="halo__ring halo__ring--inner" />
      <span class="halo__core" />
    </div>
  </div>
</template>

<style scoped>
.brand {
  position: relative;
  z-index: 3;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  height: 100%;
  padding: clamp(28px, 3.4vw, 58px);
  gap: 28px;
}

/* ------------------------------- 四角 ------------------------------- */
.corner {
  position: absolute;
  width: 26px;
  height: 26px;
  border: 1px solid rgba(34, 211, 238, 0.45);
  pointer-events: none;
}

.corner--tl {
  top: 18px;
  left: 18px;
  border-right: none;
  border-bottom: none;
}

.corner--tr {
  top: 18px;
  right: 18px;
  border-left: none;
  border-bottom: none;
}

.corner--bl {
  bottom: 18px;
  left: 18px;
  border-right: none;
  border-top: none;
}

.corner--br {
  bottom: 18px;
  right: 18px;
  border-left: none;
  border-top: none;
}

/* ------------------------------- 顶部 ------------------------------- */
.brand__top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  flex-wrap: wrap;
}

.logo {
  display: flex;
  align-items: center;
  gap: 12px;
}

.logo__mark {
  display: grid;
  place-items: center;
  width: 42px;
  height: 42px;
  border-radius: 13px;
  background: linear-gradient(145deg, rgba(34, 211, 238, 0.16), rgba(139, 92, 246, 0.16));
  border: 1px solid rgba(139, 160, 210, 0.22);
  box-shadow: 0 0 26px -8px rgba(34, 211, 238, 0.7);
}

.logo__text {
  display: flex;
  flex-direction: column;
  line-height: 1.25;
}

.logo__text strong {
  font-size: 16px;
  font-weight: 650;
  letter-spacing: 0.2px;
}

.logo__text em {
  font-style: normal;
  font-size: 11.5px;
  letter-spacing: 1.3px;
  text-transform: uppercase;
  color: var(--text-dim);
}

.status {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 14px;
  border-radius: 999px;
  border: 1px solid var(--line);
  background: rgba(10, 13, 24, 0.55);
  backdrop-filter: blur(10px);
  font-size: 12.5px;
  color: var(--text-muted);
}

.status__dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--text-dim);
  box-shadow: 0 0 0 0 currentColor;
}

.status--online .status__dot {
  background: var(--success);
  animation: pulse 2.4s ease-out infinite;
  color: var(--success);
}

.status--degraded .status__dot {
  background: #fbbf24;
  animation: pulse 2.4s ease-out infinite;
  color: #fbbf24;
}

.status--offline .status__dot {
  background: var(--danger);
  animation: pulse 1.4s ease-out infinite;
  color: var(--danger);
}

.status__text {
  font-family: var(--font-mono);
  font-size: 12px;
}

.status__clock {
  padding-left: 10px;
  border-left: 1px solid var(--line);
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--text-dim);
}

@keyframes pulse {
  0% {
    box-shadow: 0 0 0 0 currentColor;
  }
  70% {
    box-shadow: 0 0 0 7px transparent;
  }
  100% {
    box-shadow: 0 0 0 0 transparent;
  }
}

/* ------------------------------- 主体 ------------------------------- */
.brand__body {
  max-width: 640px;
  display: flex;
  flex-direction: column;
  gap: 26px;
}

.eyebrow {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 12px;
  letter-spacing: 3px;
  text-transform: uppercase;
  color: var(--accent);
}

.eyebrow__line {
  width: 44px;
  height: 1px;
  background: linear-gradient(90deg, var(--accent), transparent);
}

.headline {
  font-size: clamp(34px, 3.9vw, 62px);
  line-height: 1.12;
  font-weight: 700;
  letter-spacing: -1px;
  text-shadow: 0 0 60px rgba(34, 211, 238, 0.18);
}

.headline__rotator {
  display: inline-flex;
  align-items: baseline;
  gap: 0.28em;
}

.headline__static {
  background: linear-gradient(120deg, #ffffff, #b8c6e8);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}

/* 轮播关键词：绝对定位叠放，各自错开动画相位 */
.rotator {
  position: relative;
  display: inline-block;
  min-width: 4.4em;
  height: 1.14em;
  vertical-align: baseline;
  overflow: hidden;
}

.rotator__word {
  position: absolute;
  inset: 0;
  background: linear-gradient(120deg, var(--accent), var(--accent-2) 55%, var(--accent-3));
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  opacity: 0;
  transform: translateY(0.5em);
  animation: rotate-word 9.6s cubic-bezier(0.4, 0, 0.2, 1) infinite;
}

/*
 * 每个词「完全不透明」的窗口占整轮的 25%（正好等于相邻词的动画延迟），
 * 淡出安排在 25%→27%、下一个词的淡入安排在它的 0%→2%，
 * 两段时间完全重合 —— 任意时刻两者透明度之和都约等于 1，既不会出现空档，
 * 也不会长时间重影。
 * （最初的写法 3%~22% 会留下 0.58s 的纯空白，截图正好拍在空档上。）
 */
@keyframes rotate-word {
  0% {
    opacity: 0;
    transform: translateY(0.45em) scale(0.97);
  }
  2% {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
  25% {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
  27% {
    opacity: 0;
    transform: translateY(-0.45em) scale(0.97);
  }
  100% {
    opacity: 0;
    transform: translateY(-0.45em) scale(0.97);
  }
}

.lede {
  max-width: 540px;
  font-size: 15px;
  line-height: 1.85;
  color: var(--text-muted);
}

.features {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 14px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.feature {
  display: flex;
  gap: 12px;
  padding: 15px 16px;
  border-radius: var(--radius);
  border: 1px solid var(--line);
  background: linear-gradient(160deg, rgba(20, 26, 46, 0.66), rgba(10, 13, 24, 0.36));
  backdrop-filter: blur(8px);
  transition: transform 0.35s ease, border-color 0.35s ease, box-shadow 0.35s ease;
}

.feature:hover {
  transform: translateY(-3px);
  border-color: rgba(34, 211, 238, 0.4);
  box-shadow: 0 18px 40px -26px rgba(34, 211, 238, 0.9);
}

.feature__icon {
  display: grid;
  place-items: center;
  flex: 0 0 34px;
  width: 34px;
  height: 34px;
  border-radius: 10px;
  color: var(--accent);
  background: rgba(34, 211, 238, 0.1);
  border: 1px solid rgba(34, 211, 238, 0.2);
}

.feature__text {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.feature__text strong {
  font-size: 13.5px;
  font-weight: 620;
}

.feature__text em {
  font-style: normal;
  font-size: 12px;
  line-height: 1.6;
  color: var(--text-dim);
}

/* ------------------------------- 底部 ------------------------------- */
.brand__foot {
  display: flex;
  gap: 34px;
  flex-wrap: wrap;
  padding-top: 20px;
  border-top: 1px solid var(--line);
}

.metric {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.metric strong {
  font-family: var(--font-mono);
  font-size: 17px;
  font-weight: 600;
  background: linear-gradient(120deg, #e8ecf7, #7dd3fc);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}

.metric span {
  font-size: 11.5px;
  letter-spacing: 0.6px;
  color: var(--text-dim);
}

/* ------------------------------- 光环 ------------------------------- */
.halo {
  position: absolute;
  right: -120px;
  bottom: -140px;
  width: 420px;
  height: 420px;
  pointer-events: none;
  opacity: 0.55;
}

.halo__ring {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  border: 1px solid transparent;
}

.halo__ring--outer {
  background:
    conic-gradient(from 0deg, transparent 0deg, rgba(34, 211, 238, 0.55) 60deg, transparent 140deg)
    border-box;
  -webkit-mask:
    linear-gradient(#000 0 0) padding-box,
    linear-gradient(#000 0 0);
  -webkit-mask-composite: xor;
  mask-composite: exclude;
  animation: spin 18s linear infinite;
}

.halo__ring--inner {
  inset: 52px;
  background:
    conic-gradient(from 180deg, transparent 0deg, rgba(139, 92, 246, 0.6) 70deg, transparent 160deg)
    border-box;
  -webkit-mask:
    linear-gradient(#000 0 0) padding-box,
    linear-gradient(#000 0 0);
  -webkit-mask-composite: xor;
  mask-composite: exclude;
  animation: spin 12s linear infinite reverse;
}

.halo__core {
  position: absolute;
  inset: 130px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(34, 211, 238, 0.24), transparent 70%);
  filter: blur(14px);
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

/* ------------------------------- 自适应 ------------------------------- */

/*
 * 「减少动态效果」下的退化：全局规则会把所有 animation 压成 0.001ms，
 * 动画结束后元素会回到基础样式 opacity:0 —— 四个词就全看不见了。
 * 所以这里显式关掉动画，只留第一个词静态显示。
 */
@media (prefers-reduced-motion: reduce) {
  .rotator__word {
    animation: none;
  }

  .rotator__word:not(:first-child) {
    display: none;
  }

  .rotator__word:first-child {
    opacity: 1;
    transform: none;
  }
}

@media (max-width: 1180px) {
  .brand__body {
    gap: 20px;
  }

  .features {
    grid-template-columns: 1fr;
  }

  .feature {
    padding: 12px 14px;
  }

  .brand__foot {
    gap: 22px;
  }
}

@media (max-width: 1023px) {
  .brand {
    padding: 22px 20px;
    gap: 16px;
  }

  .headline {
    font-size: clamp(26px, 5.2vw, 38px);
  }

  .lede,
  .features {
    display: none;
  }

  .brand__foot {
    display: none;
  }

  .halo {
    display: none;
  }
}
</style>
