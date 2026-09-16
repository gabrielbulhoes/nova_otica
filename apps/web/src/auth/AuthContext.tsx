import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useCallback } from 'react';
import {
  clearToken,
  getMe,
  getToken,
  login as apiLogin,
  salvarPreferencias as apiSalvarPreferencias,
  setToken,
  type AuthUser,
} from '../api/client';
import {
  normalizarPreferencias,
  PREFERENCIAS_PADRAO,
  type PreferenciasDeInterface,
} from '../lib/preferencias';

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  isAdmin: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  /** Preferências de interface do usuário (rodada final · item 01). */
  preferencias: PreferenciasDeInterface;
  /**
   * Aplica a mudança na hora e grava no servidor. Otimista de propósito: o
   * gesto é de layout, e esperar a rede para mover uma barra faria o clique
   * parecer perdido. Se a gravação falhar, o estado anterior volta — o que
   * não pode acontecer é a tela mostrar um layout e o servidor guardar outro.
   */
  salvarPreferencias: (mudanca: Partial<PreferenciasDeInterface>) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [preferencias, setPreferencias] = useState<PreferenciasDeInterface>(PREFERENCIAS_PADRAO);

  useEffect(() => {
    if (!getToken()) {
      setLoading(false);
      return;
    }
    getMe()
      .then((u) => {
        setUser(u);
        setPreferencias(normalizarPreferencias(u.preferences));
      })
      .catch(() => clearToken())
      .finally(() => setLoading(false));
  }, []);

  const salvarPreferencias = useCallback(async (mudanca: Partial<PreferenciasDeInterface>) => {
    let anterior: PreferenciasDeInterface = PREFERENCIAS_PADRAO;
    setPreferencias((atual) => {
      anterior = atual;
      return { ...atual, ...mudanca };
    });
    try {
      const gravado = await apiSalvarPreferencias(mudanca as Record<string, unknown>);
      setPreferencias(normalizarPreferencias(gravado));
    } catch {
      setPreferencias(anterior);
    }
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      loading,
      isAdmin: user?.role === 'ADMIN',
      login: async (email, password) => {
        const { token, user: u } = await apiLogin(email, password);
        setToken(token);
        setUser(u);
        setPreferencias(normalizarPreferencias(u.preferences));
      },
      logout: () => {
        clearToken();
        setUser(null);
        // A preferência é DO USUÁRIO: sair devolve a casca ao padrão para que
        // o próximo login não herde o layout de quem saiu.
        setPreferencias(PREFERENCIAS_PADRAO);
      },
      preferencias,
      salvarPreferencias,
    }),
    [user, loading, preferencias, salvarPreferencias],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth deve ser usado dentro de AuthProvider');
  return ctx;
}
