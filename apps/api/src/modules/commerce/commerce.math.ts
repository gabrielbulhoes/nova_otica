/** Cálculos puros do e-commerce (testáveis diretamente). */

export const round2 = (n: number): number => Math.round(n * 100) / 100;

export interface LineInput {
  unitPrice: number;
  quantity: number;
}

/** Subtotal e total do pedido (sem frete/desconto no MVP). */
export function computeOrderTotals(items: LineInput[]): { subtotal: number; total: number } {
  const subtotal = round2(items.reduce((sum, i) => sum + i.unitPrice * i.quantity, 0));
  return { subtotal, total: subtotal };
}

/** Total de uma linha. */
export function lineTotal(unitPrice: number, quantity: number): number {
  return round2(unitPrice * quantity);
}
