import { prisma } from '../lib/prisma.js';
import { env } from '../config/env.js';

/**
 * Frescor da sincronização — a resposta para "o painel está mostrando dado de
 * hoje ou de três dias atrás?".
 *
 * O alerta que já existia cobria UM dos dois silêncios: o sync que roda e
 * falha. O outro — o sync que simplesmente NÃO ACONTECE — não era detectado
 * por nada. Container parado às 6h, cron mal configurado, processo morto no
 * meio: em todos esses casos o `SyncRun` sequer é criado, `notifySyncFailure`
 * nunca é chamado, e o console segue servindo os números da véspera com toda a
 * confiança do mundo.
 *
 * É o pior modo de falha de um sistema de estoque em tempo real, porque ele se
 * parece exatamente com o funcionamento normal.
 */

export interface Frescor {
  /** Fim do último sync BEM-SUCEDIDO. */
  ultimoSucesso: Date | null;
  /** Idade desse sucesso, em horas. `null` quando nunca houve um. */
  horas: number | null;
  /** Passou do limite tolerado (ou nunca sincronizou). */
  vencido: boolean;
  limiteHoras: number;
}

/**
 * Puro, para poder ser testado sem banco e sem relógio real.
 *
 * `PARTIAL` não conta como sucesso de propósito: um run que gravou lojas e
 * falhou no estoque deixa a base tão desatualizada quanto um run que não
 * aconteceu, e é justamente o caso em que alguém precisa olhar.
 */
export function avaliarFrescor(ultimoSucesso: Date | null, agora: Date, limiteHoras: number): Frescor {
  if (!ultimoSucesso) return { ultimoSucesso: null, horas: null, vencido: true, limiteHoras };
  const horas = (agora.getTime() - ultimoSucesso.getTime()) / 3_600_000;
  return { ultimoSucesso, horas, vencido: horas > limiteHoras, limiteHoras };
}

export async function getFrescor(agora = new Date()): Promise<Frescor> {
  const ultimo = await prisma.syncRun.findFirst({
    where: { status: 'SUCCESS', finishedAt: { not: null } },
    orderBy: { finishedAt: 'desc' },
    select: { finishedAt: true },
  });
  return avaliarFrescor(ultimo?.finishedAt ?? null, agora, env.SYNC_STALE_HOURS);
}
