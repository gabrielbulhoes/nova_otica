/*
 * Primeiro administrador da instalação.
 *
 * POR QUE ESTE ARQUIVO EXISTE. O `entrypoint.sh` aplicava as migrações e subia
 * a API — e mais nada. Quem criava o usuário admin era o `seed.ts`, que só roda
 * à mão. Resultado numa instalação nova: banco com schema, sem UM usuário, e
 * ninguém consegue entrar. A `SEED_ADMIN_PASSWORD` é obrigatória no compose, o
 * que sugere que ela faz alguma coisa no boot; não fazia. Foi o que aconteceu
 * na primeira subida em produção (03/08/2026).
 *
 * E POR QUE NÃO RODAR O `seed.ts` NO BOOT. Ele é de DEMONSTRAÇÃO: sincroniza em
 * modo mock, cria um gestor por loja com a senha fixa `loja123`, monta assets de
 * prova virtual e uma transferência de exemplo. Dezenove contas com senha
 * conhecida num sistema com o estoque real da rede é um problema de segurança,
 * não uma conveniência.
 *
 * Este script faz uma coisa só, e é idempotente: garante que exista um admin.
 * Se o usuário já existe, NÃO toca na senha — senão todo deploy desfaria a
 * troca de senha que o operador fez no primeiro login.
 */
import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';
import { env } from '../config/env.js';
import { hashPassword } from '../modules/auth/auth.service.js';

async function main(): Promise<void> {
  const email = env.SEED_ADMIN_EMAIL.toLowerCase();

  const existente = await prisma.user.findUnique({ where: { email } });
  if (existente) {
    logger.info('Admin já existe; senha preservada', { email });
    return;
  }

  await prisma.user.create({
    data: {
      email,
      name: 'Administrador da Rede',
      passwordHash: await hashPassword(env.SEED_ADMIN_PASSWORD),
      role: 'ADMIN',
    },
  });
  logger.info('Admin criado — troque a senha no primeiro login', { email });
}

main()
  .catch((err) => {
    logger.error('Falha ao garantir o administrador', {
      error: err instanceof Error ? err.message : String(err),
    });
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
