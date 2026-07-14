import { describe, expect, it } from 'vitest';
import {
  date,
  digits,
  mapCliente,
  mapDetalheVenda,
  mapEstoqueGrade,
  mapLoja,
  mapPagamento,
  mapProduto,
  mapVenda,
  mapVendedor,
  num,
  saleExternalId,
} from '../src/integrations/sellbie/mappers.js';

/**
 * Amostras SINTÉTICAS no formato exato do conector real (sonda 13/07/2026):
 * padding, "1900-01-01", "naotem", números-string, MAIÚSCULAS na grade e o
 * typo `categora`. Nenhum dado real de cliente entra no repositório.
 */
describe('mappers — contrato real da CDS', () => {
  it('coerções: número-string com vírgula/ponto; data nos dois formatos do conector', () => {
    expect(num('1092.00')).toBe(1092);
    expect(num('1234,50')).toBe(1234.5);
    expect(date('2026-07-08')?.getDate()).toBe(8);
    expect(date('2026-07-09 00:00:00.000')?.getDate()).toBe(9);
    expect(date('1900-01-01')).toBeUndefined(); // placeholder de nulo
  });

  it('loja: codigo_loja vira externalId; nome_fantasia vira nome', () => {
    const d = mapLoja({ codigo_loja: 22, nome_fantasia: 'GMAIS', cnpj: '31.777.506/0001-35', cep: '59020200' });
    expect(d.externalId).toBe('22');
    expect(d.name).toBe('GMAIS');
  });

  it('vendedor: chave é o nome; "1900-01-01" é data-nula; Desativado → inactive', () => {
    const d = mapVendedor({
      codigo_vendedor: 'ADEJANE',
      nome: 'ADEJANE',
      cpf: '',
      codigo_loja: 6,
      carga: 'VENDEDOR',
      data_admissao: '1900-01-01',
      data_demissao: '1900-01-01',
      data_cadastro: '2025-03-28',
      estado: 'Desativado',
    });
    expect(d.externalId).toBe('ADEJANE');
    expect(d.active).toBe(false);
    expect(d.includedAt?.getFullYear()).toBe(2025); // data_cadastro, não a admissão-placeholder
  });

  it('produto: valor_compra é o custo real; classificação com padding é aparada; typo categora cai como categoria', () => {
    const d = mapProduto({
      codigo_base: '15076',
      sku: '15076',
      nome: 'HILUX LENTES PRONTAS ESFERICAS 1.53 AQUA',
      classificacao: 'LENTES PRONTAS                          ',
      valor_compra: 45.5,
      valor_venda: 89,
      ncm: '90015000',
      data_cadastro: '2026-07-09 00:00:00.000',
      status: 'Ativo',
      nome_fornecedor: 'HOYA LENS BRAZIL FAB. DE ARTIGOS OPTICOS LTDA.    ',
      categora: null,
    });
    expect(d.externalId).toBe('15076');
    expect(d.category).toBe('LENTES PRONTAS');
    expect(d.brand).toBe('HOYA LENS BRAZIL FAB. DE ARTIGOS OPTICOS LTDA.');
    expect(d.cost).toBe(45.5);
    expect(d.price).toBe(89);
    expect(d.active).toBe(true);

    const soTypo = mapProduto({ codigo_base: '1', classificacao: '', categora: 'ARMACOES' });
    expect(soTypo.category).toBe('ARMACOES');
  });

  it('cliente: CPF vira dígitos (chave estável) e "naotem" vira e-mail vazio', () => {
    const d = mapCliente({
      cpf: '000.754.433-25',
      nome: 'ALINE EXEMPLO',
      email: 'naotem',
      ddd_celular: '88',
      celular: '988431693',
      data_inclusao: '2026-07-08',
      cidade: 'JUAZEIRO DO NORTE',
      estado: 'CE',
    });
    expect(d.externalId).toBe('00075443325');
    expect(d.document).toBe('00075443325');
    expect(d.email).toBeUndefined();
    expect(d.phone).toBe('88 988431693');
  });

  it('venda: identidade composta loja-venda e CPF do cliente casando por dígitos', () => {
    const d = mapVenda({
      codigo_venda: 1031,
      data: '2026-07-08',
      codigo_loja: 22,
      codigo_vendedor: 'GESSIKA             ',
      valor_pago: 1092,
      cpf_cliente: '768.643.163-00',
      status: 'Válido',
    });
    expect(d.externalId).toBe('22-1031');
    expect(d.externalSellerId).toBe('GESSIKA'); // padding aparado
    expect(d.externalCustomerDoc).toBe(digits('768.643.163-00'));
    expect(d.total).toBe(1092);
    // A mesma venda 1031 em OUTRA loja é outra identidade:
    expect(saleExternalId(3, 1031)).toBe('3-1031');
  });

  it('detalhe: valor_liquido é o total da linha; unitário é derivado', () => {
    const d = mapDetalheVenda({
      codigo_venda: 1031,
      codigo_loja: 22,
      item: 2,
      codigo_produto: '19126',
      valor_liquido: '1092.00', // número-string, como o conector envia
      quantidade: 2,
      status_produto_vendido: 'Válido',
      cmv: 545.1,
    });
    expect(d.externalId).toBe('22-1031-2');
    expect(d.externalSaleId).toBe('22-1031');
    expect(d.total).toBe(1092);
    expect(d.unitPrice).toBe(546);
    expect(d.quantity).toBe(2);
  });

  it('pagamento: identidade venda+parcela; forma com padding aparada', () => {
    const d = mapPagamento({
      codigo_venda: 1031,
      data_venda: '2026-07-08',
      codigo_loja: 22,
      forma_pag: 'VISA POS            ',
      valor_forma_pag: 109.2,
      qtd_parcelas: 10,
      parcela_atual: 3,
      status_pag: 'Aberto',
    });
    expect(d.externalId).toBe('22-1031-p3');
    expect(d.method).toBe('VISA POS');
    expect(d.amount).toBe(109.2);
    expect(d.installments).toBe(10);
  });

  it('estoquegrade: MAIÚSCULAS + estoque aninhado por filial viram posições por loja', () => {
    const rows = mapEstoqueGrade({
      CODIGO: '1',
      GRADE: '1',
      DESCRICAO: 'PRODUTO   TESTE',
      COR: '0',
      TAMANHO: '0',
      GRUPO: 'LENTES',
      PRECO_VENDA: '5',
      ESTOQUE: {
        'A GRACIOSA NATAL SHOP': { ID_FILIAL: '2', ESTOQUE: '1' },
        GMAIS: { ID_FILIAL: '1', ESTOQUE: '7' },
      },
    });
    expect(rows).toHaveLength(2);
    expect(rows).toContainEqual({ externalProductId: '1', externalStoreId: '2', quantity: 1 });
    expect(rows).toContainEqual({ externalProductId: '1', externalStoreId: '1', quantity: 7 });
    // Sem o objeto de estoque, nada a mapear:
    expect(mapEstoqueGrade({ CODIGO: '9' })).toEqual([]);
  });
});
