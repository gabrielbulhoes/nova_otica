import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { useLiveInvalidation } from '../hooks/useLiveInvalidation';

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
  { to: '/admin/vendas', label: 'Vendas' },
  { to: '/admin/lojas', label: 'Lojas', adminOnly: true },
  { to: '/admin/sincronizacao', label: 'Sincronização', adminOnly: true },
];

/** Console administrativo no estilo macOS (janela + sidebar translúcida). */
export function AdminShell() {
  const { user, isAdmin, logout } = useAuth();
  const location = useLocation();
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
        </section>
      </div>
    </div>
  );
}
