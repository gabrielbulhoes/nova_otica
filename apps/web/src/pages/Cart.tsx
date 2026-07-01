import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getCart,
  setCartQty,
  removeFromCart,
  clearCart,
  checkout,
  payOrder,
  formatBRL,
  type OrderView,
} from '../api/client';
import { PageHeader, Loading } from '../components/ui';

export function Cart() {
  const qc = useQueryClient();
  const [order, setOrder] = useState<OrderView | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cart = useQuery({ queryKey: ['cart'], queryFn: getCart });
  const invalidate = () => qc.invalidateQueries({ queryKey: ['cart'] });

  const qty = useMutation({
    mutationFn: ({ productId, quantity }: { productId: string; quantity: number }) => setCartQty(productId, quantity),
    onSuccess: invalidate,
    onError: () => setError('Não foi possível atualizar a quantidade (saldo?).'),
  });
  const remove = useMutation({ mutationFn: removeFromCart, onSuccess: invalidate });
  const empty = useMutation({ mutationFn: clearCart, onSuccess: invalidate });

  const doCheckout = useMutation({
    mutationFn: () => checkout({ method: 'PIX', customerName: 'Cliente' }),
    onSuccess: (o) => {
      setOrder(o);
      invalidate();
    },
    onError: (e: unknown) => setError((e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Erro no checkout.'),
  });
  const pay = useMutation({
    mutationFn: (id: string) => payOrder(id),
    onSuccess: (o) => {
      setOrder(o);
      qc.invalidateQueries({ queryKey: ['stock'] });
      qc.invalidateQueries({ queryKey: ['bi-kpis'] });
    },
  });

  // Tela de pedido (pós-checkout).
  if (order) {
    const paid = order.status === 'PAID';
    return (
      <>
        <PageHeader title={`Pedido ${order.number}`} subtitle={paid ? 'Pagamento confirmado.' : 'Aguardando pagamento.'} />
        <div className="card" style={{ maxWidth: 520 }}>
          <div className="row-between">
            <span>Status</span>
            <span className={`badge ${paid ? 'green' : 'amber'}`}>{paid ? 'Pago' : 'Aguardando pagamento'}</span>
          </div>
          <div className="row-between" style={{ marginTop: 8 }}>
            <span>Total</span>
            <strong>{formatBRL(order.total)}</strong>
          </div>
          {!paid && order.payment?.qrCode && (
            <div className="card" style={{ marginTop: 12, background: 'var(--panel-2)' }}>
              <div className="muted" style={{ fontSize: 12 }}>PIX (código de demonstração)</div>
              <code style={{ wordBreak: 'break-all', fontSize: 12 }}>{order.payment.qrCode}</code>
            </div>
          )}
          <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
            {!paid ? (
              <button className="btn" disabled={pay.isPending} onClick={() => pay.mutate(order.id)}>
                {pay.isPending ? 'Confirmando…' : 'Confirmar pagamento (simular gateway)'}
              </button>
            ) : (
              <Link to="/loja" className="btn">
                Voltar à loja
              </Link>
            )}
            <button className="btn ghost" onClick={() => setOrder(null)}>
              Novo carrinho
            </button>
          </div>
        </div>
      </>
    );
  }

  const items = cart.data?.items ?? [];

  return (
    <>
      <div className="row-between">
        <PageHeader title="Carrinho" subtitle={cart.data?.storeName ? `Loja: ${cart.data.storeName}` : 'Seu carrinho'} />
        <Link to="/loja" className="btn ghost">
          Continuar comprando
        </Link>
      </div>

      {error && <div className="badge red" style={{ display: 'block', padding: 10, marginBottom: 12 }}>{error}</div>}

      {cart.isLoading ? (
        <Loading />
      ) : items.length === 0 ? (
        <div className="empty">Seu carrinho está vazio. <Link to="/loja" style={{ color: 'var(--primary)' }}>Ir à loja →</Link></div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <table>
            <thead>
              <tr>
                <th>Produto</th>
                <th className="num">Preço</th>
                <th className="num">Qtd.</th>
                <th className="num">Total</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.productId}>
                  <td>{it.description}</td>
                  <td className="num">{formatBRL(it.unitPrice)}</td>
                  <td className="num">
                    <input
                      type="number"
                      min={1}
                      max={it.available}
                      value={it.quantity}
                      onChange={(e) => qty.mutate({ productId: it.productId, quantity: Number(e.target.value) })}
                      style={{ width: 64, padding: '4px 8px' }}
                    />
                  </td>
                  <td className="num">{formatBRL(it.total)}</td>
                  <td className="right">
                    <button className="btn ghost sm" onClick={() => remove.mutate(it.productId)}>
                      Remover
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="row-between" style={{ padding: 16 }}>
            <button className="btn ghost sm" onClick={() => empty.mutate()}>
              Esvaziar
            </button>
            <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
              <strong>Total: {formatBRL(cart.data?.total ?? 0)}</strong>
              <button className="btn" disabled={doCheckout.isPending} onClick={() => doCheckout.mutate()}>
                {doCheckout.isPending ? 'Processando…' : 'Finalizar compra'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
