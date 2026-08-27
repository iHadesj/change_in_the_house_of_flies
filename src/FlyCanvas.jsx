// Casca React fina em volta do motor de canvas. Nenhum estado do React entra no
// laço de animação: o que muda por quadro é escrito direto no motor por ref.

import { useEffect, useRef } from 'react'
import { createFlyField, createSwarmMeter } from './flies.js'
import { useInView, usePageVisible, useReducedMotion } from './perf.js'

/**
 * Campo de moscas de tela cheia. `controlRef` recebe o motor pra quem estiver
 * de fora poder chamar `setDecay`, `setAgitation` e `burst`.
 */
export function FlyField({ controlRef, color = '#e8e4d8', opacity = 0.7 }) {
  const canvasRef = useRef(null)
  const reduced = useReducedMotion()
  const pageVisible = usePageVisible()

  useEffect(() => {
    const field = createFlyField(canvasRef.current, { color, opacity })
    controlRef.current = field
    return () => {
      controlRef.current = null
      field.destroy()
    }
  }, [color, controlRef, opacity])

  useEffect(() => {
    const field = controlRef.current
    if (!field) return undefined

    if (reduced) {
      // Movimento reduzido: as moscas existem, mas paradas.
      field.stop()
      field.paintStill()
      return undefined
    }

    if (!pageVisible) {
      field.stop()
      return undefined
    }

    field.start()
    return () => field.stop()
  }, [controlRef, pageVisible, reduced])

  return <canvas className="fly-field" ref={canvasRef} aria-hidden="true" />
}

/**
 * O medidor do player: em vez de barras, um enxame que se dispersa com o
 * volume de cada faixa de frequência.
 */
export function SwarmMeter({ analyser, isPlaying, audioRef, hot }) {
  const canvasRef = useRef(null)
  const engineRef = useRef(null)
  const dataRef = useRef(null)
  // Espelho mutável do estado: o laço lê daqui em vez de ser recriado a cada
  // mudança de prop (recriar o motor perderia o suavizado das colunas).
  const stateRef = useRef({ analyser, isPlaying, audioRef, hot })
  stateRef.current = { analyser, isPlaying, audioRef, hot }

  const reduced = useReducedMotion()
  const pageVisible = usePageVisible()
  const inView = useInView(canvasRef, '120px')

  useEffect(() => {
    // Objeto reaproveitado: alocar um por quadro só alimentaria o coletor.
    const frame = { data: null, playing: false, hot: false, clock: 0 }

    const read = () => {
      const state = stateRef.current
      frame.playing = state.isPlaying
      frame.hot = state.hot
      frame.clock = state.audioRef?.current?.currentTime ?? 0
      frame.data = null

      const { analyser: node } = state
      if (node && state.isPlaying) {
        if (dataRef.current?.length !== node.frequencyBinCount) {
          dataRef.current = new Uint8Array(node.frequencyBinCount)
        }
        node.getByteFrequencyData(dataRef.current)
        frame.data = dataRef.current
      }
      return frame
    }

    const meter = createSwarmMeter(canvasRef.current, { read })
    engineRef.current = meter
    return () => {
      engineRef.current = null
      meter.destroy()
    }
  }, [])

  useEffect(() => {
    const meter = engineRef.current
    if (!meter) return undefined

    if (reduced) {
      meter.stop()
      meter.paintStill()
      return undefined
    }

    if (!pageVisible || !inView) {
      meter.stop()
      return undefined
    }

    meter.start()
    return () => meter.stop()
  }, [inView, pageVisible, reduced])

  return <canvas className="swarm-meter" ref={canvasRef} aria-hidden="true" />
}
