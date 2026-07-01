import { describe, it, expect } from 'vitest';
import { toCsv } from './csv';

describe('toCsv', () => {
  it('gera cabeçalho e linhas com separador ;', () => {
    const csv = toCsv(
      [
        { date: '2024-06-01', total: 100, count: 2 },
        { date: '2024-06-02', total: 50, count: 1 },
      ],
      [
        { key: 'date', label: 'Data' },
        { key: 'total', label: 'Faturamento' },
        { key: 'count', label: 'Vendas' },
      ],
    );
    expect(csv).toBe('Data;Faturamento;Vendas\n2024-06-01;100;2\n2024-06-02;50;1');
  });

  it('escapa valores com ; , aspas ou quebra de linha', () => {
    const csv = toCsv([{ label: 'Nova Ótica; SP', v: 'a"b' }], [
      { key: 'label', label: 'Loja' },
      { key: 'v', label: 'Valor' },
    ]);
    expect(csv).toBe('Loja;Valor\n"Nova Ótica; SP";"a""b"');
  });
});
