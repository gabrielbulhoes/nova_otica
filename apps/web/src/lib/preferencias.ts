/**
 * PREFERÊNCIAS DE INTERFACE DO USUÁRIO — rodada final · item 01.
 *
 * "O menu deve poder ser exibido tanto lateralmente quanto horizontalmente,
 *  alternável por configuração. A preferência deve ser salva por usuário. A
 *  sidebar deve ser recolhível."
 *
 * Três decisões que valem estar escritas:
 *
 * · A preferência mora NO SERVIDOR (`User.preferences`), não no navegador.
 *   "Salva por usuário" é diferente de "salva neste computador": o gerente que
 *   abre o console no caixa e depois na sala encontra a mesma tela. O tema,
 *   ao lado, é o caso oposto e continua sem persistência — o porquê está em
 *   `lib/tema.ts`.
 *
 * · A tela nunca lê um valor cru. Tudo passa por `normalizarPreferencias`, e
 *   chave ausente vira padrão. Assim um `{}` (usuário que nunca mexeu), um
 *   JSON antigo e uma resposta de erro produzem a MESMA casca, em vez de três
 *   comportamentos diferentes.
 *
 * · RECOLHER É ESCONDER, não encolher para uma faixa de ícones. A barra
 *   lateral deste console é contextual: mostra as PÁGINAS do módulo aberto, em
 *   texto, e páginas não têm ícone próprio. Uma faixa de 64px com ícones
 *   genéricos inventaria significado que o produto não tem. Quem recolhe quer
 *   a largura de volta, e o dock — que é de ícones e fica sempre visível —
 *   mantém a navegação global a um clique.
 */

export type PosicaoDoMenu = 'lateral' | 'horizontal';

export interface PreferenciasDeInterface {
  /** Onde a navegação do módulo aparece: à esquerda ou numa barra no topo. */
  menu: PosicaoDoMenu;
  /** Painel de navegação recolhido (o dock continua disponível). */
  sidebarRecolhida: boolean;
}

export const PREFERENCIAS_PADRAO: PreferenciasDeInterface = {
  menu: 'lateral',
  sidebarRecolhida: false,
};

const POSICOES: PosicaoDoMenu[] = ['lateral', 'horizontal'];

/** Qualquer coisa vinda do servidor vira uma preferência válida. */
export function normalizarPreferencias(bruto: unknown): PreferenciasDeInterface {
  if (!bruto || typeof bruto !== 'object' || Array.isArray(bruto)) return { ...PREFERENCIAS_PADRAO };
  const o = bruto as Record<string, unknown>;
  return {
    menu: POSICOES.includes(o.menu as PosicaoDoMenu) ? (o.menu as PosicaoDoMenu) : PREFERENCIAS_PADRAO.menu,
    sidebarRecolhida:
      typeof o.sidebarRecolhida === 'boolean' ? o.sidebarRecolhida : PREFERENCIAS_PADRAO.sidebarRecolhida,
  };
}

/**
 * Os atributos que a casca escreve no elemento raiz — e que o CSS lê.
 *
 * Existe como função pura para que o layout seja VERIFICÁVEL sem montar o
 * console inteiro: a regra "horizontal esconde a barra lateral" é uma linha de
 * CSS ligada a um atributo, e o que um teste precisa provar é que o atributo
 * sai certo de cada combinação de preferência.
 *
 * `undefined` em vez de `"0"`: ausência de atributo é o estado padrão, e é o
 * que o seletor espera — a mesma regra que o `data-tema` já usa.
 */
export function atributosDaCasca(p: PreferenciasDeInterface): {
  'data-menu'?: PosicaoDoMenu;
  'data-menu-recolhido'?: '1';
} {
  return {
    'data-menu': p.menu === 'horizontal' ? 'horizontal' : undefined,
    'data-menu-recolhido': p.sidebarRecolhida ? '1' : undefined,
  };
}

/** O rótulo da ação de alternar — nomeia o DESTINO, como o botão de tema. */
export const rotuloDaAlternancia = (p: PreferenciasDeInterface): string =>
  p.menu === 'horizontal' ? 'Menu lateral' : 'Menu horizontal';

export const rotuloDoRecolhimento = (p: PreferenciasDeInterface): string =>
  p.sidebarRecolhida ? 'Mostrar navegação' : 'Recolher navegação';
