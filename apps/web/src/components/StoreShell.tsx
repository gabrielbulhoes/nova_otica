import { Link, NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { useLiveInvalidation } from '../hooks/useLiveInvalidation';

/** Vitrine da loja online (estilo Apple Store): nav translúcida + conteúdo. */
export function StoreShell() {
  const { logout } = useAuth();
  useLiveInvalidation();

  return (
    <div className="store">
      <header className="store-nav">
        <Link to="/loja" className="brand">
          Nova<span style={{ color: 'var(--accent)' }}>Ótica</span>
        </Link>
        <nav>
          <NavLink to="/loja" end>
            Óculos
          </NavLink>
          <NavLink to="/loja/carrinho">Carrinho</NavLink>
          <Link to="/">Painel</Link>
          <a onClick={logout} style={{ cursor: 'pointer' }}>
            Sair
          </a>
        </nav>
      </header>
      <main className="store-main">
        <Outlet />
      </main>
    </div>
  );
}
