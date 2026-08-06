import { describe, expect, it } from 'vitest';

process.env.DATABASE_URL ??= 'postgresql://ci:ci@localhost:5432/ci?schema=public';

const { avaliarFrescor } = await import('../src/sync/syncHealth.js');
const { buildSyncStalePayload } = await import('../src/lib/opsAlert.js');

/**
 * O sync que NÃO acontece era o único modo de falha sem nenhuma detecção:
 * container parado às 6h, cron errado, processo morto no meio. Em todos, o
 * `SyncRun` sequer é criado, o alerta de falha nunca dispara, e o console
 * segue servindo os números da véspera com toda a confiança do mundo.
 */
const agora = new Date('2026-08-06T09:00:00Z');
const horasAtras = (h: number) => new Date(agora.getTime() - h * 3_600_000);

describe('avaliarFrescor', () => {
  it('base do lote da manhã está em dia', () => {
    const f = avaliarFrescor(horasAtras(3), agora, 26);
    expect(f.vencido).toBe(false);
    expect(f.horas).toBeCloseTo(3, 5);
  });

  it('tolera atraso dentro do limite — atraso não é incidente', () => {
    // 25h: o lote de ontem atrasou, o de hoje ainda não rodou. Alertar aqui
    // seria treinar todo mundo a ignorar o alerta.
    expect(avaliarFrescor(horasAtras(25), agora, 26).vencido).toBe(false);
  });

  it('acusa quando passa do limite', () => {
    const f = avaliarFrescor(horasAtras(30), agora, 26);
    expect(f.vencido).toBe(true);
    expect(f.horas).toBeCloseTo(30, 5);
  });

  it('nunca ter sincronizado é o caso mais grave, não o mais neutro', () => {
    // Instalação nova que nunca completou um sync serve tela vazia sem avisar.
    const f = avaliarFrescor(null, agora, 26);
    expect(f.vencido).toBe(true);
    expect(f.horas).toBeNull();
    expect(f.ultimoSucesso).toBeNull();
  });
});

describe('buildSyncStalePayload', () => {
  it('a mensagem diz o que está em risco, não só que houve erro', () => {
    const p = buildSyncStalePayload({ ultimoSucesso: horasAtras(40), horas: 40, limiteHoras: 26 });
    expect(p.event).toBe('sync.stale');
    expect(p.severity).toBe('error');
    expect(p.text).toContain('40h');
    expect(p.text).toContain('dados antigos');
  });

  it('sem sync nenhum, a mensagem diz NUNCA em vez de uma data vazia', () => {
    const p = buildSyncStalePayload({ ultimoSucesso: null, horas: null, limiteHoras: 26 });
    expect(p.text).toContain('NUNCA');
    expect(p.ultimoSucesso).toBeNull();
  });
});
