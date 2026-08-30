// A casa: silhueta geométrica que se desmonta. O quanto ela apodrece é o maior
// valor entre o avanço da faixa (--decay, escrito na raiz pelo player) e o
// avanço do scroll dentro da própria seção (--house-scroll, escrito aqui).
//
// Todo o movimento é transform/opacity — 24 traços e 16 moscas, nenhuma delas
// animada por JS. Nada de filtro, nada de blur: no celular isso precisa custar
// quase nada mesmo com o campo de moscas do canvas rodando por cima.

import { memo, useEffect, useRef } from 'react'
import { useInView } from './perf.js'

// dx/dy em px do viewBox, r em graus — o deslocamento de cada peça quando a
// decomposição chega a 1. `t` é o ponto em que a peça começa a ceder: sem ele a
// casa desliza inteira de uma vez, o que parece um empurrão e não um colapso.
// O telhado vai primeiro, o piso por último.
const PIECES = [
  { d: 'M18 94 L120 22', dx: -19, dy: -15, r: -9.5, t: 0 },
  { d: 'M120 22 L222 94', dx: 22, dy: -17, r: 10.5, t: 0 },
  { d: 'M10 94 L230 94', dx: 0, dy: -9, r: 2.4, t: 0.12 },
  { d: 'M172 76 L172 40 L188 40 L188 84', dx: 32, dy: -36, r: 24, t: 0.04 },
  { d: 'M40 94 L40 178', dx: -18, dy: 12, r: -7, t: 0.22 },
  { d: 'M200 94 L200 178', dx: 18, dy: 10, r: 7, t: 0.22 },
  { d: 'M26 178 L214 178', dx: 0, dy: 14, r: -1.8, t: 0.46 },
  { d: 'M104 178 L104 130 L136 130 L136 178', dx: -9, dy: 7, r: -4.5, t: 0.3 },
  { d: 'M62 112 L90 112 L90 140 L62 140 Z', dx: -26, dy: -7, r: -15, t: 0.16 },
  { d: 'M150 112 L178 112 L178 140 L150 140 Z', dx: 26, dy: -5, r: 13, t: 0.16 },
  { d: 'M76 112 L76 140 M62 126 L90 126', dx: -35, dy: 10, r: -20, t: 0.1 },
  { d: 'M164 112 L164 140 M150 126 L178 126', dx: 35, dy: 8, r: 19, t: 0.1 },
]

// O CSS só multiplica: mandar o recíproco pronto evita `calc(x / (1 - var(--t)))`,
// que é divisão por expressão e nem todo motor aceita.
const RAMPS = PIECES.map((piece) => ({
  ...piece,
  k: Number((1 / (1 - piece.t)).toFixed(4)),
}))

// Moscas escapando da casa quando ela já cedeu: pela porta, pelas janelas e
// pelo rombo do telhado. `lx`/`ly` são a deriva de cada uma e `lr` o quanto ela
// gira na subida. `a` é o rumo em que ela já nasce apontando — sem ele as
// dezesseis sobem em formação, todas de cabeça pra cima, que é a única coisa
// que uma mosca nunca faz.
const LEAKS = [
  { x: 120, y: 168, s: 1, a: -14, lx: 5, ly: 58, lr: 26 },
  { x: 112, y: 156, s: 0.8, a: 48, lx: -9, ly: 72, lr: -34 },
  { x: 129, y: 150, s: 0.9, a: -62, lx: 13, ly: 64, lr: 18 },
  { x: 118, y: 140, s: 0.7, a: 118, lx: -4, ly: 86, lr: 40 },
  { x: 133, y: 163, s: 1.05, a: -35, lx: 18, ly: 52, lr: -22 },
  { x: 107, y: 145, s: 0.75, a: 87, lx: -15, ly: 78, lr: 30 },
  { x: 76, y: 126, s: 0.95, a: 152, lx: -21, ly: 66, lr: -28 },
  { x: 66, y: 118, s: 0.7, a: -104, lx: -12, ly: 84, lr: 36 },
  { x: 86, y: 134, s: 0.85, a: 26, lx: -26, ly: 54, lr: -16 },
  { x: 164, y: 126, s: 0.95, a: -128, lx: 22, ly: 68, lr: 24 },
  { x: 174, y: 118, s: 0.7, a: 64, lx: 14, ly: 88, lr: -38 },
  { x: 154, y: 134, s: 0.88, a: 173, lx: 27, ly: 56, lr: 20 },
  { x: 120, y: 58, s: 0.8, a: -46, lx: 3, ly: 46, lr: -30 },
  { x: 100, y: 74, s: 0.65, a: 108, lx: -17, ly: 50, lr: 32 },
  { x: 142, y: 70, s: 0.72, a: -158, lx: 16, ly: 44, lr: -24 },
  { x: 180, y: 46, s: 0.6, a: 12, lx: 24, ly: 40, lr: 28 },
]

/**
 * Uma mosca no viewBox da casa: cabeça, corpo e duas asas que batem. É o mesmo
 * desenho do sprite do canvas, em SVG — o que escapa da casa precisa ser
 * reconhecível como bicho, e um círculo de raio 1.8 era poeira.
 *
 * Quatro níveis de <g>, e a ordem importa:
 *   1. posiciona e dimensiona (atributo `transform`);
 *   2. `.house-leak` anima a fuga — precisa vir ANTES do rumo, senão a subida
 *      herdaria a rotação e a mosca virada pra baixo escaparia pro chão;
 *   3. o rumo em que o bicho aponta;
 *   4. a asa, girada na geometria pra que o CSS possa animá-la.
 * Separados porque a propriedade CSS `transform` sobrescreve o atributo de
 * mesmo nome — empilhados num elemento só, um apagaria o outro.
 */
function LeakFly({ leak, index }) {
  return (
    <g transform={`translate(${leak.x} ${leak.y}) scale(${leak.s})`}>
      <g
        className="house-leak"
        style={{ '--i': index, '--lx': leak.lx, '--ly': leak.ly, '--lr': leak.lr }}
      >
        <g transform={`rotate(${leak.a})`}>
          <g transform="rotate(-32 -2.1 -1.6)">
            <ellipse className="leak-wing" cx="-2.1" cy="-1.6" rx="2.7" ry="1.05" />
          </g>
          <g transform="rotate(32 2.1 -1.6)">
            <ellipse className="leak-wing" cx="2.1" cy="-1.6" rx="2.7" ry="1.05" />
          </g>
          <ellipse className="leak-body" cx="0" cy="0.7" rx="1.2" ry="2.1" />
          <circle className="leak-body" cx="0" cy="-1.8" r="1" />
        </g>
      </g>
    </g>
  )
}

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
          {RAMPS.map((piece) => (
            <path
              key={`ghost-${piece.d}`}
              d={piece.d}
              style={{
                '--dx': piece.dx,
                '--dy': piece.dy,
                '--r': piece.r,
                '--t': piece.t,
                '--k': piece.k,
              }}
            />
          ))}
        </g>

        <g className="house-solid">
          <rect className="house-glow" x="62" y="112" width="28" height="28" />
          <rect className="house-glow" x="150" y="112" width="28" height="28" />
          {RAMPS.map((piece) => (
            <path
              key={piece.d}
              d={piece.d}
              style={{
                '--dx': piece.dx,
                '--dy': piece.dy,
                '--r': piece.r,
                '--t': piece.t,
                '--k': piece.k,
              }}
            />
          ))}
          <g className="house-leaks">
            {LEAKS.map((leak, index) => (
              <LeakFly key={`${leak.x}-${leak.y}`} leak={leak} index={index} />
            ))}
          </g>
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
