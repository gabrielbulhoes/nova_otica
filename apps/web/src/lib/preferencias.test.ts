import { describe, expect, it } from 'vitest';
import {
  atributosDaCasca,
  normalizarPreferencias,
  PREFERENCIAS_PADRAO,
  rotuloDaAlternancia,
  rotuloDoRecolhimento,
} from './preferencias';

/**
 * A PREFERÊNCIA DE NAVEGAÇÃO — rodada final · item 01.
 *
 * O que estes testes protegem não é a aparência: é a regra de que QUALQUER
 * entrada produz uma casca válida. A preferência vem do servidor como JSON
 * livre, e um valor estranho gravado ali (por um cliente antigo, por um
 * ajuste manual no banco) não pode deixar um usuário sem navegação — o tipo
 * de defeito que só aparece na conta de quem foi atingido.
 */
describe('normalizarPreferencias', () => {
  it('sem preferência nenhuma, abre lateral e aberta', () => {
    expect(normalizarPreferencias(undefined)).toEqual(PREFERENCIAS_PADRAO);
    expect(normalizarPreferencias(null)).toEqual(PREFERENCIAS_PADRAO);
    expect(normalizarPreferencias({})).toEqual(PREFERENCIAS_PADRAO);
  });

  it('aceita o que é válido e devolve o padrão para o resto', () => {
    expect(normalizarPreferencias({ menu: 'horizontal' })).toEqual({
      menu: 'horizontal',
      sidebarRecolhida: false,
    });
    expect(normalizarPreferencias({ menu: 'diagonal' }).menu).toBe('lateral');
    expect(normalizarPreferencias({ sidebarRecolhida: 'sim' }).sidebarRecolhida).toBe(false);
    expect(normalizarPreferencias({ menu: 'horizontal', sidebarRecolhida: true })).toEqual({
      menu: 'horizontal',
      sidebarRecolhida: true,
    });
  });

  it('não quebra com tipos que nem objeto são', () => {
    expect(normalizarPreferencias('horizontal')).toEqual(PREFERENCIAS_PADRAO);
    expect(normalizarPreferencias(['horizontal'])).toEqual(PREFERENCIAS_PADRAO);
    expect(normalizarPreferencias(7)).toEqual(PREFERENCIAS_PADRAO);
  });
});

describe('atributosDaCasca', () => {
  it('o padrão não escreve atributo nenhum — ausência É o estado padrão', () => {
    expect(atributosDaCasca(PREFERENCIAS_PADRAO)).toEqual({
      'data-menu': undefined,
      'data-menu-recolhido': undefined,
    });
  });

  it('horizontal e recolhida viram os atributos que o CSS lê', () => {
    expect(atributosDaCasca({ menu: 'horizontal', sidebarRecolhida: false })['data-menu']).toBe('horizontal');
    expect(atributosDaCasca({ menu: 'lateral', sidebarRecolhida: true })['data-menu-recolhido']).toBe('1');
    const ambos = atributosDaCasca({ menu: 'horizontal', sidebarRecolhida: true });
    expect(ambos).toEqual({ 'data-menu': 'horizontal', 'data-menu-recolhido': '1' });
  });
});

describe('rótulos dos botões', () => {
  it('nomeiam o destino da ação, como o botão de tema', () => {
    expect(rotuloDaAlternancia({ menu: 'lateral', sidebarRecolhida: false })).toBe('Menu horizontal');
    expect(rotuloDaAlternancia({ menu: 'horizontal', sidebarRecolhida: false })).toBe('Menu lateral');
    expect(rotuloDoRecolhimento({ menu: 'lateral', sidebarRecolhida: false })).toBe('Recolher navegação');
    expect(rotuloDoRecolhimento({ menu: 'lateral', sidebarRecolhida: true })).toBe('Mostrar navegação');
  });
});
