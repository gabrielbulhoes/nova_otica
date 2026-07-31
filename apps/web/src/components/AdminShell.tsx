import { useEffect, useState } from 'react';
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

/** Console administrativo: janela de papel com barra lateral, titlebar e dock. */
export function AdminShell() {
  const { user, isAdmin, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const { tema, alternar } = useTemaDoConsole();
  useLiveInvalidation();

  const visible = links.filter((l) => !l.adminOnly || isAdmin);
  const active =
    [...visible]
      .sort((a, b) => b.to.length - a.to.length)
      .find((l) => (l.end ? location.pathname === l.to : location.pathname.startsWith(l.to)))?.label ??
    'Painel';

  return (
    // O escuro cobre a janela inteira do console porque a escolha é do usuário e
    // vale para tudo o que ele está operando. Em claro o atributo NÃO é escrito:
    // ausência de `data-tema` é o estado padrão, e é o que o seletor CSS espera.
    <div className="macos-desktop" data-tema={tema === 'escuro' ? 'escuro' : undefined}>
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
            <ScopePicker />
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
              <span
                className="label"
                style={{ display: 'flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap' }}
              >
                <span className="dot green" aria-hidden="true" /> Dados ao vivo
              </span>
              {/* O rótulo nomeia a AÇÃO ("Tema escuro" = passar para o escuro), e
                  é texto visível: serve de nome acessível e de indicação de
                  estado sem depender de cor nenhuma. */}
              <button
                type="button"
                className="btn ghost sm"
                onClick={alternar}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 7,
                  whiteSpace: 'nowrap',
                }}
              >
                <Icon name="ideia" size={15} />
                {tema === 'escuro' ? 'Tema claro' : 'Tema escuro'}
              </button>
            </div>
          </div>
          <main className="main">
            <Outlet />
          </main>

          <div className="dock">
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
        </section>
      </div>
    </div>
  );
}
