import { describe, it, expect } from 'vitest';
import {
  MODULOS,
  ROTA_CENTRAL,
  moduloDaRota,
  modulosVisiveis,
  paginaDaRota,
} from './modulos';

/**
 * O agrupamento em módulos só é seguro se NENHUMA tela ficar órfã: uma rota
 * fora do mapa deixa de ter caminho na interface, mesmo continuando a existir
 * no roteador. Estes testes são a rede de proteção disso.
 */

/** As 16 telas do console (as 15 de antes + o Painel, que ganhou rota própria). */
const TELAS = [
  '/admin/dashboard',
  '/admin/bi',
  '/admin/estoque',
  '/admin/produtos',
  '/admin/transferencias',
  '/admin/alertas',
  '/admin/relatorios',
  '/admin/decisoes',
  '/admin/historico',
  '/admin/estrategia',
  '/admin/planejamento',
  '/admin/vendas',
  '/admin/usuarios',
  '/admin/lojas',
  '/admin/sincronizacao',
];

describe('mapa de módulos', () => {
  it('toda tela do console pertence a exatamente um módulo', () => {
    for (const rota of TELAS) {
      const donos = MODULOS.filter((m) => m.paginas.some((p) => p.to === rota));
      expect(donos.length, `${rota} deveria ter 1 módulo dono, tem ${donos.length}`).toBe(1);
    }
  });

  it('nenhuma rota é declarada duas vezes', () => {
    const todas = MODULOS.flatMap((m) => m.paginas.map((p) => p.to));
    expect(new Set(todas).size).toBe(todas.length);
  });

  it('o destino do "Entrar" é sempre uma página do próprio módulo', () => {
    for (const m of MODULOS) {
      expect(m.paginas.some((p) => p.to === m.destino), `${m.nome}: destino fora do módulo`).toBe(true);
    }
  });

  it('prefixo mais longo ganha — /admin/estrategia não cai em /admin/estoque', () => {
    expect(moduloDaRota('/admin/estrategia')?.id).toBe('compras');
    expect(moduloDaRota('/admin/estoque')?.id).toBe('estoque');
    expect(paginaDaRota('/admin/estrategia')?.label).toBe('Estratégia comercial');
  });

  it('a Central não pertence a módulo nenhum', () => {
    expect(moduloDaRota(ROTA_CENTRAL)).toBeNull();
  });

  it('gestor de loja não enxerga os módulos restritos ao admin', () => {
    const deLoja = modulosVisiveis(false);
    const rotasDeLoja = deLoja.flatMap((m) => m.paginas.map((p) => p.to));
    for (const restrita of ['/admin/usuarios', '/admin/lojas', '/admin/sincronizacao']) {
      expect(rotasDeLoja, `${restrita} vazou para o gestor de loja`).not.toContain(restrita);
    }
    // E o admin continua vendo tudo.
    const doAdmin = modulosVisiveis(true).flatMap((m) => m.paginas.map((p) => p.to));
    for (const rota of TELAS) expect(doAdmin).toContain(rota);
  });

  it('contínuo e feira são módulos SEPARADOS', () => {
    /*
     * Pedido do cliente, e a razão é de uso, não de arquitetura: os dois modos
     * partilham a matemática, mas não o momento nem o usuário. A reposição é
     * trabalho de mesa, mensal, sobre a rede viva; a feira é evento com data
     * marcada, decidido de pé no balcão com o fornecedor na frente.
     *
     * Enquanto a feira era a terceira página de Compras, a tela que mais se
     * abre com pressa era a mais escondida das três.
     */
    const compras = MODULOS.find((m) => m.id === 'compras')!;
    const feira = MODULOS.find((m) => m.id === 'feira')!;
    expect(feira, 'a feira deixou de ser módulo próprio').toBeDefined();
    expect(compras.paginas.some((p) => p.to === '/admin/feira')).toBe(false);
    expect(feira.destino).toBe('/admin/feira');
    expect(moduloDaRota('/admin/feira')?.id).toBe('feira');
    expect(moduloDaRota('/admin/estrategia')?.id).toBe('compras');
  });

  it('todo módulo tem descrição e categoria — o cartão não fica mudo', () => {
    for (const m of MODULOS) {
      expect(m.descricao.length, `${m.nome} sem descrição`).toBeGreaterThan(20);
      expect(m.categoria).toBeTruthy();
      expect(m.paginas.length).toBeGreaterThan(0);
    }
  });
});
