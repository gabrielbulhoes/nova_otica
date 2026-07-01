import type { ReactNode } from 'react';

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
