# O sertão já foi mar

> O sertão já foi mar.
> O mar já foi sertão.
> E inevitavelmente voltarão a ser um só.

Experiência artística navegável para a obra de **Vic Bulhões**. Não é um
portfólio, não é uma galeria e não é um site institucional: é **uma única obra
contínua** que o visitante atravessa com o scroll.

A coleção segue o corpo de obra do artista, em seis movimentos:

| | |
| --- | --- |
| **i** | amanhecer no sertão salino — mar no horizonte, peixes onde deveriam existir pássaros |
| **ii** | **À deriva** — a água chegou; só os galhos secos ainda aparecem |
| **iii** | **Dança dos tamboretes** — submerso, fundo de areia com cáusticas |
| **iv** | **Arraia farpada de pano** — o contrafluxo: tudo sobe |
| **v** | **Sem título** — a noite de velas e coral rosa sobre o mandacaru |
| **vi** | o mesmo amanhecer da i — o ciclo fecha |

Os poemas exibidos são do artista, transcritos das próprias pranchas. A citação
de Darwin é a que ele copiou à mão no caderno de anatomia deste universo. O
primeiro e o último movimento não recebem ficha: são a abertura e o fecho do
mundo, não pinturas.

---

## Como rodar

```bash
cd experiences/sertao-mar
npm install
npm run dev       # http://localhost:5180
npm run build     # gera dist/ — estático, sem servidor
npm run preview
```

O projeto é **autônomo**: não depende de nada do restante do repositório e é
para viver em um repositório próprio. Para mudá-lo de casa, basta copiar a
pasta e:

```bash
cd sertao-mar
git init && git add -A && git commit -m "primeira travessia"
git remote add origin git@github.com:<usuário>/sertao-mar.git
git push -u origin main
```

---

## O que ainda falta preencher

| Onde | O quê |
| --- | --- |
| `src/obras.js` → `ano`, `tecnica`, `dimensoes` | dados de acervo de cada obra. Ficaram em branco de propósito: são dados que só o artista tem. **A ficha só exibe o que existe** — preencha e o campo aparece sozinho |
| `src/obras.js` → obra `v` | está como "Sem título" porque o nome não foi informado |

Cada obra também carrega um **estado do mundo** (`estado`) e uma **posição de
câmera** (`camera`). São esses dois blocos que definem a pintura — mudar um
número ali muda o quadro. Ver "Como editar o mundo", abaixo.

---

## A ideia técnica

Existe **uma tela só**, do primeiro ao último pixel. Não há troca de cena, não
há fade, não há página. O que existe é um conjunto de parâmetros contínuos que
descrevem o mundo, e o scroll interpola entre eles.

```
scroll → progresso amortecido (ScrollTrigger scrub sobre Lenis)
       → amostrar(p) → estado do mundo (água, névoa, coral, fóssil, luz, cor…)
       → uniformes compartilhados por TODOS os materiais
       → um render → pós-processamento
```

### Pipeline de um quadro

1. **Mundo (raymarch)** — um triângulo de tela inteira que ignora a câmera e
   *é* a câmera. Marcha um campo de altura procedural, resolve céu, terreno,
   água (com refração pelo fundo já calculado), cáusticas, bioluminescência e
   névoa. Escreve `gl_FragDepth`, e é isso que permite o passo seguinte.
2. **Criaturas (malhas instanciadas)** — flora, fósseis e fauna convivem no
   mesmo buffer de profundidade do raymarch. A altura do chão sob cada
   instância é avaliada **no vertex shader**, com a mesma função GLSL usada
   pelo raymarch: por isso nada flutua e nada afunda.
3. **Poeira / plâncton** — 26 mil pontos calculados inteiramente na GPU, em uma
   caixa toroidal que acompanha a câmera. São a mesma partícula: só muda o meio.
4. **Verniz** — profundidade de campo por espiral áurea sobre o buffer de
   profundidade, bloom em três níveis, aberração cromática mínima, trama de
   linho, grão de pigmento, vinheta de galeria, ACES e gama.

### Desempenho

Não há orçamento fixo de qualidade: há um **orçamento de tempo**. A cada quadro
o renderer mede a média móvel do frame time e ajusta duas coisas — a escala de
render (0,50 a 1,00) e o número de passos do raymarch (72 a 175). Em GPU
dedicada a experiência roda em escala cheia; em máquina fraca ela degrada a
resolução antes de degradar a fluidez.

Complementos: nenhum asset externo (nem GLTF, nem HDRI, nem textura — tudo é
equação), corte por distância e por proximidade da lente nas instâncias, LOD no
campo de altura (perfil grosso na marcha, perfil fino só no ponto de impacto),
partículas sem CPU e pausa total quando a aba perde o foco.

---

## Como editar o mundo

Todo o vocabulário visual está em `src/obras.js`, em `estado`:

| Parâmetro | O que faz |
| --- | --- |
| `agua` | altura do mar no mundo. Negativo = sertão seco; positivo = tudo submerso |
| `amplitude` / `frequencia` | escala e granulação do relevo |
| `fendas` | quanto o barro está rachado e quanto sal aflora |
| `marulho` | marcas de maré no chão — a lembrança do fundo do oceano |
| `coral` | quanto a flora já virou coral e anêmona (0 = cacto, 1 = marinho) |
| `fossil` | quanto os esqueletos emergiram do chão |
| `fauna` | densidade dos peixes que andam |
| `neblina` | densidade da bruma (ela assenta no chão; o céu fica limpo) |
| `bio` | bioluminescência |
| `causticas` | luz de água sobre o que está submerso |
| `plancton` | poeira (0) ↔ plâncton (1) |
| `contrafluxo` | a água escorrendo para cima |
| `exposicao` | exposição da lente |
| `elevacaoSol` / `azimuteSol` | posição do sol, em radianos |
| `ceuAlto`, `ceuHorizonte`, `sol`, `neblinaCor`, `areia`, `rocha`, `coralCor`, `aguaCor` | paleta, em sRGB — convertida para linear automaticamente |

E em `camera`: `pos`, `alvo`, `fov`, `foco` (plano de foco, em unidades de
mundo) e `abertura` (intensidade da profundidade de campo).

A curva que liga uma obra à seguinte está em `demora()`: ela deixa o mundo
quase parado no começo e no fim de cada intervalo e concentra a metamorfose no
meio. É isso que faz o visitante não perceber quando trocou de pintura.

**O último movimento reusa o estado do primeiro** (`AURORA_SALINA`). O ciclo
fecha literalmente: quem chega ao fim e continua descendo volta ao princípio.

---

## Geografia

O terreno tem três decisões deliberadas:

- um **corredor rebaixado** ao longo do eixo do percurso, por onde o olhar
  caminha — daí a sensação de vale;
- **serras** erguidas dos dois lados, que dão silhueta contra o céu;
- a **borda do mundo**, que afunda abaixo da linha da água a partir de ~120
  unidades do eixo. É por isso que existe sempre mar no horizonte, de qualquer
  ponto do percurso, sem que isso precise ser encenado.

---

## Som

Paisagem sonora generativa em Web Audio, desligada por padrão (política dos
navegadores exige gesto do usuário). Não há música: há ruído rosa filtrado
virando vento ou onda ou pressão de fundo, duas senoides muito graves batendo
entre si como pedra, e eventos sorteados — insetos só no seco, estalos cada vez
mais raros. A proporção entre eles é função do mesmo estado que pinta a tela.

---

## Acessibilidade e limites conhecidos

- Requer **WebGL 2**. Sem ele, a página informa isso em vez de quebrar.
- `prefers-reduced-motion` reduz as animações de interface; a obra em si
  continua sendo movimento — é o que ela é.
- Em telas estreitas o rastro lateral some e as fichas passam a ocupar a
  largura toda.
- Não há trilha alternativa em texto para a narrativa visual. Se o projeto for
  ao ar publicamente, vale acrescentar uma página-índice sóbria com as fichas
  técnicas das obras.

---

## Estrutura

```
src/
  main.js                  laço único: scroll → estado → tela
  obras.js                 a coleção e a interpolação entre mundos
  percurso.js              Lenis + ScrollTrigger (o scrub é a inércia de sonho)
  cena.js                  renderer, alvos, passes, orçamento de tempo
  geometria.js             anatomias paramétricas (nada é importado)
  tipografia.js            fichas, frontispício, rastro
  audio.js                 paisagem sonora generativa
  shaders/
    comum.glsl.js          ruído, terreno, atmosfera, profundidade
    mundo.glsl.js          o raymarch
    organismos.glsl.js     flora, fósseis, fauna
    particulas.glsl.js     poeira ↔ plâncton
    pos.glsl.js            o verniz
  styles/main.css          a interface invisível
```
