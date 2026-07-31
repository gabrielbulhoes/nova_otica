import {
  createContext,
  useContext,
  useEffect,
  useId,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { Icon } from '../brand/Icon';

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

/**
 * Texto curto do chip. É diferente de SCOPE_LABEL de propósito: o rótulo longo
 * ("Óculos, armações e relógios") é para relatório e cabeçalho de página; na
 * titlebar ele empurraria os outros controles para fora da barra.
 */
const SCOPE_CHIP: Record<Scope, string> = {
  principal: 'Óculos e relógios',
  lentes: 'Lentes',
  todos: 'Tudo',
};

/** useId() devolve ":r3:" — legal como id, mas os dois-pontos quebram seletor CSS. */
const idLimpo = (bruto: string) => bruto.replace(/[^a-zA-Z0-9]/g, '');

/**
 * Seletor do recorte, para a titlebar do console.
 *
 * `className` existe porque a casca precisa marcar ESTE controle na barra
 * (`.titlebar .scope-picker { flex: none }` — o recorte é o último item que pode
 * encolher). Sem a prop, a classe escrita no AdminShell não chegava ao DOM e a
 * regra da Onda 4 não casava com nada: o seletor voltava a ser espremido a 2px
 * em telas estreitas, e o build parava no tipo.
 */
export function ScopePicker({ className }: { className?: string }) {
  const { scope, setScope } = useScope();
  const idRotulo = `recorte-${idLimpo(useId())}`;

  return (
    <div
      className={className}
      style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}
    >
      {/* Antes o controle só tinha aria-label: quem enxerga via três chips sem
          nome e não sabe o que eles recortam. O rótulo agora é visível, em mono
          caixa alta (.label), e é ELE que nomeia o grupo — o nome acessível
          passa a ser a mesma palavra que está na tela. */}
      <span className="label" id={idRotulo}>
        Recorte
      </span>
      <div className="segmented sm" role="group" aria-labelledby={idRotulo} title={SCOPE_HINT[scope]}>
        {(['principal', 'lentes', 'todos'] as Scope[]).map((s) => {
          const ativo = scope === s;
          return (
            <button
              key={s}
              type="button"
              className={ativo ? 'active' : ''}
              aria-pressed={ativo}
              onClick={() => setScope(s)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
            >
              {/* Segundo canal para o estado ativo, além da inversão de fundo: a
                  marca de conferido é FORMA, sobrevive ao P&B e ao monitor mal
                  calibrado da loja. Fica sempre no fluxo, só invisível quando o
                  chip está inativo, para a largura do controle não pular a cada
                  troca de recorte. */}
              <Icon name="check" size={11} style={{ opacity: ativo ? 1 : 0 }} />
              {SCOPE_CHIP[s]}
            </button>
          );
        })}
      </div>
    </div>
  );
}
