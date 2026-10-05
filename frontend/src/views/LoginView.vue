<script setup>
/**
 * 登录页外壳。
 *
 * 桌面端布局：左 2/3 视觉效果 + 右 1/3 登录界面
 *   grid-template-columns: 2fr 1fr
 * 移动端：视觉区压缩成顶部一条，登录卡片占满剩余空间
 */
import { useRoute, useRouter } from 'vue-router'

import BrandPanel from '@/components/BrandPanel.vue'
import LoginCard from '@/components/LoginCard.vue'
import ParticleField from '@/components/ParticleField.vue'

const router = useRouter()
const route = useRoute()

function onSuccess() {
  const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : '/dashboard'
  router.replace(redirect)
}
</script>

<template>
  <main class="login-shell">
    <!-- 背景：极光 + 网格 + 暗角，铺满整页 -->
    <div class="backdrop" aria-hidden="true">
      <span class="blob blob--a" />
      <span class="blob blob--b" />
      <span class="blob blob--c" />
      <span class="grid" />
      <span class="noise" />
      <span class="vignette" />
    </div>

    <!-- 左侧 2/3 -->
    <section class="stage">
      <ParticleField />
      <BrandPanel />
      <span class="stage__edge" aria-hidden="true" />
    </section>

    <!-- 右侧 1/3 -->
    <aside class="access">
      <LoginCard @success="onSuccess" />
    </aside>
  </main>
</template>

<style scoped>
.login-shell {
  position: relative;
  display: grid;
  grid-template-columns: 2fr 1fr;
  height: 100%;
  isolation: isolate;
  background: radial-gradient(120% 100% at 0% 0%, #0a1024 0%, #05060c 55%, #04050a 100%);
}

/* ----------------------------- 背景装饰 ----------------------------- */
.backdrop {
  position: absolute;
  inset: 0;
  z-index: 0;
  overflow: hidden;
  pointer-events: none;
}

.blob {
  position: absolute;
  border-radius: 50%;
  filter: blur(96px);
  opacity: 0.55;
  will-change: transform;
}

.blob--a {
  top: -18%;
  left: -8%;
  width: 46vw;
  height: 46vw;
  background: radial-gradient(circle, rgba(34, 211, 238, 0.55), transparent 68%);
  animation: drift-a 22s ease-in-out infinite;
}

.blob--b {
  top: 22%;
  left: 26%;
  width: 40vw;
  height: 40vw;
  background: radial-gradient(circle, rgba(139, 92, 246, 0.5), transparent 68%);
  animation: drift-b 27s ease-in-out infinite;
}

.blob--c {
  bottom: -22%;
  left: 2%;
  width: 38vw;
  height: 38vw;
  background: radial-gradient(circle, rgba(244, 114, 182, 0.34), transparent 70%);
  animation: drift-c 31s ease-in-out infinite;
}

@keyframes drift-a {
  0%,
  100% {
    transform: translate3d(0, 0, 0) scale(1);
  }
  50% {
    transform: translate3d(6%, 5%, 0) scale(1.12);
  }
}

@keyframes drift-b {
  0%,
  100% {
    transform: translate3d(0, 0, 0) scale(1.06);
  }
  50% {
    transform: translate3d(-7%, -4%, 0) scale(0.94);
  }
}

@keyframes drift-c {
  0%,
  100% {
    transform: translate3d(0, 0, 0) scale(1);
  }
  50% {
    transform: translate3d(5%, -6%, 0) scale(1.14);
  }
}

.grid {
  position: absolute;
  inset: 0;
  background-image:
    linear-gradient(rgba(120, 160, 230, 0.07) 1px, transparent 1px),
    linear-gradient(90deg, rgba(120, 160, 230, 0.07) 1px, transparent 1px);
  background-size: 58px 58px;
  mask-image: radial-gradient(120% 90% at 30% 30%, #000 20%, transparent 78%);
  -webkit-mask-image: radial-gradient(120% 90% at 30% 30%, #000 20%, transparent 78%);
}

.noise {
  position: absolute;
  inset: 0;
  opacity: 0.16;
  background-image: repeating-linear-gradient(
    0deg,
    rgba(255, 255, 255, 0.045) 0px,
    rgba(255, 255, 255, 0.045) 1px,
    transparent 1px,
    transparent 3px
  );
  mix-blend-mode: overlay;
}

.vignette {
  position: absolute;
  inset: 0;
  background: radial-gradient(115% 95% at 32% 42%, transparent 42%, rgba(2, 3, 8, 0.82) 100%);
}

/* ----------------------------- 左侧舞台 ----------------------------- */
.stage {
  position: relative;
  z-index: 2;
  overflow: hidden;
}

.stage__edge {
  position: absolute;
  top: 0;
  right: 0;
  width: 1px;
  height: 100%;
  background: linear-gradient(
    180deg,
    transparent,
    rgba(34, 211, 238, 0.5) 22%,
    rgba(139, 92, 246, 0.5) 68%,
    transparent
  );
  box-shadow: 0 0 26px rgba(34, 211, 238, 0.35);
}

/* ----------------------------- 右侧登录区 ----------------------------- */
.access {
  position: relative;
  z-index: 3;
  border-left: 1px solid rgba(139, 160, 210, 0.08);
  background: linear-gradient(200deg, rgba(10, 13, 26, 0.55), rgba(4, 5, 10, 0.82));
  backdrop-filter: blur(6px);
}

/* ----------------------------- 响应式 ----------------------------- */
@media (max-width: 1023px) {
  .login-shell {
    grid-template-columns: 1fr;
    grid-template-rows: minmax(170px, 27vh) 1fr;
    height: 100%;
  }

  .stage__edge {
    top: auto;
    bottom: 0;
    width: 100%;
    height: 1px;
    background: linear-gradient(90deg, transparent, rgba(34, 211, 238, 0.45), transparent);
  }

  .access {
    border-left: none;
    border-top: 1px solid rgba(139, 160, 210, 0.08);
    overflow-y: auto;
  }

  .blob--a,
  .blob--b,
  .blob--c {
    filter: blur(70px);
  }
}
</style>
