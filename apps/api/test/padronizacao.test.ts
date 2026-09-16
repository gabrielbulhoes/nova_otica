import { describe, expect, it } from 'vitest';
import {
  classificarTextos,
  devoGravar,
  ehPecaDeModa,
  formatoDaDescricao,
  materialDaDescricao,
  padronizarPeca,
  pesoDaFonte,
} from '../src/catalogo/padronizacao.js';
import { mapAtributosDoErp } from '../src/integrations/sellbie/mappers.js';

/**
 * A PRECEDÊNCIA ENTRE AS TRÊS FONTES — rodada final · item 03.
 *
 * Três fontes escrevem os mesmos dois campos (ficha do fornecedor, cadastro do
 * ERP e leitura da descrição). Sem uma ordem declarada, a última a rodar vence
 * e o resultado passa a depender da hora do cron em vez da qualidade do dado.
 */
describe('precedência das fontes', () => {
  it('ficha > erp > descrição, e fonte desconhecida vale o mínimo', () => {
    expect(pesoDaFonte('ficha')).toBeGreaterThan(pesoDaFonte('erp'));
    expect(pesoDaFonte('erp')).toBeGreaterThan(pesoDaFonte('descricao'));
    expect(pesoDaFonte('vinda-de-outra-versao')).toBeGreaterThan(pesoDaFonte(null));
    expect(pesoDaFonte(null)).toBe(0);
  });

  it('fonte mais fraca não sobrescreve o que a mais forte classificou', () => {
    const atual = { valor: 'AVIADOR' as const, fonte: 'ficha' };
    expect(devoGravar(atual, { valor: 'QUADRADA', fonte: 'erp' })).toBe(false);
    expect(devoGravar(atual, { valor: 'QUADRADA', fonte: 'descricao' })).toBe(false);
  });

  it('a mesma fonte PODE corrigir: o fornecedor que reenvia a ficha arrumada vale', () => {
    expect(devoGravar({ valor: 'AVIADOR', fonte: 'ficha' }, { valor: 'WAYFARER', fonte: 'ficha' })).toBe(true);
  });

  it('"não identificado" não bloqueia quem sabe — mas nunca apaga quem sabia', () => {
    // A ficha olhou e não soube; o ERP sabe. O ERP entra.
    expect(
      devoGravar({ valor: 'NAO_IDENTIFICADO', fonte: 'ficha' }, { valor: 'AVIADOR', fonte: 'erp' }),
    ).toBe(true);
    // O contrário não: "não sei" de fonte forte não apaga um "sei" gravado.
    expect(
      devoGravar({ valor: 'AVIADOR', fonte: 'descricao' }, { valor: 'NAO_IDENTIFICADO', fonte: 'ficha' }),
    ).toBe(false);
    // Em campo vazio, o "não identificado" entra — registra que alguém olhou.
    expect(devoGravar({ valor: null, fonte: null }, { valor: 'NAO_IDENTIFICADO', fonte: 'ficha' })).toBe(true);
  });

  it('candidato sem valor nunca grava', () => {
    expect(devoGravar({ valor: null, fonte: null }, { valor: null, fonte: 'ficha' })).toBe(false);
  });
});

describe('leitura da descrição', () => {
  it('só palavra inteira e inequívoca', () => {
    expect(formatoDaDescricao('RB3025 001 58 OCULOS RAY BAN AVIADOR')).toBe('AVIADOR');
    expect(formatoDaDescricao('ARMACAO GATINHO VOGUE')).toBe('GATINHO');
    expect(formatoDaDescricao('OCULOS WAYFARER CLASSICO')).toBe('WAYFARER');
    expect(materialDaDescricao('ARMACAO ACETATO PRETO')).toBe('ACETATO');
    expect(materialDaDescricao('ARMACAO TITANIO')).toBe('TITANIO');
  });

  it('ausência de palavra é null — NUNCA "não identificado"', () => {
    // Marcar "não identificado" a partir de uma descrição que nunca teve a
    // informação encheria o catálogo de um veredito que ninguém deu.
    expect(formatoDaDescricao('RB3548NL 001 54 OCULOS RAY BAN')).toBeNull();
    expect(materialDaDescricao('RB3548NL 001 54 OCULOS RAY BAN')).toBeNull();
  });

  it('acetato e metal juntos é combinado; titânio com "metal" é só titânio', () => {
    expect(materialDaDescricao('ARMACAO ACETATO E METAL')).toBe('COMBINADO');
    expect(materialDaDescricao('ARMACAO METAL TITANIO')).toBe('TITANIO');
  });
});

describe('padronizarPeca', () => {
  const vazio = { valor: null, fonte: null };
  const base = {
    productId: 'p1',
    description: 'RB3025 001 58 OCULOS RAY BAN',
    category: 'OCULOS',
    formatoTexto: null,
    materialTexto: null,
    formatoAtual: vazio,
    materialAtual: vazio,
    fonteDoTexto: null,
  };

  it('classifica o texto do cadastro com a fonte dele', () => {
    const m = padronizarPeca({
      ...base,
      formatoTexto: 'Piloto',
      materialTexto: 'Metal',
      fonteDoTexto: 'ficha',
    });
    expect(m).toEqual({
      productId: 'p1',
      formatoLente: 'AVIADOR',
      fonteFormato: 'ficha',
      materialArmacao: 'METAL',
      fonteMaterial: 'ficha',
    });
  });

  it('sem texto, tenta a descrição — e a fonte fica registrada como descrição', () => {
    const m = padronizarPeca({ ...base, description: 'OCULOS RAY BAN AVIADOR ACETATO' });
    expect(m?.formatoLente).toBe('AVIADOR');
    expect(m?.fonteFormato).toBe('descricao');
    expect(m?.materialArmacao).toBe('ACETATO');
  });

  it('é IDEMPOTENTE: rodar de novo sobre o que já está padronizado não muda nada', () => {
    const jaFeito = padronizarPeca({
      ...base,
      formatoTexto: 'Piloto',
      fonteDoTexto: 'ficha',
      formatoAtual: { valor: 'AVIADOR', fonte: 'ficha' },
      materialAtual: { valor: 'METAL', fonte: 'ficha' },
      materialTexto: 'Metal',
    });
    expect(jaFeito).toBeNull();
  });

  it('relógio, lente e acessório ficam de fora — não têm aro nem lente', () => {
    expect(ehPecaDeModa('RELOGIO')).toBe(false);
    expect(ehPecaDeModa('LENTE DE CONTATO')).toBe(false);
    expect(ehPecaDeModa('PORTA OCULOS')).toBe(false);
    expect(ehPecaDeModa('OCULOS')).toBe(true);
    expect(ehPecaDeModa('ARMACAO')).toBe(true);
    expect(padronizarPeca({ ...base, category: 'RELOGIO', formatoTexto: 'Redondo' })).toBeNull();
  });

  it('texto que o padronizador não entende vira NAO_IDENTIFICADO, não OUTROS', () => {
    const m = padronizarPeca({ ...base, formatoTexto: 'Borboleta XPTO', fonteDoTexto: 'ficha' });
    expect(m?.formatoLente).toBe('NAO_IDENTIFICADO');
  });
});

describe('classificarTextos', () => {
  it('devolve null quando não há texto — ausência não vira veredito', () => {
    expect(classificarTextos(null, null)).toEqual({ formatoLente: null, materialArmacao: null });
  });
});

/**
 * O PAYLOAD DO ERP já trazia estes campos, e nada era gravado: a ficha só
 * existia pelo importador manual de planilha, que cobre 4.339 das ~61 mil
 * peças. Este teste guarda o mapeamento — e a regra do material combinado.
 */
describe('mapAtributosDoErp', () => {
  const produto = {
    codigo_base: 4321,
    genero: 'Unisex',
    formato_armacao: 'Piloto',
    material_armacao: 'Metal',
    material_hastes: 'Acetato',
    cor_armacao: 'Dourado',
    codigo_cor: '001',
    tamanho_lente: '58',
    altura_lente: '44',
    tamanho_ponte: '14',
    comprimento_hast: '135',
    foto1: 'https://exemplo/rb3025.jpg',
  } as never;

  it('lê os campos que o conector sempre mandou', () => {
    const a = mapAtributosDoErp(produto);
    expect(a.externalId).toBe('4321');
    expect(a.genero).toBe('Unisex');
    expect(a.formato).toBe('Piloto');
    expect(a.cor).toBe('Dourado');
    expect(a.tamanhoLente).toBe(58);
    expect(a.tamanhoHaste).toBe(135);
    expect(a.imagemUrl).toBe('https://exemplo/rb3025.jpg');
  });

  it('material das hastes só entra quando DIFERE do aro', () => {
    expect(mapAtributosDoErp(produto).material).toBe('Metal / Acetato');
    expect(
      mapAtributosDoErp({ ...(produto as object), material_hastes: 'Metal' } as never).material,
    ).toBe('Metal');
    // Repetir "Acetato / Acetato" produziria COMBINADO numa armação inteira
    // de acetato.
    expect(classificarTextos(null, mapAtributosDoErp(produto).material ?? null).materialArmacao).toBe(
      'COMBINADO',
    );
  });
});
