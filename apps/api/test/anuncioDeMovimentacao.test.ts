import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma.js';
import { subscribe, type AppEvent } from '../src/lib/eventBus.js';
import {
  approveMovement,
  cancelMovement,
  confirmMovement,
  createMovement,
  rejectMovement,
  type Actor,
} from '../src/modules/movements/movements.service.js';
import { PLANNED_STORE_WHERE } from '../src/modules/stores/store.scope.js';

/**
 * O INVARIANTE: TODA GRAVAÇÃO EM `InventoryMovement` ANUNCIA.
 *
 * Este arquivo não conserta bug nenhum de hoje. Ele prende uma regra que hoje
 * vale só por disciplina, e que a próxima frente vai passar a DEPENDER.
 *
 * Por quê agora. O quadro de decisões é recalculado a cada requisição, e por
 * isso um card errado morre sozinho no F5 seguinte. Quando o quadro passar a
 * ser guardado (a frente da materialização), o card errado passa a SOBREVIVER
 * até alguém derrubar a foto — e quem derruba a foto é o evento. O saldo ao
 * vivo que entra no cálculo (`liveDeltas`) sai de `InventoryMovement`; uma
 * gravação que não publica vira foto válida sobre estoque mudado.
 *
 * Essa é a classe de defeito mais cara deste repositório: tela mostrando número
 * de antes, sem erro em lugar nenhum. Já apareceu quatro vezes.
 *
 * A regra é mais larga que "transição de status" de propósito. O que importa
 * para quem lê o saldo não é o status ter mudado — é a LINHA ter mudado.
 *
 * E ela já pegou uma: `reconcileMovements`, no `syncService`, virava milhares
 * de CONFIRMED em RECONCILED sem publicar nada. Passava despercebida porque o
 * `runSync` publica `sync.completed` logo depois e a tela invalida tudo em
 * qualquer evento — carona que deixaria de existir no dia em que a foto for
 * invalidada por `movement.changed`.
 */

const AQUI = fileURLToPath(new URL('.', import.meta.url));
const RAIZ_SRC = join(AQUI, '..', 'src');

/** Toda gravação em `InventoryMovement` — é o que precisa anunciar. */
const GRAVACAO = /inventoryMovement\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\b/;

/** O anúncio. Escrito literalmente; apelidar `publish` faz este teste falhar. */
const ANUNCIO = /publish\(\{\s*type:\s*'movement\.changed'/;

/**
 * Começo de declaração de topo. Sem parser: neste código as funções abrem na
 * coluna zero e fecham na coluna zero, então o intervalo entre duas
 * declarações consecutivas É o corpo de uma.
 */
const DECLARACAO = /^(export\s+)?(default\s+)?(async\s+)?(function\s+[\w$]+|const\s+[\w$]+\s*[:=]|class\s+[\w$]+)/;

function arquivosTs(dir: string): string[] {
  const saida: string[] = [];
  for (const nome of readdirSync(dir)) {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) saida.push(...arquivosTs(caminho));
    else if (nome.endsWith('.ts')) saida.push(caminho);
  }
  return saida;
}

interface SitioDeGravacao {
  arquivo: string;
  linha: number;
  bloco: string;
  anuncia: boolean;
}

function mapearGravacoes(): SitioDeGravacao[] {
  const sitios: SitioDeGravacao[] = [];
  for (const caminho of arquivosTs(RAIZ_SRC)) {
    const linhas = readFileSync(caminho, 'utf8').split('\n');
    const fronteiras = linhas.flatMap((l, i) => (DECLARACAO.test(l) ? [i] : []));

    for (let i = 0; i < linhas.length; i++) {
      if (!GRAVACAO.test(linhas[i])) continue;
      const inicio = fronteiras.filter((f) => f <= i).pop() ?? 0;
      const fim = fronteiras.find((f) => f > i) ?? linhas.length;
      sitios.push({
        arquivo: caminho.slice(RAIZ_SRC.length + 1),
        linha: i + 1,
        bloco: linhas[inicio].trim(),
        anuncia: ANUNCIO.test(linhas.slice(inicio, fim).join('\n')),
      });
    }
  }
  return sitios;
}

describe('invariante · quem grava movimentação, anuncia', () => {
  const sitios = mapearGravacoes();

  it('a varredura encontra gravações — senão o teste é decorativo', () => {
    // Uma expressão regular que não casa com nada passa em silêncio e dá a
    // impressão de cobertura. Este repositório já pagou por isso.
    expect(
      sitios.length,
      'nenhuma gravação em InventoryMovement encontrada — a varredura quebrou',
    ).toBeGreaterThanOrEqual(6);
  });

  it('nenhuma gravação fica calada', () => {
    const caladas = sitios.filter((s) => !s.anuncia);
    expect(
      caladas.map((s) => `${s.arquivo}:${s.linha} (em "${s.bloco}")`).join('\n'),
      'grava InventoryMovement e não publica movement.changed no mesmo bloco.\n' +
        'Sem o anúncio, a tela — e, em breve, o quadro guardado — continuam ' +
        'mostrando o saldo de antes, sem erro em lugar nenhum.\n' +
        'Se a gravação for de lote, publique UM evento sem storeId/movementId ' +
        '(é o que reconcileMovements faz).',
    ).toBe('');
  });
});

// ─── A outra metade: as transições de verdade, contra o banco ────────────────

const RUN = process.env.RUN_DB_TESTS === '1';
const d = RUN ? describe : describe.skip;

/**
 * A varredura acima prova que o `publish` ESTÁ ESCRITO no bloco. Não prova que
 * ele RODA no caminho que grava — um `publish` dentro de um `if` que nunca é
 * verdadeiro passaria por ela.
 *
 * Estes exercitam as cinco transições que a operação dirige, contando eventos.
 */
d('invariante · cada transição publica exatamente um evento', () => {
  const rede: Actor = { id: 'test-admin', role: 'ADMIN', storeId: null };
  let gerente: Actor;
  let origemId = '';
  let destinoId = '';
  let productId = '';
  const criados: string[] = [];

  type Anuncio = Extract<AppEvent, { type: 'movement.changed' }>;

  /** Conta os `movement.changed` publicados durante `acao`. */
  const contando = async <T>(acao: () => Promise<T>): Promise<[T, Anuncio[]]> => {
    const vistos: Anuncio[] = [];
    const parar = subscribe((e) => {
      if (e.type === 'movement.changed') vistos.push(e);
    });
    try {
      return [await acao(), vistos];
    } finally {
      parar();
    }
  };

  beforeAll(async () => {
    const lojas = await prisma.store.findMany({
      where: PLANNED_STORE_WHERE,
      orderBy: { name: 'asc' },
      take: 2,
    });
    if (lojas.length < 2) throw new Error('sem lojas suficientes no banco (rode o seed)');
    origemId = lojas[0].id;
    destinoId = lojas[1].id;
    gerente = { id: 'test-gerente', role: 'STORE_MANAGER', storeId: origemId };

    const produto = await prisma.product.create({
      data: {
        externalId: `test-anuncio-${Date.now()}`,
        description: 'ARMACAO TESTE ANUNCIO DE MOVIMENTACAO',
        category: 'ARMACOES',
        price: 300,
        cost: 150,
      },
    });
    productId = produto.id;

    // Saldo folgado na origem: as travas de disponibilidade não são o assunto
    // aqui, e uma delas barrando a criação faria o teste passar por engano.
    await prisma.stockItem.upsert({
      where: { storeId_productId: { storeId: origemId, productId } },
      create: { storeId: origemId, productId, quantity: 500 },
      update: { quantity: 500, reserved: 0 },
    });
  });

  afterAll(async () => {
    if (criados.length) await prisma.inventoryMovement.deleteMany({ where: { id: { in: criados } } });
    if (productId) {
      await prisma.stockItem.deleteMany({ where: { productId } });
      await prisma.product.deleteMany({ where: { id: productId } });
    }
  });

  /** Uma solicitação nova, já registrada para limpeza. */
  const solicitar = async () => {
    const [mov, eventos] = await contando(() =>
      createMovement(
        { type: 'TRANSFER', productId, fromStoreId: origemId, toStoreId: destinoId, quantity: 1, confirm: false },
        gerente,
      ),
    );
    criados.push(mov.id);
    expect(mov.status, 'gerente de loja cria TRANSFER como REQUESTED').toBe('REQUESTED');
    return { mov, eventos };
  };

  it('criar anuncia', async () => {
    const { eventos } = await solicitar();
    expect(eventos).toHaveLength(1);
  });

  it('aprovar anuncia', async () => {
    const { mov } = await solicitar();
    const [, eventos] = await contando(() => approveMovement(mov.id, rede));
    expect(eventos).toHaveLength(1);
    expect(eventos[0].movementId).toBe(mov.id);
  });

  it('rejeitar anuncia', async () => {
    const { mov } = await solicitar();
    const [, eventos] = await contando(() => rejectMovement(mov.id, rede));
    expect(eventos).toHaveLength(1);
  });

  it('confirmar anuncia', async () => {
    const { mov } = await solicitar();
    await approveMovement(mov.id, rede);
    const [, eventos] = await contando(() => confirmMovement(mov.id, rede));
    expect(eventos).toHaveLength(1);
  });

  it('cancelar anuncia', async () => {
    const { mov } = await solicitar();
    await approveMovement(mov.id, rede);
    const [, eventos] = await contando(() => cancelMovement(mov.id, rede));
    expect(eventos).toHaveLength(1);
  });

  it('a recusa por concorrência NÃO anuncia — nada mudou', async () => {
    // O outro lado do invariante. "Publicar sempre" seria fácil e errado:
    // evento sem mudança derruba a foto do quadro à toa, que é o custo que a
    // materialização veio remover.
    const { mov } = await solicitar();
    await approveMovement(mov.id, rede);
    await confirmMovement(mov.id, rede);
    const [, eventos] = await contando(async () => {
      await expect(confirmMovement(mov.id, rede)).rejects.toThrow();
    });
    expect(eventos).toHaveLength(0);
  });
});
