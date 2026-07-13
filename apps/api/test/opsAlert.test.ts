import { describe, it, expect } from 'vitest';
import { buildSyncFailurePayload } from '../src/lib/opsAlert.js';

describe('buildSyncFailurePayload', () => {
  it('lista apenas as entidades com erro e monta texto legível', () => {
    const p = buildSyncFailurePayload({
      trigger: 'schedule',
      window: '06:00-07:00',
      durationMs: 1234,
      entities: {
        stores: { read: 4, written: 4 },
        stock: { read: 0, written: 0, error: 'timeout' },
        reconcile: { read: 0, written: 0, error: 'pulada: sync de estoque falhou' },
      },
    });
    expect(p.event).toBe('sync.failed');
    expect(p.failures).toHaveLength(2);
    expect(p.failures[0]).toEqual({ entity: 'stock', error: 'timeout' });
    expect(p.text).toContain('stock: timeout');
    expect(p.text).toContain('06:00-07:00');
    expect(p.text).not.toContain('stores');
  });
});
