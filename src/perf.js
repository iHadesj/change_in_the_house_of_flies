// Orçamento de custo por aparelho. Tudo aqui é medido uma vez, na carga: em vez
// de sondar desempenho em tempo real (que já é trabalho por si só), o app decide
// de antemão quantas partículas desenha, em que DPR e a que taxa de quadros.

import { useEffect, useRef, useState } from 'react'

const matches = (query) =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(query).matches
    : false

export const IS_TOUCH = matches('(pointer: coarse)')

// No iOS/iPadOS, rotear o <audio> pelo Web Audio (createMediaElementSource) faz o
// som morrer assim que a tela apaga: o sistema interrompe o AudioContext. Só o
// elemento de mídia "puro" sobrevive em segundo plano. Nesses aparelhos o
// espectro roda em modo simulado e o áudio fica intacto.
export const IS_APPLE_MOBILE =
  typeof navigator !== 'undefined' &&
  (/iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (/Mac/.test(navigator.userAgent) && navigator.maxTouchPoints > 1))

/** 'low' | 'mid' | 'high' — celular modesto, celular comum, desktop. */
export const TIER = (() => {
  if (typeof navigator === 'undefined') return 'high'
  const cores = navigator.hardwareConcurrency || (IS_TOUCH ? 4 : 8)
  // deviceMemory não existe no Safari; o palpite abaixo é conservador de propósito.
  const memory = navigator.deviceMemory || (IS_TOUCH ? 4 : 8)
  if (IS_TOUCH && (cores <= 4 || memory <= 3)) return 'low'
  if (IS_TOUCH || cores <= 4) return 'mid'
  return 'high'
})()

// Retina cheia só onde sobra GPU: o canvas de fundo cobre a tela inteira, e
// dobrar o DPR quadruplica o número de pixels de cada quadro.
export const CANVAS_DPR = { low: 1, mid: 1.5, high: 2 }[TIER]
export const CANVAS_FPS = { low: 24, mid: 30, high: 60 }[TIER]

// Moscas de ambiente: mínimo no silêncio, máximo no fim da faixa (--decay = 1).
export const FLY_MIN = { low: 8, mid: 14, high: 20 }[TIER]
export const FLY_MAX = { low: 34, mid: 68, high: 140 }[TIER]
export const BURST_CAP = { low: 80, mid: 160, high: 320 }[TIER]

// Colunas do enxame que faz as vezes de espectro no player.
export const SWARM_COLUMNS = { low: 22, mid: 32, high: 52 }[TIER]

export function useReducedMotion() {
  const [reduced, setReduced] = useState(() => matches('(prefers-reduced-motion: reduce)'))

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setReduced(query.matches)
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])

  return reduced
}

/** Aba em segundo plano: nenhum canvas precisa girar rAF gastando bateria. */
export function usePageVisible() {
  const [visible, setVisible] = useState(
    () => typeof document === 'undefined' || document.visibilityState === 'visible',
  )

  useEffect(() => {
    const update = () => setVisible(document.visibilityState === 'visible')
    document.addEventListener('visibilitychange', update)
    return () => document.removeEventListener('visibilitychange', update)
  }, [])

  return visible
}

/** Só anima o que está (quase) na tela. */
export function useInView(ref, rootMargin = '180px') {
  const [inView, setInView] = useState(true)

  useEffect(() => {
    const node = ref.current
    if (!node || typeof IntersectionObserver === 'undefined') return undefined

    const observer = new IntersectionObserver(
      ([entry]) => setInView(entry.isIntersecting),
      { rootMargin },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [ref, rootMargin])

  return inView
}

/**
 * Escreve uma custom property no elemento sem passar pelo React. A 60fps um
 * setState por quadro custaria um render inteiro; aqui é uma escrita de estilo.
 * Só grava quando o valor muda o bastante pra ser visível.
 */
export function useCssVar(ref, name, epsilon = 0.01) {
  const last = useRef(Number.NaN)

  return useRef((value) => {
    if (Math.abs(value - last.current) < epsilon) return
    last.current = value
    ref.current?.style.setProperty(name, value.toFixed(3))
  }).current
}
