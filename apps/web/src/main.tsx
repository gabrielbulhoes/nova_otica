import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, HashRouter } from 'react-router-dom';
import { AppRoot } from './App';
import { AuthProvider } from './auth/AuthContext';
import './styles.css';

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false, staleTime: 10_000 } },
});

// VITE_HASH_ROUTER=1 usa HashRouter: o app roda em qualquer subdomínio/subpasta
// de hospedagem estática (ex.: HostGator) sem precisar de rewrite no servidor.
const useHash = import.meta.env.VITE_HASH_ROUTER === '1';
const basename = (import.meta.env.BASE_URL || '/').replace(/\/$/, '') || '/';

const Router = useHash ? HashRouter : BrowserRouter;
const routerProps = useHash ? {} : { basename };

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <Router {...routerProps}>
        <AuthProvider>
          <AppRoot />
        </AuthProvider>
      </Router>
    </QueryClientProvider>
  </React.StrictMode>,
);
