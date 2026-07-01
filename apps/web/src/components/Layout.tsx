import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { useLiveInvalidation } from '../hooks/useLiveInvalidation';

interface LinkDef {
  to: string;
  label: string;
  end?: boolean;
  adminOnly?: boolean;
}

const links: LinkDef[] = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/bi', label: 'BI' },
  { to: '/estoque', label: 'Estoque' },
  { to: '/produtos', label: 'Produtos' },
  { to: '/transferencias', label: 'Transferências' },
  { to: '/alertas', label: 'Alertas' },
  { to: '/relatorios', label: 'Relatórios' },
  { to: '/vendas', label: 'Vendas' },
  { to: '/lojas', label: 'Lojas', adminOnly: true },
  { to: '/sincronizacao', label: 'Sincronização', adminOnly: true },
];

export function Layout() {
  const { user, isAdmin, logout } = useAuth();
  const visible = links.filter((l) => !l.adminOnly || isAdmin);
  useLiveInvalidation(); // liga o tempo real (SSE) enquanto autenticado

  return (
    <div className="app">
      <aside className="sidebar">
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

        <div style={{ marginTop: 'auto', paddingTop: 16 }}>
          <div className="card" style={{ padding: 12 }}>
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
      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}
