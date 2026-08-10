import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A VERSÃO NO `/health`.
 *
 * Nasceu de um erro concreto, e é ele que estes testes guardam: em 8/8/2026 um
 * parecer afirmou ao cliente que dois consertos estavam publicados. Não
 * estavam — a esteira de deploy estava quebrada havia dois dias. O código
 * estava mesclado, a CI verde, e ninguém percebeu, porque de fora **não havia
 * como distinguir "mesclado" de "no ar"**. O cliente foi orientado a conferir
 * algo que não existia na tela dele.
 *
 * Um `curl` no `/health` passa a responder isso. Os três casos abaixo são os
 * três jeitos de a resposta mentir:
 *
 *   · devolver a versão errada (não carimbada no build);
 *   · devolver um número inventado quando não há carimbo;
 *   · devolver a versão certa de uma imagem que o contêiner não está rodando.
 */
const montarApp = async (gitSha: string) => {
  // `process.env` e não um mock de `../src/config/env.js`: assim o schema do
  // zod parseia de verdade, e o teste cobre também a declaração da variável.
  // Substituir o módulo inteiro por um objeto escrito à mão obrigaria a
  // enumerar todo campo que qualquer rota lê — e o primeiro que faltasse
  // quebraria por um motivo que não tem nada a ver com o que se quer provar.
  process.env.GIT_SHA = gitSha;
  vi.doMock('../src/lib/prisma.js', () => ({
    prisma: { $queryRaw: async () => [{ '?column?': 1 }] },
  }));
  vi.doMock('../src/sync/syncHealth.js', () => ({
    getFrescor: async () => ({
      ultimoSucesso: new Date('2026-08-09T09:09:37.618Z'),
      horas: 12.7,
      vencido: false,
      limiteHoras: 26,
    }),
  }));
  const { createApp } = await import('../src/app.js');
  return createApp();
};

/** Sobe a app numa porta efêmera, chama `GET /health` e desliga. */
const pedirHealth = async (app: ReturnType<typeof Object>): Promise<Record<string, unknown>> =>
  new Promise((resolve, reject) => {
    const servidor = (app as { listen: (p: number, cb: () => void) => { address: () => { port: number }; close: (cb: () => void) => void } }).listen(0, () => {
      const { port } = servidor.address();
      fetch(`http://127.0.0.1:${port}/health`)
        .then((r) => r.json())
        .then((j) => servidor.close(() => resolve(j as Record<string, unknown>)))
        .catch((e) => servidor.close(() => reject(e)));
    });
  });

describe('/health · a versão publicada', () => {
  const shaOriginal = process.env.GIT_SHA;
  beforeEach(() => vi.resetModules());
  afterEach(() => {
    if (shaOriginal === undefined) delete process.env.GIT_SHA;
    else process.env.GIT_SHA = shaOriginal;
    vi.doUnmock('../src/lib/prisma.js');
    vi.doUnmock('../src/sync/syncHealth.js');
  });

  it('devolve a versão carimbada na imagem', async () => {
    const app = await montarApp('e0b8444');
    const corpo = await pedirHealth(app);
    expect(corpo.versao).toBe('e0b8444');
    expect(corpo.status).toBe('ok');
  });

  it('sem carimbo, devolve `null` — e não um número inventado', async () => {
    // Imagem construída à mão, sem passar o build arg. Cair no `package.json`
    // ou escrever "desconhecida" daria a impressão de resposta, e quem lê
    // acreditaria. `null` obriga a perguntar.
    const app = await montarApp('');
    const corpo = await pedirHealth(app);
    expect(corpo.versao).toBeNull();
  });

  it('diz também DESDE QUANDO este processo está de pé', async () => {
    // Versão sozinha não basta: a imagem pode estar construída na versão nova
    // e o contêiner ainda rodando a antiga. As duas informações falham
    // separado, então as duas precisam estar na resposta.
    const antes = Date.now();
    const app = await montarApp('e0b8444');
    const corpo = await pedirHealth(app);

    expect(typeof corpo.iniciadoEm).toBe('string');
    const t = Date.parse(corpo.iniciadoEm as string);
    expect(Number.isNaN(t)).toBe(false);
    // Instante plausível: entre um minuto antes deste teste e agora.
    expect(t).toBeGreaterThan(antes - 60_000);
    expect(t).toBeLessThanOrEqual(Date.now());
  });

  it('o instante de início NÃO muda entre requisições', async () => {
    // Se fosse carimbado por requisição, ele diria "agora" para sempre e não
    // significaria "desde quando a API está de pé" — que é a única pergunta
    // que ele responde.
    const app = await montarApp('e0b8444');
    const primeira = await pedirHealth(app);
    const segunda = await pedirHealth(app);
    expect(segunda.iniciadoEm).toBe(primeira.iniciadoEm);
  });
});

/**
 * A CORRENTE QUE LEVA A VERSÃO ATÉ A IMAGEM.
 *
 * Três elos, em três formatos diferentes, nenhum deles coberto por tipo:
 *
 *   1. `scripts/deploy.sh` exporta `GIT_SHA` do commit recém-baixado;
 *   2. `docker-compose.prod.yml` repassa como build arg;
 *   3. o `Dockerfile` recebe o `ARG` e o promove a `ENV`.
 *
 * Se qualquer um se soltar, o `/health` passa a responder `versao: null` — que
 * é indistinguível de "imagem construída à mão", o caso legítimo. Ou seja: o
 * defeito se disfarça exatamente do estado que a resposta prevê. Os testes de
 * cima continuariam verdes, porque eles provam o handler, não a corrente.
 *
 * O certo seria construir a imagem e ler a variável — feito à mão durante o
 * desenvolvimento, mas não aqui: não há daemon de Docker na CI deste
 * repositório. Enquanto não houver, isto é uma regra de lint escrita como
 * teste. Não prova que o carimbo chega; prova que os três elos não sumiram.
 */
describe('fiação: a versão chega até a imagem', () => {
  const ler = (rel: string) => readFileSync(new URL(`../../../${rel}`, import.meta.url), 'utf8');

  it('o deploy.sh exporta GIT_SHA DEPOIS do checkout e ANTES do build', () => {
    const sh = ler('scripts/deploy.sh');
    const posReset = sh.indexOf('git reset --hard "origin/$BRANCH"');
    const posExport = sh.indexOf('export GIT_SHA=');
    const posBuild = sh.indexOf('$COMPOSE build app');

    expect(posReset, 'deploy.sh não faz mais o reset esperado').toBeGreaterThan(-1);
    expect(posExport, 'deploy.sh precisa exportar GIT_SHA').toBeGreaterThan(-1);
    // A ordem é o que importa: exportar antes do reset carimbaria a versão
    // ANTIGA na imagem nova — o pior resultado possível, porque mente com
    // aparência de certeza.
    expect(posExport).toBeGreaterThan(posReset);
    expect(posExport).toBeLessThan(posBuild);
  });

  it('o compose repassa GIT_SHA como build arg', () => {
    const yml = ler('docker-compose.prod.yml');
    expect(yml).toMatch(/args:\s*(#[^\n]*\n\s*)*GIT_SHA:\s*\$\{GIT_SHA:-\}/);
  });

  it('o Dockerfile recebe o ARG e o promove a ENV no runtime', () => {
    const df = ler('Dockerfile');
    const runtime = df.slice(df.indexOf('AS runtime'));
    expect(runtime, 'falta o ARG no estágio de runtime').toMatch(/ARG GIT_SHA/);
    // `ARG` sozinho vale só durante o build: sem o `ENV`, a variável não existe
    // no contêiner em execução e o /health responde null para sempre.
    expect(runtime, 'ARG sem ENV não sobrevive ao build').toMatch(/GIT_SHA=\$GIT_SHA/);
  });
});

/**
 * A DIVERGÊNCIA QUE A CAUDA POSICIONAL CAUSOU.
 *
 * `buildDecisionCards` chegou a sete parâmetros posicionais, e o sétimo tinha
 * default. Quem chamava com cinco recebia os dois últimos em silêncio — o tipo
 * aceita, e nada acusa.
 *
 * Foi o que aconteceu com `stuckDaysByProduct`, o sinal de TEMPO que faz o
 * desconto de liquidação variar por peça. Medido no repositório antes deste
 * refatoramento:
 *
 *   · produção  (planning.service.ts) → CINCO argumentos, sem o mapa
 *   · demo      (demo.ts:2095)        → SEIS argumentos, COM o mapa
 *
 * Resultado visível para o cliente: na demonstração o desconto variava conforme
 * o tempo parado; em produção saía da constante. A demo era mais capaz que a
 * API, numa linha que o cliente olha para decidir preço.
 *
 * A assinatura virou objeto. Este teste prende a CONSEQUÊNCIA — e não a forma —
 * porque objeto também pode ser chamado sem o campo.
 *
 * O QUE ELE AINDA NÃO PROVA, dito aqui para não virar a mesma armadilha: a
 * produção continua NÃO passando o mapa. Passá-lo exige uma consulta a
 * `CardSighting` antes de montar o quadro — e `generateCards` é a rota mais
 * quente da plataforma, a que acabou de sair de um incidente de 503 e 856 MB.
 * Acrescentar consulta ali sem medir seria repetir exatamente o erro que a
 * correção do saldo ao vivo cometeu.
 *
 * A fiação entra junto da frente que materializa o quadro, onde o histórico já
 * estará em mãos e a consulta deixa de ser por requisição. Até lá, o desconto
 * em produção sai da constante — e isto está escrito para que a próxima pessoa
 * saiba que é dívida conhecida, e não descuido.
 */
describe('quadro de decisões · o tempo parado chega ao desconto', () => {
  it('o mesmo card, com e sem dias parados, sugere descontos diferentes', async () => {
    const { analyzeProduct, buildDecisionCards, DEFAULT_PLANNING_CONFIG } = await import(
      '../src/modules/planning/planning.math.js'
    );
    const parada = analyzeProduct(
      {
        productId: 'p-parada',
        description: 'OO9208 AGGY 38 OCULOS OAKLEY',
        brand: 'LUXOTTICA',
        category: 'OCULOS',
        unitsSold: 0,
        currentStock: 6,
        unitCost: 600,
        unitPrice: 1500,
      },
      90,
      DEFAULT_PLANNING_CONFIG,
    );
    expect(parada.recommendation, 'a peça precisa ser de liquidação').toBe('LIQUIDATE');

    const semTempo = buildDecisionCards([parada], []);
    const comTempo = buildDecisionCards([parada], [], {
      stuckDaysByProduct: new Map([['p-parada', 240]]),
    });

    const desconto = (b: ReturnType<typeof buildDecisionCards>) =>
      b.cards.find((c) => c.type === 'LIQUIDACAO')?.discountPct ?? null;

    expect(desconto(semTempo)).not.toBeNull();
    expect(desconto(comTempo)).not.toBeNull();
    // 240 dias parados sobem o desconto acima do piso da faixa de preço. Se os
    // dois derem igual, o mapa não está chegando ao motor — que era o estado da
    // produção.
    expect(desconto(comTempo)!).toBeGreaterThan(desconto(semTempo)!);
  });
});
