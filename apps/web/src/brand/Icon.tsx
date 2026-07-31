import type { CSSProperties } from 'react';

/**
 * Iconografia NANOFLOW — grade 24, traço 1,3, terminais retos, junções vivas.
 *
 * Substitui o emoji que o console usava (🏠 📊 📦 🧭 🎯 🛒 🔁 🔔 🕶️ 💡 ✓ ⚠︎ ℹ︎ ↔︎).
 * Emoji não é ícone: renderiza diferente em cada sistema operacional, ignora a cor
 * da marca e destrói a leitura de precisão que é o produto da NANOFLOW.
 *
 * Regras do manual (seção 06 · Iconografia), aplicadas no <svg> uma única vez para
 * que nenhum desenho possa divergir:
 *   viewBox 0 0 24 24 · fill none · stroke currentColor · largura 1,3
 *   linecap butt · linejoin miter · sem cantos arredondados
 *
 * A ÚNICA exceção de canto em arco é `marca`, `aprovar` e `prazo`: esses três
 * reproduzem a silhueta do símbolo (quadrado com dois cantos em arco de raio 9),
 * e o manual autoriza o arco justamente nesse caso.
 *
 * Cor: nunca dourado no path. O ícone herda `currentColor` do contexto — é isso
 * que permite o mesmo desenho servir em texto, em ouro e no modo escuro.
 */

/* ─── Desenhos ──────────────────────────────────────────────────────────────
   Coordenadas em inteiros ou meios-pixels: com traço 1,3 qualquer terça parte
   de pixel vira borrão na tela. Onde há círculo, ele é forma do ícone (lente,
   roda, mostrador), não canto arredondado.                                    */
const desenhos = {
  /* — Os oito do manual, copiados sem alteração: são o gabarito de estilo — */

  /** Símbolo da marca. Único desenho com o corte assimétrico do logotipo. */
  marca: <path d="M12 3h9v9a9 9 0 0 1-9 9H3v-9a9 9 0 0 1 9-9z" />,
  /** BI / indicadores. */
  indicadores: (
    <>
      <path d="M3 17l5-6 4 3 4-7 5 5" />
      <path d="M3 21h18" />
    </>
  ),
  /** Motor de IA / previsão. */
  'motor-ia': (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1" />
    </>
  ),
  /** Integração entre sistemas. */
  integracao: (
    <>
      <path d="M4 8h6a4 4 0 0 1 4 4v8" />
      <path d="M20 16h-6a4 4 0 0 1-4-4V4" />
    </>
  ),
  /** Aprovar decisão. Marca + check: é o momento de governança da tela. */
  aprovar: (
    <>
      <path d="M12 3h9v9a9 9 0 0 1-9 9H3" />
      <path d="M7 12l3 3 6-6" />
    </>
  ),
  /** Governança / trilha de auditoria. */
  governanca: (
    <>
      <rect x="3" y="4" width="18" height="16" />
      <path d="M3 9h18M9 9v11" />
    </>
  ),
  /** Fluxo / fila de itens. */
  fluxo: (
    <>
      <path d="M4 6h16M4 12h10M4 18h13" />
      <circle cx="19" cy="12" r="2" />
    </>
  ),
  /** Prazo. Relógio dentro da silhueta da marca. */
  prazo: (
    <>
      <path d="M12 4v8l5 3" />
      <path d="M12 3h9v9a9 9 0 0 1-9 9H3v-9a9 9 0 0 1 9-9z" />
    </>
  ),

  /* — Navegação do console (o dock e a barra lateral) — */

  /** Dashboard. Três painéis desiguais: é um painel, não uma casa. */
  painel: (
    <>
      <path d="M3 4h7v16H3z" />
      <path d="M12 4h9v6h-9z" />
      <path d="M12 12h9v8h-9z" />
    </>
  ),
  /** Estoque. Caixa fechada em vista isométrica. */
  estoque: (
    <>
      <path d="M3 7l9-4 9 4v10l-9 4-9-4z" />
      <path d="M3 7l9 4 9-4M12 11v10" />
    </>
  ),
  /** Decisões. Bússola: agulha losangular centrada em 12,12. */
  decisoes: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M15.5 8.5l-2 5-5 2 2-5z" />
    </>
  ),
  /** Estratégia comercial. Alvo concêntrico. */
  estrategia: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1.5" />
    </>
  ),
  /** Planejamento & Compras. Carrinho. */
  compras: (
    <>
      <path d="M2 4h3l2 12h12" />
      <path d="M5.5 7H21l-1.5 7H6.7" />
      <circle cx="9" cy="18.5" r="1.5" />
      <circle cx="17" cy="18.5" r="1.5" />
    </>
  ),
  /** Transferências entre lojas. Duas setas em sentidos opostos. */
  transferencias: (
    <>
      <path d="M3 9h14" />
      <path d="M13 5l4 4-4 4" />
      <path d="M21 15H7" />
      <path d="M11 19l-4-4 4-4" />
    </>
  ),
  /** Alertas. Sino de saia reta — a cúpula é forma, não canto arredondado. */
  alertas: (
    <>
      <path d="M18 16V10a6 6 0 0 0-12 0v6l-2 3h16z" />
      <path d="M10 21h4" />
    </>
  ),
  /** Loja online / provador virtual. Óculos: duas lentes trapezoidais e ponte. */
  loja: (
    <>
      <path d="M1.5 7.5h9l-1.5 8H3z" />
      <path d="M22.5 7.5h-9l1.5 8h6z" />
      <path d="M10.5 9h3" />
    </>
  ),
  /** Catálogo de produtos. Grade de quatro. */
  produtos: (
    <>
      <path d="M3 3h8v8H3z" />
      <path d="M13 3h8v8h-8z" />
      <path d="M3 13h8v8H3z" />
      <path d="M13 13h8v8h-8z" />
    </>
  ),
  /** Relatórios. Folha com canto cortado a 90° — ecoa o corte do símbolo. */
  relatorios: (
    <>
      <path d="M5 3h9l5 5v13H5z" />
      <path d="M14 3v5h5" />
      <path d="M8 13h8M8 17h5" />
    </>
  ),
  /** Histórico geral. Mostrador limpo (a variante com a marca é `prazo`). */
  historico: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l4 2" />
    </>
  ),
  /** Vendas. Cupom com recorte serrilhado no pé. */
  vendas: (
    <>
      <path d="M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2z" />
      <path d="M9 8h6M9 12h6" />
    </>
  ),
  /** Usuários. Cabeça em círculo, ombros em trapézio (nada arredondado). */
  usuarios: (
    <>
      <circle cx="9" cy="7.5" r="3.5" />
      <path d="M2 21v-3.5L9 14l7 3.5V21" />
      <circle cx="17.5" cy="9" r="2.5" />
      <path d="M18 14.5l4 2V21" />
    </>
  ),
  /** Lojas da rede. Fachada com toldo. */
  lojas: (
    <>
      <path d="M3 9h18v12H3z" />
      <path d="M3 9l2-5h14l2 5" />
      <path d="M9 21v-7h6v7" />
    </>
  ),
  /** Sincronização. Dois quartos de anel com ponta em ângulo vivo. */
  sincronizacao: (
    <>
      <path d="M4 12a8 8 0 0 1 8-8h5" />
      <path d="M14 1l3 3-3 3" />
      <path d="M20 12a8 8 0 0 1-8 8H7" />
      <path d="M10 23l-3-3 3-3" />
    </>
  ),

  /* — Estado e resposta do sistema — */

  /** Confirmação inline ("Salvo", "Enviado"). Para o botão de decisão use `aprovar`. */
  check: <path d="M4 13l5 5L20 7" />,
  /** Recusar / fechar / remover. */
  recusar: <path d="M5 5l14 14M19 5L5 19" />,
  /** Atenção: risco operacional (ruptura, compra sem lastro). */
  atencao: (
    <>
      <path d="M12 3.5L2 20.5h20z" />
      <path d="M12 9.5v5" />
      <path d="M12 17.5v1.5" />
    </>
  ),
  /** Informação: nota de metodologia, escopo de um número. */
  informacao: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v6" />
      <path d="M12 7.2v1.6" />
    </>
  ),
  /** Dica / porquê da recomendação (substitui o 💡). */
  ideia: (
    <>
      <path d="M12 2.5a6 6 0 0 0-3.5 10.9V16h7v-2.6A6 6 0 0 0 12 2.5z" />
      <path d="M9 19h6" />
      <path d="M10.5 21.5h3" />
    </>
  ),
  /** Tendência de alta (método de previsão, variação positiva). */
  tendencia: (
    <>
      <path d="M3 17l6-6 4 4 7-7" />
      <path d="M15 8h5v5" />
    </>
  ),

  /* — Ações de toolbar — */

  /** Exportar CSV. Seta descendo sobre a linha de base. */
  exportar: (
    <>
      <path d="M12 3v12" />
      <path d="M7 10l5 5 5-5" />
      <path d="M4 20h16" />
    </>
  ),
  /** Exportar PDF / imprimir. */
  imprimir: (
    <>
      <path d="M7 9V3h10v6" />
      <path d="M7 17H3V9h18v8h-4" />
      <path d="M7 14h10v7H7z" />
    </>
  ),
  /** Filtro (recorte de lojas, marcas, período). */
  filtro: <path d="M3 4h18l-7 8v8l-4-2v-6z" />,
  /** Buscar. */
  buscar: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="M15.1 15.1L21 21" />
    </>
  ),
  /** Limpar filtros. X dentro do círculo — não se confunde com `recusar`. */
  limpar: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9 9l6 6M15 9l-6 6" />
    </>
  ),
  /** Adicionar (quantidade, item, linha). */
  mais: <path d="M12 4v16M4 12h16" />,
  /** Remover uma unidade. */
  menos: <path d="M4 12h16" />,
  /** Excluir do carrinho / da lista. */
  lixeira: (
    <>
      <path d="M3.5 6h17" />
      <path d="M6 6l1 15h10l1-15" />
      <path d="M9.5 6V3h5v3" />
      <path d="M10 10.5v7M14 10.5v7" />
    </>
  ),
  /** Sair da sessão. */
  sair: (
    <>
      <path d="M10 4H4v16h6" />
      <path d="M20 12H9" />
      <path d="M15 7l5 5-5 5" />
    </>
  ),
  /** Entrega / prazo do fornecedor. */
  entrega: (
    <>
      <path d="M2 6h12v10H2z" />
      <path d="M14 9h4l3 3v4h-7z" />
      <circle cx="7" cy="18.5" r="2" />
      <circle cx="17.5" cy="18.5" r="2" />
    </>
  ),
  /** Etiqueta de preço / liquidação / marca. */
  etiqueta: (
    <>
      <path d="M3 3h8l10 10-8 8L3 11z" />
      <circle cx="7" cy="7" r="1.5" />
    </>
  ),
  /** Calendário / recorte de período / sazonalidade. */
  calendario: (
    <>
      <path d="M3 5h18v16H3z" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </>
  ),

  /* — Direção. Substituem → ← ▾ ▸ escritos como texto, que mudam de largura
       conforme a fonte instalada e desalinham a linha.                        */

  'seta-direita': (
    <>
      <path d="M3 12h16" />
      <path d="M14 7l5 5-5 5" />
    </>
  ),
  'seta-esquerda': (
    <>
      <path d="M21 12H5" />
      <path d="M10 7l-5 5 5 5" />
    </>
  ),
  'chevron-baixo': <path d="M5 9l7 7 7-7" />,
  'chevron-cima': <path d="M5 15l7-7 7 7" />,
  'chevron-direita': <path d="M9 5l7 7-7 7" />,
};

export type IconName = keyof typeof desenhos;

/** Lista completa, para galeria de verificação e testes de cobertura. */
export const nomesDeIcone = Object.keys(desenhos) as IconName[];

export interface IconProps {
  name: IconName;
  /** Lado do quadrado, em px. 18 em texto, 20 em botão, 22 no dock. */
  size?: number;
  /** Espessura do traço. Só saia de 1.3 em tamanho ≥ 40px, onde o traço some. */
  stroke?: number;
  /**
   * Rótulo acessível. Informe SOMENTE quando o ícone for o único rótulo do
   * controle (o caso do dock). Ao lado de um texto que já diz a mesma coisa,
   * omita: o ícone vira decorativo e o leitor de tela não repete a palavra.
   */
  title?: string;
  className?: string;
  style?: CSSProperties;
}

export function Icon({ name, size = 20, stroke = 1.3, title, className, style }: IconProps) {
  const decorativo = title === undefined;
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="butt"
      strokeLinejoin="miter"
      className={className}
      role={decorativo ? undefined : 'img'}
      aria-hidden={decorativo || undefined}
      aria-label={title}
      // focusable=false: sem isso o SVG entra na ordem de tabulação no IE/Edge
      // legado e cria uma parada de teclado que não faz nada.
      focusable="false"
      // flex:none impede que o ícone seja espremido dentro de linhas flex, que é
      // o layout de quase todo botão e badge do console.
      style={{ display: 'inline-block', verticalAlign: 'middle', flex: 'none', ...style }}
    >
      {title ? <title>{title}</title> : null}
      {desenhos[name]}
    </svg>
  );
}
