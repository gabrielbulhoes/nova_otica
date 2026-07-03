import { describe, it, expect } from 'vitest';
import { canAccessOrder } from '../src/modules/commerce/checkout.service.js';
import { maskDocument } from '../src/modules/customers/customers.routes.js';
import type { Actor } from '../src/modules/movements/movements.service.js';

const admin: Actor = { id: 'u_admin', role: 'ADMIN', storeId: null };
const managerA: Actor = { id: 'u_a', role: 'STORE_MANAGER', storeId: 'st_a' };
const managerB: Actor = { id: 'u_b', role: 'STORE_MANAGER', storeId: 'st_b' };

describe('canAccessOrder', () => {
  const order = { storeId: 'st_a', userId: 'buyer_1' };

  it('ADMIN acessa qualquer pedido', () => {
    expect(canAccessOrder(order, admin)).toBe(true);
  });

  it('uso interno (sem actor) é permitido', () => {
    expect(canAccessOrder(order)).toBe(true);
  });

  it('gestor da loja dona acessa; de outra loja não', () => {
    expect(canAccessOrder(order, managerA)).toBe(true);
    expect(canAccessOrder(order, managerB)).toBe(false); // IDOR bloqueado
  });

  it('o comprador acessa o próprio pedido mesmo de outra loja', () => {
    expect(canAccessOrder({ storeId: 'st_a', userId: 'u_b' }, managerB)).toBe(true);
  });
});

describe('maskDocument', () => {
  it('ADMIN vê o documento completo', () => {
    expect(maskDocument('123.456.789-09', 'ADMIN')).toBe('123.456.789-09');
  });

  it('não-ADMIN vê apenas os 3 últimos dígitos', () => {
    expect(maskDocument('123.456.789-09', 'STORE_MANAGER')).toBe('***909');
  });

  it('trata nulo e documentos curtos', () => {
    expect(maskDocument(null, 'STORE_MANAGER')).toBeNull();
    expect(maskDocument('12', 'STORE_MANAGER')).toBe('***');
  });
});
