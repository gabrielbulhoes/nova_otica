import { useEffect, useRef, useState } from 'react';

export interface MultiOption {
  value: string;
  label: string;
}

/**
 * Filtro clicável de múltipla escolha (lojas, categorias…): botão no estilo
 * dos selects que abre uma lista de opções marcáveis. Vazio = "todas".
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
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const toggle = (value: string) =>
    onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value]);

  const label =
    selected.length === 0
      ? allLabel
      : selected.length === 1
        ? options.find((o) => o.value === selected[0])?.label ?? allLabel
        : `${selected.length} ${noun}`;

  return (
    <div className="mselect" ref={rootRef}>
      <button
        type="button"
        className={`mselect-btn ${selected.length > 0 ? 'active' : ''}`}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="mselect-label">{label}</span>
        <span className="mselect-caret" aria-hidden>
          ▾
        </span>
      </button>
      {open && (
        <div className="mselect-pop" role="listbox" aria-multiselectable>
          <div className="mselect-list">
            {options.map((o) => {
              const checked = selected.includes(o.value);
              return (
                <button
                  key={o.value}
                  type="button"
                  role="option"
                  aria-selected={checked}
                  className={`mselect-opt ${checked ? 'checked' : ''}`}
                  onClick={() => toggle(o.value)}
                >
                  <span className="mselect-check" aria-hidden>
                    {checked ? '✓' : ''}
                  </span>
                  <span>{o.label}</span>
                </button>
              );
            })}
            {options.length === 0 && <div className="mselect-empty">Sem opções.</div>}
          </div>
          {selected.length > 0 && (
            <div className="mselect-actions">
              <button type="button" onClick={() => onChange([])}>
                Limpar ({selected.length})
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
