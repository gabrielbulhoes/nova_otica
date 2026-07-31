import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

/**
 * Recorte de produto do console (feedback do Galbe, 29/07: "ainda continua
 * puxando lentes").
 *
 * Lente e tratamento são do setor de produção — o laboratório — e terão módulo
 * próprio. Até lá eles saem do caminho das telas de operação, mas NÃO somem do
 * sistema: são estoque real (o print do Galbe mostrava 56 un. de um
 * antirreflexo). O recorte é padrão, visível no topo e reversível em um clique.
 *
 * Um controle só, no shell, em vez de um filtro repetido em cinco telas: a
 * pergunta "estou olhando o quê?" tem uma resposta só por sessão.
 */
export type Scope = 'principal' | 'lentes' | 'todos';

export const SCOPE_LABEL: Record<Scope, string> = {
  principal: 'Óculos, armações e relógios',
  lentes: 'Lentes e tratamentos',
  todos: 'Tudo',
};

export const SCOPE_HINT: Record<Scope, string> = {
  principal: 'Lentes e tratamentos ficam de fora — são do laboratório e terão módulo próprio.',
  lentes: 'Só lentes e tratamentos — a prévia do módulo do laboratório.',
  todos: 'Catálogo inteiro, lentes e tratamentos inclusos.',
};

const KEY = 'novaotica.scope';

interface Ctx {
  scope: Scope;
  setScope: (s: Scope) => void;
}
const ScopeContext = createContext<Ctx>({ scope: 'principal', setScope: () => {} });

export function ScopeProvider({ children }: { children: ReactNode }) {
  const [scope, setScope] = useState<Scope>(() => {
    const saved = typeof localStorage !== 'undefined' ? localStorage.getItem(KEY) : null;
    return saved === 'lentes' || saved === 'todos' ? saved : 'principal';
  });
  useEffect(() => {
    try { localStorage.setItem(KEY, scope); } catch { /* modo privado */ }
  }, [scope]);
  const value = useMemo(() => ({ scope, setScope }), [scope]);
  return <ScopeContext.Provider value={value}>{children}</ScopeContext.Provider>;
}

export const useScope = () => useContext(ScopeContext);

/** Seletor do recorte, para o topo do console. */
export function ScopePicker() {
  const { scope, setScope } = useScope();
  return (
    <div className="segmented sm" title={SCOPE_HINT[scope]} aria-label="Recorte de produto">
      {(['principal', 'lentes', 'todos'] as Scope[]).map((s) => (
        <button
          key={s}
          className={scope === s ? 'active' : ''}
          aria-pressed={scope === s}
          onClick={() => setScope(s)}
        >
          {s === 'principal' ? 'Óculos e relógios' : s === 'lentes' ? 'Lentes' : 'Tudo'}
        </button>
      ))}
    </div>
  );
}
