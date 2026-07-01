/** Utilitários de exportação (CSV). `toCsv` é puro e testável. */

export interface CsvColumn<T> {
  key: keyof T;
  label: string;
}

/** Escapa um valor para CSV (aspas, vírgulas, quebras de linha). */
function escapeCell(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value);
  if (/[",\n;]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** Converte linhas em CSV (separador `;`, cabeçalho com os rótulos). */
export function toCsv<T>(rows: T[], columns: CsvColumn<T>[]): string {
  const header = columns.map((c) => escapeCell(c.label)).join(';');
  const body = rows.map((r) => columns.map((c) => escapeCell(r[c.key])).join(';'));
  return [header, ...body].join('\n');
}

/** Dispara o download de um CSV no navegador. */
export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
