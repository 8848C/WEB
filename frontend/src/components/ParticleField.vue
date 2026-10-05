<script setup>
/**
 * 粒子星链（Canvas 2D）
 *
 * 视觉构成：
 *   1. 漂浮粒子，按速度缓慢漂移，出界后从对侧回绕
 *   2. 距离越近的粒子之间连线越亮（按亮度分桶批量描边，避免逐条 stroke）
 *   3. 鼠标是「引力井」：附近粒子被推开，同时向光标连线
 *   4. 周期性从随机位置扩散冲击波，把粒子向外推
 *   5. 整体跟随鼠标做轻微视差
 *
 * 性能与礼貌：
 *   - 按 devicePixelRatio 渲染，避免高分屏发虚
 *   - 按容器面积决定粒子数并设上限
 *   - 标签页不可见时暂停 rAF
 *   - 系统开启「减少动态效果」时只画一帧静态图
 */

import { onBeforeUnmount, onMounted, ref } from 'vue'

const props = defineProps({
  /** 粒子数量上限 */
  maxParticles: { type: Number, default: 150 },
  /** 连线判定距离（CSS 像素） */
  linkDistance: { type: Number, default: 138 },
  /** 鼠标影响半径 */
  pointerRadius: { type: Number, default: 152 },
  /** 每像素的粒子密度 */
  density: { type: Number, default: 1 / 9000 },
})

const hostRef = ref(null)
const canvasRef = ref(null)

/** 调色板：青 / 紫 / 粉 / 天蓝 */
const PALETTE = [
  [34, 211, 238],
  [139, 92, 246],
  [244, 114, 182],
  [56, 189, 248],
]

const LINK_BUCKETS = 6

let ctx = null
let dpr = 1
let width = 0
let height = 0
let particles = []
let ripples = []
let sprites = []
let linkBuckets = []
let rafId = 0
let lastTs = 0
let rippleCooldown = 2.4
let running = false
let reducedMotion = false
let resizeObserver = null

const pointer = { x: -9999, y: -9999, targetX: 0, targetY: 0, x0: 0, y0: 0, active: false }

/* ------------------------------------------------------------------ */
/* 资源准备                                                            */
/* ------------------------------------------------------------------ */

/** 预渲染一张径向渐变贴图当粒子，比每帧 arc()+shadowBlur 快一个数量级。 */
function makeSprite([r, g, b]) {
  const size = 64
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size

  const c = canvas.getContext('2d')
  const half = size / 2
  const gradient = c.createRadialGradient(half, half, 0, half, half, half)
  gradient.addColorStop(0, `rgba(${r}, ${g}, ${b}, 1)`)
  gradient.addColorStop(0.28, `rgba(${r}, ${g}, ${b}, 0.62)`)
  gradient.addColorStop(0.62, `rgba(${r}, ${g}, ${b}, 0.16)`)
  gradient.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`)

  c.fillStyle = gradient
  c.fillRect(0, 0, size, size)
  return canvas
}

function createParticles() {
  const target = Math.min(
    props.maxParticles,
    Math.max(34, Math.round(width * height * props.density)),
  )

  particles = Array.from({ length: target }, () => {
    const angle = Math.random() * Math.PI * 2
    const speed = 0.1 + Math.random() * 0.26
    return {
      x: Math.random() * width,
      y: Math.random() * height,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      r: 0.9 + Math.random() * 2.1,
      sprite: Math.floor(Math.random() * PALETTE.length),
      phase: Math.random() * Math.PI * 2,
      pulse: 0.4 + Math.random() * 0.9,
    }
  })

  linkBuckets = Array.from({ length: LINK_BUCKETS }, () => [])
}

function spawnRipple(x, y, strength = 1) {
  ripples.push({ x, y, radius: 0, maxRadius: 210 + Math.random() * 190, strength })
  if (ripples.length > 6) ripples.shift()
}

/* ------------------------------------------------------------------ */
/* 尺寸                                                                */
/* ------------------------------------------------------------------ */

function resize() {
  const host = hostRef.value
  const canvas = canvasRef.value
  if (!host || !canvas) return

  const rect = host.getBoundingClientRect()
  const nextWidth = Math.max(1, Math.round(rect.width))
  const nextHeight = Math.max(1, Math.round(rect.height))
  const nextDpr = Math.min(window.devicePixelRatio || 1, 2)

  const changed =
    nextWidth !== width || nextHeight !== height || nextDpr !== dpr || particles.length === 0
  if (!changed) return

  width = nextWidth
  height = nextHeight
  dpr = nextDpr

  canvas.width = Math.round(width * dpr)
  canvas.height = Math.round(height * dpr)
  canvas.style.width = `${width}px`
  canvas.style.height = `${height}px`

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  createParticles()

  if (reducedMotion) draw(0)
}

/* ------------------------------------------------------------------ */
/* 逐帧更新                                                            */
/* ------------------------------------------------------------------ */

function update(dt) {
  const { linkDistance, pointerRadius } = props
  const repelRadius2 = pointerRadius * pointerRadius
  const time = performance.now() / 1000

  // 视差：整体朝鼠标方向轻微偏移
  pointer.x0 += (pointer.targetX - pointer.x0) * Math.min(1, dt * 3)
  pointer.y0 += (pointer.targetY - pointer.y0) * Math.min(1, dt * 3)

  // 冲击波计时
  rippleCooldown -= dt
  if (rippleCooldown <= 0) {
    rippleCooldown = 3.6 + Math.random() * 3.4
    spawnRipple(Math.random() * width, Math.random() * height, 0.9)
  }

  for (let i = ripples.length - 1; i >= 0; i--) {
    const ripple = ripples[i]
    ripple.radius += 132 * dt
    if (ripple.radius > ripple.maxRadius) ripples.splice(i, 1)
  }

  for (const p of particles) {
    // 呼吸脉动
    p.phase += dt * 0.9 * p.pulse

    // 鼠标：靠近时被推开
    if (pointer.active) {
      const dx = p.x - pointer.x
      const dy = p.y - pointer.y
      const d2 = dx * dx + dy * dy
      if (d2 < repelRadius2 && d2 > 0.01) {
        const d = Math.sqrt(d2)
        const force = (1 - d / pointerRadius) ** 2 * 46
        p.vx += (dx / d) * force * dt
        p.vy += (dy / d) * force * dt
      }
    }

    // 冲击波：位于波带上的粒子被向外推
    for (const ripple of ripples) {
      const dx = p.x - ripple.x
      const dy = p.y - ripple.y
      const d = Math.hypot(dx, dy) || 0.001
      const band = Math.abs(d - ripple.radius)
      if (band < 26) {
        const falloff = (1 - band / 26) * (1 - ripple.radius / ripple.maxRadius)
        const force = falloff * 62 * ripple.strength
        p.vx += (dx / d) * force * dt
        p.vy += (dy / d) * force * dt
      }
    }

    // 阻尼 + 保底速度，避免粒子彻底停下
    p.vx *= 0.995
    p.vy *= 0.995
    const speed = Math.hypot(p.vx, p.vy)
    if (speed < 0.045) {
      const angle = Math.random() * Math.PI * 2
      p.vx += Math.cos(angle) * 0.05
      p.vy += Math.sin(angle) * 0.05
    } else if (speed > 1.5) {
      p.vx = (p.vx / speed) * 1.5
      p.vy = (p.vy / speed) * 1.5
    }

    p.x += p.vx * dt * 60
    p.y += p.vy * dt * 60

    // 回绕（留 24px 余量，连线不会突然断在边缘）
    if (p.x < -24) p.x = width + 24
    else if (p.x > width + 24) p.x = -24
    if (p.y < -24) p.y = height + 24
    else if (p.y > height + 24) p.y = -24
  }
}

/* ------------------------------------------------------------------ */
/* 绘制                                                                */
/* ------------------------------------------------------------------ */

function draw(time) {
  if (!ctx) return

  ctx.clearRect(0, 0, width, height)
  ctx.globalCompositeOperation = 'lighter'

  const { linkDistance } = props
  const linkDistance2 = linkDistance * linkDistance
  const parallaxX = pointer.x0
  const parallaxY = pointer.y0

  for (const bucket of linkBuckets) bucket.length = 0

  // --- 粒子之间的连线：先按亮度归桶，再每桶一次 stroke ---
  for (let i = 0; i < particles.length; i++) {
    const a = particles[i]
    for (let j = i + 1; j < particles.length; j++) {
      const b = particles[j]
      const dx = a.x - b.x
      const dy = a.y - b.y
      if (dx > linkDistance || dx < -linkDistance) continue
      if (dy > linkDistance || dy < -linkDistance) continue

      const d2 = dx * dx + dy * dy
      if (d2 > linkDistance2) continue

      const closeness = 1 - Math.sqrt(d2) / linkDistance
      const bucket = Math.min(LINK_BUCKETS - 1, (closeness * LINK_BUCKETS) | 0)
      linkBuckets[bucket].push(a.x + parallaxX, a.y + parallaxY, b.x + parallaxX, b.y + parallaxY)
    }
  }

  ctx.lineWidth = 0.7
  for (let b = 0; b < LINK_BUCKETS; b++) {
    const points = linkBuckets[b]
    if (!points.length) continue
    ctx.strokeStyle = `rgba(104, 198, 255, ${(0.06 + (b / LINK_BUCKETS) * 0.42).toFixed(3)})`
    ctx.beginPath()
    for (let k = 0; k < points.length; k += 4) {
      ctx.moveTo(points[k], points[k + 1])
      ctx.lineTo(points[k + 2], points[k + 3])
    }
    ctx.stroke()
  }

  // --- 鼠标连线：更亮，做出「牵引」的感觉 ---
  if (pointer.active) {
    const pointerRadius = props.pointerRadius
    ctx.lineWidth = 0.9
    ctx.beginPath()
    for (const p of particles) {
      const dx = p.x - pointer.x
      const dy = p.y - pointer.y
      const d2 = dx * dx + dy * dy
      if (d2 > pointerRadius * pointerRadius) continue
      ctx.moveTo(p.x + parallaxX, p.y + parallaxY)
      ctx.lineTo(pointer.x, pointer.y)
    }
    ctx.strokeStyle = 'rgba(34, 211, 238, 0.2)'
    ctx.stroke()
  }

  // --- 冲击波圆环 ---
  for (const ripple of ripples) {
    const fade = Math.max(0, 1 - ripple.radius / ripple.maxRadius)
    ctx.beginPath()
    ctx.arc(ripple.x + parallaxX, ripple.y + parallaxY, ripple.radius, 0, Math.PI * 2)
    ctx.strokeStyle = `rgba(139, 92, 246, ${(fade * 0.24).toFixed(3)})`
    ctx.lineWidth = 1.1
    ctx.stroke()
  }

  // --- 粒子本体 ---
  ctx.globalCompositeOperation = 'lighter'
  for (const p of particles) {
    const twinkle = 0.62 + Math.sin(p.phase) * 0.38
    const radius = p.r * (2.6 + twinkle * 1.5)
    ctx.globalAlpha = Math.min(1, 0.28 + twinkle * 0.58)
    ctx.drawImage(
      sprites[p.sprite],
      p.x + parallaxX - radius,
      p.y + parallaxY - radius,
      radius * 2,
      radius * 2,
    )
  }
  ctx.globalAlpha = 1

  // --- 鼠标位置的柔光 ---
  if (pointer.active) {
    const glow = ctx.createRadialGradient(pointer.x, pointer.y, 0, pointer.x, pointer.y, 120)
    glow.addColorStop(0, 'rgba(34, 211, 238, 0.16)')
    glow.addColorStop(1, 'rgba(34, 211, 238, 0)')
    ctx.fillStyle = glow
    ctx.beginPath()
    ctx.arc(pointer.x, pointer.y, 120, 0, Math.PI * 2)
    ctx.fill()
  }

  ctx.globalCompositeOperation = 'source-over'
}

function frame(ts) {
  if (!running) return
  const dt = lastTs ? Math.min(0.05, (ts - lastTs) / 1000) : 0.016
  lastTs = ts

  update(dt)
  draw(ts)

  rafId = requestAnimationFrame(frame)
}

function start() {
  if (running || reducedMotion) return
  running = true
  lastTs = 0
  rafId = requestAnimationFrame(frame)
}

function stop() {
  running = false
  if (rafId) cancelAnimationFrame(rafId)
  rafId = 0
}

/* ------------------------------------------------------------------ */
/* 事件                                                                */
/* ------------------------------------------------------------------ */

function onPointerMove(event) {
  const rect = canvasRef.value?.getBoundingClientRect()
  if (!rect) return
  pointer.x = event.clientX - rect.left
  pointer.y = event.clientY - rect.top
  pointer.active = true

  // 视差幅度限制在 ±14px
  pointer.targetX = (pointer.x / Math.max(1, rect.width) - 0.5) * -26
  pointer.targetY = (pointer.y / Math.max(1, rect.height) - 0.5) * -20
}

function onPointerLeave() {
  pointer.active = false
  pointer.x = -9999
  pointer.y = -9999
  pointer.targetX = 0
  pointer.targetY = 0
}

function onPointerDown(event) {
  const rect = canvasRef.value?.getBoundingClientRect()
  if (!rect) return
  spawnRipple(event.clientX - rect.left, event.clientY - rect.top, 1.35)
}

function onVisibilityChange() {
  if (document.hidden) stop()
  else start()
}

/* ------------------------------------------------------------------ */
/* 生命周期                                                            */
/* ------------------------------------------------------------------ */

onMounted(() => {
  const canvas = canvasRef.value
  if (!canvas) return

  ctx = canvas.getContext('2d', { alpha: true })
  sprites = PALETTE.map(makeSprite)
  reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

  resize()

  resizeObserver = new ResizeObserver(() => {
    resize()
    if (reducedMotion) draw(0)
  })
  resizeObserver.observe(hostRef.value)

  if (reducedMotion) {
    // 静态一帧，保留视觉但不消耗持续算力
    draw(0)
  } else {
    start()
    window.addEventListener('pointermove', onPointerMove, { passive: true })
    window.addEventListener('pointerdown', onPointerDown, { passive: true })
    window.addEventListener('pointerleave', onPointerLeave, { passive: true })
    document.addEventListener('visibilitychange', onVisibilityChange)
  }
})

onBeforeUnmount(() => {
  stop()
  resizeObserver?.disconnect()
  resizeObserver = null
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerdown', onPointerDown)
  window.removeEventListener('pointerleave', onPointerLeave)
  document.removeEventListener('visibilitychange', onVisibilityChange)
  particles = []
  ripples = []
  linkBuckets = []
  sprites = []
  ctx = null
})
</script>

<template>
  <div ref="hostRef" class="particle-field" aria-hidden="true">
    <canvas ref="canvasRef" class="particle-field__canvas" />
  </div>
</template>

<style scoped>
.particle-field {
  position: absolute;
  inset: 0;
  overflow: hidden;
}

.particle-field__canvas {
  display: block;
  width: 100%;
  height: 100%;
}
</style>
