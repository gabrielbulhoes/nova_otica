import { describe, expect, it } from 'vitest';
import { buildInserirVendaPayload } from '../src/modules/commerce/erpExport.service.js';

/**
 * O builder é puro: pedido pago → JSON do POST /cds/inserirvenda exatamente
 * no formato da documentação oficial da CDS.
 */
describe('buildInserirVendaPayload', () => {
  const order = {
    number: 'NO-LX2K9-042',
    customerName: 'Marina Souza',
    total: 499.5,
    paymentMethod: 'PIX',
    items: [
      { quantity: 1, unitPrice: 399.6, productExternalId: '10066', productDescription: 'Óculos de Sol Ray-Ban' },
      { quantity: 2, unitPrice: 49.95, productExternalId: '10101', productDescription: 'Estojo Rígido' },
    ],
  };

  it('mapeia pedido pago para o formato da CDS (pedidoSite, PIX, produtos)', () => {
    const p = buildInserirVendaPayload(order);

    expect(p.pedidoSite).toBe('NO-LX2K9-042');
    expect(p.dadosCliente.nomeCliente).toBe('Marina Souza');
    expect(p.dadosCliente.consumoFinal).toBe('1');

    expect(p.formasPagamento).toHaveLength(1);
    expect(p.formasPagamento[0].descricaoForma).toBe('PIX');
    expect(p.formasPagamento[0].valorForma).toBe(499.5);
    expect(p.formasPagamento[0].parcelasForma).toBe(1);
    expect(p.formasPagamento[0].dataVenctoForma).toBeNull();

    expect(p.dadosProdutos).toEqual([
      { codigoProduto: '10066', descricaoProduto: 'Óculos de Sol Ray-Ban', valorVendido: 399.6, quantidadeVendida: 1 },
      { codigoProduto: '10101', descricaoProduto: 'Estojo Rígido', valorVendido: 49.95, quantidadeVendida: 2 },
    ]);

    expect(p.finalizarVenda).toEqual({ descontoPerc: 0, descontoValor: 0, acrescimo: 0, motivoDesconto: null });
  });

  it('sem nome do cliente usa "Consumidor Final"; método desconhecido vira OUTROS', () => {
    const p = buildInserirVendaPayload({ ...order, customerName: '  ', paymentMethod: null });
    expect(p.dadosCliente.nomeCliente).toBe('Consumidor Final');
    expect(p.formasPagamento[0].descricaoForma).toBe('OUTROS');
  });

  it('cartão vira CARTAO DE CREDITO (sem acento, como no exemplo da doc)', () => {
    const p = buildInserirVendaPayload({ ...order, paymentMethod: 'CARD' });
    expect(p.formasPagamento[0].descricaoForma).toBe('CARTAO DE CREDITO');
  });

  it('funcionario vem da configuração (identifica as vendas do site no ERP)', () => {
    const p = buildInserirVendaPayload(order);
    expect(p.funcionario).toBe('ECOMMERCE');
  });

  it('pedido sem desconto fecha a conta: itens = pagamento, desconto/acréscimo zero', () => {
    const p = buildInserirVendaPayload(order); // 399.60 + 2×49.95 = 499.50 = total
    expect(p.finalizarVenda.descontoValor).toBe(0);
    expect(p.finalizarVenda.acrescimo).toBe(0);
    expect(p.finalizarVenda.motivoDesconto).toBeNull();
  });

  it('total menor que a soma dos itens vira descontoValor (conta fecha no ERP)', () => {
    const p = buildInserirVendaPayload({ ...order, total: 449.5 }); // cupom de 50
    expect(p.finalizarVenda.descontoValor).toBe(50);
    expect(p.finalizarVenda.acrescimo).toBe(0);
    expect(p.finalizarVenda.motivoDesconto).toBe('Desconto aplicado no pedido online');
    expect(p.formasPagamento[0].valorForma).toBe(449.5);
  });

  it('total maior que a soma dos itens vira acréscimo (ex.: frete)', () => {
    const p = buildInserirVendaPayload({ ...order, total: 519.5 }); // +20 de frete
    expect(p.finalizarVenda.acrescimo).toBe(20);
    expect(p.finalizarVenda.descontoValor).toBe(0);
    expect(p.finalizarVenda.motivoDesconto).toBeNull();
  });

  it('desconto calculado em centavos — sem deriva de ponto flutuante', () => {
    // 3 × 0.10 = 0.30000000000000004 em float; em centavos, fecha exato.
    const p = buildInserirVendaPayload({
      ...order,
      total: 0.25,
      items: [{ quantity: 3, unitPrice: 0.1, productExternalId: '1', productDescription: 'A' }],
    });
    expect(p.finalizarVenda.descontoValor).toBe(0.05);
  });
});
