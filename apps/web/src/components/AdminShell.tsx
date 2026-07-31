import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { useLiveInvalidation } from '../hooks/useLiveInvalidation';
import { ScopePicker } from '../lib/scope';
import { Mark } from '../brand/Brand';
import { Icon, type IconName } from '../brand/Icon';

interface DockItem {
  to: string;
  icon: IconName;
  label: string;
  end?: boolean;
}

/**
 * Dock: atalho para as nove telas de uso diário.
 *
 * O ícone saiu de emoji para a grade 24 do manual. Emoji não é ícone de
 * produto: cada sistema operacional desenha o seu, ignora a cor da marca e muda
 * de largura — num dock de 42px isso desalinha a fileira inteira e o console
 * passa a parecer outro produto em cada máquina da rede.
 */
const dockItems: DockItem[] = [
  { to: '/admin', icon: 'painel', label: 'Dashboard', end: true },
  { to: '/admin/bi', icon: 'indicadores', label: 'BI' },
  { to: '/admin/estoque', icon: 'estoque', label: 'Estoque' },
  { to: '/admin/decisoes', icon: 'decisoes', label: 'Decisões' },
  { to: '/admin/estrategia', icon: 'estrategia', label: 'Estratégia' },
  { to: '/admin/planejamento', icon: 'compras', label: 'Compras' },
  { to: '/admin/transferencias', icon: 'transferencias', label: 'Transferências' },
  { to: '/admin/alertas', icon: 'alertas', label: 'Alertas' },
  { to: '/loja', icon: 'loja', label: 'Loja online' },
];

interface LinkDef {
  to: string;
  label: string;
  end?: boolean;
  adminOnly?: boolean;
}

const links: LinkDef[] = [
  { to: '/admin', label: 'Dashboard', end: true },
  { to: '/admin/bi', label: 'BI' },
  { to: '/admin/estoque', label: 'Estoque' },
  { to: '/admin/produtos', label: 'Produtos' },
  { to: '/admin/transferencias', label: 'Transferências' },
  { to: '/admin/alertas', label: 'Alertas' },
  { to: '/admin/relatorios', label: 'Relatórios' },
  { to: '/admin/decisoes', label: 'Decisões (cards)' },
  { to: '/admin/historico', label: 'Histórico Geral' },
  { to: '/admin/estrategia', label: 'Estratégia comercial' },
  { to: '/admin/planejamento', label: 'Planejamento & Compras' },
  { to: '/admin/vendas', label: 'Vendas' },
  { to: '/admin/usuarios', label: 'Usuários', adminOnly: true },
  { to: '/admin/lojas', label: 'Lojas', adminOnly: true },
  { to: '/admin/sincronizacao', label: 'Sincronização', adminOnly: true },
];

// ─── Tema ───────────────────────────────────────────────────────────────────

export type Tema = 'claro' | 'escuro';

/** Chave única da preferência. Outras cascas devem ler ESTA, não inventar outra. */
export const CHAVE_TEMA = 'novaotica.tema';

/**
 * Tema do console — decisão do USUÁRIO, nunca do sistema operacional.
 *
 * Nenhuma linha daqui consulta `prefers-color-scheme`, de propósito: o manual
 * põe o branco-papel como padrão do produto e trata o escuro como opção. Um
 * console que abre preto porque o macOS do gerente está escuro entrega a marca
 * errada logo na primeira impressão — e é a primeira tela que o cliente vê.
 *
 * O atributo é escrito como PROP de um elemento renderizado pelo React, e não
 * com `setAttribute` no <html>: assim o DOM não tem como divergir do estado
 * (StrictMode montando duas vezes, outra casca sobrescrevendo na troca de rota,
 * dois efeitos disputando o mesmo nó). O <EChart> observa mutações de
 * `data-tema` na subárvore do documento, então recebe a troca do mesmo jeito.
 */
export function useTemaDoConsole() {
  const [tema, setTema] = useState<Tema>(() => {
    try {
      // Sem preferência gravada o valor é 'claro' — o padrão do produto.
      return localStorage.getItem(CHAVE_TEMA) === 'escuro' ? 'escuro' : 'claro';
    } catch {
      // Safari em navegação privada chega a lançar só na LEITURA do storage.
      return 'claro';
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(CHAVE_TEMA, tema);
    } catch {
      /* modo privado: a escolha vale para a sessão e não persiste */
    }
  }, [tema]);

  const alternar = () => setTema((atual) => (atual === 'escuro' ? 'claro' : 'escuro'));
  return { tema, alternar };
}

// ─── Dock que recolhe na rolagem ────────────────────────────────────────────

/** Rolagem mínima que conta como gesto (px). Abaixo disso é tremor de trackpad. */
const LIMIAR_ROLAGEM = 14;
/** Dentro desta faixa do topo o dock fica sempre aberto. */
const ZONA_DE_TOPO = 72;

/**
 * Recolhe o dock quando o usuário rola PARA BAIXO; devolve ele inteiro quando
 * rola para cima, quando volta ao topo, e sempre que o dock recebe ponteiro ou
 * foco. O dock flutua sobre o conteúdo, e a tela mais lida do console é uma
 * tabela longa — lendo o fim de uma linha, a régua de atalhos vira uma tarja
 * por cima do dado.
 *
 * Três decisões que não são detalhe:
 *
 * · O estado é do React e a classe sai do JSX. Escrever `classList` na mão a
 *   partir do listener criaria um segundo dono do mesmo nó — na primeira
 *   re-renderização por outra causa (troca de rota, tema, invalidação de
 *   query) o React repintaria o className e apagaria a classe silenciosamente.
 *
 * · O listener é PASSIVO e coalescido em requestAnimationFrame. O evento de
 *   rolagem chega dezenas de vezes por segundo e ler `scrollTop` força cálculo
 *   de layout; com um quadro por vez a conta acontece uma vez por pintura.
 *   Passivo porque este código nunca chama preventDefault, e avisar isso é o
 *   que mantém a rolagem por toque na thread do compositor.
 *
 * · O limiar acumula em vez de descartar: o ponto de referência só anda quando
 *   o gesto passa de LIMIAR_ROLAGEM. Sem isso, rolagens de 2px em 2px nunca
 *   passariam do limiar e o dock nunca reagiria; e sem limiar nenhum ele
 *   piscaria a cada pixel de tremor do trackpad.
 */
function useDockDaRolagem(alvoRef: RefObject<HTMLElement>, rota: string) {
  const [recolhido, setRecolhido] = useState(false);
  // Enquanto o foco de teclado está DENTRO do dock ele fica travado aberto:
  // quem navega por Tab não pode ver o alvo encolher debaixo do anel de foco.
  // Mora em ref, e não em estado, porque quem lê é o listener de rolagem — em
  // estado, o efeito teria de ser remontado a cada entrada e saída de foco.
  const focoDentro = useRef(false);
  const ultimoTopo = useRef(0);

  useEffect(() => {
    const alvo = alvoRef.current;
    if (!alvo) return;
    ultimoTopo.current = alvo.scrollTop;
    let quadro = 0;

    const avaliar = () => {
      quadro = 0;
      const topo = alvo.scrollTop;
      const delta = topo - ultimoTopo.current;
      if (Math.abs(delta) < LIMIAR_ROLAGEM) return;
      ultimoTopo.current = topo;
      if (focoDentro.current) return;
      setRecolhido(topo > ZONA_DE_TOPO && delta > 0);
    };

    const aoRolar = () => {
      if (quadro) return;
      quadro = requestAnimationFrame(avaliar);
    };

    alvo.addEventListener('scroll', aoRolar, { passive: true });
    return () => {
      alvo.removeEventListener('scroll', aoRolar);
      if (quadro) cancelAnimationFrame(quadro);
    };
  }, [alvoRef]);

  // Tela nova, dock aberto: o gesto de rolagem da tela anterior não fala pela
  // seguinte, e o conteúdo pode ter mudado de altura embaixo do mesmo scrollTop.
  useEffect(() => {
    setRecolhido(false);
    ultimoTopo.current = alvoRef.current?.scrollTop ?? 0;
  }, [rota, alvoRef]);

  const abrir = useCallback(() => setRecolhido(false), []);
  const aoFocar = useCallback(() => {
    focoDentro.current = true;
    setRecolhido(false);
  }, []);
  const aoDesfocar = useCallback(() => {
    focoDentro.current = false;
  }, []);

  return { recolhido, abrir, aoFocar, aoDesfocar };
}

/** Console administrativo: janela de papel com barra lateral, titlebar e dock. */
export function AdminShell() {
  const { user, isAdmin, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const { tema, alternar } = useTemaDoConsole();
  useLiveInvalidation();

  // Quem rola é .main (a janela tem altura fixa e o conteúdo rola dentro dela),
  // então é nele que o dock escuta — não em window.
  const conteudoRef = useRef<HTMLElement>(null);
  const dock = useDockDaRolagem(conteudoRef, location.pathname);

  const visible = links.filter((l) => !l.adminOnly || isAdmin);
  const active =
    [...visible]
      .sort((a, b) => b.to.length - a.to.length)
      .find((l) => (l.end ? location.pathname === l.to : location.pathname.startsWith(l.to)))?.label ??
    'Painel';

  /**
   * Rolagem NÃO vaza entre telas.
   *
   * Quem rola é `.main`, um contêiner interno, e a navegação por hash do
   * roteador é same-document: o React troca o conteúdo e o `scrollTop` do nó
   * fica onde estava. Medido: sair do Estoque a 6.000px e abrir Alertas deixava
   * o <h1> da tela nova em y = −218px, ou seja, a tela abria já rolada por cima
   * do próprio título; do dock para Decisões o scrollTop de 9.000px era
   * preservado inteiro. O navegador faz esse trabalho sozinho quando quem rola é
   * o documento — como aqui não é, o trabalho é nosso.
   *
   * `location.key` e não `pathname`: reabrir a MESMA rota (clicar de novo no
   * item já ativo, que é o gesto de "volta ao começo") também precisa voltar ao
   * topo, e o pathname não muda nesse caso.
   */
  useEffect(() => {
    conteudoRef.current?.scrollTo({ top: 0, left: 0 });
  }, [location.key]);

  /**
   * Título do documento por rota.
   *
   * As 17 rotas compartilhavam "Nova Ótica — Gestão de Estoque". Numa SPA o
   * leitor de tela usa a troca de <title> para anunciar que o usuário mudou de
   * tela; sem isso, navegar pelo dock é silêncio absoluto (falha 2.4.2). O nome
   * da rede vem depois do nome da tela porque é o começo da string que o leitor
   * anuncia primeiro e que aparece na aba estreita.
   */
  useEffect(() => {
    document.title = `${active} — Nova Ótica`;
  }, [active]);

  return (
    // O escuro cobre a janela inteira do console porque a escolha é do usuário e
    // vale para tudo o que ele está operando. Em claro o atributo NÃO é escrito:
    // ausência de `data-tema` é o estado padrão, e é o que o seletor CSS espera.
    <div className="macos-desktop" data-tema={tema === 'escuro' ? 'escuro' : undefined}>
      {/* Atalho para o conteúdo (WCAG 2.4.1). Medido: não havia UM skip link em
          17 rotas, e a casca cobra 20 paradas fixas de Tab (15 links da barra
          lateral + Sair + os 3 chips de recorte + o tema) antes que o teclado
          toque o conteúdo — em toda troca de tela. Só aparece ao receber foco. */}
      <a href="#conteudo" className="skip-link">
        Ir para o conteúdo
      </a>
      <div className="macos-window">
        <aside className="sidebar">
          {/* Sobrou UM marcador dos três semáforos do macOS: o CSS transformou o
              primeiro no símbolo da marca e não desenha mais os outros dois. */}
          <div className="traffic">
            <i className="r" />
          </div>
          <div className="brand">
            {/* `decorative`: o nome já está escrito ao lado, em texto. Sem isso o
                leitor de tela anunciaria "NANOFLOW Nova Ótica". No mobile o
                bloco .traffic some (media query) e esta marca é a única que
                sobra — mais uma razão para ela viver aqui, junto do nome. */}
            <Mark size={20} decorative style={{ marginRight: 9, verticalAlign: 'middle' }} />
            Nova<span>Ótica</span>
          </div>
          {visible.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              end={l.end}
              className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
            >
              {l.label}
            </NavLink>
          ))}

          {/* O style inline não é enfeite: `.sidebar > div[style]` é o seletor que
              reposiciona este bloco quando a barra vira cabeçalho no mobile. */}
          <div style={{ marginTop: 'auto', paddingTop: 14 }}>
            <div className="card" style={{ padding: 12, boxShadow: 'none' }}>
              <div style={{ fontWeight: 600, fontSize: 13 }}>{user?.name}</div>
              <div className="label" style={{ marginBottom: 8 }}>
                {isAdmin ? 'Gestor da rede' : user?.storeName ?? 'Gestor de loja'}
              </div>
              <button
                type="button"
                className="btn ghost sm"
                style={{
                  width: '100%',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 7,
                }}
                onClick={logout}
              >
                <Icon name="sair" size={15} />
                Sair
              </button>
            </div>
          </div>
        </aside>

        <section className="window-main">
          <div className="titlebar">
            <span className="title" style={{ whiteSpace: 'nowrap' }}>
              {active}
            </span>
            {/* Recorte de produto: uma escolha por sessão, sempre visível.
                Lente e tratamento saem por padrão (são do laboratório). */}
            <ScopePicker className="scope-picker" />
            <div
              style={{
                marginLeft: 'auto',
                display: 'flex',
                alignItems: 'center',
                gap: 14,
                flex: 'none',
              }}
            >
              {/* "Dados ao vivo" diz sozinho o que está acontecendo: o quadrado
                  verde é reforço visual, não o portador do significado — parte
                  dos usuários não separa os tons quentes entre si. */}
              {/* `title` no elemento inteiro: abaixo de 1204px o CSS esconde a
                  palavra para liberar largura, e sem isso o quadrado verde
                  ficaria sozinho, sem nome nenhum. */}
              <span
                className="label live-status"
                title="Dados ao vivo"
                style={{ display: 'flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap' }}
              >
                <span className="dot green" aria-hidden="true" />
                <span className="live-status-text">Dados ao vivo</span>
              </span>
              {/* O rótulo nomeia a AÇÃO ("Tema escuro" = passar para o escuro), e
                  é texto visível: serve de nome acessível e de indicação de
                  estado sem depender de cor nenhuma.
                  ONDA 4 · o botão não expunha ESTADO: sem aria-pressed e sem
                  role=switch, o rótulo sozinho é ambíguo — "Tema escuro" pode
                  ser lido como o estado atual ou como o destino, e ao acionar o
                  usuário recebia silêncio. Com aria-pressed o leitor de tela
                  anuncia "não pressionado → pressionado" na própria ativação,
                  sem precisar de uma região aria-live que ninguém mais usa.
                  O `aria-label` é explícito porque abaixo de 960px o CSS esconde
                  a palavra e sobra só o ícone. */}
              <button
                type="button"
                className="btn ghost sm"
                onClick={alternar}
                aria-pressed={tema === 'escuro'}
                aria-label={tema === 'escuro' ? 'Tema escuro ativo' : 'Tema escuro'}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 7,
                  whiteSpace: 'nowrap',
                }}
              >
                <Icon name="ideia" size={15} />
                <span className="rotulo-tema">
                  {tema === 'escuro' ? 'Tema claro' : 'Tema escuro'}
                </span>
              </button>
            </div>
          </div>
          {/* O DOCK VEM ANTES DO <main> NO DOM, e é de propósito.
              Ele é `position:absolute`, então a posição na tela não muda — o que
              muda é a ordem de tabulação. Medido: com o dock DEPOIS do conteúdo,
              chegar até ele em /admin/alertas custava 4.376 paradas de Tab
              (4.356 focáveis no corpo: 2.176 linhas × input + botão), 954 em
              /admin/decisoes e 100 em /admin/planejamento. Uma navegação global
              que só o mouse alcança não é navegação. Agora ela vem junto da
              barra de título, como a barra lateral, e quem quer o conteúdo pula
              pelo skip link do topo.
              Ponteiro e foco reabrem o dock. O ponteiro cobre também o toque:
              um dedo na faixa recolhida dispara pointerenter antes do
              pointerdown, e como os botões ficam sem pointer-events enquanto
              recolhidos, esse primeiro toque só expande — não navega.
              O foco entra pela captura para ganhar de qualquer handler dos
              botões: o usuário de teclado tem que ver o alvo antes de agir. */}
          <div
            className={dock.recolhido ? 'dock recolhido' : 'dock'}
            onPointerEnter={dock.abrir}
            onFocusCapture={dock.aoFocar}
            onBlurCapture={dock.aoDesfocar}
          >
            {dockItems.map((d) => {
              const selecionado = d.end
                ? location.pathname === d.to
                : location.pathname.startsWith(d.to);
              return (
                // No dock o ícone É o botão: o nome acessível fica no <button> e
                // o desenho entra decorativo (sem `title`), senão o leitor de
                // tela anuncia o mesmo rótulo duas vezes. `aria-current` dá a
                // posição atual a quem não enxerga o filete dourado embaixo.
                <button
                  key={d.to}
                  type="button"
                  className={selecionado ? 'active' : ''}
                  aria-label={d.label}
                  aria-current={selecionado ? 'page' : undefined}
                  onClick={() => navigate(d.to)}
                >
                  <Icon name={d.icon} size={22} />
                </button>
              );
            })}
          </div>

          {/* `id` é o alvo do skip link; `tabIndex={-1}` é o que permite ao
              <main> receber foco programaticamente quando o link é acionado —
              sem ele o navegador rola até a âncora mas o foco de teclado fica
              para trás, e o Tab seguinte volta para a barra lateral.
              `aria-label` nomeia a região: a auditoria não achou nenhuma região
              nomeada nas 17 rotas. */}
          <main
            className="main"
            id="conteudo"
            ref={conteudoRef}
            tabIndex={-1}
            aria-label={`Conteúdo — ${active}`}
          >
            <Outlet />
          </main>

        </section>
      </div>
    </div>
  );
}
