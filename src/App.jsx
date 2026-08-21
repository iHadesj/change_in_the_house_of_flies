import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  BookOpen,
  Bug,
  Copy,
  Disc3,
  Download,
  Headphones,
  Maximize2,
  Mic2,
  Pause,
  Play,
  RotateCcw,
  Trash2,
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
  findActiveIndex,
  listBlocks,
  formatTimestamp,
  parseLyrics,
  readStoredLyrics,
  sectionAt,
  toLrc,
  writeStoredLyrics,
} from './lyrics.js'

const DEFAULT_DURATION = '04:58'
const AUDIO_PATH = `${import.meta.env.BASE_URL}music/change.mp3`
const ARTWORK_PATH = `${import.meta.env.BASE_URL}assets/change-app-icon.png`
const LYRICS_PATHS = [
  `${import.meta.env.BASE_URL}lyrics/change.lrc`,
  `${import.meta.env.BASE_URL}lyrics/change.txt`,
]

// No iOS/iPadOS, rotear o <audio> pelo Web Audio API (createMediaElementSource)
// faz o som morrer assim que a tela apaga ou o app vai pro fundo: o AudioContext
// é interrompido pelo sistema. Só o elemento de mídia "puro" sobrevive em background.
// Então nesses aparelhos o espectro roda em modo simulado e o áudio fica intacto.
const IS_APPLE_MOBILE =
  typeof navigator !== 'undefined' &&
  (/iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (/Mac/.test(navigator.userAgent) && navigator.maxTouchPoints > 1))

// Moscas que atravessam a tela devagar. Posição e ritmo fixos por índice: um
// valor aleatório mudaria a cada render e cortaria a animação no meio.
const FLIES = [
  { top: '18%', left: '8%', delay: '0s', duration: '31s', scale: 0.9 },
  { top: '34%', left: '72%', delay: '-6s', duration: '27s', scale: 1.15 },
  { top: '61%', left: '22%', delay: '-13s', duration: '35s', scale: 0.75 },
  { top: '12%', left: '54%', delay: '-19s', duration: '24s', scale: 1 },
  { top: '76%', left: '63%', delay: '-3s', duration: '38s', scale: 1.3 },
  { top: '47%', left: '41%', delay: '-24s', duration: '29s', scale: 0.65 },
  { top: '88%', left: '11%', delay: '-9s', duration: '33s', scale: 1.05 },
  { top: '26%', left: '89%', delay: '-16s', duration: '26s', scale: 0.85 },
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

function Spectrum({ analyser, isPlaying, audioRef, isChorus }) {
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const context = canvas.getContext('2d')
    let frameId
    let tick = 0
    const data = analyser ? new Uint8Array(analyser.frequencyBinCount) : null
    const smoothed = []

    const render = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const width = canvas.clientWidth
      const height = canvas.clientHeight

      if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
        canvas.width = width * dpr
        canvas.height = height * dpr
      }

      context.setTransform(dpr, 0, 0, dpr, 0, 0)
      context.clearRect(0, 0, width, height)

      if (analyser && isPlaying) analyser.getByteFrequencyData(data)

      const bars = Math.max(20, Math.floor(width / 8))
      const gap = 3
      const barWidth = Math.max(2, width / bars - gap)

      const clock = audioRef?.current?.currentTime ?? tick * 0.016

      for (let index = 0; index < bars; index += 1) {
        let value
        if (analyser && isPlaying) {
          const bin = Math.floor((index / bars) * data.length * 0.72)
          value = data[bin] / 255
        } else if (isPlaying) {
          // Modo simulado (iOS): sem analyser, mas o desenho continua acompanhando o tempo da faixa.
          const rolloff = 1 - (index / bars) * 0.55
          const raw =
            0.12 +
            (Math.abs(Math.sin(clock * 3.1 + index * 0.87)) * 0.34 +
              Math.abs(Math.sin(clock * 7.4 + index * 2.31)) * 0.2 +
              Math.abs(Math.sin(clock * 1.2 + index * 0.29)) * 0.24) *
              rolloff
          const previous = smoothed[index] ?? raw
          value = previous + (raw - previous) * 0.22
          smoothed[index] = value
        } else {
          value = 0.06 + Math.abs(Math.sin(index * 1.7 + tick * 0.01)) * 0.08
          smoothed[index] = value
        }

        // No refrão as barras crescem e o contraste sobe.
        const barHeight = Math.max(2, value * height * 0.9 * (isChorus ? 1.3 : 1))
        const x = index * (barWidth + gap)
        const y = (height - barHeight) / 2
        if (isChorus) context.fillStyle = index % 3 === 0 ? '#efeaf6' : '#9a76d6'
        else context.fillStyle = index % 5 === 0 ? '#d9d6d1' : '#6b539a'
        context.fillRect(x, y, barWidth, barHeight)
      }

      tick += isPlaying ? 1 : 0.2
      frameId = requestAnimationFrame(render)
    }

    render()
    return () => cancelAnimationFrame(frameId)
  }, [analyser, audioRef, isChorus, isPlaying])

  return <canvas ref={canvasRef} className="spectrum" aria-hidden="true" />
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

  const [isPlaying, setIsPlaying] = useState(false)
  const [duration, setDuration] = useState(0)
  const [currentTime, setCurrentTime] = useState(0)
  const [volume, setVolume] = useState(0.82)
  const [muted, setMuted] = useState(false)
  const [analyser, setAnalyser] = useState(null)
  const [dragging, setDragging] = useState(false)
  const [trackSource, setTrackSource] = useState('ARQUIVO LOCAL')
  const [message, setMessage] = useState('PRONTO PARA O SEU MP3')
  const [showMeaning, setShowMeaning] = useState(false)

  const [showLyrics, setShowLyrics] = useState(false)
  const [syncMode, setSyncMode] = useState(false)
  const [lyricsSource, setLyricsSource] = useState(null)
  const [lyricsOrigin, setLyricsOrigin] = useState('loading')
  const [draft, setDraft] = useState('')
  const [activeLine, setActiveLine] = useState(-1)
  const [syncCursor, setSyncCursor] = useState(0)

  const progress = duration ? (currentTime / duration) * 100 : 0

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
        setMessage('TOCANDO AGORA')
      } catch {
        setMessage('ADICIONE OU SELECIONE O MP3')
      }
    } else {
      audio.pause()
      setMessage('PAUSADO')
    }
  }, [setupAudio])

  const loadFile = useCallback(
    async (file) => {
      if (!file || (!file.type.startsWith('audio/') && !file.name.toLowerCase().endsWith('.mp3'))) {
        setMessage('ESSE ARQUIVO NÃO PARECE SER ÁUDIO')
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
      setMessage('ARQUIVO CARREGADO')
      setCurrentTime(0)

      setupAudio()
      try {
        await audio.play()
      } catch {
        setMessage('APERTE PLAY PARA COMEÇAR')
      }
    },
    [setupAudio],
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
  const activeSection = activeLine >= 0 ? lyrics.lines[activeLine]?.section ?? null : null
  const isChorus = isPlaying && activeSection === 'chorus'

  const lyricsStatus = (() => {
    if (lyricsOrigin === 'loading') return 'CARREGANDO…'
    if (!hasLyrics) return 'NENHUMA LETRA'
    if (!syncedCount) return `${lyrics.lines.length} LINHAS / SEM SYNC`
    if (syncedCount < lyrics.lines.length) return `SYNC ${syncedCount}/${lyrics.lines.length}`
    return 'SINCRONIZADA'
  })()

  // Fontes, em ordem: o que o usuário colou/sincronizou → arquivo em
  // public/lyrics/ → nada. Nenhuma letra é distribuída com o projeto.
  useEffect(() => {
    let cancelled = false

    const stored = readStoredLyrics()
    if (stored) {
      setLyricsSource(stored)
      setLyricsOrigin('storage')
      return undefined
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
          setLyricsSource(text)
          setLyricsOrigin('file')
          return
        } catch {
          /* arquivo ausente — tenta o próximo */
        }
      }
      if (!cancelled) setLyricsOrigin('empty')
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

  // Enquanto toca, a linha ativa vem de rAF: `timeupdate` dispara ~4x/s e
  // atrasaria a virada de forma visível numa letra rápida.
  useEffect(() => {
    if (!isPlaying) return undefined
    let frame = requestAnimationFrame(function tick() {
      resolveActiveLine()
      frame = requestAnimationFrame(tick)
    })
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

  const clearLyrics = useCallback(() => {
    writeStoredLyrics(null)
    setLyricsSource(null)
    setLyricsOrigin('empty')
    setDraft('')
    setSyncCursor(0)
    setSyncMode(false)
  }, [])

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
   * `--intensity` (0..1) alimenta os efeitos que respiram junto com a música.
   * Escreve direto no CSS, sem estado do React: a 60fps isso seria um render
   * por quadro. Sem analisador (iOS), fica num valor fixo enquanto toca.
   */
  useEffect(() => {
    const root = rootRef.current
    if (!root) return undefined

    if (!isPlaying) {
      root.style.setProperty('--intensity', '0')
      return undefined
    }

    if (!analyser) {
      root.style.setProperty('--intensity', '0.5')
      return undefined
    }

    const data = new Uint8Array(analyser.frequencyBinCount)
    // Graves e médios carregam o peso do refrão; agudos só somam ruído.
    const upper = Math.max(1, Math.floor(data.length * 0.55))
    let smooth = 0
    let peak = 0.08
    let frame

    const tick = () => {
      analyser.getByteFrequencyData(data)
      let sum = 0
      for (let index = 0; index < upper; index += 1) sum += data[index]
      const level = sum / upper / 255

      // Pico com decaimento lento: normaliza faixas mais baixas ou mais altas.
      peak = Math.max(level, peak * 0.9995, 0.08)
      const normalized = Math.min(1, level / peak)
      smooth += (normalized - smooth) * 0.11
      root.style.setProperty('--intensity', smooth.toFixed(3))
      frame = requestAnimationFrame(tick)
    }

    frame = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(frame)
      root.style.setProperty('--intensity', '0')
    }
  }, [analyser, isPlaying])

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
    const isOriginal = trackSource === 'ARQUIVO LOCAL'
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

  const handlePointerMove = (event) => {
    if (!rootRef.current) return
    const x = event.clientX / window.innerWidth - 0.5
    const y = event.clientY / window.innerHeight - 0.5
    rootRef.current.style.setProperty('--pointer-x', x.toFixed(3))
    rootRef.current.style.setProperty('--pointer-y', y.toFixed(3))
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
    const nextVolume = Number(event.target.value)
    setVolume(nextVolume)
    setMuted(false)
  }

  return (
    <div
      className={`experience ${isPlaying ? 'is-playing' : ''} ${isChorus ? 'is-chorus' : ''}`}
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
          setMessage('MP3 ENCONTRADO — APERTE PLAY')
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
          setMessage('FIM DA FAIXA — DE NOVO?')
        }}
        onError={() => setMessage('ADICIONE O MP3 OU ESCOLHA UM ARQUIVO')}
      />

      <div className="background" aria-hidden="true" />
      <div className="ink-layer" aria-hidden="true" />
      <div className="flies" aria-hidden="true">
        {FLIES.map((fly, index) => (
          <i
            key={index}
            style={{
              top: fly.top,
              left: fly.left,
              '--delay': fly.delay,
              '--duration': fly.duration,
              '--scale': fly.scale,
            }}
          />
        ))}
      </div>
      <div className="chorus-flash" aria-hidden="true" />
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
          <strong>SOLTE O MP3 AQUI</strong>
          <span>Ele toca somente no seu navegador.</span>
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
                <span>TRACK NOTES / 01</span>
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
                Em “Change (In The House Of Flies)” a transformação abordada vai além do aspecto
                físico e mergulha em questões profundas de identidade e percepção. Bora por partes
                (sem traduzir linha por linha pra não reproduzir a letra toda, mas cobrindo tudo que
                ela quer dizer):
              </p>

              <section>
                <span>01</span>
                <div>
                  <h3>A METÁFORA NO CENTRO</h3>
                  <p>
                    Chino Moreno, vocalista da banda, já afirmou que a letra é altamente metafórica.
                    A mudança descrita não é a do corpo: ela representa uma alteração intensa na
                    forma como alguém se vê e é visto — percepção e identidade mexidas de lugar.
                  </p>
                </div>
              </section>

              <section>
                <span>02</span>
                <div>
                  <h3>“I WATCHED YOU CHANGE / INTO A FLY”</h3>
                  <p>
                    A imagem da mosca funciona como símbolo de degradação ou perda de valor. Mas
                    também pode indicar um renascimento desconfortável: a mosca está ligada à
                    decadência e à efemeridade da vida. Nascer de novo, sim — só que como outra
                    coisa, e não necessariamente melhor.
                  </p>
                </div>
              </section>

              <section>
                <span>03</span>
                <div>
                  <h3>“PULLING OFF YOUR WINGS”</h3>
                  <p>
                    Arrancar as asas e rir em seguida reforça a ideia de controle ou crueldade diante
                    da vulnerabilidade do outro. Sugere uma relação marcada por manipulação ou
                    dominação: alguém observa a queda e se diverte com ela.
                  </p>
                </div>
              </section>

              <section>
                <span>04</span>
                <div>
                  <h3>O CLIMA E O CLIPE</h3>
                  <p>
                    O tom sombrio da música é intensificado pelo videoclipe — máscaras de animais,
                    expressões apáticas — e isso aprofunda o sentimento de alienação e desconexão.
                    Todos estão juntos na mesma festa e ninguém está de fato ali.
                  </p>
                </div>
              </section>

              <section>
                <span>05</span>
                <div>
                  <h3>“IT’S LIKE YOU NEVER HAD WINGS”</h3>
                  <p>
                    A repetição de que é como se nunca houvesse asas e de que agora ela se sente tão
                    viva mostra o paradoxo: a mudança, mesmo dolorosa ou degradante, pode trazer uma
                    sensação de vitalidade ou liberdade — ainda que ilusória.
                  </p>
                </div>
              </section>

              <section>
                <span>06</span>
                <div>
                  <h3>A CRUZ E A ARMA</h3>
                  <p>
                    O trecho em que ele olha para a cruz, desvia o olhar, entrega a arma e pede pra
                    ser destruído adiciona ambiguidade. Pode ser lido como culpa, como sacrifício ou
                    como desejo de fuga — e a música não resolve qual dos três.
                  </p>
                </div>
              </section>

              <section>
                <span>07</span>
                <div>
                  <h3>IDENTIDADE SOB PRESSÃO</h3>
                  <p>
                    O que atravessa tudo é a fragilidade da identidade: ela pode se perder diante de
                    pressões emocionais e existenciais. Quem muda não escolhe totalmente em que vai
                    virar, e quem assiste tem parte nisso.
                  </p>
                </div>
              </section>

              <section className="meaning-summary">
                <span>08</span>
                <div>
                  <h3>RESUMO DO SIGNIFICADO GERAL</h3>
                  <p>
                    A música explora as complexidades das relações humanas, mostrando que a
                    transformação pode significar tanto libertação quanto destruição. É lenta,
                    contida e sem catarse fácil: em vez de gritar a dor, ela observa de perto — o que
                    é exatamente a pegada do Deftones em White Pony.
                  </p>
                </div>
              </section>
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
                          <button type="button" onClick={() => seekToLine(line, index)}>
                            {syncMode && (
                              <em className="lyric-stamp">
                                {Number.isFinite(line.time)
                                  ? formatTimestamp(line.time)
                                  : '--:--.--'}
                              </em>
                            )}
                            <span>{line.text}</span>
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
                  <div className="sync-nudge">
                    <button onClick={() => nudgeLine(-0.25)}>−0,25s</button>
                    <button onClick={() => nudgeLine(0.25)}>+0,25s</button>
                  </div>
                </div>

                <div className="sync-row sync-sections">
                  <span>SEÇÃO</span>
                  {SECTION_ORDER.map((section) => (
                    <button
                      key={section}
                      className={
                        lyrics.lines[Math.min(syncCursor, lyrics.lines.length - 1)]?.section ===
                        section
                          ? 'on'
                          : ''
                      }
                      onClick={() =>
                        tagSection(Math.min(syncCursor, lyrics.lines.length - 1), section)
                      }
                    >
                      {SECTION_LABELS[section]}
                    </button>
                  ))}
                  <button
                    className="sync-twins"
                    onClick={() => tagTwinBlocks(Math.min(syncCursor, lyrics.lines.length - 1))}
                    disabled={!lyrics.lines[Math.min(syncCursor, lyrics.lines.length - 1)]?.section}
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
                  <button onClick={exportLrc}>
                    <Download size={14} /> BAIXAR .LRC
                  </button>
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
          <small>00</small>
        </a>

        <div className="top-meta">
          <span>TRACK 10</span>
          <i />
          <span>WHITE PONY</span>
        </div>

        <nav>
          <a href="#player">PLAYER</a>
          <a href="#energy">ENERGIA</a>
        </nav>
      </header>

      <main id="top">
        <section className="hero" aria-labelledby="track-title">
          <div className="side-index" aria-hidden="true">
            <span>SACRAMENTO CA</span>
            <span>38.5816° N</span>
            <span>92 BPM</span>
          </div>

          <div className="hero-copy">
            <p className="eyebrow"><span /> Deftones / single experience</p>
            <h1 id="track-title" aria-label="Change">
              {'CHANGE'.split('').map((letter, index) => (
                <span key={letter + index} style={{ '--index': index }}>{letter}</span>
              ))}
            </h1>
            <p className="hero-sub">(IN THE HOUSE OF FLIES)</p>
            <div className="hero-foot">
              <p>ONE TRACK.<br />SLOW COLLAPSE.</p>
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
                MOSTRAR SIGNIFICADO
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

          <div className="roundel" aria-hidden="true">
            <span>WATCH IT CHANGE • WATCH IT CHANGE • </span>
            <Headphones size={34} />
          </div>
        </section>

        <section className="player-section" id="player" aria-label="Player de áudio">
          <div className="player-card">
            <div className="player-heading">
              <div className={`record ${isPlaying ? 'spinning' : ''}`}>
                <Disc3 size={42} />
              </div>
              <div>
                <span className="now-playing">
                  {message}
                  {activeSection && isPlaying && (
                    <em className={`section-chip is-${activeSection}`}>
                      {SECTION_LABELS[activeSection] || activeSection}
                    </em>
                  )}
                </span>
                <h2>CHANGE</h2>
                <p>DEFTONES <i /> {trackSource}</p>
              </div>
              <div className="track-number">10</div>
            </div>

            <Spectrum
              analyser={analyser}
              isPlaying={isPlaying}
              audioRef={audioRef}
              isChorus={isChorus}
            />

            <div className="timeline">
              <span>{formatTime(currentTime)}</span>
              <div className="timeline-track">
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
              <span>{duration ? formatTime(duration) : DEFAULT_DURATION}</span>
            </div>

            <div className="player-controls">
              <button
                className="icon-button"
                onClick={() => {
                  audioRef.current.currentTime = 0
                  setCurrentTime(0)
                }}
                aria-label="Voltar ao início"
              >
                <RotateCcw size={20} />
              </button>

              <button className="play-button" onClick={togglePlayback} aria-label={isPlaying ? 'Pausar' : 'Tocar'}>
                {isPlaying ? <Pause fill="currentColor" /> : <Play fill="currentColor" />}
              </button>

              <div className="volume-control">
                <button className="icon-button" onClick={() => setMuted((value) => !value)} aria-label={muted ? 'Ativar som' : 'Silenciar'}>
                  {muted || volume === 0 ? <VolumeX size={20} /> : <Volume2 size={20} />}
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
                <Upload size={17} /> ESCOLHER MP3
              </button>
              <input
                ref={fileInputRef}
                className="visually-hidden"
                type="file"
                accept="audio/*,.mp3"
                onChange={(event) => loadFile(event.target.files?.[0])}
              />
            </div>
          </div>

          <div className="player-note">
            <Maximize2 size={17} />
            <p>ARRASTE O SEU MP3 PARA QUALQUER LUGAR DA TELA</p>
            <span>SPACE = PLAY / PAUSE &nbsp; M = MUTE</span>
          </div>
        </section>

        <section className="energy-section" id="energy">
          <div className="section-kicker">02 / ANATOMIA DA FAIXA</div>
          <div className="energy-intro">
            <h2>CALMA.<br /><em>MUDANÇA.</em><br />QUEDA.</h2>
            <p>
              Uma experiência construída para acompanhar a dinâmica da música: observação, atrito
              contido e desabamento. Coloque os fones, carregue o arquivo e deixe o espectro reagir
              em tempo real.
            </p>
          </div>

          <div className="energy-map">
            {[
              ['01', 'OBSERVAÇÃO', '0'],
              ['02', 'METAMORFOSE', '24'],
              ['03', 'ASAS ARRANCADAS', '49'],
              ['04', 'VAZIO', '76'],
            ].map(([number, label, start], index) => {
              const end = [24, 49, 76, 101][index]
              const active = progress >= Number(start) && progress < end
              return (
                <article className={active && isPlaying ? 'active' : ''} key={label}>
                  <span>{number}</span>
                  <strong>{label}</strong>
                  <div className="energy-lines" aria-hidden="true">
                    {Array.from({ length: 12 }, (_, line) => <i key={line} style={{ '--line': line }} />)}
                  </div>
                </article>
              )
            })}
          </div>
        </section>
      </main>

      <div className="ticker" aria-hidden="true">
        <div>
          CHANGE / DEFTONES / 2000 / IN THE HOUSE OF FLIES / CHANGE / DEFTONES / 2000 / IN THE HOUSE OF FLIES /&nbsp;
          CHANGE / DEFTONES / 2000 / IN THE HOUSE OF FLIES / CHANGE / DEFTONES / 2000 / IN THE HOUSE OF FLIES /
        </div>
      </div>

      <footer>
        <div className="footer-mark">C<span>/</span>00</div>
        <p>EXPERIÊNCIA NÃO OFICIAL CRIADA PARA FÃS.<br />ÁUDIO REPRODUZIDO LOCALMENTE NO SEU DISPOSITIVO.</p>
        <a href="#top">BACK TO TOP ↑</a>
      </footer>
    </div>
  )
}

export default App
