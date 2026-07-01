import { Routes, Route } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Dashboard } from './pages/Dashboard';
import { Stock } from './pages/Stock';
import { Products } from './pages/Products';
import { Movements } from './pages/Movements';
import { Sales } from './pages/Sales';
import { Stores } from './pages/Stores';
import { Sync } from './pages/Sync';

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="estoque" element={<Stock />} />
        <Route path="produtos" element={<Products />} />
        <Route path="transferencias" element={<Movements />} />
        <Route path="vendas" element={<Sales />} />
        <Route path="lojas" element={<Stores />} />
        <Route path="sincronizacao" element={<Sync />} />
        <Route path="*" element={<div className="empty">Página não encontrada.</div>} />
      </Route>
    </Routes>
  );
}
