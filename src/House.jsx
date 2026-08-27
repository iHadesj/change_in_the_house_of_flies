// A casa: silhueta geométrica que se desmonta. O quanto ela apodrece é o maior
// valor entre o avanço da faixa (--decay, escrito na raiz pelo player) e o
// avanço do scroll dentro da própria seção (--house-scroll, escrito aqui).
//
// Todo o movimento é transform/opacity em ~14 nós. Nada de filtro, nada de
// blur: no celular isso precisa custar quase nada mesmo com o resto rodando.

import { memo, useEffect, useRef } from 'react'
import { useInView } from './perf.js'

// dx/dy em px do viewBox, r em graus — o deslocamento de cada peça quando a
// decomposição chega a 1.
const PIECES = [
  { d: 'M18 94 L120 22', dx: -7, dy: -5, r: -3.2 },
  { d: 'M120 22 L222 94', dx: 8, dy: -6, r: 3.6 },
  { d: 'M10 94 L230 94', dx: 0, dy: -3, r: 0.8 },
  { d: 'M172 76 L172 40 L188 40 L188 84', dx: 11, dy: -12, r: 7 },
  { d: 'M40 94 L40 178', dx: -6, dy: 4, r: -2 },
  { d: 'M200 94 L200 178', dx: 6, dy: 3, r: 2 },
  { d: 'M26 178 L214 178', dx: 0, dy: 5, r: -0.6 },
  { d: 'M104 178 L104 130 L136 130 L136 178', dx: -3, dy: 2, r: -1.4 },
  { d: 'M62 112 L90 112 L90 140 L62 140 Z', dx: -9, dy: -2, r: -4.5 },
  { d: 'M150 112 L178 112 L178 140 L150 140 Z', dx: 9, dy: -1, r: 4 },
  { d: 'M76 112 L76 140 M62 126 L90 126', dx: -12, dy: 3, r: -6 },
  { d: 'M164 112 L164 140 M150 126 L178 126', dx: 12, dy: 2, r: 6 },
]

// Moscas escapando pela porta quando a casa já cedeu.
const LEAKS = [
  { x: 120, y: 168 },
  { x: 112, y: 156 },
  { x: 129, y: 150 },
  { x: 118, y: 140 },
  { x: 133, y: 163 },
  { x: 107, y: 145 },
]

function HouseGlyph({ stage }) {
  const sectionRef = useRef(null)
  const inView = useInView(sectionRef, '120px')

  useEffect(() => {
    const node = sectionRef.current
    if (!node || !inView) return undefined

    let frame = 0

    const measure = () => {
      frame = 0
      const rect = node.getBoundingClientRect()
      const viewport = window.innerHeight || 1
      // 0 quando a seção acabou de entrar por baixo, 1 um pouco antes de sair
      // por cima. O 1.35 antecipa o fim: a casa deve estar destruída enquanto
      // ainda dá pra ver.
      const raw = ((viewport - rect.top) / (viewport + rect.height)) * 1.35
      node.style.setProperty('--house-scroll', Math.min(1, Math.max(0, raw)).toFixed(3))
    }

    const onScroll = () => {
      if (frame) return
      frame = requestAnimationFrame(measure)
    }

    measure()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll, { passive: true })
    return () => {
      if (frame) cancelAnimationFrame(frame)
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
    }
  }, [inView])

  return (
    <div className="house" ref={sectionRef}>
      <svg viewBox="0 0 240 200" role="img" aria-label="Silhueta de uma casa se decompondo">
        {/* Fantasma verde deslocado: a separação de cor faz as vezes de glitch
            sem custar um filtro. */}
        <g className="house-ghost" aria-hidden="true">
          {PIECES.map((piece) => (
            <path
              key={`ghost-${piece.d}`}
              d={piece.d}
              style={{ '--dx': piece.dx, '--dy': piece.dy, '--r': piece.r }}
            />
          ))}
        </g>

        <g className="house-solid">
          <rect className="house-glow" x="62" y="112" width="28" height="28" />
          <rect className="house-glow" x="150" y="112" width="28" height="28" />
          {PIECES.map((piece) => (
            <path
              key={piece.d}
              d={piece.d}
              style={{ '--dx': piece.dx, '--dy': piece.dy, '--r': piece.r }}
            />
          ))}
          {LEAKS.map((leak, index) => (
            <circle
              key={`${leak.x}-${leak.y}`}
              className="house-leak"
              cx={leak.x}
              cy={leak.y}
              r="1.8"
              style={{ '--i': index }}
            />
          ))}
        </g>
      </svg>

      <div className="house-readout">
        <span>ESTRUTURA</span>
        <strong>{String(Math.max(0, 100 - stage)).padStart(3, '0')}%</strong>
        <i aria-hidden="true" />
      </div>
    </div>
  )
}

// `stage` é um inteiro: sem isso o componente re-renderizaria a cada
// `timeupdate` do áudio pra mostrar o mesmo número.
export default memo(HouseGlyph)
