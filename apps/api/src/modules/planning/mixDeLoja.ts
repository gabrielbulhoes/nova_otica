import { prisma } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';
import { loadBrandCatalog } from './brandCatalog.js';
import {
  lojaTrabalhaAGrife,
  normBrandKey,
  separarPorMix,
  storeCarriesBrand,
  type MixDeclarado,
} from './planning.math.js';

/**
 * O MIX POR LOJA — quem responde "esta loja trabalha esta grife?".
 *
 * Existe porque a resposta vinha de duas fontes e nenhuma delas funcionava em
 * produção:
 *
 *  · O `brand-catalog.json`, que nunca chegou ao contêiner. `/health` dizia
 *    `mix.ativo: false` desde sempre, e o cliente voltou duas rodadas seguidas
 *    com o mesmo exemplo — Dior sugerida para Guarabira.
 *  · Nada, no módulo de COMPRAS. Lá o catálogo servia só para agrupar
 *    fornecedor; não havia porteiro nenhum. "Chanel só pode ser vendido no
 *    Iguatemi e Natal Shopping" não tinha onde ser respeitado.
 *
 * Agora há UM porteiro, e ele é assíncrono porque o mix mora no banco. Quem
 * decide passa a ser o cliente, pela tela, sem deploy no meio.
 *
 * PRECEDÊNCIA: o mix declarado manda quando tem alguma linha. Sem linha
 * nenhuma, cai no arquivo — que continua valendo para quem o tinha. Não é
 * indecisão: apagar o caminho do arquivo nesta entrega transformaria uma
 * correção de regra numa migração de dados, e as duas falham diferente.
 */

// A regra é consultada uma vez por linha de plano — dezenas de milhares numa
// montagem de quadro. Um `findMany` por linha seria absurdo; um por REQUISIÇÃO
// já é o suficiente, e é o que `porteiroDeMix` faz. Esta memória curta cobre o
// resto: as várias rotas que o painel dispara juntas no mesmo segundo.
//
// Trinta segundos, e não os sessenta dos atributos: aqui o que invalida é o
// cliente salvar na tela, e ele salva olhando para o resultado. Meio minuto
// entre marcar a loja e ver a sugestão sumir é a espera máxima aceitável — e
// `esquecerMixDeclarado` corta até isso no caminho da escrita.
const MEMORIA_MS = 30_000;
let memoria: { em: number; valor: MixDeclarado } | null = null;

/** Descarta a memória — chamado por quem escreve o mix. */
export function esquecerMixDeclarado(): void {
  memoria = null;
}

/** O mix declarado no banco: grife normalizada → ids das lojas. */
export async function carregarMixDeclarado(): Promise<MixDeclarado> {
  const agora = Date.now();
  if (memoria && agora - memoria.em < MEMORIA_MS) return memoria.valor;

  const linhas = await prisma.storeBrandMix.findMany({ select: { brand: true, storeId: true } });
  const mapa = new Map<string, Set<string>>();
  for (const l of linhas) {
    const chave = normBrandKey(l.brand);
    let s = mapa.get(chave);
    if (!s) mapa.set(chave, (s = new Set()));
    s.add(l.storeId);
  }
  memoria = { em: agora, valor: mapa };
  return mapa;
}

/** O que o porteiro decide, por linha. */
export interface PorteiroDeMix {
  /** A loja trabalha a grife? Loja ausente → `true` (ver `lojaTrabalhaAGrife`). */
  permite(brand: string | null | undefined, storeId?: string | null, storeName?: string | null): boolean;
  /** Divide candidatas em quem entra no rateio e quem fica de fora. */
  separar<T extends { storeId: string; storeName?: string }>(
    brand: string | null | undefined,
    candidatas: readonly T[],
  ): { elegiveis: T[]; excluidas: T[] };
  /** Alguma regra está valendo? `false` = tudo permissivo, e a tela deve dizer. */
  readonly ativo: boolean;
  /** De onde a regra veio, para a tela e para o `/health`. */
  readonly fonte: 'declarado' | 'arquivo' | 'nenhum';
}

/**
 * Monta o porteiro UMA vez por requisição e o passa adiante. É deliberado que
 * seja assim e não uma função solta que consulta o banco: a regra é aplicada
 * linha a linha sobre planos de dezenas de milhares de itens, e uma consulta
 * escondida dentro de um `filter` é o tipo de custo que não erra a saída — só
 * derruba a rota — e que já derrubou a Central de Decisões uma vez aqui.
 */
export async function porteiroDeMix(): Promise<PorteiroDeMix> {
  const declarado = await carregarMixDeclarado();
  if (declarado.size > 0) {
    return {
      ativo: true,
      fonte: 'declarado',
      permite: (brand, storeId) => lojaTrabalhaAGrife(brand, storeId ?? null, declarado),
      separar: (brand, candidatas) => separarPorMix(brand, candidatas, declarado),
    };
  }

  // Sem nada declarado: o arquivo, se existir. Casa por NOME — a tolerância
  // antiga, com todos os defeitos dela — e por isso `separar` precisa do
  // `storeName`, que nem toda chamada tem. Quando não tem, é permissivo: um
  // porteiro que barra por falta de dado barraria a rede inteira.
  const catalogo = loadBrandCatalog();
  if (catalogo) {
    return {
      ativo: true,
      fonte: 'arquivo',
      permite: (brand, _storeId, storeName) => storeCarriesBrand(brand, storeName ?? null, catalogo),
      separar: (brand, candidatas) => {
        const elegiveis: typeof candidatas[number][] = [];
        const excluidas: typeof candidatas[number][] = [];
        for (const c of candidatas) {
          (storeCarriesBrand(brand, c.storeName ?? null, catalogo) ? elegiveis : excluidas).push(c);
        }
        return { elegiveis, excluidas };
      },
    };
  }

  return {
    ativo: false,
    fonte: 'nenhum',
    permite: () => true,
    separar: (_brand, candidatas) => ({ elegiveis: [...candidatas], excluidas: [] }),
  };
}

/** O que o `/health` publica sobre o mix declarado. */
export interface StatusDoMixDeclarado {
  /** Grifes com pelo menos uma loja declarada. */
  grifes: number;
  /** Lojas citadas em alguma declaração. */
  lojas: number;
  /** Linhas (grife × loja). */
  linhas: number;
}

export async function statusDoMixDeclarado(): Promise<StatusDoMixDeclarado> {
  const mix = await carregarMixDeclarado();
  const lojas = new Set<string>();
  let linhas = 0;
  for (const s of mix.values()) {
    linhas += s.size;
    for (const id of s) lojas.add(id);
  }
  return { grifes: mix.size, lojas: lojas.size, linhas };
}

// ─── Escrita: o cliente declara pela tela ───────────────────────────────────

/**
 * Declara quais lojas trabalham uma grife. Lista VAZIA apaga a restrição — a
 * grife volta a ser corrente, vendida em todas as lojas.
 *
 * A gravação é um `deleteMany` + `createMany` na mesma transação, e não um
 * `upsert` por loja: a tela manda a seleção INTEIRA, então o estado final é o
 * que ela mandou. Reconciliar diferença a diferença deixaria uma loja
 * desmarcada viva no banco se a linha correspondente falhasse — e o sintoma
 * seria a grife continuar liberada onde o cliente acabou de proibir, que é
 * exatamente o defeito que esta entrega existe para consertar.
 */
export async function declararMixDaGrife(brand: string, storeIds: readonly string[]) {
  const chave = normBrandKey(brand.trim());
  if (!chave) throw new Error('Informe a grife.');

  const unicas = [...new Set(storeIds)];
  await prisma.$transaction(async (tx) => {
    await tx.storeBrandMix.deleteMany({ where: { brand: chave } });
    if (unicas.length > 0) {
      await tx.storeBrandMix.createMany({
        data: unicas.map((storeId) => ({ brand: chave, storeId })),
        skipDuplicates: true,
      });
    }
  });

  esquecerMixDeclarado();
  logger.info('mix por loja declarado', { grife: chave, lojas: unicas.length });
  return { brand: chave, storeIds: unicas };
}

/** O mix declarado, grife a grife, com as lojas resolvidas para a tela. */
export async function listarMixPorLoja() {
  const [linhas, lojas] = await Promise.all([
    prisma.storeBrandMix.findMany({
      select: { brand: true, storeId: true },
      orderBy: { brand: 'asc' },
    }),
    prisma.store.findMany({
      where: { excludeFromPlanning: false, externalErp: false },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
  ]);

  const nomePor = new Map(lojas.map((l) => [l.id, l.name]));
  const porGrife = new Map<string, string[]>();
  for (const l of linhas) {
    const atual = porGrife.get(l.brand) ?? [];
    atual.push(l.storeId);
    porGrife.set(l.brand, atual);
  }

  const rows = [...porGrife.entries()]
    .map(([brand, ids]) => ({
      brand,
      storeIds: ids,
      // Loja que saiu do escopo planejável (virou retaguarda, ou passou a
      // outro ERP) continua contando como declaração, mas sem nome resolvido.
      // A tela precisa poder mostrar que a linha existe e está órfã, em vez de
      // exibir uma grife restrita a menos lojas do que o banco diz.
      stores: ids.map((id) => ({ id, name: nomePor.get(id) ?? null })),
    }))
    .sort((a, b) => a.brand.localeCompare(b.brand, 'pt-BR'));

  return { rows, lojas };
}
