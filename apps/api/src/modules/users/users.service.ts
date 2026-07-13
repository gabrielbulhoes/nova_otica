/**
 * Regras puras de gestão de usuários (testáveis sem banco).
 */

/**
 * Um ADMIN ativo só pode ser desativado/rebaixado se sobrar pelo menos UM
 * outro ADMIN ativo — senão a rede fica sem administrador (lockout).
 */
export function wouldOrphanAdmins(
  target: { role: 'ADMIN' | 'STORE_MANAGER'; active: boolean },
  change: { role?: 'ADMIN' | 'STORE_MANAGER'; active?: boolean },
  otherActiveAdmins: number,
): boolean {
  const isActiveAdmin = target.role === 'ADMIN' && target.active;
  if (!isActiveAdmin) return false;
  const losesAdmin = (change.role !== undefined && change.role !== 'ADMIN') || change.active === false;
  return losesAdmin && otherActiveAdmins === 0;
}

/** Ninguém edita o próprio papel/status — evita auto-lockout acidental. */
export function isSelfRoleOrStatusChange(
  actorId: string,
  targetId: string,
  change: { role?: unknown; active?: unknown },
): boolean {
  return actorId === targetId && (change.role !== undefined || change.active !== undefined);
}
