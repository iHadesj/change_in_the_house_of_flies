# Change (In The House Of Flies) — Track Experience

Microsite interativo inspirado em **Change (In The House Of Flies)**, do Deftones.
Não é uma landing estática: ela apodrece enquanto a faixa toca. Player offline,
enxame de moscas reagindo ao áudio, letra datilografada em sincronia, casa que se
decompõe e um easter egg escondido no título.

## Direção de arte

**Paleta.** Preto puxado pro roxo (`#0a0a0c`), roxo/índigo profundo (`#2d1b3d` →
`#4a2f5c`), verde-mosca usado como veneno — pouco e só onde dói (`#8b9d3f`) — e o
branco osso do *White Pony* (`#e8e4d8`), reservado a título, LCD e ponto-chave.

**Tipografia.** Display em serifa de contraste alto (Bodoni / Didot / Hoefler,
com queda pra Times), quebrada por uma máscara de fatias horizontais e por um
escorrido que cresce com a podridão. Corpo e letra em monoespaçada, tipo
relatório clínico. A tensão entre as duas é o efeito.

**Duas variáveis mandam em quase tudo**, escritas fora do React direto no style
da raiz:

- `--decay` (0..1) — o avanço da faixa. Mais moscas, mais grão, mais linhas de
  varredura, mais separação cromática no título, menos casa de pé.
- `--intensity` (0..1) — o volume do momento, vindo do analisador. Faz o halo e o
  grão respirarem, e agita o enxame.

## O player

Um toca-fitas, não um player de streaming: parafusos, carretel que gira, fita que
passa de um lado pro outro conforme o progresso, visor de LCD com os segmentos
apagados aparecendo por baixo dos dígitos, e teclas que afundam e rangem ao
apertar.

No lugar das barras de espectro, um **enxame**: cada coluna de frequência vira
moscas que se dispersam com o volume daquela faixa e voltam pra linha no
silêncio.

## Desempenho

O alvo é celular, não desktop com GPU sobrando.

- **Orçamento por aparelho** (`src/perf.js`): DPR, taxa de quadros e contagem de
  partículas saem de `hardwareConcurrency` / `deviceMemory` / tipo de ponteiro,
  medidos uma vez na carga. Celular modesto roda 5–20 moscas a 24fps em DPR 1;
  desktop roda 14–74 a 60fps em DPR 2.
- **Sprites pré-rotacionados**: 3 tamanhos × 8 ângulos desenhados uma vez. Nenhum
  quadro paga transformação de matriz, `shadowBlur` ou gradiente por partícula.
- **Limpeza por retângulo sujo**: o canvas de fundo cobre o viewport, então
  limpar a tela inteira tocaria milhões de pixels por quadro pra apagar algumas
  dezenas de bichos de 8px. Só as caixas do quadro anterior são apagadas.
- **rAF com alvo de fps** e `dt` limitado, pausando quando a aba sai de foco ou o
  elemento sai da tela (`IntersectionObserver`).
- **Só transform e opacity animam.** Filtro, blur e `box-shadow` animados ficam
  de fora — no celular eles repintam camada de tela cheia a cada quadro.
- O grão de vídeo é uma camada do tamanho da tela mais uma ladrilhagem de folga,
  a 2fps em `steps()`. As linhas de varredura são estáticas.
- No celular os painéis abrem mão do `backdrop-filter`, e `:hover` não existe em
  aparelho sem mouse (ele gruda depois do tap).
- A letra é datilografada escrevendo direto no nó de texto, sem `setState` por
  caractere.

Tudo respeita `prefers-reduced-motion`: o enxame congela num quadro, o grão e a
faixa de tracking somem, e a letra aparece inteira.

## Adicionando a música

Coloque o seu arquivo em:

```text
public/music/change.mp3
```

Também dá pra escolher ou arrastar um MP3 pra qualquer lugar da tela. O arquivo é
lido apenas pelo navegador.

## Rodando o projeto

```bash
npm install
npm run dev
```

Para gerar a versão final:

```bash
npm run build
```

## Letra sincronizada

O botão **LETRA** abre um painel que acompanha a música linha por linha. A linha
ativa é datilografada no ritmo do trecho — a velocidade sai do tempo que sobra
até a próxima linha entrar — com rolagem automática (que cede a vez se você
navegar com o dedo) e toque numa linha pra pular pra ela.

O projeto não vem com letra. Você carrega a sua por `public/lyrics/change.txt` /
`.lrc` ou colando direto no painel.

**Quem vê o quê.** O arquivo em `public/lyrics/` é servido a todo visitante; o
rascunho colado/sincronizado fica no `localStorage` e é só seu, naquele aparelho.
O rascunho tem precedência — então, depois de sincronizar, o que está na tela é
a sua cópia, não a do público. `USAR A DO PROJETO` e `LIMPAR` descartam o
rascunho e voltam pro arquivo.

**Sincronizando.** Como não dá pra adivinhar os tempos da faixa, o painel traz um
sincronizador: modo **SYNC**, `Enter` (ou o botão) marca cada linha durante a
reprodução, `±0,25s` corrige a última, `DESFAZER` desmarca a última e volta o
cursor, e `TUDO ±0,5s` desloca a letra inteira.

O atalho que corta a maior parte do trabalho é `DERIVAR BLOCO DO GÊMEO`: refrão
que volta idêntico não precisa ser remarcado. Marque só a primeira linha do bloco
repetido e o resto sai dos intervalos internos da ocorrência já sincronizada,
ancorados nessa marca — junto com a marcação de seção. Numa letra em que o refrão
volta três vezes, isso troca ~28 marcações por ~3.

Pra publicar: `COPIAR .LRC` (área de transferência) ou `BAIXAR .LRC`, e o arquivo
vai pra `public/lyrics/change.lrc` versionado com o projeto. A partir daí vale
pra qualquer visitante, sem ninguém precisar sincronizar de novo.

Detalhes de formato em [public/lyrics/LEIA-ME.txt](public/lyrics/LEIA-ME.txt).

## Efeitos de intensidade

Marcar um bloco como refrão (`[refrão]` no `.txt`, `{refrão}` no `.lrc`, ou o
botão REFRÃO no modo SYNC) liga os efeitos quando ele entra: halo violeta
pulsando, título respirando, tremor no toca-fitas, enxame em verde-mosca, grão
mais denso e carretel acelerado. As marcas de refrão também aparecem na barra de
progresso.

## A casa

A silhueta da seção **A CASA** se desmonta peça por peça: telhado abrindo, chaminé
saindo de lugar, janelas acendendo em verde e moscas escapando pela porta. O
quanto ela cedeu é o maior valor entre o avanço da faixa e o avanço do scroll
dentro da seção — role a página ou deixe a fita rodar, dá no mesmo.

## Easter egg

Clique (ou segure) no título **CHANGE**.

## Atalhos

- `Espaço`: play / pause
- `M`: ativar / silenciar áudio
- `Enter`: marcar linha (no modo SYNC da letra)

## Tocando em segundo plano

O player usa a Media Session API, então o áudio continua com a tela apagada ou
com o app fora de foco, e aparece na tela de bloqueio / central de mídia.

Em iPhone e iPad o enxame roda em modo simulado: o `AudioContext` do Web Audio é
interrompido pelo sistema quando o app vai pro fundo, e isso derrubaria o som.
Nos demais navegadores ele continua vindo do analisador real.

Para instalar como app no iOS: abrir no Safari → Compartilhar → *Adicionar à Tela
de Início*.

## Sobre o significado

O botão **SIGNIFICADO** abre as notas da faixa: a metáfora da mosca como
degradação e renascimento desconfortável, as asas arrancadas como controle e
crueldade, o clipe das máscaras e a alienação, o paradoxo de se sentir vivo depois
da queda, a ambiguidade da cruz e da arma — e a leitura geral de que a
transformação pode ser libertação e destruição ao mesmo tempo. As palavras-chave
do texto falham na tela de vez em quando, por dois quadros.

## Mapa dos arquivos

```text
src/perf.js       orçamento por aparelho + hooks de visibilidade
src/flies.js      motor de canvas: sprites, campo de fundo e enxame do player
src/FlyCanvas.jsx casca React em volta do motor
src/House.jsx     a casa que se decompõe
src/TypedLine.jsx a linha datilografada
src/meaning.js    notas da faixa + marcação das palavras-chave
src/lyrics.js     leitura de .lrc / texto simples, sincronia e exportação
```

> Projeto conceitual não oficial, sem fim comercial. O código não traz áudio nem
> letra: o que for colocado em `public/music/` e `public/lyrics/` é conteúdo de
> quem monta o site, e passa a ser servido a quem visitar.
