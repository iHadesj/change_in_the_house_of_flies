// Linha da letra sendo datilografada. O texto é escrito direto no nó de texto:
// um setState por caractere significaria um render do React a cada ~30ms, e a
// linha ativa é justamente a que já divide quadro com o canvas e o áudio.

import { useLayoutEffect, useRef } from 'react'
import { useReducedMotion } from './perf.js'

export default function TypedLine({ text, typing, budget = 2.6 }) {
  const ref = useRef(null)
  const reduced = useReducedMotion()

  // useLayoutEffect, e não useEffect: as linhas paradas precisam do texto
  // antes da pintura. Com o efeito rodando depois, o painel abriria com
  // dezenas de linhas em branco por um quadro.
  useLayoutEffect(() => {
    const node = ref.current
    if (!node) return undefined

    if (!typing || reduced) {
      node.textContent = text
      return undefined
    }

    // A linha tem que terminar de aparecer antes da próxima entrar; o piso de
    // 22 caracteres/s evita que um verso curto seja escrito devagar demais.
    const window_ = Math.min(Math.max(budget, 0.5), 3.4) * 0.62
    const speed = Math.max(22, text.length / window_)
    const start = performance.now()
    let painted = -1
    let frame = 0

    const step = (now) => {
      const chars = Math.min(text.length, Math.floor(((now - start) / 1000) * speed))
      if (chars !== painted) {
        painted = chars
        node.textContent = text.slice(0, chars)
      }
      if (chars < text.length) frame = requestAnimationFrame(step)
      else frame = 0
    }

    node.textContent = ''
    frame = requestAnimationFrame(step)
    return () => {
      if (frame) cancelAnimationFrame(frame)
    }
  }, [budget, reduced, text, typing])

  // aria-hidden: quem usa leitor de tela recebe o texto inteiro pelo
  // aria-label do botão, não a versão pela metade.
  return <span className="lyric-text" ref={ref} aria-hidden="true" />
}
