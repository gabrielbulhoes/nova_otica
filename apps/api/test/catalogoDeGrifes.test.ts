import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * O CATÁLOGO DE GRIFES, e a inércia que ele viveu em silêncio.
 *
 * Medido no repositório em 10/08/2026, antes deste conserto:
 *
 *   · o `Dockerfile` não copia `apps/api/data` — só package.json, dist e prisma;
 *   · o serviço `app` do `docker-compose.prod.yml` não tinha `volumes:`;
 *   · `BRAND_CATALOG_PATH` não estava no `.env.production.example`;
 *   · `loadBrandCatalog()` caía em `cached = null` SEM UMA LINHA DE LOG — o
 *     `logger.info` só disparava no sucesso e o `catch` só pegava JSON quebrado;
 *   · NENHUM teste encostava no carregamento real (o único que citava mix
 *     montava o catálogo à mão, em planning.test.ts:1225).
 *
 * Somados: o arquivo nunca chegou ao contêiner, e a regra de mix — que o
 * remanejamento e a distribuição do recebimento aplicam, e que foi declarada
 * entregue ao cliente — esteve PERMISSIVA em produção o tempo todo. A lista de
 * "lojas excluídas por mix" vinha sempre vazia, e nada distinguia isso de "não
 * havia loja a excluir".
 *
 * Terceira vez que esta plataforma entrega recurso inerte em silêncio. Estes
 * testes cobrem o buraco pelos dois lados: o estado tem de ser LEGÍVEL, e a
 * ausência tem de ser BARULHENTA.
 */
describe('catálogo de grifes · a ausência precisa gritar', () => {
  let dir = '';
  const linhas: { nivel: string; msg: string; dados: unknown }[] = [];

  const carregar = async (arquivo?: string) => {
    linhas.length = 0;
    vi.doMock('../src/config/env.js', () => ({
      env: { BRAND_CATALOG_PATH: arquivo ?? path.join(dir, 'nao-existe.json') },
    }));
    vi.doMock('../src/lib/logger.js', () => ({
      logger: {
        info: (msg: string, dados: unknown) => linhas.push({ nivel: 'info', msg, dados }),
        warn: (msg: string, dados: unknown) => linhas.push({ nivel: 'warn', msg, dados }),
        error: (msg: string, dados: unknown) => linhas.push({ nivel: 'error', msg, dados }),
        child: () => ({ info: () => {}, warn: () => {}, error: () => {} }),
      },
    }));
    return import('../src/modules/planning/brandCatalog.js');
  };

  const CATALOGO = {
    supplierByBrand: { 'RAY BAN': 'Luxottica', OAKLEY: 'Luxottica', PRADA: 'Luxottica' },
    premiumStores: { 'RAY BAN': ['MIDWAY', 'PARTAGE'], PRADA: ['MIDWAY'] },
  };

  beforeEach(() => {
    vi.resetModules();
    dir = mkdtempSync(path.join(tmpdir(), 'catalogo-'));
  });
  afterEach(() => {
    vi.doUnmock('../src/config/env.js');
    vi.doUnmock('../src/lib/logger.js');
    rmSync(dir, { recursive: true, force: true });
  });

  it('sem catálogo, escreve ERRO no log dizendo que a regra está permissiva', async () => {
    // Este é o teste central. Antes, a ausência era literalmente muda: nenhum
    // log, nenhum campo, nada. Um `warn` também não bastaria — sem catálogo,
    // duas regras que o cliente considera entregues param de valer.
    const { loadBrandCatalog } = await carregar();
    expect(loadBrandCatalog()).toBeNull();

    const erros = linhas.filter((l) => l.nivel === 'error');
    expect(erros.length, 'a ausência do catálogo tem de virar linha de erro').toBe(1);
    expect(erros[0].msg).toMatch(/AUSENTE/);
    expect(erros[0].msg).toMatch(/PERMISSIVA/i);
    // Os caminhos tentados vão junto: sem eles, quem lê o log sabe que faltou
    // mas não sabe onde o sistema procurou.
    expect(erros[0].dados).toHaveProperty('tentados');
  });

  it('sem catálogo, o status diz `ativo: false` — e não some do JSON', async () => {
    const { statusDoCatalogo } = await carregar();
    const s = statusDoCatalogo();
    expect(s.ativo).toBe(false);
    expect(s.fonte).toBeNull();
    expect(s.impressao).toBeNull();
    expect(s.grifes).toBe(0);
    expect(s.lojas).toBe(0);
  });

  it('com catálogo, carrega, conta e diz de onde veio', async () => {
    const arq = path.join(dir, 'brand-catalog.json');
    writeFileSync(arq, JSON.stringify(CATALOGO));
    const { loadBrandCatalog, statusDoCatalogo } = await carregar(arq);

    expect(loadBrandCatalog()).not.toBeNull();
    const s = statusDoCatalogo();
    expect(s.ativo).toBe(true);
    expect(s.fonte).toBe(arq);
    expect(s.grifes).toBe(3);
    expect(s.lojas).toBe(2);
    expect(linhas.some((l) => l.nivel === 'error')).toBe(false);
  });

  it('a impressão digital muda quando o conteúdo muda', async () => {
    // A atualização prevista é trocar o arquivo no servidor e reiniciar o
    // contêiner — o que NÃO muda a imagem nem a `versao` do /health. Sem
    // impressão, "atualizei o catálogo" não é verificável por ninguém.
    const a = path.join(dir, 'a.json');
    writeFileSync(a, JSON.stringify(CATALOGO));
    const primeiro = (await carregar(a)).statusDoCatalogo().impressao;

    vi.resetModules();
    const b = path.join(dir, 'b.json');
    writeFileSync(b, JSON.stringify({ ...CATALOGO, premiumStores: { OAKLEY: ['MIDWAY'] } }));
    const segundo = (await carregar(b)).statusDoCatalogo().impressao;

    expect(primeiro).toBeTruthy();
    expect(segundo).toBeTruthy();
    expect(segundo).not.toBe(primeiro);
  });

  it('catálogo ILEGÍVEL é erro próprio, distinto de ausente', async () => {
    // Arquivo quebrado é pior que arquivo faltando: alguém quis configurar e
    // não conseguiu. Se os dois casos dessem a mesma mensagem, o operador
    // procuraria o arquivo que está bem debaixo do nariz dele.
    const arq = path.join(dir, 'quebrado.json');
    writeFileSync(arq, '{ isto não é json');
    const { loadBrandCatalog } = await carregar(arq);

    expect(loadBrandCatalog()).toBeNull();
    const erros = linhas.filter((l) => l.nivel === 'error');
    expect(erros.length).toBe(2); // o ilegível E o "nenhum caminho serviu"
    expect(erros[0].msg).toMatch(/ilegível/i);
    expect(erros[0].dados).toHaveProperty('path', arq);
  });
});

/**
 * A FIAÇÃO QUE LEVA O ARQUIVO ATÉ O CONTÊINER.
 *
 * O módulo acima pode estar impecável e a regra continuar inerte, porque o
 * defeito real não era de código: era que o arquivo não tinha por onde entrar.
 * Estes dois testes prendem o caminho.
 *
 * Mesma ressalva das outras regras de lint escritas como teste neste
 * repositório: o certo seria subir o compose e conferir o arquivo dentro do
 * contêiner, e não há daemon de Docker na CI. Enquanto não houver, isto impede
 * que o caminho suma de novo sem ninguém ver.
 */
describe('fiação: o catálogo tem por onde chegar ao contêiner', () => {
  const ler = (rel: string) => readFileSync(new URL(`../../../${rel}`, import.meta.url), 'utf8');

  it('o compose monta o catálogo no serviço app', () => {
    const yml = ler('docker-compose.prod.yml');
    const app = yml.slice(yml.indexOf('\n  app:'), yml.indexOf('\n  caddy:'));
    expect(app, 'o serviço app precisa de volumes para receber o catálogo').toContain('volumes:');
    expect(app).toMatch(/CATALOGO_DE_GRIFES.*:\/dados\/brand-catalog\.json:ro/);
  });

  it('o .env de produção documenta as duas pontas do caminho', () => {
    // Uma sem a outra não serve: `CATALOGO_DE_GRIFES` é o lado do servidor e
    // `BRAND_CATALOG_PATH` é o lado de dentro do contêiner. Faltando qualquer
    // uma, o arquivo não é encontrado — e era assim que estava.
    const env = ler('.env.production.example');
    expect(env).toMatch(/^CATALOGO_DE_GRIFES=/m);
    expect(env).toMatch(/^BRAND_CATALOG_PATH=\/dados\/brand-catalog\.json$/m);
  });
});
