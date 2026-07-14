import type { ReactNode } from 'react';
import type { CoverageLevel } from '../api/client';
import { toCsv, downloadCsv, type CsvColumn } from '../bi/csv';

export function StatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <div className="card stat">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

export function PageHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div>
      <h1 className="page-title">{title}</h1>
      {subtitle && <p className="page-sub">{subtitle}</p>}
    </div>
  );
}

export function Loading() {
  return <div className="empty">Carregando…</div>;
}

export function ErrorState({ message }: { message?: string }) {
  return <div className="empty">Erro ao carregar dados. {message}</div>;
}

const movementStatus: Record<string, { label: string; cls: string }> = {
  REQUESTED: { label: 'Solicitada', cls: 'blue' },
  REJECTED: { label: 'Rejeitada', cls: 'red' },
  PENDING: { label: 'Aprovada/Pendente', cls: 'amber' },
  CONFIRMED: { label: 'Confirmada', cls: 'green' },
  CANCELLED: { label: 'Cancelada', cls: 'red' },
  RECONCILED: { label: 'Reconciliada', cls: 'gray' },
};

export function StatusBadge({ status }: { status: string }) {
  const s = movementStatus[status] ?? { label: status, cls: 'blue' };
  return <span className={`badge ${s.cls}`}>{s.label}</span>;
}

const movementType: Record<string, string> = {
  TRANSFER: 'Transferência',
  SALE: 'Venda',
  ADJUSTMENT: 'Ajuste',
  RETURN: 'Devolução',
};
export const movementTypeLabel = (t: string) => movementType[t] ?? t;

// ─── Cobertura de estoque (Dashboard e Relatórios usam o mesmo selo) ─────────

const coverageMeta: Record<CoverageLevel, { label: string; cls: string }> = {
  CRITICAL: { label: 'crítica', cls: 'red' },
  HEALTHY: { label: 'saudável', cls: 'green' },
  HIGH: { label: 'alta', cls: 'amber' },
  EXCESS: { label: 'excesso', cls: 'red' },
};

export const fmtMonths = (m: number | null) =>
  m === null ? 'sem venda' : `${m.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} meses`;

/** Selo "X meses · nível" da cobertura (crítica <1 · saudável ≤6 · alta ≤12 · excesso >12). */
export function CoverageBadge({ months, level }: { months: number | null; level: CoverageLevel }) {
  const meta = coverageMeta[level];
  return (
    <span className={`badge ${meta.cls}`}>
      {fmtMonths(months)} · {meta.label}
    </span>
  );
}

/** Botão "Exportar CSV" padronizado dos relatórios. */
export function ExportCsv<T>({
  rows,
  columns,
  filename,
}: {
  rows: T[] | undefined;
  columns: CsvColumn<T>[];
  filename: string;
}) {
  if (!rows || rows.length === 0) return null;
  return (
    <button className="btn ghost" onClick={() => downloadCsv(filename, toCsv(rows, columns))}>
      ⬇︎ Exportar CSV ({rows.length})
    </button>
  );
}
