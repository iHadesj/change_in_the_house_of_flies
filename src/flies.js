// Motor de moscas em canvas, sem React e sem dependência de DOM além do próprio
// <canvas>. Duas saídas: o campo de fundo (ambiente + enxame do easter egg) e o
// medidor do player, que substitui as barras de espectro por um enxame.
//
// Regras de custo que valem pros dois:
//   - nada de shadowBlur, gradiente por partícula ou save/restore por quadro:
//     tudo é drawImage de um sprite pré-renderizado;
//   - a rotação também é pré-renderizada (8 ângulos), então nenhum quadro paga
//     transformação de matriz por mosca;
//   - o rAF respeita um alvo de fps e pula quadros em vez de rodar solto.

import { BURST_CAP, CANVAS_DPR, CANVAS_FPS, FLY_MAX, FLY_MIN, SWARM_COLUMNS } from './perf.js'

const ANGLE_STEPS = 8
const SIZES = [5, 7, 11]
const TAU = Math.PI * 2

const spriteCache = new Map()

/** A mosca do projeto, desenhada no mesmo viewBox 24×24 do ícone SVG. */
function paintFly(ctx, unit, color) {
  const ellipse = (cx, cy, rx, ry, rotation) => {
    ctx.beginPath()
    ctx.ellipse(cx * unit, cy * unit, rx * unit, ry * unit, rotation, 0, TAU)
    ctx.fill()
  }

  ctx.fillStyle = color
  ellipse(12, 13, 2.1, 4.2, 0)
  ctx.globalAlpha = 0.66
  ellipse(7.4, 8.6, 4.6, 2.1, (-28 * Math.PI) / 180)
  ellipse(16.6, 8.6, 4.6, 2.1, (28 * Math.PI) / 180)
  ctx.globalAlpha = 1
}

function buildSprite(size, angle, color, dpr) {
  const box = Math.ceil(size * 1.6)
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(2, Math.round(box * dpr))
  canvas.height = canvas.width

  const ctx = canvas.getContext('2d')
  ctx.scale(dpr, dpr)
  ctx.translate(box / 2, box / 2)
  // O glifo aponta pra cima; +90° faz o ângulo 0 virar "andando pra direita".
  ctx.rotate(angle + Math.PI / 2)
  ctx.translate(-size / 2, -size / 2)
  paintFly(ctx, size / 24, color)

  return { canvas, box }
}

/**
 * Conjunto [tamanho][ângulo] de sprites. O cache é global de propósito: o campo
 * de fundo e o medidor do player compartilham as mesmas texturas.
 */
export function getSprites(color, dpr = CANVAS_DPR) {
  const key = `${color}|${dpr}`
  const cached = spriteCache.get(key)
  if (cached) return cached

  const set = SIZES.map((size) =>
    Array.from({ length: ANGLE_STEPS }, (_, index) =>
      buildSprite(size, (index / ANGLE_STEPS) * TAU, color, dpr),
    ),
  )
  spriteCache.set(key, set)
  return set
}

const random = (min, max) => min + Math.random() * (max - min)

/**
 * Voo de mosca: trechos quase retos interrompidos por viradas bruscas. É o que
 * separa "mosca" de "poeira flutuando" — a virada é o movimento característico.
 */
class Fly {
  constructor(width, height) {
    this.reset(width, height, true)
  }

  reset(width, height, anywhere) {
    this.x = anywhere ? Math.random() * width : random(-20, width + 20)
    this.y = anywhere ? Math.random() * height : random(-20, height + 20)
    this.direction = Math.random() * TAU
    this.speed = random(14, 46)
    this.turnIn = random(0.14, 0.9)
    this.wobble = random(3, 9)
    this.phase = Math.random() * TAU
    this.size = Math.random() < 0.62 ? 0 : Math.random() < 0.8 ? 1 : 2
    this.alpha = random(0.24, 0.72)
  }

  step(delta, agitation, width, height) {
    this.turnIn -= delta
    if (this.turnIn <= 0) {
      // Agitada, a mosca vira mais vezes e com ângulo maior.
      this.direction += random(-1, 1) * (1.1 + agitation * 1.8)
      this.speed = random(14, 46) * (1 + agitation * 2.4)
      this.turnIn = random(0.12, 0.85) / (1 + agitation)
    }

    this.phase += delta * this.wobble
    this.direction += Math.sin(this.phase) * 0.05

    this.x += Math.cos(this.direction) * this.speed * delta
    this.y += Math.sin(this.direction) * this.speed * delta

    // Tela toroidal: sai de um lado, entra do outro. Sem reposicionamento
    // aleatório, que criaria "piscadas" no canto do olho.
    const margin = 24
    if (this.x < -margin) this.x = width + margin
    else if (this.x > width + margin) this.x = -margin
    if (this.y < -margin) this.y = height + margin
    else if (this.y > height + margin) this.y = -margin
  }
}

/** Mosca do enxame do easter egg: nasce, se espalha e apodrece em ~2s. */
class Burst {
  constructor(x, y, width, height, fromPoint) {
    if (fromPoint) {
      this.x = x + random(-14, 14)
      this.y = y + random(-14, 14)
      this.speed = random(160, 620)
    } else {
      // Parte do enxame nasce espalhada pela tela: só radiando do ponto, o
      // efeito vira "explosão", e o que se quer é a tela tomada.
      this.x = Math.random() * width
      this.y = Math.random() * height
      this.speed = random(40, 220)
    }
    this.direction = Math.random() * TAU
    this.turnIn = random(0.05, 0.3)
    this.life = 0
    this.span = random(1.1, 2.1)
    this.size = Math.random() < 0.5 ? 0 : Math.random() < 0.75 ? 1 : 2
  }

  step(delta) {
    this.life += delta
    this.turnIn -= delta
    if (this.turnIn <= 0) {
      this.direction += random(-1.6, 1.6)
      this.turnIn = random(0.04, 0.24)
    }
    this.speed *= 1 - Math.min(0.9, delta * 2.4)
    this.x += Math.cos(this.direction) * this.speed * delta
    this.y += Math.sin(this.direction) * this.speed * delta
    return this.life < this.span
  }

  get alpha() {
    const t = this.life / this.span
    // Sobe rápido, sustenta, some devagar.
    return t < 0.12 ? t / 0.12 : Math.max(0, 1 - (t - 0.12) / 0.88)
  }
}

function fitCanvas(canvas, dpr) {
  const width = Math.max(1, canvas.clientWidth)
  const height = Math.max(1, canvas.clientHeight)
  const pixelWidth = Math.round(width * dpr)
  const pixelHeight = Math.round(height * dpr)

  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth
    canvas.height = pixelHeight
    return { width, height, changed: true }
  }
  return { width, height, changed: false }
}

/**
 * Laço de animação compartilhado: alvo de fps, dt limitado (uma aba que volta do
 * fundo não pode entregar um delta de 8 segundos) e parada limpa.
 */
function createLoop(step, fps) {
  const interval = 1000 / fps
  let frame = 0
  let previous = 0

  const tick = (now) => {
    frame = requestAnimationFrame(tick)
    const elapsed = now - previous
    // -2ms de folga: a 60fps o rAF entrega 16.6ms e um `>= 16.6` perderia quadros.
    if (elapsed < interval - 2) return
    previous = now
    step(Math.min(elapsed, 90) / 1000)
  }

  return {
    start() {
      if (frame) return
      previous = performance.now()
      frame = requestAnimationFrame(tick)
    },
    stop() {
      if (!frame) return
      cancelAnimationFrame(frame)
      frame = 0
    },
  }
}

/**
 * Campo de moscas de tela cheia.
 *
 * `setDecay(0..1)`  quantas moscas existem — sobe conforme a faixa avança.
 * `setAgitation(0..1)` o quanto elas surtam — vem do analisador de áudio.
 * `burst(x, y, n)`  o enxame do easter egg.
 */
export function createFlyField(canvas, options = {}) {
  const {
    color = '#e8e4d8',
    dpr = CANVAS_DPR,
    fps = CANVAS_FPS,
    min = FLY_MIN,
    max = FLY_MAX,
    burstCap = BURST_CAP,
    opacity = 1,
  } = options

  const ctx = canvas.getContext('2d')
  const sprites = getSprites(color, dpr)
  const flies = []
  const swarm = []
  // Retângulos sujos do quadro anterior. Limpar só onde teve mosca em vez da
  // tela inteira: este canvas cobre o viewport, e num monitor 4K a 2x um
  // `clearRect` de tela cheia toca 8 milhões de pixels a cada quadro pra
  // apagar umas poucas dezenas de bichos de 8px.
  let dirty = []
  let spare = []

  let width = 1
  let height = 1
  let active = min
  let agitation = 0
  let agitationTarget = 0

  const measure = () => {
    const size = fitCanvas(canvas, dpr)
    width = size.width
    height = size.height
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    // Redimensionar já zera o bitmap; o histórico de sujeira perde o sentido.
    dirty.length = 0
  }

  const drawOne = (particle, alpha) => {
    if (alpha <= 0.01) return
    const turn = (((particle.direction % TAU) + TAU) % TAU) / TAU
    const angle = Math.min(ANGLE_STEPS - 1, Math.floor(turn * ANGLE_STEPS))
    const sprite = sprites[particle.size][angle]
    const x = particle.x - sprite.box / 2
    const y = particle.y - sprite.box / 2

    ctx.globalAlpha = alpha
    ctx.drawImage(sprite.canvas, x, y, sprite.box, sprite.box)
    spare.push(x, y, sprite.box)
  }

  const step = (delta) => {
    agitation += (agitationTarget - agitation) * Math.min(1, delta * 3)

    while (flies.length < active) flies.push(new Fly(width, height))

    // O +1 de folga cobre o antialiasing da borda do sprite.
    for (let index = 0; index < dirty.length; index += 3) {
      const size = dirty[index + 2] + 2
      ctx.clearRect(dirty[index] - 1, dirty[index + 1] - 1, size, size)
    }

    dirty.length = 0

    for (let index = 0; index < active && index < flies.length; index += 1) {
      const fly = flies[index]
      fly.step(delta, agitation, width, height)
      drawOne(fly, fly.alpha * opacity * (0.7 + agitation * 0.3))
    }

    for (let index = swarm.length - 1; index >= 0; index -= 1) {
      const particle = swarm[index]
      if (particle.step(delta)) drawOne(particle, particle.alpha * 0.9)
      else swarm.splice(index, 1)
    }

    // O que acabou de ser desenhado é a sujeira do próximo quadro. Os dois
    // arrays só trocam de papel — nenhuma alocação por quadro.
    const drawn = spare
    spare = dirty
    dirty = drawn

    ctx.globalAlpha = 1
  }

  const loop = createLoop(step, fps)
  measure()

  // ResizeObserver em vez de `resize` na window: pega mudança de layout e a
  // barra de endereço do celular entrando e saindo, sem ouvir a página inteira.
  const observer =
    typeof ResizeObserver === 'function'
      ? new ResizeObserver(() => {
          measure()
        })
      : null
  observer?.observe(canvas)

  return {
    start: loop.start,
    stop: loop.stop,
    setDecay(value) {
      const clamped = Math.min(1, Math.max(0, value))
      active = Math.round(min + (max - min) * clamped)
    },
    setAgitation(value) {
      agitationTarget = Math.min(1, Math.max(0, value))
    },
    burst(x, y, amount) {
      const room = Math.min(amount, burstCap - swarm.length)
      for (let index = 0; index < room; index += 1) {
        // Metade explode do ponto tocado, metade já nasce espalhada: só
        // radiando do dedo o efeito vira explosão, e o que se quer é a tela
        // tomada por dois segundos.
        swarm.push(new Burst(x, y, width, height, index % 2 === 0))
      }
    },
    /** Um quadro isolado, pra quem prefere movimento reduzido ver algo. */
    paintStill() {
      measure()
      step(0)
    },
    destroy() {
      loop.stop()
      observer?.disconnect()
      flies.length = 0
      swarm.length = 0
    },
  }
}

/**
 * O "espectro" do player: cada coluna de frequência vira um punhado de moscas
 * que se dispersam com o volume daquela faixa. Silêncio junta tudo numa linha.
 */
export function createSwarmMeter(canvas, options = {}) {
  const {
    read,
    color = '#e8e4d8',
    hotColor = '#a3b347',
    dpr = CANVAS_DPR,
    fps = CANVAS_FPS,
    columns = SWARM_COLUMNS,
  } = options

  const ctx = canvas.getContext('2d')
  const cool = getSprites(color, dpr)
  const warm = getSprites(hotColor, dpr)

  let width = 1
  let height = 1
  let count = columns
  const level = new Float32Array(columns)
  const phase = new Float32Array(columns)
  for (let index = 0; index < columns; index += 1) phase[index] = Math.random() * TAU

  const measure = () => {
    const size = fitCanvas(canvas, dpr)
    width = size.width
    height = size.height
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    // Em tela estreita, menos colunas: mosca espremida vira sujeira.
    count = Math.max(12, Math.min(columns, Math.floor(width / 9)))
  }

  let clock = 0

  const step = (delta) => {
    clock += delta
    const frame = read()
    const data = frame.data
    const hot = frame.hot
    const sprites = hot ? warm : cool

    ctx.clearRect(0, 0, width, height)

    const middle = height / 2
    const spacing = width / count
    const reach = height * 0.44

    // Fio da linha de base: dá chão pro enxame e some quando tudo cala.
    ctx.globalAlpha = 0.16
    ctx.fillStyle = hot ? hotColor : color
    ctx.fillRect(0, middle - 0.5, width, 1)

    for (let index = 0; index < count; index += 1) {
      let raw = 0
      if (data) {
        // Só a metade baixa do espectro: os agudos são quase só ruído aqui.
        const bin = Math.floor((index / count) * data.length * 0.7)
        raw = data[bin] / 255
      } else if (frame.playing) {
        // Sem analisador (iOS em segundo plano), o desenho segue o relógio da faixa.
        const rolloff = 1 - (index / count) * 0.5
        raw =
          0.1 +
          (Math.abs(Math.sin(frame.clock * 3.1 + index * 0.87)) * 0.36 +
            Math.abs(Math.sin(frame.clock * 1.2 + index * 0.29)) * 0.24) *
            rolloff
      } else {
        raw = 0.05
      }

      const current = level[index] + (raw - level[index]) * (raw > level[index] ? 0.42 : 0.12)
      level[index] = current
      phase[index] += delta * (2 + current * 14)

      const x = index * spacing + spacing / 2
      const spread = current * reach
      const shiver = Math.sin(phase[index]) * spread * 0.5
      const drift = Math.cos(phase[index] * 0.7) * spacing * 0.5 * current

      const size = current > 0.62 ? 2 : current > 0.3 ? 1 : 0
      const set = sprites[size]
      const angleUp = Math.abs(Math.floor(phase[index] * 0.6)) % ANGLE_STEPS
      const angleDown = (angleUp + 4) % ANGLE_STEPS

      ctx.globalAlpha = 0.28 + current * 0.7
      const top = set[angleUp]
      ctx.drawImage(
        top.canvas,
        x + drift - top.box / 2,
        middle - spread + shiver * 0.3 - top.box / 2,
        top.box,
        top.box,
      )

      const bottom = set[angleDown]
      ctx.drawImage(
        bottom.canvas,
        x - drift - bottom.box / 2,
        middle + spread - shiver * 0.3 - bottom.box / 2,
        bottom.box,
        bottom.box,
      )
    }

    ctx.globalAlpha = 1
  }

  const loop = createLoop(step, fps)
  measure()

  const observer =
    typeof ResizeObserver === 'function'
      ? new ResizeObserver(() => {
          measure()
        })
      : null
  observer?.observe(canvas)

  return {
    start: loop.start,
    stop: loop.stop,
    paintStill() {
      measure()
      step(0.016)
    },
    destroy() {
      loop.stop()
      observer?.disconnect()
    },
  }
}
