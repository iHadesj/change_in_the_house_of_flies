import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  BookOpen,
  Bug,
  Copy,
  Download,
  FileDown,
  Mic2,
  Pause,
  Play,
  Repeat,
  SkipBack,
  Trash2,
  Undo2,
  Upload,
  Volume2,
  VolumeX,
  X,
  Zap,
} from 'lucide-react'
import {
  SECTION_LABELS,
  SECTION_ORDER,
  blockRange,
  blockSignature,
  buildSectionRanges,
  deriveFromTwin,
  findActiveIndex,
  listBlocks,
  formatTimestamp,
  parseLyrics,
  readStoredLyrics,
  shiftLines,
  toLrc,
  writeStoredLyrics,
} from './lyrics.js'
import { FlyField, SwarmMeter } from './FlyCanvas.jsx'
import House from './House.jsx'
import TypedLine from './TypedLine.jsx'
import { MEANING, MEANING_LEAD, splitKeywords } from './meaning.js'
import { IS_APPLE_MOBILE, IS_TOUCH, useCssVar, useReducedMotion } from './perf.js'

const DEFAULT_DURATION = '04:58'
const AUDIO_PATH = `${import.meta.env.BASE_URL}music/change.mp3`
const ARTWORK_PATH = `${import.meta.env.BASE_URL}assets/change-app-icon.png`
const LYRICS_PATHS = [
  `${import.meta.env.BASE_URL}lyrics/change.lrc`,
  `${import.meta.env.BASE_URL}lyrics/change.txt`,
]

const STAGES = [
  ['01', 'OBSERVAÇÃO', 'A casa ainda de pé. Alguém olha.'],
  ['02', 'METAMORFOSE', 'O corpo do outro deixa de ser o mesmo.'],
  ['03', 'ASAS ARRANCADAS', 'O riso vem depois da queda.'],
  ['04', 'ZUMBIDO', 'Não sobrou casa. Só o que mora nela.'],
]

/**
 * Trava de rolagem à prova de iOS: `overflow: hidden` no body não segura o
 * Safari mobile — o toque vaza pra página de trás e o painel parece "morto".
 * Fixando o body e devolvendo o scrollY depois, só o painel rola.
 */
function useScrollLock(active, focusRef, onEscape) {
  useEffect(() => {
    if (!active) return undefined

    const { body, documentElement: html } = document
    const scrollY = window.scrollY || html.scrollTop || 0
    const previousStyle = body.getAttribute('style')
    const previousFocus = document.activeElement

    Object.assign(body.style, {
      position: 'fixed',
      top: `${-scrollY}px`,
      left: '0',
      right: '0',
      width: '100%',
      overflow: 'hidden',
    })

    focusRef?.current?.focus({ preventScroll: true })

    const closeOnEscape = (event) => {
      if (event.key === 'Escape') onEscape()
    }

    window.addEventListener('keydown', closeOnEscape)
    return () => {
      if (previousStyle === null) body.removeAttribute('style')
      else body.setAttribute('style', previousStyle)

      const previousScrollBehavior = html.style.scrollBehavior
      html.style.scrollBehavior = 'auto'
      window.scrollTo(0, scrollY)
      html.style.scrollBehavior = previousScrollBehavior

      window.removeEventListener('keydown', closeOnEscape)
      previousFocus?.focus?.({ preventScroll: true })
    }
  }, [active, focusRef, onEscape])
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '00:00'
  const minutes = Math.floor(seconds / 60)
  const remaining = Math.floor(seconds % 60)
  return `${String(minutes).padStart(2, '0')}:${String(remaining).padStart(2, '0')}`
}

/** Texto com as palavras-chave marcadas pra falhar na tela. */
function Prose({ text }) {
  return splitKeywords(text).map((part, index) =>
    part.key ? (
      <em className="decay-word" key={index} style={{ '--d': index % 9 }}>
        {part.text}
      </em>
    ) : (
      <Fragment key={index}>{part.text}</Fragment>
    ),
  )
}

function App() {
  const rootRef = useRef(null)
  const audioRef = useRef(null)
  const fileInputRef = useRef(null)
  const meaningCloseRef = useRef(null)
  const lyricsCloseRef = useRef(null)
  const activeLineRef = useRef(null)
  const manualScrollUntilRef = useRef(0)
  const audioContextRef = useRef(null)
  const sourceNodeRef = useRef(null)
  const objectUrlRef = useRef(null)
  const flyFieldRef = useRef(null)
  const swarmTimersRef = useRef({ hold: 0, calm: 0 })
  const copyTimerRef = useRef(0)
  const pointerFrameRef = useRef(0)

  const [isPlaying, setIsPlaying] = useState(false)
  const [duration, setDuration] = useState(0)
  const [currentTime, setCurrentTime] = useState(0)
  const [volume, setVolume] = useState(0.82)
  const [muted, setMuted] = useState(false)
  const [analyser, setAnalyser] = useState(null)
  const [dragging, setDragging] = useState(false)
  const [trackSource, setTrackSource] = useState('FITA LOCAL')
  const [message, setMessage] = useState('AGUARDANDO FITA')
  const [showMeaning, setShowMeaning] = useState(false)
  const [infested, setInfested] = useState(false)

  const [showLyrics, setShowLyrics] = useState(false)
  const [syncMode, setSyncMode] = useState(false)
  const [lyricsSource, setLyricsSource] = useState(null)
  const [lyricsOrigin, setLyricsOrigin] = useState('loading')
  // A letra que veio de public/lyrics/ — a que todo visitante recebe. Guardada
  // à parte do que está em uso pra dar como voltar pra ela depois de sincronizar.
  const [projectLyrics, setProjectLyrics] = useState(null)
  const [copied, setCopied] = useState(false)
  const [draft, setDraft] = useState('')
  const [activeLine, setActiveLine] = useState(-1)
  const [syncCursor, setSyncCursor] = useState(0)

  const reduced = useReducedMotion()
  const writeDecay = useCssVar(rootRef, '--decay')
  const writeIntensity = useCssVar(rootRef, '--intensity')

  const decay = duration ? Math.min(1, currentTime / duration) : 0
  const progress = decay * 100
  const rotting = decay > 0.22

  const closeMeaning = useCallback(() => setShowMeaning(false), [])
  const closeLyrics = useCallback(() => setShowLyrics(false), [])

  const setupAudio = useCallback(() => {
    const audio = audioRef.current
    if (!audio) return

    // Em iOS/iPadOS não criamos o grafo do Web Audio: ele é o que impede a
    // reprodução em segundo plano (tela apagada / app fora de foco).
    if (IS_APPLE_MOBILE) return

    if (!audioContextRef.current) {
      const AudioContext = window.AudioContext || window.webkitAudioContext
      if (!AudioContext) return
      const audioContext = new AudioContext()
      const source = audioContext.createMediaElementSource(audio)
      const nextAnalyser = audioContext.createAnalyser()
      nextAnalyser.fftSize = 128
      nextAnalyser.smoothingTimeConstant = 0.86
      source.connect(nextAnalyser)
      nextAnalyser.connect(audioContext.destination)
      audioContextRef.current = audioContext
      sourceNodeRef.current = source
      setAnalyser(nextAnalyser)
    }

    if (audioContextRef.current.state === 'suspended') {
      audioContextRef.current.resume()
    }
  }, [])

  const togglePlayback = useCallback(async () => {
    const audio = audioRef.current
    if (!audio) return

    if (audio.paused) {
      setupAudio()
      try {
        await audio.play()
        setMessage('RODANDO')
      } catch {
        setMessage('SEM FITA — ESCOLHA UM MP3')
      }
    } else {
      audio.pause()
      setMessage('PAUSA')
    }
  }, [setupAudio])

  const loadFile = useCallback(
    async (file) => {
      if (!file || (!file.type.startsWith('audio/') && !file.name.toLowerCase().endsWith('.mp3'))) {
        setMessage('ISSO NÃO É ÁUDIO')
        return
      }

      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current)
      const objectUrl = URL.createObjectURL(file)
      objectUrlRef.current = objectUrl

      const audio = audioRef.current
      audio.pause()
      audio.src = objectUrl
      audio.load()
      setTrackSource(file.name.toUpperCase())
      setMessage('FITA INSERIDA')
      setCurrentTime(0)

      setupAudio()
      try {
        await audio.play()
      } catch {
        setMessage('APERTE PLAY')
      }
    },
    [setupAudio],
  )

  /* --------------------------------------------------------- easter egg */

  const swarm = useCallback(
    (x, y) => {
      if (reduced) return
      flyFieldRef.current?.burst(x, y, 400)
      navigator.vibrate?.(18)
      setInfested(true)
      window.clearTimeout(swarmTimersRef.current.calm)
      swarmTimersRef.current.calm = window.setTimeout(() => setInfested(false), 1900)
    },
    [reduced],
  )

  const startSwarm = useCallback(
    (event) => {
      const x = event.clientX ?? window.innerWidth / 2
      const y = event.clientY ?? window.innerHeight / 3
      swarm(x, y)
      // Segurar continua alimentando o enxame em vez de soltar tudo de uma vez.
      window.clearInterval(swarmTimersRef.current.hold)
      swarmTimersRef.current.hold = window.setInterval(() => swarm(x, y), 620)
    },
    [swarm],
  )

  const endSwarm = useCallback(() => {
    window.clearInterval(swarmTimersRef.current.hold)
    swarmTimersRef.current.hold = 0
  }, [])

  useEffect(
    () => () => {
      window.clearInterval(swarmTimersRef.current.hold)
      window.clearTimeout(swarmTimersRef.current.calm)
      window.clearTimeout(copyTimerRef.current)
    },
    [],
  )

  /* ---------------------------------------------------------------- letra */

  const lyrics = useMemo(() => parseLyrics(lyricsSource || ''), [lyricsSource])

  const timedLines = useMemo(
    () =>
      lyrics.lines
        .map((line, index) => ({ ...line, index }))
        .filter((line) => Number.isFinite(line.time)),
    [lyrics],
  )

  // Quanto tempo cada linha tem em cena — é o que dita a velocidade da máquina
  // de escrever: a linha precisa terminar antes da próxima entrar.
  const budgets = useMemo(() => {
    const map = new Map()
    timedLines.forEach((line, index) => {
      const next = timedLines[index + 1]
      const end = next ? next.time : duration || line.time + 4
      map.set(line.index, Math.max(0.4, end - line.time))
    })
    return map
  }, [duration, timedLines])

  const sectionRanges = useMemo(
    () => buildSectionRanges(lyrics.lines, duration),
    [lyrics, duration],
  )

  const choruses = useMemo(
    () => sectionRanges.filter((range) => range.section === 'chorus'),
    [sectionRanges],
  )

  const hasLyrics = lyrics.lines.length > 0
  const syncedCount = timedLines.length
  // O cursor pode estar uma posição além do fim (tudo marcado); quase toda
  // operação quer a última linha real.
  const cursorIndex = Math.min(syncCursor, Math.max(0, lyrics.lines.length - 1))
  const activeSection = activeLine >= 0 ? lyrics.lines[activeLine]?.section ?? null : null
  const isChorus = isPlaying && activeSection === 'chorus'

  // Saber de onde a letra veio importa: sincronizando, o que está na tela é o
  // rascunho do navegador, não o que os visitantes recebem.
  const originLabel = { storage: 'NAVEGADOR', file: 'PROJETO' }[lyricsOrigin]

  const lyricsStatus = (() => {
    if (lyricsOrigin === 'loading') return 'CARREGANDO…'
    if (!hasLyrics) return 'NENHUMA LETRA'
    const suffix = originLabel ? ` · ${originLabel}` : ''
    if (!syncedCount) return `${lyrics.lines.length} LINHAS / SEM SYNC${suffix}`
    if (syncedCount < lyrics.lines.length)
      return `SYNC ${syncedCount}/${lyrics.lines.length}${suffix}`
    return `SINCRONIZADA${suffix}`
  })()

  /**
   * Duas fontes, e as duas importam:
   *   - a do projeto (public/lyrics/), que é o que todo visitante recebe;
   *   - a do navegador, que é o rascunho de quem está sincronizando.
   *
   * O rascunho tem precedência, mas o arquivo é buscado de qualquer jeito. Sem
   * isso, quem sincronizou uma vez ficaria preso à própria cópia pra sempre e
   * não teria como conferir o que os outros estão vendo.
   */
  useEffect(() => {
    let cancelled = false

    const stored = readStoredLyrics()
    if (stored) {
      setLyricsSource(stored)
      setLyricsOrigin('storage')
    }

    const loadFromDisk = async () => {
      for (const path of LYRICS_PATHS) {
        try {
          const response = await fetch(path, { cache: 'no-cache' })
          if (!response.ok) continue
          const text = await response.text()
          // Um 404 servido como index.html não é letra.
          if (!text.trim() || /^\s*<(!doctype|html)/i.test(text)) continue
          if (cancelled) return
          setProjectLyrics(text)
          if (!stored) {
            setLyricsSource(text)
            setLyricsOrigin('file')
          }
          return
        } catch {
          /* arquivo ausente — tenta o próximo */
        }
      }
      if (!cancelled && !stored) setLyricsOrigin('empty')
    }

    loadFromDisk()
    return () => {
      cancelled = true
    }
  }, [])

  const resolveActiveLine = useCallback(() => {
    if (!timedLines.length) {
      setActiveLine(-1)
      return
    }
    const time = audioRef.current?.currentTime ?? 0
    const found = findActiveIndex(timedLines, time)
    const next = found >= 0 ? timedLines[found].index : -1
    setActiveLine((previous) => (previous === next ? previous : next))
  }, [timedLines])

  // A linha ativa vem de um rAF próprio: `timeupdate` dispara ~4x/s e atrasaria
  // a virada de forma visível. 40ms é imperceptível e custa um sexto do laço.
  useEffect(() => {
    if (!isPlaying) return undefined
    let frame = 0
    let previous = 0

    const tick = (now) => {
      frame = requestAnimationFrame(tick)
      if (now - previous < 40) return
      previous = now
      resolveActiveLine()
    }

    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [isPlaying, resolveActiveLine])

  // Pausado ou depois de um seek, um cálculo pontual basta.
  useEffect(() => {
    resolveActiveLine()
  }, [resolveActiveLine, currentTime])

  // Rola até a linha ativa, mas cede a vez por alguns segundos se a pessoa
  // estiver navegando a letra com o dedo.
  useEffect(() => {
    if (!showLyrics || syncMode || activeLine < 0) return
    if (Date.now() < manualScrollUntilRef.current) return
    activeLineRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [activeLine, showLyrics, syncMode])

  const holdAutoScroll = useCallback(() => {
    manualScrollUntilRef.current = Date.now() + 4500
  }, [])

  const commitLyrics = useCallback((lines, meta) => {
    const serialized = toLrc({ meta, lines })
    setLyricsSource(serialized)
    setLyricsOrigin('storage')
    writeStoredLyrics(serialized)
  }, [])

  const stampLine = useCallback(() => {
    const audio = audioRef.current
    if (!audio || !lyrics.lines.length) return
    const index = Math.min(syncCursor, lyrics.lines.length - 1)
    commitLyrics(
      lyrics.lines.map((line, i) => (i === index ? { ...line, time: audio.currentTime } : line)),
      lyrics.meta,
    )
    setSyncCursor(index + 1)
  }, [commitLyrics, lyrics, syncCursor])

  const nudgeLine = useCallback(
    (delta) => {
      const index = Math.min(Math.max(syncCursor - 1, 0), lyrics.lines.length - 1)
      const target = lyrics.lines[index]
      if (!target || !Number.isFinite(target.time)) return
      commitLyrics(
        lyrics.lines.map((line, i) =>
          i === index ? { ...line, time: Math.max(0, line.time + delta) } : line,
        ),
        lyrics.meta,
      )
    },
    [commitLyrics, lyrics, syncCursor],
  )

  // Errar uma linha no meio da faixa não pode custar recomeçar: desmarca a
  // última e devolve o cursor pra ela.
  const undoStamp = useCallback(() => {
    const index = syncCursor - 1
    if (index < 0 || !lyrics.lines[index]) return
    commitLyrics(
      lyrics.lines.map((line, i) => (i === index ? { ...line, time: null } : line)),
      lyrics.meta,
    )
    setSyncCursor(index)
  }, [commitLyrics, lyrics, syncCursor])

  /** Desloca a letra inteira — pra quando ela está toda atrasada igual. */
  const shiftAll = useCallback(
    (delta) => {
      commitLyrics(shiftLines(lyrics.lines, delta), lyrics.meta)
    },
    [commitLyrics, lyrics],
  )

  // O refrão volta três vezes e os "ah-ah" duas: marcada a primeira linha do
  // bloco repetido, o resto sai dos intervalos do bloco gêmeo já sincronizado.
  const derived = useMemo(
    () => (lyrics.lines.length ? deriveFromTwin(lyrics.lines, cursorIndex) : null),
    [cursorIndex, lyrics.lines],
  )

  const deriveTwin = useCallback(() => {
    if (!derived) return
    commitLyrics(derived, lyrics.meta)
    setSyncCursor(blockRange(lyrics.lines, cursorIndex).end)
  }, [commitLyrics, cursorIndex, derived, lyrics])

  // Marcar uma seção pinta o bloco inteiro (a estrofe entre linhas em branco),
  // e para ali. Sem essa fronteira, numa letra sem cabeçalho nenhum a marcação
  // vazaria pelo resto da música.
  const tagSection = useCallback(
    (index, section) => {
      if (!lyrics.lines[index]) return
      const { start, end } = blockRange(lyrics.lines, index)
      commitLyrics(
        lyrics.lines.map((line, i) => (i >= start && i < end ? { ...line, section } : line)),
        lyrics.meta,
      )
    },
    [commitLyrics, lyrics],
  )

  // O refrão se repete idêntico várias vezes: marcar um e propagar para os
  // blocos de texto igual evita repetir o trabalho seis vezes.
  const tagTwinBlocks = useCallback(
    (index) => {
      const origin = lyrics.lines[index]
      if (!origin?.section) return

      const blocks = listBlocks(lyrics.lines)
      const current = blocks.find((block) => index >= block.start && index < block.end)
      if (!current) return

      const signature = blockSignature(lyrics.lines, current.start, current.end)
      const painted = new Set()
      blocks.forEach((block) => {
        if (blockSignature(lyrics.lines, block.start, block.end) !== signature) return
        for (let i = block.start; i < block.end; i += 1) painted.add(i)
      })

      commitLyrics(
        lyrics.lines.map((line, i) => (painted.has(i) ? { ...line, section: origin.section } : line)),
        lyrics.meta,
      )
    },
    [commitLyrics, lyrics],
  )

  const saveDraft = useCallback(() => {
    if (!draft.trim()) return
    writeStoredLyrics(draft)
    setLyricsSource(draft)
    setLyricsOrigin('storage')
    setSyncCursor(0)
  }, [draft])

  /** Descarta o rascunho do navegador e volta pra letra do projeto, se houver. */
  const useProjectLyrics = useCallback(() => {
    if (!projectLyrics) return
    writeStoredLyrics(null)
    setLyricsSource(projectLyrics)
    setLyricsOrigin('file')
    setSyncCursor(0)
  }, [projectLyrics])

  const clearLyrics = useCallback(() => {
    writeStoredLyrics(null)
    setDraft('')
    setSyncCursor(0)
    setSyncMode(false)
    // Limpar significa "esquece o meu rascunho", e não "fique sem letra": se o
    // projeto traz um arquivo, é pra ele que a tela volta.
    if (projectLyrics) {
      setLyricsSource(projectLyrics)
      setLyricsOrigin('file')
      return
    }
    setLyricsSource(null)
    setLyricsOrigin('empty')
  }, [projectLyrics])

  // Atalho pra levar o resultado daqui pro repositório sem passar por Downloads.
  const copyLrc = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(toLrc(lyrics))
      setCopied(true)
      window.clearTimeout(copyTimerRef.current)
      copyTimerRef.current = window.setTimeout(() => setCopied(false), 2000)
    } catch {
      /* área de transferência bloqueada — o botão BAIXAR continua valendo */
    }
  }, [lyrics])

  const exportLrc = useCallback(() => {
    const blob = new Blob([toLrc(lyrics)], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'change.lrc'
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }, [lyrics])

  const seekToLine = useCallback(
    (line, index) => {
      if (syncMode) {
        setSyncCursor(index)
        return
      }
      if (!Number.isFinite(line.time) || !audioRef.current) return
      audioRef.current.currentTime = line.time
      setCurrentTime(line.time)
      holdAutoScroll()
    },
    [holdAutoScroll, syncMode],
  )

  useEffect(() => {
    const handleKey = (event) => {
      if (showMeaning) return
      const tag = event.target.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'BUTTON' || tag === 'A') return

      if (event.code === 'Space') {
        event.preventDefault()
        togglePlayback()
      }

      if (event.code === 'Enter' && showLyrics && syncMode) {
        event.preventDefault()
        stampLine()
      }

      if (event.key.toLowerCase() === 'm') {
        setMuted((value) => !value)
      }
    }

    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [showLyrics, showMeaning, stampLine, syncMode, togglePlayback])

  /**
   * `--intensity` (0..1) alimenta os efeitos que respiram junto com a música e
   * a agitação das moscas. Escreve direto no CSS e no motor de canvas, sem
   * estado do React: a 60fps isso seria um render por quadro. O laço roda a
   * ~30Hz — o grão e o enxame não ganham nada acima disso.
   */
  useEffect(() => {
    const field = flyFieldRef.current

    if (!isPlaying) {
      writeIntensity(0)
      field?.setAgitation(0)
      return undefined
    }

    if (!analyser) {
      // Sem analisador (iOS), um valor fixo mantém a página viva sem mentir
      // sobre o que a música está fazendo.
      writeIntensity(0.5)
      field?.setAgitation(0.45)
      return undefined
    }

    const data = new Uint8Array(analyser.frequencyBinCount)
    // Graves e médios carregam o peso do refrão; agudos só somam ruído.
    const upper = Math.max(1, Math.floor(data.length * 0.55))
    let smooth = 0
    let peak = 0.08
    let previous = 0
    let frame = 0

    const tick = (now) => {
      frame = requestAnimationFrame(tick)
      if (now - previous < 32) return
      previous = now

      analyser.getByteFrequencyData(data)
      let sum = 0
      for (let index = 0; index < upper; index += 1) sum += data[index]
      const level = sum / upper / 255

      // Pico com decaimento lento: normaliza faixas mais baixas ou mais altas.
      peak = Math.max(level, peak * 0.999, 0.08)
      const normalized = Math.min(1, level / peak)
      smooth += (normalized - smooth) * 0.16
      writeIntensity(smooth)
      flyFieldRef.current?.setAgitation(smooth)
    }

    frame = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(frame)
      writeIntensity(0)
      flyFieldRef.current?.setAgitation(0)
    }
  }, [analyser, isPlaying, writeIntensity])

  // A podridão acompanha o avanço da faixa: mais moscas, mais grão, mais ruído.
  useEffect(() => {
    writeDecay(decay)
    flyFieldRef.current?.setDecay(decay)
  }, [decay, writeDecay])

  useScrollLock(showMeaning, meaningCloseRef, closeMeaning)
  useScrollLock(showLyrics, lyricsCloseRef, closeLyrics)

  // Controles de tela de bloqueio / central de mídia. Além de dar play, pause e
  // seek fora do site, é o que sinaliza pro iOS que isso é mídia de verdade e
  // deve continuar tocando com a tela apagada.
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return undefined
    const audio = audioRef.current
    const { mediaSession } = navigator

    const skip = (offset) => {
      if (!audio) return
      const target = audio.currentTime + offset
      const max = Number.isFinite(audio.duration) ? audio.duration : target
      audio.currentTime = Math.min(Math.max(0, target), max)
    }

    const actions = [
      ['play', () => audio?.play()],
      ['pause', () => audio?.pause()],
      [
        'stop',
        () => {
          if (!audio) return
          audio.pause()
          audio.currentTime = 0
        },
      ],
      ['seekbackward', (details) => skip(-(details?.seekOffset || 10))],
      ['seekforward', (details) => skip(details?.seekOffset || 10)],
      [
        'seekto',
        (details) => {
          if (audio && Number.isFinite(details?.seekTime)) audio.currentTime = details.seekTime
        },
      ],
    ]

    actions.forEach(([action, handler]) => {
      try {
        mediaSession.setActionHandler(action, handler)
      } catch {
        /* ação não suportada neste navegador */
      }
    })

    return () => {
      actions.forEach(([action]) => {
        try {
          mediaSession.setActionHandler(action, null)
        } catch {
          /* ação não suportada neste navegador */
        }
      })
    }
  }, [])

  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return
    if (typeof window.MediaMetadata !== 'function') return
    const isOriginal = trackSource === 'FITA LOCAL'
    navigator.mediaSession.metadata = new window.MediaMetadata({
      title: isOriginal ? 'Change (In The House Of Flies)' : trackSource,
      artist: isOriginal ? 'Deftones' : 'Change Experience',
      album: isOriginal ? 'White Pony' : '',
      artwork: [
        { src: ARTWORK_PATH, sizes: '256x256', type: 'image/png' },
        { src: ARTWORK_PATH, sizes: '512x512', type: 'image/png' },
      ],
    })
  }, [trackSource])

  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return
    navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused'
  }, [isPlaying])

  // Se o navegador suspender o AudioContext ao mandar a aba pro fundo (desktop),
  // devolvemos o som ao voltar em vez de deixar o player "tocando" mudo.
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState !== 'visible') return
      const context = audioContextRef.current
      if (context?.state === 'suspended' && audioRef.current && !audioRef.current.paused) {
        context.resume()
      }
    }

    document.addEventListener('visibilitychange', handleVisibility)
    return () => document.removeEventListener('visibilitychange', handleVisibility)
  }, [])

  useEffect(
    () => () => {
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current)
      audioContextRef.current?.close()
    },
    [],
  )

  useEffect(() => {
    const audio = audioRef.current
    if (audio) audio.volume = volume
  }, [volume])

  // Paralaxe do ponteiro: só no mouse, e coalescida num rAF. No celular não
  // existe ponteiro pairando, e o handler seria puro custo por toque.
  const handlePointerMove = (event) => {
    if (IS_TOUCH || pointerFrameRef.current) return
    const x = event.clientX / window.innerWidth - 0.5
    const y = event.clientY / window.innerHeight - 0.5
    pointerFrameRef.current = requestAnimationFrame(() => {
      pointerFrameRef.current = 0
      const root = rootRef.current
      if (!root) return
      root.style.setProperty('--pointer-x', x.toFixed(3))
      root.style.setProperty('--pointer-y', y.toFixed(3))
    })
  }

  const handleDrop = (event) => {
    event.preventDefault()
    setDragging(false)
    loadFile(event.dataTransfer.files?.[0])
  }

  // Mantém a barra de progresso da tela de bloqueio em sincronia com a faixa.
  const publishPosition = (media) => {
    if (typeof navigator === 'undefined' || !navigator.mediaSession?.setPositionState) return
    if (!Number.isFinite(media.duration) || media.duration <= 0) return
    try {
      navigator.mediaSession.setPositionState({
        duration: media.duration,
        playbackRate: media.playbackRate || 1,
        position: Math.min(media.currentTime, media.duration),
      })
    } catch {
      /* posição inválida durante um seek — ignora */
    }
  }

  const seek = (event) => {
    const nextTime = Number(event.target.value)
    audioRef.current.currentTime = nextTime
    setCurrentTime(nextTime)
  }

  const changeVolume = (event) => {
    setVolume(Number(event.target.value))
    setMuted(false)
  }

  const rootClass = [
    'experience',
    isPlaying ? 'is-playing' : '',
    isChorus ? 'is-chorus' : '',
    rotting ? 'is-rotting' : '',
    infested ? 'is-infested' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div
      className={rootClass}
      data-section={activeSection || 'none'}
      ref={rootRef}
      onPointerMove={handlePointerMove}
      onDragEnter={() => setDragging(true)}
      onDragOver={(event) => event.preventDefault()}
      onDrop={handleDrop}
    >
      <audio
        ref={audioRef}
        src={AUDIO_PATH}
        preload="metadata"
        playsInline
        muted={muted}
        onLoadedMetadata={(event) => {
          setDuration(event.currentTarget.duration)
          setMessage('FITA PRONTA')
        }}
        onTimeUpdate={(event) => {
          const media = event.currentTarget
          setCurrentTime(media.currentTime)
          publishPosition(media)
        }}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onEnded={() => {
          setIsPlaying(false)
          setMessage('FIM DO LADO A')
        }}
        onError={() => setMessage('SEM FITA — ESCOLHA UM MP3')}
      />

      <div className="background" aria-hidden="true" />
      <div className="ink-layer" aria-hidden="true" />
      <FlyField controlRef={flyFieldRef} />
      <div className="chorus-flash" aria-hidden="true" />
      <div className="infest-veil" aria-hidden="true" />
      <div className="scanlines" aria-hidden="true" />
      <div className="tracking" aria-hidden="true" />
      <div className="grain" aria-hidden="true" />

      {dragging && (
        <div
          className="drop-zone"
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) setDragging(false)
          }}
        >
          <button className="drop-close" onClick={() => setDragging(false)} aria-label="Fechar">
            <X size={22} />
          </button>
          <Bug size={72} strokeWidth={1.1} />
          <strong>SOLTE A FITA</strong>
          <span>Ela toca somente no seu navegador.</span>
        </div>
      )}

      {showMeaning && createPortal(
        <div
          className="meaning-overlay"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) setShowMeaning(false)
          }}
        >
          <div className="meaning-backdrop" aria-hidden="true" />
          <article
            className="meaning-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="meaning-title"
          >
            <header className="meaning-header">
              <div>
                <span>NOTAS DA FAIXA / 01</span>
                <h2 id="meaning-title">O QUE “CHANGE”<br />QUER DIZER?</h2>
              </div>
              <button
                ref={meaningCloseRef}
                className="meaning-close"
                onClick={() => setShowMeaning(false)}
                aria-label="Fechar significado da música"
              >
                <X size={24} />
              </button>
            </header>

            <div className="meaning-scroll">
              <p className="meaning-lead">
                <Prose text={MEANING_LEAD} />
              </p>

              {MEANING.map((entry) => (
                <section key={entry.n} className={entry.summary ? 'meaning-summary' : undefined}>
                  <span>{entry.n}</span>
                  <div>
                    <h3>{entry.title}</h3>
                    <p>
                      <Prose text={entry.body} />
                    </p>
                  </div>
                </section>
              ))}
            </div>
          </article>
        </div>,
        document.body,
      )}

      {showLyrics && createPortal(
        <div
          className="lyrics-overlay"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) setShowLyrics(false)
          }}
        >
          <div className="meaning-backdrop" aria-hidden="true" />
          <article
            className={`lyrics-panel ${syncMode ? 'is-syncing' : ''}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="lyrics-title"
          >
            <header className="lyrics-header">
              <div>
                <span>{lyricsStatus}</span>
                <h2 id="lyrics-title">LETRA</h2>
              </div>
              <div className="lyrics-actions">
                {hasLyrics && (
                  <button
                    className={`lyrics-mode ${syncMode ? 'on' : ''}`}
                    onClick={() => setSyncMode((value) => !value)}
                    aria-pressed={syncMode}
                  >
                    SYNC
                  </button>
                )}
                <button
                  ref={lyricsCloseRef}
                  className="meaning-close"
                  onClick={closeLyrics}
                  aria-label="Fechar letra"
                >
                  <X size={24} />
                </button>
              </div>
            </header>

            {hasLyrics ? (
              <div
                className="lyrics-scroll"
                onTouchStart={holdAutoScroll}
                onWheel={holdAutoScroll}
              >
                <ol>
                  {lyrics.lines.map((line, index) => {
                    const startsSection =
                      line.section && line.section !== lyrics.lines[index - 1]?.section
                    const isActive = index === activeLine
                    const classes = [
                      'lyric-line',
                      line.startsBlock && index > 0 ? 'block-start' : '',
                      isActive ? 'active' : '',
                      activeLine >= 0 && index < activeLine ? 'past' : '',
                      syncMode && index === syncCursor ? 'cursor' : '',
                      Number.isFinite(line.time) ? 'timed' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')

                    return (
                      <Fragment key={`${index}-${line.text}`}>
                        {startsSection && (
                          <li className={`lyric-section is-${line.section}`} aria-hidden="true">
                            {SECTION_LABELS[line.section] || line.section}
                          </li>
                        )}
                        <li className={classes} ref={isActive ? activeLineRef : null}>
                          <button
                            type="button"
                            onClick={() => seekToLine(line, index)}
                            aria-label={line.text}
                          >
                            {syncMode && (
                              <em className="lyric-stamp">
                                {Number.isFinite(line.time)
                                  ? formatTimestamp(line.time)
                                  : '--:--.--'}
                              </em>
                            )}
                            <TypedLine
                              text={line.text}
                              typing={isActive && isPlaying && !syncMode}
                              budget={budgets.get(index)}
                            />
                          </button>
                        </li>
                      </Fragment>
                    )
                  })}
                </ol>
              </div>
            ) : (
              <div className="lyrics-scroll lyrics-empty">
                <p>
                  Nenhuma letra carregada — o projeto não distribui letra nenhuma. Cole a sua
                  abaixo (uma linha por linha) ou deixe um arquivo em{' '}
                  <code>public/lyrics/change.txt</code>.
                </p>
                <p className="lyrics-note">
                  Marque as partes com um cabeçalho entre colchetes — <code>[refrão]</code>,{' '}
                  <code>[verso]</code>, <code>[ponte]</code> — pra ligar os efeitos de intensidade.
                  Fica salvo só no seu navegador.
                </p>
                <textarea
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  rows={12}
                  spellCheck="false"
                  aria-label="Colar letra"
                  placeholder={'[verso]\nprimeira linha\nsegunda linha\n\n[refrão]\nprimeira linha do refrão'}
                />
                <button className="load-button" onClick={saveDraft} disabled={!draft.trim()}>
                  <Upload size={17} /> CARREGAR LETRA
                </button>
              </div>
            )}

            {hasLyrics && syncMode && (
              <footer className="sync-bar">
                <div className="sync-row">
                  <button
                    className="sync-stamp"
                    onClick={stampLine}
                    disabled={syncCursor >= lyrics.lines.length}
                  >
                    <Zap size={18} />
                    {syncCursor >= lyrics.lines.length
                      ? 'TUDO MARCADO'
                      : `MARCAR LINHA ${syncCursor + 1}`}
                  </button>
                  <button
                    className="sync-undo"
                    onClick={undoStamp}
                    disabled={syncCursor <= 0}
                    title="Desmarca a última linha e volta o cursor pra ela"
                  >
                    <Undo2 size={15} /> DESFAZER
                  </button>
                </div>

                <button
                  className={`sync-derive ${derived ? 'ready' : ''}`}
                  onClick={deriveTwin}
                  disabled={!derived}
                  title="Preenche o bloco inteiro a partir do bloco de texto idêntico já sincronizado"
                >
                  <Repeat size={15} />
                  {derived
                    ? 'DERIVAR BLOCO DO GÊMEO'
                    : 'MARQUE A 1ª LINHA DE UM BLOCO REPETIDO'}
                </button>

                <div className="sync-row sync-fix">
                  <span>ÚLTIMA</span>
                  <button onClick={() => nudgeLine(-0.25)}>−0,25s</button>
                  <button onClick={() => nudgeLine(0.25)}>+0,25s</button>
                  <span className="sync-gap">TUDO</span>
                  <button onClick={() => shiftAll(-0.5)}>−0,5s</button>
                  <button onClick={() => shiftAll(0.5)}>+0,5s</button>
                </div>

                <div className="sync-row sync-sections">
                  <span>SEÇÃO</span>
                  {SECTION_ORDER.map((section) => (
                    <button
                      key={section}
                      className={lyrics.lines[cursorIndex]?.section === section ? 'on' : ''}
                      onClick={() => tagSection(cursorIndex, section)}
                    >
                      {SECTION_LABELS[section]}
                    </button>
                  ))}
                  <button
                    className="sync-twins"
                    onClick={() => tagTwinBlocks(cursorIndex)}
                    disabled={!lyrics.lines[cursorIndex]?.section}
                    title="Aplica a mesma seção a todos os blocos de texto idêntico"
                  >
                    <Copy size={13} /> IGUAIS
                  </button>
                </div>

                <div className="sync-row sync-io">
                  <span>
                    {syncedCount}/{lyrics.lines.length} MARCADAS
                  </span>
                  <button onClick={() => setSyncCursor(0)}>VOLTAR AO TOPO</button>
                  <button onClick={copyLrc}>
                    <Copy size={14} /> {copied ? 'COPIADO' : 'COPIAR .LRC'}
                  </button>
                  <button onClick={exportLrc}>
                    <Download size={14} /> BAIXAR .LRC
                  </button>
                  {projectLyrics && lyricsOrigin === 'storage' && (
                    <button onClick={useProjectLyrics} title="Descarta o rascunho deste navegador">
                      <FileDown size={14} /> USAR A DO PROJETO
                    </button>
                  )}
                  <button className="sync-danger" onClick={clearLyrics}>
                    <Trash2 size={14} /> LIMPAR
                  </button>
                </div>
              </footer>
            )}
          </article>
        </div>,
        document.body,
      )}

      <header className="topbar">
        <a className="monogram" href="#top" aria-label="Voltar ao início">
          <span>DT</span>
          <small>10</small>
        </a>

        <div className="top-meta">
          <span>WHITE PONY</span>
          <i />
          <span>92 BPM</span>
        </div>

        <nav>
          <a href="#player">PLAYER</a>
          <a href="#casa">A CASA</a>
        </nav>
      </header>

      <main id="top">
        <section className="hero" aria-labelledby="track-title">
          <div className="side-index" aria-hidden="true">
            <span>SACRAMENTO CA</span>
            <span>38.5816° N</span>
            <span>FAIXA 10</span>
          </div>

          <div className="hero-copy">
            <p className="eyebrow"><span /> Deftones / single experience</p>

            <div className="title-wrap">
              <h1 id="track-title" aria-label="Change">
                <button
                  type="button"
                  className="title-trigger"
                  onPointerDown={startSwarm}
                  onPointerUp={endSwarm}
                  onPointerLeave={endSwarm}
                  onPointerCancel={endSwarm}
                  onClick={(event) => {
                    // `detail === 0` = ativado pelo teclado, onde não houve
                    // pointerdown nenhum. No mouse isso já rodou e é ignorado.
                    if (event.detail === 0) {
                      const box = event.currentTarget.getBoundingClientRect()
                      swarm(box.left + box.width / 2, box.top + box.height / 2)
                    }
                  }}
                  aria-label="Change — segure para soltar as moscas"
                >
                  {'CHANGE'.split('').map((letter, index) => (
                    // data-letter alimenta o escorrido em ::after — é o mesmo
                    // caractere, então o derretido nunca sai do lugar.
                    <span key={letter + index} data-letter={letter} style={{ '--index': index }}>
                      {letter}
                    </span>
                  ))}
                </button>
              </h1>
            </div>

            <p className="hero-sub">(IN THE HOUSE OF FLIES)</p>

            <div className="hero-foot">
              <p>UMA FAIXA.<br />COLAPSO LENTO.</p>
              <div className="release-stamp">
                <span>RELEASED</span>
                <strong>2000</strong>
              </div>
              <button
                className="meaning-trigger"
                onClick={() => setShowMeaning(true)}
                aria-expanded={showMeaning}
              >
                <BookOpen size={17} />
                SIGNIFICADO
              </button>
              <button
                className="meaning-trigger lyrics-trigger"
                onClick={() => setShowLyrics(true)}
                aria-expanded={showLyrics}
              >
                <Mic2 size={17} />
                LETRA
              </button>
            </div>
          </div>
        </section>

        <section className="player-section" id="player" aria-label="Player de áudio">
          <div className="deck">
            <i className="screw screw-tl" aria-hidden="true" />
            <i className="screw screw-tr" aria-hidden="true" />
            <i className="screw screw-bl" aria-hidden="true" />
            <i className="screw screw-br" aria-hidden="true" />

            <div className="deck-head">
              <div className="deck-brand">
                <strong>PONY&nbsp;·&nbsp;90</strong>
                <span>PORTABLE TAPE UNIT</span>
              </div>
              <div className="deck-side" aria-hidden="true">
                LADO<em>A</em>
              </div>
            </div>

            <div className="cassette" aria-hidden="true">
              <div className="cassette-window">
                <div
                  className={`reel ${isPlaying ? 'turning' : ''}`}
                  style={{ '--fill': (1 - decay).toFixed(3) }}
                >
                  <i />
                </div>
                <div className="tape-path" />
                <div
                  className={`reel ${isPlaying ? 'turning' : ''}`}
                  style={{ '--fill': decay.toFixed(3) }}
                >
                  <i />
                </div>
              </div>
              <div className="cassette-label">
                <strong>CHANGE</strong>
                <span>DEFTONES — WHITE PONY</span>
              </div>
            </div>

            <SwarmMeter
              analyser={analyser}
              isPlaying={isPlaying}
              audioRef={audioRef}
              hot={isChorus}
            />

            <div className="deck-lcd">
              <span className="lcd">
                <i aria-hidden="true">88:88</i>
                <b>{formatTime(currentTime)}</b>
              </span>
              <span className="lcd-status">
                {message}
                {activeSection && isPlaying && (
                  <em className={`section-chip is-${activeSection}`}>
                    {SECTION_LABELS[activeSection] || activeSection}
                  </em>
                )}
              </span>
              <span className="lcd lcd-total">
                <i aria-hidden="true">88:88</i>
                <b>{duration ? formatTime(duration) : DEFAULT_DURATION}</b>
              </span>
            </div>

            <div className="deck-track">
              {duration > 0 &&
                choruses.map((range) => (
                  <i
                    key={range.start}
                    className="timeline-chorus"
                    aria-hidden="true"
                    style={{
                      left: `${(range.start / duration) * 100}%`,
                      width: `${Math.max(0.8, ((range.end - range.start) / duration) * 100)}%`,
                    }}
                  />
                ))}
              <input
                type="range"
                min="0"
                max={duration || 1}
                step="0.1"
                value={Math.min(currentTime, duration || 1)}
                onChange={seek}
                aria-label="Posição da música"
                style={{ '--range-progress': `${progress}%` }}
              />
            </div>

            <div className="deck-transport">
              <button
                className="deck-key"
                onClick={() => {
                  audioRef.current.currentTime = 0
                  setCurrentTime(0)
                }}
                aria-label="Voltar ao início"
              >
                <SkipBack size={19} />
              </button>

              <button
                className="deck-key deck-play"
                onClick={togglePlayback}
                aria-label={isPlaying ? 'Pausar' : 'Tocar'}
              >
                {isPlaying ? <Pause fill="currentColor" size={22} /> : <Play fill="currentColor" size={22} />}
              </button>

              <div className="volume-control">
                <button
                  className="deck-key"
                  onClick={() => setMuted((value) => !value)}
                  aria-label={muted ? 'Ativar som' : 'Silenciar'}
                >
                  {muted || volume === 0 ? <VolumeX size={19} /> : <Volume2 size={19} />}
                </button>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={volume}
                  onChange={changeVolume}
                  aria-label="Volume"
                  style={{ '--range-progress': `${volume * 100}%` }}
                />
              </div>

              <button className="load-button" onClick={() => fileInputRef.current?.click()}>
                <Upload size={16} /> TROCAR FITA
              </button>
              <input
                ref={fileInputRef}
                className="visually-hidden"
                type="file"
                accept="audio/*,.mp3"
                onChange={(event) => loadFile(event.target.files?.[0])}
              />
            </div>

            <p className="deck-source">{trackSource}</p>
          </div>

          <div className="player-note">
            <Bug size={16} />
            <p>ARRASTE UM MP3 PRA QUALQUER LUGAR DA TELA</p>
            <span>SPACE = PLAY / PAUSE &nbsp;·&nbsp; M = MUTE</span>
          </div>
        </section>

        <section className="house-section" id="casa">
          <div className="section-kicker">02 / A CASA</div>

          <div className="house-intro">
            <h2>ELA NÃO<br /><em>DESABA.</em><br />ELA APODRECE.</h2>
            <p>
              A estrutura cede no ritmo da faixa: quanto mais a música avança, menos casa sobra e
              mais coisa voa dentro dela. Role a página ou deixe a fita rodar — o resultado é o
              mesmo.
            </p>
          </div>

          <House stage={Math.round(progress)} />

          <div className="stage-map">
            {STAGES.map(([number, label, note], index) => {
              const start = [0, 24, 49, 76][index]
              const end = [24, 49, 76, 101][index]
              const active = isPlaying && progress >= start && progress < end
              return (
                <article className={active ? 'active' : ''} key={label}>
                  <span>{number}</span>
                  <strong>{label}</strong>
                  <p>{note}</p>
                  <div className="stage-lines" aria-hidden="true">
                    {Array.from({ length: 10 }, (_, line) => (
                      <i
                        key={line}
                        style={{ '--line': line, height: `${16 + (line % 5) * 15}%` }}
                      />
                    ))}
                  </div>
                </article>
              )
            })}
          </div>
        </section>
      </main>

      <div className="ticker" aria-hidden="true">
        <div>
          CHANGE · DEFTONES · 2000 · IN THE HOUSE OF FLIES ·&nbsp;
          CHANGE · DEFTONES · 2000 · IN THE HOUSE OF FLIES ·&nbsp;
          CHANGE · DEFTONES · 2000 · IN THE HOUSE OF FLIES ·&nbsp;
          CHANGE · DEFTONES · 2000 · IN THE HOUSE OF FLIES ·&nbsp;
        </div>
      </div>

      <footer>
        <div className="footer-mark">C<span>/</span>10</div>
        <p>EXPERIÊNCIA NÃO OFICIAL FEITA POR FÃ.<br />O ÁUDIO TOCA LOCALMENTE, NO SEU APARELHO.</p>
        <a href="#top">VOLTAR AO TOPO ↑</a>
      </footer>
    </div>
  )
}

export default App
