import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { useAuth } from './auth/AuthContext';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { Stock } from './pages/Stock';
import { Products } from './pages/Products';
import { Movements } from './pages/Movements';
import { Sales } from './pages/Sales';
import { Stores } from './pages/Stores';
import { Sync } from './pages/Sync';
import { Reports } from './pages/Reports';
import { Alerts } from './pages/Alerts';

// A página de BI carrega o ECharts (pesado) sob demanda — code-splitting.
const BI = lazy(() => import('./pages/BI').then((m) => ({ default: m.BI })));

function RequireAuth({ children }: { children: JSX.Element }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="empty">Carregando…</div>;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/"
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route index element={<Dashboard />} />
        <Route
          path="bi"
          element={
            <Suspense fallback={<div className="empty">Carregando BI…</div>}>
              <BI />
            </Suspense>
          }
        />
        <Route path="estoque" element={<Stock />} />
        <Route path="produtos" element={<Products />} />
        <Route path="transferencias" element={<Movements />} />
        <Route path="alertas" element={<Alerts />} />
        <Route path="relatorios" element={<Reports />} />
        <Route path="vendas" element={<Sales />} />
        <Route path="lojas" element={<Stores />} />
        <Route path="sincronizacao" element={<Sync />} />
        <Route path="*" element={<div className="empty">Página não encontrada.</div>} />
      </Route>
    </Routes>
  );
}
