import { describe, expect, it } from 'vitest';
import {
  lojaTrabalhaAGrife,
  separarPorMix,
  type MixDeclarado,
} from '../src/modules/planning/planning.math.js';

/**
 * O MIX DECLARADO — a regra que o cliente pediu duas rodadas seguidas.
 *
 * Os dois exemplos são literais do feedback:
 *  · "Aquele exemplo que vimos de Dior para Guarabira ainda continua
 *     aparecendo" (item 01)
 *  · "Chanel só pode ser vendido no Iguatemi e Natal Shopping" (item 02)
 *
 * A regra em si já existia e sempre funcionou nos testes de unidade. O que
 * falhava era a FONTE: um arquivo JSON no disco do servidor que nunca chegou
 * ao contêiner. Estes testes cobrem a forma nova — chave de LOJA, não de nome —
 * e principalmente as bordas, que são onde uma regra de exclusão erra feio:
 * ela decide o que NÃO acontece, e o que não acontece não aparece em tela
 * nenhuma para alguém desconfiar.
 */

const IGUATEMI = 'loja-iguatemi';
const NATAL_SHOPPING = 'loja-natal-shopping';
const GUARABIRA = 'loja-guarabira';
const PARTAGE = 'loja-partage';

const mix = (m: Record<string, string[]>): MixDeclarado =>
  new Map(Object.entries(m).map(([k, v]) => [k, new Set(v)]));

describe('mix declarado · o que o cliente pediu', () => {
  const REDE = mix({
    CHANEL: [IGUATEMI, NATAL_SHOPPING],
    DIOR: [IGUATEMI],
  });

  it('Chanel passa no Iguatemi e no Natal Shopping', () => {
    expect(lojaTrabalhaAGrife('Chanel', IGUATEMI, REDE)).toBe(true);
    expect(lojaTrabalhaAGrife('Chanel', NATAL_SHOPPING, REDE)).toBe(true);
  });

  it('Chanel NÃO passa nas demais', () => {
    expect(lojaTrabalhaAGrife('Chanel', GUARABIRA, REDE)).toBe(false);
    expect(lojaTrabalhaAGrife('Chanel', PARTAGE, REDE)).toBe(false);
  });

  it('Dior não vai para Guarabira — o exemplo que voltou duas vezes', () => {
    expect(lojaTrabalhaAGrife('Dior', GUARABIRA, REDE)).toBe(false);
  });

  it('grife não declarada é corrente: passa em toda loja', () => {
    // Ray-Ban não está no mapa. É a maioria do catálogo, e o padrão TEM que
    // ser o permissivo: uma declaração de exceção que barra o não-declarado
    // travaria a rede inteira no dia em que alguém salvasse a primeira grife.
    expect(lojaTrabalhaAGrife('Ray-Ban', GUARABIRA, REDE)).toBe(true);
    expect(lojaTrabalhaAGrife('CHILLI BEANS', PARTAGE, REDE)).toBe(true);
  });

  it('a chave é normalizada nos dois lados', () => {
    // "Dolce & Gabbana" e "DOLCE E GABBANA" são a mesma grife para o motor.
    const m = mix({ 'DOLCE & GABBANA': [IGUATEMI] });
    expect(lojaTrabalhaAGrife('Dolce & Gabbana', IGUATEMI, m)).toBe(true);
    expect(lojaTrabalhaAGrife('dolce & gabbana', GUARABIRA, m)).toBe(false);
  });
});

describe('mix declarado · as bordas que fazem uma regra de exclusão mentir', () => {
  const REDE = mix({ CHANEL: [IGUATEMI] });

  it('sem mix nenhum, tudo passa', () => {
    expect(lojaTrabalhaAGrife('Chanel', GUARABIRA, null)).toBe(true);
    expect(lojaTrabalhaAGrife('Chanel', GUARABIRA, mix({}))).toBe(true);
  });

  it('sem grife reconhecível, passa', () => {
    // Barrar uma peça por não sabermos ler a grife da descrição é punir a peça
    // pelo nosso erro de extração — e some do quadro sem nada dizer.
    expect(lojaTrabalhaAGrife(null, GUARABIRA, REDE)).toBe(true);
    expect(lojaTrabalhaAGrife('', GUARABIRA, REDE)).toBe(true);
  });

  it('SEM LOJA, passa — e é o card de compra da rede', () => {
    // O card de COMPRA da rede não tem loja de destino: a compra é da rede, e
    // o destino sai depois, no rateio. Barrá-lo aqui apagaria a compra de uma
    // grife que a rede legitimamente trabalha — em duas lojas.
    expect(lojaTrabalhaAGrife('Chanel', null, REDE)).toBe(true);
    expect(lojaTrabalhaAGrife('Chanel', undefined, REDE)).toBe(true);
  });

  it('grife declarada com lista VAZIA volta a ser corrente', () => {
    // O estado "declarada, sem loja nenhuma" não deve significar "proibida em
    // toda parte". Se significasse, um clique que desmarcasse a última loja
    // apagaria a grife da rede inteira em silêncio.
    expect(lojaTrabalhaAGrife('Chanel', GUARABIRA, mix({ CHANEL: [] }))).toBe(true);
  });
});

describe('separarPorMix · quem entra no rateio e quem fica de fora', () => {
  const CANDIDATAS = [
    { storeId: IGUATEMI, storeName: 'A GRACIOSA IGUATEMI' },
    { storeId: NATAL_SHOPPING, storeName: 'A GRACIOSA NATAL SHOPPING' },
    { storeId: GUARABIRA, storeName: 'A GRACIOSA GUARABIRA' },
  ];

  it('divide a rede pelas lojas declaradas', () => {
    const r = separarPorMix('Chanel', CANDIDATAS, mix({ CHANEL: [IGUATEMI, NATAL_SHOPPING] }));
    expect(r.elegiveis.map((e) => e.storeId)).toEqual([IGUATEMI, NATAL_SHOPPING]);
    expect(r.excluidas.map((e) => e.storeName)).toEqual(['A GRACIOSA GUARABIRA']);
  });

  it('a soma fecha: ninguém some entre as duas listas', () => {
    // É a invariante que protege a contabilidade do rateio. As unidades das
    // lojas excluídas voltam para `unassigned`; se uma candidata sumisse das
    // duas listas, a soma da tela deixaria de bater com a compra e ninguém
    // saberia dizer onde foi parar.
    const r = separarPorMix('Chanel', CANDIDATAS, mix({ CHANEL: [IGUATEMI] }));
    expect(r.elegiveis.length + r.excluidas.length).toBe(CANDIDATAS.length);
  });

  it('grife corrente não exclui ninguém', () => {
    const r = separarPorMix('Ray-Ban', CANDIDATAS, mix({ CHANEL: [IGUATEMI] }));
    expect(r.elegiveis).toHaveLength(3);
    expect(r.excluidas).toHaveLength(0);
  });

  it('rede inteira excluída devolve lista vazia, não a rede inteira', () => {
    // Caso da grife declarada só numa loja que saiu do escopo. A resposta
    // honesta é "não há para onde mandar" — o rateio devolve tudo em
    // `unassigned` e a tela mostra o resto. Cair no permissivo aqui mandaria a
    // caixa para as treze lojas proibidas, que é o defeito original.
    const r = separarPorMix('Chanel', CANDIDATAS, mix({ CHANEL: ['loja-que-saiu'] }));
    expect(r.elegiveis).toHaveLength(0);
    expect(r.excluidas).toHaveLength(3);
  });
});
