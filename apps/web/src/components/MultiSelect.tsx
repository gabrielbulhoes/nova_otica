import { useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { Icon } from '../brand/Icon';

export interface MultiOption {
  value: string;
  label: string;
}

/**
 * Filtro clicável de múltipla escolha (lojas, categorias…): botão no estilo dos
 * selects que abre uma lista de opções marcáveis. Vazio = "todas".
 *
 * TECLADO — este componente é a toolbar de metade do console, então precisa ser
 * operável sem mouse. O contrato implementado aqui é o de listbox da WAI-ARIA:
 *
 *   no gatilho    Enter/Espaço abre e fecha · ↓ abre na primeira opção ·
 *                 ↑ abre na última
 *   na lista      ↑ ↓ percorrem (circulando nas pontas) · Home/Fim vão às
 *                 pontas · Enter/Espaço marcam e desmarcam sem fechar (é
 *                 múltipla escolha: fechar a cada clique obrigaria a reabrir) ·
 *                 Esc fecha e devolve o foco ao gatilho · Tab sai do filtro
 *
 * O foco anda por FOCO REAL (tabindex rotativo), não por aria-activedescendant:
 * assim o anel de foco do sistema — 2px em --ouro-dark, que passa o mínimo de
 * 3:1 para componente — é desenhado pelo navegador na opção certa, sem precisar
 * de estilo próprio que poderia divergir do resto do console.
 */
export function MultiSelect({
  options,
  selected,
  onChange,
  allLabel,
  noun,
}: {
  options: MultiOption[];
  selected: string[];
  onChange: (values: string[]) => void;
  /** Rótulo quando nada está selecionado (ex.: "Todas as lojas"). */
  allLabel: string;
  /** Substantivo plural para o contador (ex.: "lojas" → "3 lojas"). */
  noun: string;
}) {
  const [aberto, setAberto] = useState(false);
  /** Índice que detém o foco na lista. null = ninguém ainda (abertura por mouse). */
  const [indiceAtivo, setIndiceAtivo] = useState<number | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const gatilhoRef = useRef<HTMLButtonElement>(null);
  const opcoesRef = useRef<(HTMLButtonElement | null)[]>([]);
  const idLista = useId();

  const fechar = (devolverFoco: boolean) => {
    setAberto(false);
    setIndiceAtivo(null);
    if (devolverFoco) gatilhoRef.current?.focus();
  };

  useEffect(() => {
    if (!aberto) return;
    const aoClicarFora = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) fechar(false);
    };
    const aoTeclar = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Só devolve o foco ao gatilho se o foco estava dentro do filtro. Esc
      // apertado em outro ponto da tela fecha o menu, mas não pode roubar o
      // foco de quem o tem.
      fechar(!!rootRef.current?.contains(document.activeElement));
    };
    document.addEventListener('mousedown', aoClicarFora);
    document.addEventListener('keydown', aoTeclar);
    return () => {
      document.removeEventListener('mousedown', aoClicarFora);
      document.removeEventListener('keydown', aoTeclar);
    };
  }, [aberto]);

  // O foco é movido em efeito, e não dentro do handler, porque a opção de
  // destino pode ainda não existir no DOM no instante em que a lista abre.
  useEffect(() => {
    if (aberto && indiceAtivo !== null) opcoesRef.current[indiceAtivo]?.focus();
  }, [aberto, indiceAtivo]);

  const alternar = (value: string) =>
    onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value]);

  const mover = (destino: 1 | -1 | 'inicio' | 'fim') => {
    if (options.length === 0) return;
    setIndiceAtivo((atual) => {
      if (destino === 'inicio') return 0;
      if (destino === 'fim') return options.length - 1;
      const base = atual ?? (destino > 0 ? -1 : 0);
      return (base + destino + options.length) % options.length;
    });
  };

  const aoTeclarNaOpcao = (e: KeyboardEvent<HTMLButtonElement>) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        mover(1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        mover(-1);
        break;
      case 'Home':
        e.preventDefault();
        mover('inicio');
        break;
      case 'End':
        e.preventDefault();
        mover('fim');
        break;
      case 'Tab':
        // Devolve o foco ao gatilho ANTES de o Tab padrão acontecer: o navegador
        // calcula o próximo elemento a partir de quem está focado no momento da
        // ação, então a tabulação segue para o controle seguinte da toolbar em
        // vez de cair no <body> quando a lista desmonta.
        fechar(true);
        break;
      default:
        break;
    }
  };

  const rotulo =
    selected.length === 0
      ? allLabel
      : selected.length === 1
        ? options.find((o) => o.value === selected[0])?.label ?? allLabel
        : `${selected.length} ${noun}`;

  const temOpcoes = options.length > 0;

  return (
    <div className="mselect" ref={rootRef}>
      <button
        ref={gatilhoRef}
        type="button"
        className={`mselect-btn ${selected.length > 0 ? 'active' : ''}`}
        onClick={() => {
          setAberto((v) => !v);
          setIndiceAtivo(null);
        }}
        onKeyDown={(e) => {
          if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
          if (!temOpcoes) return;
          e.preventDefault();
          setAberto(true);
          setIndiceAtivo(e.key === 'ArrowDown' ? 0 : options.length - 1);
        }}
        aria-haspopup="listbox"
        aria-expanded={aberto}
        aria-controls={aberto && temOpcoes ? idLista : undefined}
        // O texto visível é o VALOR do filtro ("3 lojas"), que sozinho não diz
        // do que se trata. O nome acessível começa por ele — exigência de 2.5.3,
        // rótulo visível contido no nome — e completa com a finalidade.
        aria-label={`${rotulo} — filtro de ${noun}`}
      >
        <span className="mselect-label">{rotulo}</span>
        <span className="mselect-caret">
          {/* Era o glifo ▾ escrito como texto: mudava de largura conforme a
              fonte instalada e desalinhava o campo. */}
          <Icon name={aberto ? 'chevron-cima' : 'chevron-baixo'} size={14} />
        </span>
      </button>

      {aberto && (
        <div className="mselect-pop">
          {temOpcoes ? (
            // role="listbox" mora na lista, não no popover: os filhos de um
            // listbox só podem ser opções, e o popover também abriga o rodapé
            // "Limpar".
            <div
              className="mselect-list"
              role="listbox"
              id={idLista}
              aria-multiselectable="true"
              aria-label={`Opções de ${noun}`}
            >
              {options.map((o, i) => {
                const marcada = selected.includes(o.value);
                return (
                  <button
                    key={o.value}
                    ref={(el) => {
                      opcoesRef.current[i] = el;
                    }}
                    type="button"
                    role="option"
                    aria-selected={marcada}
                    // Tabindex rotativo: a lista inteira é UMA parada de
                    // tabulação. Sem isso, filtrar 19 lojas custaria 19 Tabs.
                    tabIndex={(indiceAtivo ?? 0) === i ? 0 : -1}
                    className={`mselect-opt ${marcada ? 'checked' : ''}`}
                    onFocus={() => setIndiceAtivo(i)}
                    onClick={() => alternar(o.value)}
                    onKeyDown={aoTeclarNaOpcao}
                  >
                    {/* aria-hidden: quem comunica a marcação ao leitor de tela é
                        aria-selected. O ✓ desenhado é o canal visual. */}
                    <span className="mselect-check" aria-hidden="true">
                      {marcada && <Icon name="check" size={11} />}
                    </span>
                    <span>{o.label}</span>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="mselect-empty">Sem opções.</div>
          )}

          {selected.length > 0 && (
            <div className="mselect-actions">
              <button
                type="button"
                onClick={() => {
                  onChange([]);
                  // Este botão desaparece junto com a seleção que ele acabou de
                  // limpar. Sem realocar o foco, ele iria para o <body> e o
                  // teclado perderia o lugar; então volta para a lista, ou para
                  // o gatilho se não houver lista.
                  const primeira = opcoesRef.current[0];
                  if (primeira) {
                    primeira.focus();
                    setIndiceAtivo(0);
                  } else {
                    fechar(true);
                  }
                }}
              >
                Limpar ({selected.length})
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
