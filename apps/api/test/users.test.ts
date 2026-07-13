import { describe, it, expect } from 'vitest';
import { isSelfRoleOrStatusChange, wouldOrphanAdmins } from '../src/modules/users/users.service.js';

describe('wouldOrphanAdmins (proteção do último admin)', () => {
  const admin = { role: 'ADMIN', active: true } as const;

  it('bloqueia desativar o único ADMIN ativo', () => {
    expect(wouldOrphanAdmins(admin, { active: false }, 0)).toBe(true);
  });

  it('bloqueia rebaixar o único ADMIN ativo', () => {
    expect(wouldOrphanAdmins(admin, { role: 'STORE_MANAGER' }, 0)).toBe(true);
  });

  it('permite quando existe outro ADMIN ativo', () => {
    expect(wouldOrphanAdmins(admin, { active: false }, 1)).toBe(false);
  });

  it('não se aplica a não-admins ou admins já inativos', () => {
    expect(wouldOrphanAdmins({ role: 'STORE_MANAGER', active: true }, { active: false }, 0)).toBe(false);
    expect(wouldOrphanAdmins({ role: 'ADMIN', active: false }, { role: 'STORE_MANAGER' }, 0)).toBe(false);
  });

  it('mudanças que não tiram o papel/status de admin passam', () => {
    expect(wouldOrphanAdmins(admin, { role: 'ADMIN' }, 0)).toBe(false);
  });
});

describe('isSelfRoleOrStatusChange (anti auto-lockout)', () => {
  it('bloqueia mexer no próprio papel/status', () => {
    expect(isSelfRoleOrStatusChange('u1', 'u1', { role: 'STORE_MANAGER' })).toBe(true);
    expect(isSelfRoleOrStatusChange('u1', 'u1', { active: false })).toBe(true);
  });

  it('permite editar o próprio nome ou editar terceiros', () => {
    expect(isSelfRoleOrStatusChange('u1', 'u1', {})).toBe(false);
    expect(isSelfRoleOrStatusChange('u1', 'u2', { active: false })).toBe(false);
  });
});
