import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { salePlannedWhere } from '../stores/store.scope.js';
import { itemVendidoWhere } from '../../vendas/escopo.js';
import {
  analysisBrand,
  familiaDePeca,
  justificativaMinima,
  marginPct,
  normFormatoLente,
  normGenero,
  normMaterialArmacao,
  rotuloDoFormato,
  rotuloDoGenero,
  rotuloDoMaterial,
  supplierFor,
  type FormatoLenteChave,
  type GeneroChave,
  type MaterialArmacaoChave,
  type MovementClass,
  type Recommendation,
} from '../planning/planning.math.js';
import { loadBrandCatalog } from '../planning/brandCatalog.js';
import { analyzeProduct } from '../planning/planning.math.js';

/**
 * A FICHA TÉCNICA DE UMA PEÇA — rodada final · item 02.
 *
 * "Na listagem de Produtos, ao clicar em um SKU, deve abrir uma ficha técnica
 *  completa com: marca, modelo, SKU, referência, categoria, gênero, cor,
 *  formato da lente, material, dimensões, tipo, custo, preço, estoque,
 *  vendido, histórico de vendas, giro, última compra e quantidade, fornecedor,
 *  imagem."
 *
 * É rota PRÓPRIA, e não um `/products/:id` mais gordo, por dois motivos que já
 * custaram entrega aqui: aquele detalhe é consumido pela vitrine e pelo provador
 * virtual, e engordá-lo faria toda tela de catálogo pagar por consultas de
 * venda e de compra que não usa; e o formato dele é o espelho do Prisma, que
 * qualquer mudança de schema muda junto — a ficha tem contrato próprio, escrito
 * abaixo, e é esse contrato que a tela lê.
 *
 * CAMPO SEM DADO VEM `null`. Nunca zero, nunca "—", nunca um valor plausível:
 * a ficha é a tela onde o comprador confere o que a rede sabe da peça, e um
 * campo inventado ali é pior que um campo vazio. Quem escreve o travessão é a
 * interface; quem diz "não sei" é esta função.
 */

export interface DimensoesDaPeca {
  tamanhoLente: number | null;
  alturaLente: number | null;
  tamanhoPonte: number | null;
  tamanhoHaste: number | null;
}

/** Um atributo padronizado com a sua procedência — o texto de origem incluído. */
export interface AtributoComFonte<T> {
  chave: T | null;
  rotulo: string;
  /** `ficha` (planilha do fornecedor) · `erp` (cadastro do CDS) · `descricao`. */
  fonte: string | null;
  /** Como a fonte escreveu, para conferência. */
  textoOriginal: string | null;
}

export interface VendaNoPeriodo {
  dias: number;
  unidades: number;
  receita: number;
}

export interface MesDeVenda {
  /** 'AAAA-MM' */
  mes: string;
  unidades: number;
  receita: number;
}

export interface UltimaCompra {
  data: string;
  quantidade: number;
  custoUnitario: number | null;
  pedidoId: string;
  fornecedor: string;
  status: string;
  recebidaEm: string | null;
}

export interface FichaTecnica {
  identificacao: {
    id: string;
    sku: string | null;
    externalId: string;
    referencia: string | null;
    gtin: string | null;
    /** A descrição do ERP — é o "modelo" da ficha do cliente. */
    modelo: string;
    /** A GRIFE, extraída da descrição (não a razão social do fornecedor). */
    grife: string | null;
    /** Marca como o catálogo do fornecedor a escreve. */
    marcaCatalogo: string | null;
    /** O campo "marca" do ERP — costuma trazer a razão social. */
    marcaErp: string | null;
    categoria: string | null;
    /** solar · armacao · relogio · lente · acessorio */
    familia: string;
    tipo: string;
    ativo: boolean;
    cadastradoEm: string | null;
  };
  atributos: {
    genero: AtributoComFonte<GeneroChave>;
    formatoLente: AtributoComFonte<FormatoLenteChave>;
    materialArmacao: AtributoComFonte<MaterialArmacaoChave>;
    cor: string | null;
    codigoCor: string | null;
    dimensoes: DimensoesDaPeca;
    bestSellerDoFornecedor: boolean;
    /** Marcada pelo fornecedor, conferida contra o giro real da rede. */
    bestSellerNaRede: boolean | null;
  };
  comercial: {
    custo: number | null;
    custoEstimado: boolean;
    preco: number | null;
    margemPct: number | null;
    /** Teto comercial de desconto definido pelo CDS (%), quando houver. */
    descontoMaximoPct: number | null;
  };
  estoque: {
    porLoja: { storeId: string; loja: string; quantidade: number; reservado: number }[];
    total: number;
    reservado: number;
    aCaminho: number;
    /** Lojas visíveis para quem pediu — o denominador honesto do "por loja". */
    lojasConsideradas: number;
  };
  vendas: {
    periodos: VendaNoPeriodo[];
    mensal: MesDeVenda[];
    /** Unidades por dia na janela de 90 dias. */
    giroDiario: number;
    coberturaDias: number | null;
    classe: MovementClass;
    recomendacao: Recommendation;
    justificativa: string;
    sugestaoDeCompra: number;
  };
  compra: {
    ultima: UltimaCompra | null;
    fornecedorCanonico: string | null;
  };
  imagem: {
    url: string | null;
    fonte: 'ficha' | 'provador' | null;
  };
  procedencia: {
    fonteCadastro: string | null;
    cadastroEm: string | null;
    erpEm: string | null;
    sincronizadoEm: string | null;
  };
}

const num = (v: Prisma.Decimal | number | null | undefined): number | null =>
  v === null || v === undefined ? null : Number(v);

const round2 = (n: number) => Math.round(n * 100) / 100;

const ROTULO_DA_FAMILIA: Record<string, string> = {
  solar: 'Óculos de sol',
  armacao: 'Armação',
  relogio: 'Relógio',
  lente: 'Lente',
  acessorio: 'Acessório',
};

/** 'AAAA-MM' de uma data, em UTC — a mesma régua do resto dos agregados. */
const chaveDoMes = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;

const diasAtras = (dias: number) => new Date(Date.now() - dias * 86_400_000);

/**
 * Monta a ficha. `storeWhere` é o recorte de lojas de quem perguntou (gestor de
 * loja enxerga a própria; ADMIN, todas) — chega pronto do middleware, como nas
 * outras rotas de produto, para que a regra de visibilidade viva num lugar só.
 */
export async function fichaTecnica(
  productId: string,
  storeWhere: Prisma.StockItemWhereInput = {},
): Promise<FichaTecnica | null> {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    include: {
      color: true,
      size: true,
      attributes: true,
      stockItems: { where: storeWhere, include: { store: { select: { id: true, name: true } } } },
      assets: { where: { status: 'PUBLISHED' }, orderBy: { createdAt: 'desc' }, take: 1 },
    },
  });
  if (!product) return null;

  const a = product.attributes;
  const preco = num(product.price);
  const custoReal = num(product.cost);
  // A mesma estimativa do motor de planejamento — e MARCADA como estimativa,
  // porque é ela que define o teto do desconto de liquidação.
  const custo = custoReal ?? (preco !== null ? round2(preco * 0.55) : null);

  // ── Vendas: três janelas e o histórico mensal ────────────────────────────
  const [porJanela, mensalCru, aCaminho] = await Promise.all([
    Promise.all(
      [30, 90, 365].map(async (dias) => {
        const r = await prisma.saleItem.aggregate({
          // O MESMO RECORTE DE LOJAS DO RESTO DO MOTOR. Sem ele, a ficha somava
          // venda de filial em outro ERP e de retaguarda — lojas que
          // `plans()` exclui — e a mesma peça aparecia com 61 unidades aqui e
          // 47 na lista de compras, sem nada na tela explicando a diferença.
          where: { ...itemVendidoWhere, productId, sale: { saleDate: { gte: diasAtras(dias) }, ...salePlannedWhere } },
          _sum: { quantity: true, total: true },
        });
        return { dias, unidades: r._sum.quantity ?? 0, receita: round2(Number(r._sum.total ?? 0)) };
      }),
    ),
    prisma.saleItem.findMany({
      where: { ...itemVendidoWhere, productId, sale: { saleDate: { gte: diasAtras(365) }, ...salePlannedWhere } },
      select: { quantity: true, total: true, sale: { select: { saleDate: true } } },
    }),
    prisma.purchaseOrderRecord.findMany({
      where: { status: 'SENT' },
      select: { items: true },
    }),
  ]);

  // Doze meses SEMPRE, inclusive os vazios: um gráfico que pula o mês sem
  // venda desenha uma linha contínua sobre um buraco — e quem lê entende
  // "vendeu sempre", que é o oposto do que aconteceu.
  const porMes = new Map<string, { unidades: number; receita: number }>();
  for (let i = 11; i >= 0; i -= 1) {
    const d = new Date();
    d.setUTCMonth(d.getUTCMonth() - i, 1);
    porMes.set(chaveDoMes(d), { unidades: 0, receita: 0 });
  }
  for (const linha of mensalCru) {
    const k = chaveDoMes(linha.sale.saleDate);
    const alvo = porMes.get(k);
    if (!alvo) continue;
    alvo.unidades += linha.quantity;
    alvo.receita += Number(linha.total ?? 0);
  }
  const mensal: MesDeVenda[] = [...porMes.entries()].map(([mes, v]) => ({
    mes,
    unidades: v.unidades,
    receita: round2(v.receita),
  }));

  const estoquePorLoja = product.stockItems
    .map((s) => ({
      storeId: s.store.id,
      loja: s.store.name,
      quantidade: s.quantity,
      reservado: s.reserved,
    }))
    .sort((x, y) => y.quantidade - x.quantidade || x.loja.localeCompare(y.loja, 'pt-BR'));
  const totalEmEstoque = estoquePorLoja.reduce((s, l) => s + l.quantidade, 0);
  const totalReservado = estoquePorLoja.reduce((s, l) => s + l.reservado, 0);

  // O "a caminho" sai dos pedidos ENVIADOS e não recebidos, somando a
  // quantidade desta peça em cada um — o mesmo dado que o motor de compra usa
  // para não pedir duas vezes a mesma reposição.
  let unidadesACaminho = 0;
  for (const pedido of aCaminho) {
    for (const it of (pedido.items as unknown as { productId?: string; quantity?: number }[]) ?? []) {
      if (it?.productId === productId) unidadesACaminho += Number(it.quantity ?? 0);
    }
  }

  const venda90 = porJanela.find((p) => p.dias === 90)!;
  const plano = analyzeProduct(
    {
      productId: product.id,
      sku: product.sku,
      description: product.description,
      brand: product.brand,
      category: product.category,
      unitsSold: venda90.unidades,
      currentStock: totalEmEstoque,
      unitCost: custo ?? 0,
      unitPrice: preco ?? 0,
      costEstimated: custoReal === null,
      onOrderQty: unidadesACaminho,
      annualUnitsSold: porJanela.find((p) => p.dias === 365)?.unidades,
      ageDays: product.includedAt
        ? Math.floor((Date.now() - product.includedAt.getTime()) / 86_400_000)
        : null,
    },
    90,
  );

  // ── A última compra: o pedido mais recente que contém esta peça ──────────
  //
  // Os itens moram num JSON, então a busca é em duas etapas: o banco devolve os
  // pedidos do mais novo para o mais velho e a varredura para no primeiro que
  // cita a peça. Um filtro JSON aqui seria específico do Postgres e dependeria
  // do formato exato do array — que já mudou uma vez nesta rodada.
  const pedidos = await prisma.purchaseOrderRecord.findMany({
    // CANCELADO NÃO É COMPRA. Sem este filtro, um pedido cancelado mais
    // recente virava a "última compra" da peça e escondia a que de fato
    // chegou — e como cancelado não tem `receivedAt`, a tela ainda escrevia
    // "ainda a caminho" sobre mercadoria que ninguém pediu mais.
    where: { status: { in: ['SENT', 'RECEIVED'] } },
    orderBy: { sentAt: 'desc' },
    take: 300,
    select: {
      id: true,
      supplier: true,
      status: true,
      sentAt: true,
      receivedAt: true,
      items: true,
    },
  });
  let ultima: UltimaCompra | null = null;
  for (const pedido of pedidos) {
    const item = ((pedido.items as unknown as { productId?: string; quantity?: number; unitCost?: number }[]) ?? []).find(
      (it) => it?.productId === productId,
    );
    if (!item) continue;
    ultima = {
      data: pedido.sentAt.toISOString(),
      quantidade: Number(item.quantity ?? 0),
      custoUnitario: item.unitCost === undefined ? null : Number(item.unitCost),
      pedidoId: pedido.id,
      fornecedor: pedido.supplier,
      status: pedido.status,
      recebidaEm: pedido.receivedAt ? pedido.receivedAt.toISOString() : null,
    };
    break;
  }

  const grife = analysisBrand(product.description, product.category, product.brand);
  const familia = familiaDePeca(product.category);

  // Os atributos padronizados: a chave é a do banco quando já foi padronizada;
  // quando não, deriva do texto na hora — assim a ficha mostra o dado que
  // existe mesmo antes de o padronizador ter rodado, e diz de onde ele veio.
  const formatoChave = (a?.formatoLente as FormatoLenteChave | null) ?? normFormatoLente(a?.formato ?? null);
  const materialChave =
    (a?.materialArmacao as MaterialArmacaoChave | null) ?? normMaterialArmacao(a?.material ?? null);
  const generoChave = normGenero(a?.genero ?? null);
  const fonteDerivada = a?.fonteCadastro ?? (a?.erpEm ? 'erp' : null);

  return {
    identificacao: {
      id: product.id,
      sku: product.sku,
      externalId: product.externalId,
      referencia: a?.referencia ?? null,
      gtin: a?.gtin ?? null,
      modelo: product.description,
      grife,
      marcaCatalogo: a?.marcaCatalogo ?? null,
      marcaErp: product.brand,
      categoria: product.category,
      familia,
      tipo: ROTULO_DA_FAMILIA[familia] ?? (product.category ?? 'Não classificado'),
      ativo: product.active,
      cadastradoEm: product.includedAt ? product.includedAt.toISOString() : null,
    },
    atributos: {
      genero: {
        chave: generoChave,
        rotulo: rotuloDoGenero(generoChave),
        fonte: a?.genero ? fonteDerivada : null,
        textoOriginal: a?.genero ?? null,
      },
      formatoLente: {
        chave: formatoChave,
        rotulo: rotuloDoFormato(formatoChave),
        fonte: a?.fonteFormato ?? (a?.formato ? fonteDerivada : null),
        textoOriginal: a?.formato ?? null,
      },
      materialArmacao: {
        chave: materialChave,
        rotulo: rotuloDoMaterial(materialChave),
        fonte: a?.fonteMaterial ?? (a?.material ? fonteDerivada : null),
        textoOriginal: a?.material ?? null,
      },
      cor: a?.cor ?? product.color?.name ?? null,
      codigoCor: a?.codigoCor ?? null,
      dimensoes: {
        tamanhoLente: a?.tamanhoLente ?? null,
        alturaLente: a?.alturaLente ?? null,
        tamanhoPonte: a?.tamanhoPonte ?? null,
        tamanhoHaste: a?.tamanhoHaste ?? null,
      },
      bestSellerDoFornecedor: a?.bestSeller ?? false,
      // O fornecedor diz o que é campeão na coleção dele; quem diz o que gira
      // NESTA rede é o histórico dela. Sem ficha, não há o que confrontar.
      bestSellerNaRede: a?.bestSeller ? venda90.unidades > 0 : null,
    },
    comercial: {
      custo,
      custoEstimado: custoReal === null,
      preco,
      margemPct: preco !== null && custo !== null ? marginPct(preco, custo) : null,
      descontoMaximoPct: num(a?.maxDiscountPct ?? null),
    },
    estoque: {
      porLoja: estoquePorLoja,
      total: totalEmEstoque,
      reservado: totalReservado,
      aCaminho: unidadesACaminho,
      lojasConsideradas: estoquePorLoja.length,
    },
    vendas: {
      periodos: porJanela,
      mensal,
      giroDiario: plano.dailyDemand,
      coberturaDias: plano.coverageDays,
      classe: plano.movementClass,
      recomendacao: plano.recommendation,
      // A MESMA frase do resto do sistema (item 07): a ficha não pode dizer de
      // uma peça algo diferente do que a lista de compras diz dela.
      justificativa: justificativaMinima({
        currentStock: totalEmEstoque,
        unitsSold: venda90.unidades,
        days: 90,
        dailyDemand: plano.dailyDemand,
        coverageDays: plano.coverageDays,
        onOrder: unidadesACaminho,
        suggestedQty: plano.suggestedQty,
        targetCoverDays: 60,
      }),
      sugestaoDeCompra: plano.suggestedQty,
    },
    compra: {
      ultima,
      fornecedorCanonico: supplierFor(grife, loadBrandCatalog()),
    },
    imagem: {
      url: a?.imagemUrl ?? product.assets[0]?.url ?? null,
      fonte: a?.imagemUrl ? 'ficha' : product.assets[0] ? 'provador' : null,
    },
    procedencia: {
      fonteCadastro: a?.fonteCadastro ?? null,
      cadastroEm: a?.cadastroEm ? a.cadastroEm.toISOString() : null,
      erpEm: a?.erpEm ? a.erpEm.toISOString() : null,
      sincronizadoEm: product.syncedAt ? product.syncedAt.toISOString() : null,
    },
  };
}
