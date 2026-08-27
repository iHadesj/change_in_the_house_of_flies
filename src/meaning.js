// Notas de leitura da faixa. Fica em dados, e não em JSX, porque cada parágrafo
// passa por `splitKeywords` antes de ir pra tela: as palavras-chave viram nós
// próprios pra poderem tremer sozinhas.

export const MEANING = [
  {
    n: '01',
    title: 'A METÁFORA NO CENTRO',
    body: 'Chino Moreno já afirmou que a letra é altamente metafórica. A mudança descrita não é a do corpo: ela representa uma alteração intensa na forma como alguém se vê e é visto — percepção e identidade mexidas de lugar.',
  },
  {
    n: '02',
    title: '“I WATCHED YOU CHANGE / INTO A FLY”',
    body: 'A imagem da mosca funciona como símbolo de degradação ou perda de valor. Mas também pode indicar um renascimento desconfortável: a mosca está ligada à decadência e à efemeridade da vida. Nascer de novo, sim — só que como outra coisa, e não necessariamente melhor.',
  },
  {
    n: '03',
    title: '“PULLING OFF YOUR WINGS”',
    body: 'Arrancar as asas e rir em seguida reforça a ideia de controle ou crueldade diante da vulnerabilidade do outro. Sugere uma relação marcada por manipulação ou dominação: alguém observa a queda e se diverte com ela.',
  },
  {
    n: '04',
    title: 'O CLIMA E O CLIPE',
    body: 'O tom sombrio é intensificado pelo videoclipe — máscaras de animais, expressões apáticas — e isso aprofunda o sentimento de alienação. Todos estão juntos na mesma casa, na mesma festa, e ninguém está de fato ali.',
  },
  {
    n: '05',
    title: '“IT’S LIKE YOU NEVER HAD WINGS”',
    body: 'A repetição de que é como se nunca houvesse asas e de que agora ela se sente tão viva mostra o paradoxo: a mudança, mesmo dolorosa ou degradante, pode trazer uma sensação de vitalidade ou liberdade — ainda que ilusória.',
  },
  {
    n: '06',
    title: 'A CRUZ E A ARMA',
    body: 'O trecho em que ele olha para a cruz, desvia o olhar, entrega a arma e pede pra ser destruído adiciona ambiguidade. Pode ser lido como culpa, como sacrifício ou como desejo de fuga — e a música não resolve qual dos três.',
  },
  {
    n: '07',
    title: 'IDENTIDADE SOB PRESSÃO',
    body: 'O que atravessa tudo é a fragilidade da identidade: ela pode se perder diante de pressões emocionais e existenciais. Quem muda não escolhe totalmente em que vai virar, e quem assiste tem parte nisso.',
  },
  {
    n: '08',
    title: 'RESUMO DO SIGNIFICADO GERAL',
    body: 'A faixa explora as complexidades das relações humanas, mostrando que a transformação pode significar tanto libertação quanto destruição. É lenta, contida e sem catarse fácil: em vez de gritar a dor, ela observa de perto — que é exatamente a pegada do Deftones em White Pony.',
    summary: true,
  },
]

export const MEANING_LEAD =
  'Em “Change (In The House Of Flies)” a transformação vai além do aspecto físico e mergulha em identidade e percepção. Por partes — sem traduzir linha por linha, pra não reproduzir a letra inteira, mas cobrindo tudo que ela quer dizer:'

// As bordas `\b` evitam pegar a palavra dentro de outra ("casa" em "casaco").
const KEYWORDS =
  /\b(moscas?|casas?|mudanças?|transformaç(?:ão|ões)|asas|identidade|decadência|change|flies|fly|house)\b/gi

const cache = new Map()

/**
 * Quebra o texto em pedaços, marcando as palavras que devem falhar na tela.
 * O resultado é memoizado por string: os parágrafos são constantes, então cada
 * um paga essa conta uma vez na vida do app.
 */
export function splitKeywords(text) {
  const cached = cache.get(text)
  if (cached) return cached

  const parts = []
  let cursor = 0
  KEYWORDS.lastIndex = 0

  let match = KEYWORDS.exec(text)
  while (match) {
    if (match.index > cursor) parts.push({ text: text.slice(cursor, match.index) })
    parts.push({ text: match[0], key: true })
    cursor = match.index + match[0].length
    match = KEYWORDS.exec(text)
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor) })

  cache.set(text, parts)
  return parts
}
