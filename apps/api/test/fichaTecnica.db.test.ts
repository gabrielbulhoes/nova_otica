import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma.js';
import { fichaTecnica } from '../src/modules/products/ficha.service.js';

const RUN = process.env.RUN_DB_TESTS === '1';
const d = RUN ? describe : describe.skip;

/**
 * A FICHA TÉCNICA CONTRA O BANCO — rodada final · item 02.
 *
 * O que se prova aqui é o contrato: a ficha junta seis consultas (catálogo,
 * atributos, estoque por loja, venda em três janelas, histórico mensal e
 * última compra) e o risco de uma delas devolver silenciosamente nada é real —
 * foi assim que uma coluna de destino saiu vazia numa entrega verde.
 *
 * Os dados são fictícios e criados aqui, com prefixo próprio, e apagados no
 * fim: o banco de teste é compartilhado com as outras suítes de integração.
 */
const PREFIXO = `ficha_${Date.now()}`;

let productId = '';
let semFichaId = '';
let storeId = '';

d('ficha técnica (integração com Postgres)', () => {
  beforeAll(async () => {
    const loja = await prisma.store.create({
      data: { externalId: `${PREFIXO}_loja`, name: 'Loja da ficha', city: 'Natal' },
    });
    storeId = loja.id;

    const p = await prisma.product.create({
      data: {
        externalId: `${PREFIXO}_p1`,
        sku: 'RB3025',
        description: 'OCULOS RAY BAN RB3025 AVIADOR',
        brand: 'LUXOTTICA BRASIL LTDA',
        category: 'OCULOS',
        price: 890,
        cost: 400,
        includedAt: new Date(Date.now() - 400 * 86_400_000),
      },
    });
    productId = p.id;

    await prisma.productAttribute.create({
      data: {
        productId: p.id,
        referencia: 'RB3025-L0205',
        marcaCatalogo: 'Ray-Ban',
        genero: 'Unisex',
        formato: 'Piloto',
        material: 'Metal',
        formatoLente: 'AVIADOR',
        materialArmacao: 'METAL',
        fonteFormato: 'ficha',
        fonteMaterial: 'ficha',
        cor: 'Dourado',
        tamanhoLente: 58,
        alturaLente: 44,
        tamanhoPonte: 14,
        tamanhoHaste: 135,
        bestSeller: true,
        fonteCadastro: 'ficha',
        cadastroEm: new Date(),
      },
    });

    await prisma.stockItem.create({
      data: { productId: p.id, storeId: loja.id, quantity: 7, reserved: 1 },
    });

    const venda = await prisma.sale.create({
      data: {
        externalId: `${PREFIXO}_v1`,
        storeId: loja.id,
        saleDate: new Date(Date.now() - 10 * 86_400_000),
        total: 1780,
      },
    });
    await prisma.saleItem.create({
      data: { saleId: venda.id, productId: p.id, quantity: 2, unitPrice: 890, total: 1780 },
    });

    await prisma.purchaseOrderRecord.create({
      data: {
        supplier: 'Luxottica',
        leadTimeDays: 14,
        status: 'RECEIVED',
        items: [{ productId: p.id, description: p.description, quantity: 6, unitCost: 400, total: 2400 }],
        units: 6,
        total: 2400,
        sentBy: 'teste',
        sentAt: new Date(Date.now() - 60 * 86_400_000),
        receivedAt: new Date(Date.now() - 40 * 86_400_000),
      },
    });

    const p2 = await prisma.product.create({
      data: {
        externalId: `${PREFIXO}_p2`,
        description: 'ARMACAO SEM CADASTRO',
        category: 'ARMACAO',
        price: 300,
      },
    });
    semFichaId = p2.id;
  });

  afterAll(async () => {
    await prisma.saleItem.deleteMany({ where: { productId: { in: [productId, semFichaId] } } });
    await prisma.sale.deleteMany({ where: { externalId: { startsWith: PREFIXO } } });
    await prisma.stockItem.deleteMany({ where: { productId: { in: [productId, semFichaId] } } });
    await prisma.productAttribute.deleteMany({ where: { productId: { in: [productId, semFichaId] } } });
    await prisma.purchaseOrderRecord.deleteMany({ where: { sentBy: 'teste' } });
    await prisma.product.deleteMany({ where: { externalId: { startsWith: PREFIXO } } });
    await prisma.store.deleteMany({ where: { externalId: { startsWith: PREFIXO } } });
  });

  it('junta identificação, atributos, estoque, vendas e compra numa ficha só', async () => {
    const f = await fichaTecnica(productId);
    expect(f).not.toBeNull();
    expect(f!.identificacao.sku).toBe('RB3025');
    expect(f!.identificacao.referencia).toBe('RB3025-L0205');
    // A GRIFE sai da descrição; a razão social do ERP fica noutro campo.
    expect(f!.identificacao.grife).toMatch(/ray/i);
    expect(f!.identificacao.marcaErp).toMatch(/LUXOTTICA/);
    expect(f!.identificacao.tipo).toBe('Óculos de sol');

    expect(f!.atributos.genero.chave).toBe('UNISSEX');
    expect(f!.atributos.genero.textoOriginal).toBe('Unisex');
    expect(f!.atributos.formatoLente.chave).toBe('AVIADOR');
    expect(f!.atributos.formatoLente.rotulo).toBe('Aviador');
    expect(f!.atributos.formatoLente.fonte).toBe('ficha');
    expect(f!.atributos.materialArmacao.chave).toBe('METAL');
    expect(f!.atributos.dimensoes).toEqual({
      tamanhoLente: 58,
      alturaLente: 44,
      tamanhoPonte: 14,
      tamanhoHaste: 135,
    });

    expect(f!.comercial.preco).toBe(890);
    expect(f!.comercial.custo).toBe(400);
    expect(f!.comercial.custoEstimado).toBe(false);
    expect(f!.comercial.faixa?.rotulo).toBe('R$ 500–1.000');

    const loja = f!.estoque.porLoja.find((l) => l.storeId === storeId);
    expect(loja).toMatchObject({ quantidade: 7, reservado: 1 });
    expect(f!.estoque.total).toBeGreaterThanOrEqual(7);

    const j90 = f!.vendas.periodos.find((p) => p.dias === 90)!;
    expect(j90.unidades).toBeGreaterThanOrEqual(2);
    expect(f!.vendas.mensal).toHaveLength(12);
    expect(f!.vendas.justificativa).toContain('Estoque');

    expect(f!.compra.ultima).toMatchObject({ quantidade: 6, custoUnitario: 400, fornecedor: 'Luxottica' });
  });

  it('peça sem ficha do fornecedor devolve null nos atributos — não zero, não inventado', async () => {
    const f = await fichaTecnica(semFichaId);
    expect(f!.atributos.formatoLente.chave).toBeNull();
    expect(f!.atributos.materialArmacao.chave).toBeNull();
    expect(f!.atributos.genero.chave).toBeNull();
    expect(f!.atributos.dimensoes.tamanhoLente).toBeNull();
    expect(f!.identificacao.referencia).toBeNull();
    expect(f!.atributos.bestSellerNaRede).toBeNull();
    // O custo AUSENTE vira estimativa, e a ficha diz que é estimativa.
    expect(f!.comercial.custoEstimado).toBe(true);
    expect(f!.comercial.custo).toBeGreaterThan(0);
    // Doze meses vazios continuam sendo doze meses.
    expect(f!.vendas.mensal).toHaveLength(12);
    expect(f!.vendas.mensal.every((m) => m.unidades === 0)).toBe(true);
    expect(f!.compra.ultima).toBeNull();
  });

  it('peça que não existe é null — quem devolve 404 é a rota', async () => {
    expect(await fichaTecnica('nao-existe')).toBeNull();
  });

  it('o recorte de lojas vale: sem a loja no filtro, a posição não aparece', async () => {
    const f = await fichaTecnica(productId, { storeId: 'outra-loja-qualquer' });
    expect(f!.estoque.porLoja).toHaveLength(0);
    expect(f!.estoque.total).toBe(0);
  });
});
