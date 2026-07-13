import { Router } from 'express';
import type { Prisma, Role } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { asyncHandler, notFound, parsePaging } from '../../http/helpers.js';

export const customersRouter = Router();

/** Oculta o documento (CPF/CNPJ) para quem não é ADMIN — expõe só os 3 finais. */
export function maskDocument(doc: string | null, role?: Role): string | null {
  if (!doc || role === 'ADMIN') return doc;
  const digits = doc.replace(/\D/g, '');
  return digits.length <= 3 ? '***' : `***${digits.slice(-3)}`;
}

/** GET /api/customers — clientes com busca por nome/documento. */
customersRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { limit, page, skip } = parsePaging(req.query);
    const search = req.query.search as string | undefined;
    const isAdmin = req.user?.role === 'ADMIN';

    // Busca por documento (CPF/CNPJ) é exclusiva do ADMIN — do contrário a
    // busca por substring contornaria a máscara e permitiria enumerar CPFs.
    const or: Prisma.CustomerWhereInput[] = [
      { name: { contains: search ?? '', mode: 'insensitive' } },
      { email: { contains: search ?? '', mode: 'insensitive' } },
    ];
    if (isAdmin && search) or.push({ document: { contains: search } });
    const where: Prisma.CustomerWhereInput = search ? { OR: or } : {};

    const [total, rows] = await Promise.all([
      prisma.customer.count({ where }),
      prisma.customer.findMany({
        where,
        orderBy: { name: 'asc' },
        include: { _count: { select: { sales: true } } },
        take: limit,
        skip,
      }),
    ]);
    const masked = rows.map((r) => ({ ...r, document: maskDocument(r.document, req.user?.role) }));
    res.json({ total, page, limit, rows: masked });
  }),
);

/** GET /api/customers/:id — detalhe + últimas vendas. */
customersRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const customer = await prisma.customer.findUnique({
      where: { id: req.params.id },
      include: {
        sales: { orderBy: { saleDate: 'desc' }, take: 20, include: { store: true } },
      },
    });
    if (!customer) throw notFound('Cliente não encontrado');
    res.json({ ...customer, document: maskDocument(customer.document, req.user?.role) });
  }),
);
