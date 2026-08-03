import { describe, it, expect, beforeEach, vi } from 'vitest';
import { alternarTema, assinarTema, definirTema, lerTema } from './tema';

/**
 * A regra do tema tem duas metades, e as duas quebram em silêncio:
 * o usuário PODE escolher o escuro, e toda ABERTURA começa no claro. A segunda
 * é a que já falhou de verdade — a escolha ficava gravada no navegador e a
 * demonstração abria preta dias depois de um clique que ninguém lembrava.
 */
describe('tema do console', () => {
  beforeEach(() => {
    definirTema('claro');
  });

  it('começa no claro', () => {
    expect(lerTema()).toBe('claro');
  });

  it('o alternador troca nos dois sentidos', () => {
    alternarTema();
    expect(lerTema()).toBe('escuro');
    alternarTema();
    expect(lerTema()).toBe('claro');
  });

  it('avisa quem assina — é assim que console e vitrine trocam juntos', () => {
    // As duas cascas leem o MESMO store. Sem o aviso, a loja continuaria clara
    // com o console escuro, que era exatamente o defeito original.
    const avisos = vi.fn();
    const cancelar = assinarTema(avisos);

    definirTema('escuro');
    expect(avisos).toHaveBeenCalledTimes(1);

    definirTema('escuro'); // valor repetido: nada muda, ninguém re-renderiza
    expect(avisos).toHaveBeenCalledTimes(1);

    cancelar();
    definirTema('claro');
    expect(avisos).toHaveBeenCalledTimes(1); // cancelado de verdade
  });

  it('TODA ABERTURA COMEÇA NO CLARO: o escuro não sobrevive ao recarregamento', async () => {
    definirTema('escuro');
    expect(lerTema()).toBe('escuro');

    // Recarregar a página é carregar o módulo do zero. Se algum dia alguém
    // reintroduzir localStorage aqui, este teste falha.
    vi.resetModules();
    const recarregado = await import('./tema');
    expect(recarregado.lerTema()).toBe('claro');
  });
});
