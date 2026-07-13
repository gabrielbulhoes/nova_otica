import { describe, it, expect } from 'vitest';
import { buildNfcePayload, buildTransferNfePayload } from '../src/modules/fiscal/fiscal.payloads.js';

const config = { cnpj: '12345678000199', ncmDefault: '90031100', cfop: '5102' };

describe('buildNfcePayload', () => {
  it('numera itens, calcula brutos e fecha o total', () => {
    const p = buildNfcePayload({
      orderNumber: 'NO-1',
      customerName: 'Cliente',
      items: [
        { sku: 'RAY-1', description: 'Armação', quantity: 2, unitPrice: 100.5 },
        { sku: null, description: 'Estojo', quantity: 1, unitPrice: 49.9 },
      ],
      config,
    });
    expect(p.itens).toHaveLength(2);
    expect(p.itens[0].numero_item).toBe(1);
    expect(p.itens[1].numero_item).toBe(2);
    expect(p.itens[0].valor_bruto).toBe(201);
    expect(p.itens[1].codigo_produto).toBe('ITEM-2'); // sem SKU ganha código
    expect(p.valor_total).toBe(250.9);
    expect(p.formas_pagamento[0].valor_pagamento).toBe(p.valor_total);
    expect(p.itens.every((i) => i.cfop === '5102' && i.codigo_ncm === '90031100')).toBe(true);
  });
});

describe('buildTransferNfePayload', () => {
  it('usa CFOP de transferência e valores do item', () => {
    const p = buildTransferNfePayload({
      reference: 'nfe-mov-1',
      item: { sku: 'OAK-2', description: 'Óculos', quantity: 3, unitPrice: 80 },
      fromCnpj: '11111111000111',
      toCnpj: '22222222000122',
      config: { ncmDefault: '90031100', cfop: '5152' },
    });
    expect(p.natureza_operacao).toContain('TRANSFERENCIA');
    expect(p.itens[0].cfop).toBe('5152');
    expect(p.valor_total).toBe(240);
    expect(p.cnpj_emitente).toBe('11111111000111');
    expect(p.cnpj_destinatario).toBe('22222222000122');
  });
});
