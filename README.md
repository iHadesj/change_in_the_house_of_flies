# Change (In The House Of Flies) — Track Experience

Microsite interativo inspirado no clima de **Change (In The House Of Flies)**, do
Deftones, com player offline, espectro de áudio em tempo real, letra sincronizada,
atalhos de teclado e layout responsivo.

paleta White Pony
(osso, violeta baço, preto quase azul), tipografia serifada em vez do Impact,
fundo procedural com moscas atravessando a tela e o pulso do refrão no andamento
arrastado da faixa (92 BPM).

## Adicionando a música

Coloque o seu arquivo em:

```text
public/music/change.mp3
```

Também é possível escolher ou arrastar um MP3 diretamente para a página. O arquivo
é lido apenas pelo navegador.

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

O botão **LETRA** abre um painel que acompanha a música linha por linha, com
rolagem automática (que cede a vez se você navegar com o dedo) e toque numa
linha pra pular pra ela.

Nenhuma letra vem no projeto — é material protegido. Você carrega a sua por
`public/lyrics/change.txt` / `.lrc` (ambos no `.gitignore`) ou colando direto no
painel, e nesse caso ela fica salva só no seu navegador. Como não dá pra
adivinhar os tempos da faixa, o painel traz um sincronizador: modo **SYNC**,
`Enter` (ou o botão) marca cada linha durante a reprodução, `±0,25s` corrige a
última, e **BAIXAR .LRC** exporta o resultado.

Detalhes de formato em [public/lyrics/LEIA-ME.txt](public/lyrics/LEIA-ME.txt).

## Efeitos de intensidade

Marcar um bloco como refrão (`[refrão]` no `.txt`, `{refrão}` no `.lrc`, ou o
botão REFRÃO no modo SYNC) liga os efeitos quando ele entra: halo violeta
pulsando, brilho no título, zoom no fundo, tremor no player, espectro maior,
ticker acelerado e as moscas do fundo se agitando. As marcas de refrão também
aparecem na barra de progresso.

Fora do refrão, um `--intensity` derivado do analisador de áudio faz o grão
respirar junto com a música. Tudo isso respeita `prefers-reduced-motion`.

## Atalhos

- `Espaço`: play / pause
- `M`: ativar / silenciar áudio
- `Enter`: marcar linha (no modo SYNC da letra)

## Tocando em segundo plano

O player usa a Media Session API, então o áudio continua com a tela apagada ou
com o app fora de foco, e aparece na tela de bloqueio / central de mídia.

Em iPhone e iPad o espectro roda em modo simulado: o `AudioContext` do Web Audio
é interrompido pelo sistema quando o app vai pro fundo, e isso derrubaria o som.
Nos demais navegadores o espectro continua vindo do analisador real.

Para instalar como app no iOS: abrir no Safari → Compartilhar → *Adicionar à Tela
de Início*.

## Sobre o significado

O botão **MOSTRAR SIGNIFICADO** abre as notas da faixa: a metáfora da mosca como
degradação e renascimento desconfortável, as asas arrancadas como controle e
crueldade, o clipe das máscaras e a alienação, o paradoxo de se sentir vivo depois
da queda, a ambiguidade da cruz e da arma — e a leitura geral de que a
transformação pode ser libertação e destruição ao mesmo tempo.

> Projeto conceitual não oficial. Nenhum áudio e nenhuma letra são distribuídos
> com o repositório.
