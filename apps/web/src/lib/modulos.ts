import type { IconName } from '../brand/Icon';

/**
 * O MAPA DOS MÓDULOS — fonte única da navegação do console.
 *
 * Antes a casca carregava duas listas soltas (15 links na barra lateral + 9 no
 * dock) e nenhuma delas dizia a que ÁREA cada tela pertencia. No celular isso
 * virava uma parede: os 15 rótulos ocupavam cinco linhas antes de qualquer
 * conteúdo, e achar "Estratégia comercial" custava ler a lista inteira.
 *
 * Aqui as mesmas 15 telas passam a ser SETE módulos, cada um com as suas
 * páginas internas. Quem entra vê sete cartões; quem escolhe um módulo recebe
 * só as páginas daquele módulo. A rota de cada tela é exatamente a que já
 * existia — este arquivo agrupa, não redireciona.
 *
 * Regra de permissão: `adminOnly` continua sendo do MESMO conjunto de telas de
 * antes. Um módulo só é `adminOnly` quando todas as suas páginas eram.
 */

export type Categoria = 'Operação' | 'Inteligência' | 'Gestão' | 'Sistema';

/** Ordem em que as categorias aparecem na Central (do dia a dia ao raro). */
export const CATEGORIAS: Categoria[] = ['Operação', 'Inteligência', 'Gestão', 'Sistema'];

export interface PaginaDoModulo {
  to: string;
  label: string;
  /** Casa a rota inteira (só o índice do módulo precisa disso). */
  end?: boolean;
  adminOnly?: boolean;
  /** Sai da casca do admin (abre outra superfície). */
  externo?: boolean;
}

export interface Modulo {
  id: string;
  nome: string;
  icone: IconName;
  categoria: Categoria;
  /** Uma linha dizendo o que se resolve aqui — não é slogan, é função. */
  descricao: string;
  /** Para onde o "Entrar" leva: a página de entrada do módulo. */
  destino: string;
  paginas: PaginaDoModulo[];
  adminOnly?: boolean;
}

export const MODULOS: Modulo[] = [
  {
    id: 'painel',
    nome: 'Painel',
    icone: 'painel',
    categoria: 'Operação',
    descricao: 'Visão geral da rede: cobertura por loja, capital parado e o que pede atenção hoje.',
    destino: '/admin/dashboard',
    paginas: [{ to: '/admin/dashboard', label: 'Painel da rede' }],
  },
  {
    id: 'estoque',
    nome: 'Estoque',
    icone: 'estoque',
    categoria: 'Operação',
    descricao: 'Posição por loja, catálogo de produtos, transferências entre lojas e rupturas.',
    destino: '/admin/estoque',
    paginas: [
      { to: '/admin/estoque', label: 'Posição de estoque' },
      { to: '/admin/produtos', label: 'Produtos' },
      { to: '/admin/transferencias', label: 'Transferências' },
      { to: '/admin/alertas', label: 'Alertas' },
    ],
  },
  {
    id: 'vendas',
    nome: 'Vendas',
    icone: 'vendas',
    categoria: 'Operação',
    descricao: 'As vendas que vieram do ERP na última sincronização, loja a loja.',
    destino: '/admin/vendas',
    paginas: [{ to: '/admin/vendas', label: 'Vendas' }],
  },
  {
    id: 'decisoes',
    nome: 'Decisões',
    icone: 'decisoes',
    categoria: 'Inteligência',
    descricao: 'Comprar, remanejar ou liquidar: cada oportunidade vira um card com prioridade e impacto.',
    destino: '/admin/decisoes',
    paginas: [
      { to: '/admin/decisoes', label: 'Central de decisões' },
      { to: '/admin/historico', label: 'Histórico geral' },
    ],
  },
  {
    id: 'compras',
    nome: 'Compras',
    icone: 'compras',
    categoria: 'Inteligência',
    descricao: 'Reposição por fornecedor, prazo de entrega e a estratégia da compra da safra.',
    destino: '/admin/planejamento',
    paginas: [
      { to: '/admin/planejamento', label: 'Planejamento & Compras' },
      { to: '/admin/estrategia', label: 'Estratégia comercial' },
      // Os dois modos da compra vivem lado a lado: o CONTÍNUO repõe o que a
      // rede já vende, a FEIRA planeja uma coleção que ninguém vendeu ainda.
      { to: '/admin/feira', label: 'Feira de compra' },
    ],
  },
  {
    id: 'bi',
    nome: 'BI',
    icone: 'indicadores',
    categoria: 'Inteligência',
    descricao: 'Faturamento, giro e ticket médio, com os relatórios analíticos da rede.',
    destino: '/admin/bi',
    paginas: [
      { to: '/admin/bi', label: 'Business Intelligence' },
      { to: '/admin/relatorios', label: 'Relatórios' },
    ],
  },
  {
    id: 'cadastros',
    nome: 'Cadastros',
    icone: 'lojas',
    categoria: 'Sistema',
    descricao: 'Lojas da rede, quem acessa o console e a sincronização com o ERP.',
    destino: '/admin/lojas',
    adminOnly: true,
    paginas: [
      { to: '/admin/lojas', label: 'Lojas', adminOnly: true },
      { to: '/admin/usuarios', label: 'Usuários', adminOnly: true },
      { to: '/admin/sincronizacao', label: 'Sincronização', adminOnly: true },
    ],
  },
];

/** Rota da Central. O `end` do NavLink depende de ser exatamente esta. */
export const ROTA_CENTRAL = '/admin';

/**
 * Módulo dono de uma rota. Casa pelo prefixo mais LONGO para que
 * `/admin/estrategia` não seja capturado por `/admin/estoque` — e devolve
 * `null` na Central, que não pertence a módulo nenhum.
 */
export function moduloDaRota(pathname: string): Modulo | null {
  if (pathname === ROTA_CENTRAL) return null;
  let achado: { modulo: Modulo; tamanho: number } | null = null;
  for (const m of MODULOS)
    for (const p of m.paginas) {
      const casa = pathname === p.to || pathname.startsWith(`${p.to}/`);
      if (casa && (!achado || p.to.length > achado.tamanho))
        achado = { modulo: m, tamanho: p.to.length };
    }
  return achado?.modulo ?? null;
}

/** Página exata da rota (para o título da barra e do documento). */
export function paginaDaRota(pathname: string): PaginaDoModulo | null {
  let achada: PaginaDoModulo | null = null;
  for (const m of MODULOS)
    for (const p of m.paginas) {
      const casa = pathname === p.to || pathname.startsWith(`${p.to}/`);
      if (casa && (!achada || p.to.length > achada.to.length)) achada = p;
    }
  return achada;
}

/** Só o que o papel do usuário alcança — mesma regra de antes, agrupada. */
export function modulosVisiveis(isAdmin: boolean): Modulo[] {
  return MODULOS.filter((m) => !m.adminOnly || isAdmin).map((m) => ({
    ...m,
    paginas: m.paginas.filter((p) => !p.adminOnly || isAdmin),
  }));
}
