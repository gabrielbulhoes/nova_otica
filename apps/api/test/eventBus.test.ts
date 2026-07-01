import { describe, it, expect } from 'vitest';
import { publish, subscribe, subscriberCount } from '../src/lib/eventBus.js';
import type { AppEvent } from '../src/lib/eventBus.js';

describe('eventBus', () => {
  it('entrega eventos publicados aos assinantes', () => {
    const received: AppEvent[] = [];
    const unsub = subscribe((e) => received.push(e));

    publish({ type: 'sync.completed', ok: true });
    publish({ type: 'movement.changed', storeId: 's1', movementId: 'm1' });

    expect(received).toEqual([
      { type: 'sync.completed', ok: true },
      { type: 'movement.changed', storeId: 's1', movementId: 'm1' },
    ]);
    unsub();
  });

  it('cancelar a assinatura interrompe a entrega e libera o listener', () => {
    const received: AppEvent[] = [];
    const before = subscriberCount();
    const unsub = subscribe((e) => received.push(e));
    expect(subscriberCount()).toBe(before + 1);

    unsub();
    expect(subscriberCount()).toBe(before);
    publish({ type: 'sync.completed', ok: false });
    expect(received).toHaveLength(0);
  });
});
