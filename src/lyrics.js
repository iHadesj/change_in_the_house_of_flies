// Motor de letra: leitura de .lrc / texto simples, sincronia e exportação.
// Nenhuma letra mora aqui — o conteúdo vem do usuário (colado no app ou de um
// arquivo em public/lyrics/, que o .gitignore mantém fora do repositório).

export const STORAGE_KEY = 'change:lyrics:v1'

const TIME_TAG = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g
const META_TAG = /^\[(ti|ar|al|au|by|length|offset|re|ve):([^\]]*)\]$/i
const SECTION_PREFIX = /^\{([^}]*)\}\s*/
const SECTION_HEADER = /^[[(]([^\])]*)[\])]$/

// Chaves já normalizadas (minúsculas, sem acento, só letras).
const SECTION_ALIASES = {
  intro: 'intro',
  verse: 'verse',
  verso: 'verse',
  prechorus: 'prechorus',
  prerefrao: 'prechorus',
  chorus: 'chorus',
  refrao: 'chorus',
  hook: 'chorus',
  bridge: 'bridge',
  ponte: 'bridge',
  breakdown: 'breakdown',
  outro: 'outro',
  final: 'outro',
  instrumental: 'instrumental',
  solo: 'instrumental',
}

export const SECTION_LABELS = {
  intro: 'INTRO',
  verse: 'VERSO',
  prechorus: 'PRÉ',
  chorus: 'REFRÃO',
  bridge: 'PONTE',
  breakdown: 'BREAK',
  outro: 'OUTRO',
  instrumental: 'INSTR.',
  other: '—',
}

export const SECTION_ORDER = [
  'intro',
  'verse',
  'prechorus',
  'chorus',
  'bridge',
  'breakdown',
  'outro',
  'instrumental',
]

export function normalizeSection(raw) {
  if (!raw) return null
  const key = String(raw)
    .toLowerCase()
    // NFD separa o acento da letra; o filtro seguinte descarta o acento solto.
    .normalize('NFD')
    .replace(/[^a-z]/g, '')
  if (!key) return null
  return SECTION_ALIASES[key] || 'other'
}

export function parseTimestamp(minutes, seconds, fraction) {
  const digits = fraction ? fraction.padEnd(3, '0').slice(0, 3) : '0'
  return Number(minutes) * 60 + Number(seconds) + Number(digits) / 1000
}

export function formatTimestamp(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '00:00.00'
  // Arredonda primeiro, decompõe depois: evita o ":60" de 119.996s.
  const total = Math.round(seconds * 100)
  const minutes = Math.floor(total / 6000)
  const secs = Math.floor((total % 6000) / 100)
  const hundredths = total % 100
  return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(
    hundredths,
  ).padStart(2, '0')}`
}

/**
 * Ordena por tempo sem perder as linhas ainda não sincronizadas: cada linha
 * solta viaja junto da linha marcada que vem antes dela.
 */
function sortPartiallyTimed(lines) {
  const blocks = []

  lines.forEach((line) => {
    const last = blocks[blocks.length - 1]
    if (!Number.isFinite(line.time) && last) last.items.push(line)
    else blocks.push({ time: line.time, items: [line] })
  })

  return blocks
    .map((block, order) => ({ ...block, order }))
    .sort((a, b) => {
      const aTime = Number.isFinite(a.time) ? a.time : Number.NEGATIVE_INFINITY
      const bTime = Number.isFinite(b.time) ? b.time : Number.NEGATIVE_INFINITY
      return aTime - bTime || a.order - b.order
    })
    .flatMap((block) => block.items)
}

function pushLine(lines, { time, text, section, startsBlock }) {
  const clean = text.trim()
  if (!clean) return
  lines.push({
    time,
    text: clean,
    section: section || null,
    // Linha em branco no original vira fronteira de bloco. É o que dá ao app
    // a estrutura de estrofes / refrões quando não há cabeçalho nenhum.
    startsBlock: Boolean(startsBlock) || lines.length === 0,
  })
}

/** Início (inclusivo) e fim (exclusivo) do bloco que contém `index`. */
export function blockRange(lines, index) {
  let start = Math.min(Math.max(index, 0), lines.length - 1)
  while (start > 0 && !lines[start].startsBlock) start -= 1

  let end = index + 1
  while (end < lines.length && !lines[end].startsBlock) end += 1

  return { start, end }
}

export function listBlocks(lines) {
  const blocks = []
  lines.forEach((line, index) => {
    if (!blocks.length || line.startsBlock) blocks.push({ start: index, end: index + 1 })
    else blocks[blocks.length - 1].end = index + 1
  })
  return blocks
}

/** Identidade textual de um bloco, pra reconhecer refrões repetidos. */
export function blockSignature(lines, start, end) {
  return lines
    .slice(start, end)
    .map((line) => line.text.toLowerCase())
    .join('\n')
}

/**
 * Preenche um bloco inteiro a partir de outro de texto idêntico já sincronizado.
 *
 * Numa letra assim, o refrão volta três vezes e os "ah-ah" duas: marcar tudo na
 * mão é marcar a mesma coisa quatro vezes e errar em pelo menos uma. Aqui basta
 * marcar a PRIMEIRA linha do bloco repetido — o resto vem dos intervalos
 * internos da ocorrência já sincronizada, ancorados nessa marca.
 *
 * Devolve o novo array de linhas, ou `null` quando não dá pra derivar (não há
 * bloco gêmeo pronto, ou a âncora ainda não foi marcada).
 */
export function deriveFromTwin(lines, index) {
  const target = blockRange(lines, index)
  const anchor = lines[target.start]
  if (!anchor || !Number.isFinite(anchor.time)) return null

  const length = target.end - target.start
  const signature = blockSignature(lines, target.start, target.end)

  const reference = listBlocks(lines).find((block) => {
    if (block.start === target.start) return false
    if (block.end - block.start !== length) return false
    if (blockSignature(lines, block.start, block.end) !== signature) return false
    for (let i = block.start; i < block.end; i += 1) {
      if (!Number.isFinite(lines[i].time)) return false
    }
    return true
  })

  if (!reference) return null

  const origin = lines[reference.start].time
  return lines.map((line, i) => {
    if (i < target.start || i >= target.end) return line
    const source = lines[reference.start + (i - target.start)]
    return {
      ...line,
      time: Math.max(0, anchor.time + (source.time - origin)),
      // A marcação de seção viaja junto: derivar um refrão já o marca como tal.
      section: source.section ?? line.section,
    }
  })
}

/** Desloca toda a letra de uma vez, pra quando ela está uniformemente atrasada. */
export function shiftLines(lines, delta) {
  return lines.map((line) =>
    Number.isFinite(line.time) ? { ...line, time: Math.max(0, line.time + delta) } : line,
  )
}

// Letra sincronizada: [mm:ss.xx] por linha, com {refrão} opcional marcando a
// seção. A marcação vale dali em diante até a próxima.
function parseLrc(source) {
  const meta = {}
  const lines = []
  let section = null
  let pendingBreak = true

  source.split(/\r?\n/).forEach((rawLine) => {
    const line = rawLine.trim()
    if (!line) {
      pendingBreak = true
      return
    }

    const metaMatch = line.match(META_TAG)
    if (metaMatch) {
      meta[metaMatch[1].toLowerCase()] = metaMatch[2].trim()
      return
    }

    TIME_TAG.lastIndex = 0
    const stamps = []
    let match = TIME_TAG.exec(line)
    while (match) {
      stamps.push(parseTimestamp(match[1], match[2], match[3]))
      match = TIME_TAG.exec(line)
    }
    // Tag desconhecida no formato [algo:...] é metadado, não letra.
    if (!stamps.length && /^\[[a-z]+:/i.test(line)) return

    let text = line.replace(TIME_TAG, '').trim()
    const sectionMatch = text.match(SECTION_PREFIX)
    if (sectionMatch) {
      // Marcação explícita manda, inclusive `{}`, que zera a seção. Sem esse
      // reset um bloco sem marcação herdaria o refrão anterior.
      section = normalizeSection(sectionMatch[1])
      text = text.replace(SECTION_PREFIX, '')
    }

    // Linha sem marca de tempo continua na lista (sincronia parcial em andamento).
    if (!stamps.length) {
      pushLine(lines, { time: null, text, section, startsBlock: pendingBreak })
      pendingBreak = false
      return
    }

    stamps.forEach((time) => pushLine(lines, { time, text, section, startsBlock: pendingBreak }))
    pendingBreak = false
  })

  // Ordena só o que tem tempo; as linhas soltas guardam a posição relativa.
  return { meta, lines: sortPartiallyTimed(lines) }
}

// Letra crua: uma linha por linha, [refrão] / (chorus) como cabeçalho de seção,
// linha em branco vira respiro.
function parsePlain(source) {
  const lines = []
  let section = null
  let pendingBreak = true

  source.split(/\r?\n/).forEach((rawLine) => {
    const line = rawLine.trim()
    if (!line) {
      pendingBreak = true
      return
    }

    const headerMatch = line.match(SECTION_HEADER)
    if (headerMatch) {
      const parsed = normalizeSection(headerMatch[1])
      // Só some da lista se for uma seção reconhecida. Um [x2] ou um aparte
      // entre parênteses é parte da letra e não pode evaporar.
      if (parsed && parsed !== 'other') {
        section = parsed
        pendingBreak = true
        return
      }
    }

    pushLine(lines, { time: null, text: line, section, startsBlock: pendingBreak })
    pendingBreak = false
  })

  return { meta: {}, lines }
}

export function parseLyrics(source) {
  if (!source || !source.trim()) return { meta: {}, lines: [] }
  TIME_TAG.lastIndex = 0
  return TIME_TAG.test(source) ? parseLrc(source) : parsePlain(source)
}

export function toLrc({ meta = {}, lines = [] }) {
  const header = Object.entries(meta)
    .filter(([, value]) => value !== undefined && value !== '')
    .map(([key, value]) => `[${key}:${value}]`)

  let section = null
  const body = []
  lines.forEach((line, index) => {
    // Devolve a linha em branco entre blocos: é a estrutura de estrofes.
    if (index > 0 && line.startsBlock) body.push('')

    const stamp = Number.isFinite(line.time) ? `[${formatTimestamp(line.time)}]` : ''
    const next = line.section || null
    let prefix = ''
    if (next !== section) {
      section = next
      // `{}` marca a volta para "sem seção" — sem isso o bloco seguinte
      // herdaria o refrão anterior ao reler o arquivo.
      prefix = next ? `{${SECTION_LABELS[next] || next}}` : '{}'
    }
    body.push(`${stamp}${prefix}${line.text}`)
  })

  return [...header, ...(header.length ? [''] : []), ...body].join('\n')
}

/** Índice da última linha cujo tempo já passou. -1 antes da primeira. */
export function findActiveIndex(lines, time) {
  let low = 0
  let high = lines.length - 1
  let result = -1

  while (low <= high) {
    const mid = (low + high) >> 1
    if (lines[mid].time <= time) {
      result = mid
      low = mid + 1
    } else {
      high = mid - 1
    }
  }

  return result
}

/**
 * Agrupa linhas consecutivas da mesma seção em faixas de tempo.
 * É isso que diz ao app quando o refrão está rolando.
 */
export function buildSectionRanges(lines, duration) {
  const timed = lines.filter((line) => Number.isFinite(line.time))
  if (!timed.length) return []

  const ranges = []
  timed.forEach((line, index) => {
    const end = timed[index + 1]?.time ?? (Number.isFinite(duration) ? duration : line.time + 8)
    const last = ranges[ranges.length - 1]
    if (last && last.section === line.section) last.end = end
    else ranges.push({ section: line.section, start: line.time, end })
  })

  return ranges
}

export function sectionAt(ranges, time) {
  const found = ranges.find((range) => time >= range.start && time < range.end)
  return found?.section ?? null
}

export function readStoredLyrics() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    return raw && raw.trim() ? raw : null
  } catch {
    return null // modo privado / storage bloqueado
  }
}

export function writeStoredLyrics(source) {
  try {
    if (source && source.trim()) window.localStorage.setItem(STORAGE_KEY, source)
    else window.localStorage.removeItem(STORAGE_KEY)
    return true
  } catch {
    return false
  }
}
