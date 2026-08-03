import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { useLiveInvalidation } from '../hooks/useLiveInvalidation';
import { ScopePicker, SCOPE_LABEL, useScope } from '../lib/scope';
import { Mark } from '../brand/Brand';
import { Icon, type IconName } from '../brand/Icon';
import { moduloDaRota, paginaDaRota, ROTA_CENTRAL } from '../lib/modulos';

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
  // A Central abre o dock: voltar para a visão dos módulos é um clique de
  // qualquer tela, sem depender do caminho de volta na barra lateral.
  { to: '/admin', icon: 'marca', label: 'Central de operações', end: true },
  { to: '/admin/dashboard', icon: 'painel', label: 'Painel' },
  { to: '/admin/bi', icon: 'indicadores', label: 'BI' },
  { to: '/admin/estoque', icon: 'estoque', label: 'Estoque' },
  { to: '/admin/decisoes', icon: 'decisoes', label: 'Decisões' },
  { to: '/admin/estrategia', icon: 'estrategia', label: 'Estratégia' },
  { to: '/admin/planejamento', icon: 'compras', label: 'Compras' },
  { to: '/admin/transferencias', icon: 'transferencias', label: 'Transferências' },
  { to: '/admin/alertas', icon: 'alertas', label: 'Alertas' },
  { to: '/loja', icon: 'loja', label: 'Loja online' },
];

/*
   A LISTA DE 15 LINKS SAIU DAQUI.
   Ela virou o mapa de módulos em src/lib/modulos.ts, e a barra lateral passou a
   ser CONTEXTUAL: na Central não mostra link nenhum (os cartões são a
   navegação), e dentro de um módulo mostra só as páginas daquele módulo — no
   máximo quatro. Era essa lista que, no celular, ocupava cinco linhas de
   rótulos antes de qualquer conteúdo.
   As rotas não mudaram: quem tinha um link salvo continua chegando.
*/

/* ─── Tema: CLARO, FIXO, EM TODAS AS PÁGINAS ──────────────────────────────────
   O produto passa a ter UMA aparência — o branco-papel do NANOFLOW, que é o
   padrão do manual: superfície de papel, filete de 1px, canto reto e o ouro
   como único acento. Aqui moravam o alternador (`useTemaDoConsole`) e a chave
   de preferência `novaotica.tema`; os dois saíram, junto com o botão da barra
   de título. Nenhuma casca escreve mais `data-tema`, e a ausência do atributo É
   o tema claro.

   Por que fixar em vez de manter a opção: a escolha ficava gravada no
   navegador, então bastava um clique de alguém, uma vez, para a demonstração
   seguinte abrir preta — uma marca diferente da que o cliente aprovou, na
   primeira tela que ele vê. Nenhuma linha consulta `prefers-color-scheme`: o
   tema do sistema operacional do gerente nunca decidiu isto, e continua sem
   decidir.

   O escuro NÃO foi apagado, só desligado. Os blocos `[data-tema='escuro']` de
   styles.css seguem intactos e `bi/transforms.ts` continua sabendo montar as
   duas paletas; como ninguém escreve o atributo, esse caminho fica dormente.
   Reativar é voltar a escrever `data-tema` — não reescrever o tema.
   ─────────────────────────────────────────────────────────────────────────── */

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
  useLiveInvalidation();

  // Quem rola é .main (a janela tem altura fixa e o conteúdo rola dentro dela),
  // então é nele que o dock escuta — não em window.
  const conteudoRef = useRef<HTMLElement>(null);
  const dock = useDockDaRolagem(conteudoRef, location.pathname);

  const { scope } = useScope();

  /*
     Onde estamos: qual módulo e qual página. Na Central `modulo` é null — é a
     raiz da navegação, não pertence a módulo nenhum.
  */
  const modulo = moduloDaRota(location.pathname);
  const naCentral = location.pathname === ROTA_CENTRAL;
  const paginasDoModulo = (modulo?.paginas ?? []).filter((p) => !p.adminOnly || isAdmin);
  const active = naCentral
    ? 'Central de operações'
    : paginaDaRota(location.pathname)?.label ?? modulo?.nome ?? 'Central de operações';

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
    // Sem `data-tema`: a ausência do atributo É o tema claro, o padrão do
    // produto e agora o único (ver o bloco "Tema", no topo do arquivo).
    <div className="macos-desktop">
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
          {/*
             NAVEGAÇÃO CONTEXTUAL.
             Na Central não há link nenhum: os cartões SÃO a navegação, e
             repetir os módulos aqui seria a mesma lista de antes com outro
             nome. Dentro de um módulo aparecem só as páginas dele, precedidas
             do caminho de volta — no máximo cinco paradas de Tab, contra as 15
             de antes.

             A dica não diz "ao lado" nem "abaixo": no celular a barra vira
             cabeçalho e os cartões passam a ficar embaixo — a frase tem de
             valer nas duas larguras.
          */}
          {naCentral ? (
            <p className="sidebar-dica">
              Escolha um módulo para entrar. Os atalhos do dock levam direto às
              telas do dia a dia.
            </p>
          ) : (
            <nav className="sidebar-modulo" aria-label={`Telas de ${modulo?.nome ?? 'módulo'}`}>
              <NavLink to={ROTA_CENTRAL} end className="nav-voltar">
                <span className="nav-voltar-seta" aria-hidden="true">&#8592;</span>
                Central de operações
              </NavLink>
              {modulo && (
                <p className="eyebrow sidebar-modulo-nome">
                  <Icon name={modulo.icone} size={14} aria-hidden="true" />
                  {modulo.nome}
                </p>
              )}
              {paginasDoModulo.map((p) => (
                <NavLink
                  key={p.to}
                  to={p.to}
                  end={p.end}
                  className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
                >
                  {p.label}
                </NavLink>
              ))}
            </nav>
          )}

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
              {/* Aqui ficava o alternador de tema. Saiu junto com a decisão de
                  fixar o claro em todo o produto: um controle que não tem mais
                  dois estados é ruído na barra — e, na prática, um jeito de a
                  demonstração abrir com uma aparência diferente da aprovada.
                  O CSS do escuro segue no lugar, apenas dormente. */}
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
            {/* Cabeçalho DE PAPEL. Os cinco relatórios saíam da impressora com
                texto de capa idêntico — o nome do relatório mora num
                `.segmented`, que o `@media print` esconde —, e nenhuma folha
                dizia de que rede era, de que recorte, nem de quando. Um maço
                sem isso não se recompõe depois de cair no chão. Só aparece no
                papel; em tela não ocupa um pixel. */}
            <div className="print-only cabecalho-papel" aria-hidden="true">
              A GRACIOSA · Nova Ótica · {active} · recorte: {SCOPE_LABEL[scope]}
            </div>
            <Outlet />
          </main>

        </section>
      </div>
    </div>
  );
}
