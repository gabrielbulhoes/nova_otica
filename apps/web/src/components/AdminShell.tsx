import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { useLiveInvalidation } from '../hooks/useLiveInvalidation';

const dockItems = [
  { to: '/admin', icon: '🏠', label: 'Dashboard', end: true },
  { to: '/admin/bi', icon: '📊', label: 'BI' },
  { to: '/admin/estoque', icon: '📦', label: 'Estoque' },
  { to: '/admin/planejamento', icon: '🛒', label: 'Compras' },
  { to: '/admin/transferencias', icon: '🔁', label: 'Transferências' },
  { to: '/admin/alertas', icon: '🔔', label: 'Alertas' },
  { to: '/loja', icon: '🕶️', label: 'Loja online' },
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
  { to: '/admin/planejamento', label: 'Planejamento & Compras' },
  { to: '/admin/vendas', label: 'Vendas' },
  { to: '/admin/lojas', label: 'Lojas', adminOnly: true },
  { to: '/admin/sincronizacao', label: 'Sincronização', adminOnly: true },
];

/** Console administrativo no estilo macOS (janela + sidebar translúcida). */
export function AdminShell() {
  const { user, isAdmin, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  useLiveInvalidation();

  const visible = links.filter((l) => !l.adminOnly || isAdmin);
  const active =
    [...visible]
      .sort((a, b) => b.to.length - a.to.length)
      .find((l) => (l.end ? location.pathname === l.to : location.pathname.startsWith(l.to)))?.label ??
    'Painel';

  return (
    <div className="macos-desktop">
      <div className="macos-window">
        <aside className="sidebar">
          <div className="traffic">
            <i className="r" />
            <i className="y" />
            <i className="g" />
          </div>
          <div className="brand">
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

          <div style={{ marginTop: 'auto', paddingTop: 14 }}>
            <div className="card" style={{ padding: 12, boxShadow: 'none' }}>
              <div style={{ fontWeight: 600, fontSize: 13 }}>{user?.name}</div>
              <div className="muted" style={{ fontSize: 11, marginBottom: 8 }}>
                {isAdmin ? 'Gestor da rede' : user?.storeName ?? 'Gestor de loja'}
              </div>
              <button className="btn ghost sm" style={{ width: '100%' }} onClick={logout}>
                Sair
              </button>
            </div>
          </div>
        </aside>

        <section className="window-main">
          <div className="titlebar">
            <span className="title">{active}</span>
            <span className="muted" style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
              <span className="dot green" /> ao vivo
            </span>
          </div>
          <main className="main">
            <Outlet />
          </main>

          <div className="dock">
            {dockItems.map((d) => {
              const active = d.end ? location.pathname === d.to : location.pathname.startsWith(d.to);
              return (
                <button
                  key={d.to}
                  className={active ? 'active' : ''}
                  title={d.label}
                  onClick={() => navigate(d.to)}
                >
                  {d.icon}
                </button>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}
