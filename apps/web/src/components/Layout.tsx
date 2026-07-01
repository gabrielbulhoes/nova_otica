import { NavLink, Outlet } from 'react-router-dom';

const links = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/estoque', label: 'Estoque' },
  { to: '/produtos', label: 'Produtos' },
  { to: '/transferencias', label: 'Transferências' },
  { to: '/vendas', label: 'Vendas' },
  { to: '/lojas', label: 'Lojas' },
  { to: '/sincronizacao', label: 'Sincronização' },
];

export function Layout() {
  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          Nova<span>Ótica</span>
        </div>
        {links.map((l) => (
          <NavLink
            key={l.to}
            to={l.to}
            end={l.end}
            className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
          >
            {l.label}
          </NavLink>
        ))}
      </aside>
      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}
