import { useState } from 'react';
import type { CSSProperties } from 'react';
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
import { Icon } from '../brand/Icon';

/** `.btn` não é flex no CSS; sem isto o ícone empurra a linha de base do rótulo. */
const botaoComIcone: CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 7 };
/** `.badge` é inline-block; o chip só acomoda ícone + palavra em inline-flex. */
const chipComIcone: CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6 };

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
        <hr className="rule-section" />
        <div className="card" style={{ maxWidth: 520 }}>
          <div className="row-between">
            <span className="label">Status</span>
            {/*
              O selo carrega ícone E palavra. Sob deuteranopia o verde de
              "saudável" e os tons quentes vizinhos colapsam quase no mesmo tom,
              então a cor aqui é reforço: quem decide é o rótulo escrito e a
              forma do desenho (visto x relógio).
            */}
            <span className={`badge ${paid ? 'green' : 'amber'}`} style={chipComIcone}>
              <Icon name={paid ? 'check' : 'prazo'} size={14} />
              {paid ? 'Pago' : 'Aguardando pagamento'}
            </span>
          </div>
          <hr className="rule" />
          <div className="row-between" style={{ alignItems: 'baseline' }}>
            <span className="label">Total</span>
            <span className="kpi">{formatBRL(order.total)}</span>
          </div>
          {!paid && order.payment?.qrCode && (
            <div className="card" style={{ marginTop: 12, background: 'var(--panel-2)' }}>
              <div className="label">PIX · código de demonstração</div>
              <code style={{ wordBreak: 'break-all', fontSize: 12 }}>{order.payment.qrCode}</code>
            </div>
          )}
          <div style={{ marginTop: 16, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {/*
              Um `.btn.solid` por tela — e os dois ramos abaixo são excludentes,
              então a regra continua valendo: enquanto há pagamento pendente o
              primário é confirmá-lo; depois de pago, o primário é a volta à
              vitrine, que é o próximo passo da jornada.
            */}
            {!paid ? (
              <button className="btn solid" style={botaoComIcone} disabled={pay.isPending} onClick={() => pay.mutate(order.id)}>
                <Icon name="aprovar" size={17} />
                {pay.isPending ? 'Confirmando…' : 'Confirmar pagamento (simular gateway)'}
              </button>
            ) : (
              <Link to="/loja" className="btn solid" style={botaoComIcone}>
                <Icon name="seta-esquerda" size={17} />
                Voltar à loja
              </Link>
            )}
            <button className="btn ghost" style={botaoComIcone} onClick={() => setOrder(null)}>
              <Icon name="compras" size={17} />
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
        <Link to="/loja" className="btn ghost" style={botaoComIcone}>
          <Icon name="seta-esquerda" size={17} />
          Continuar comprando
        </Link>
      </div>

      <hr className="rule-section" />

      {/*
        O erro era um `.badge red` esticado para virar bloco — chip de 9,5px em
        mono não é feito para carregar frase. Agora é banner: filete de estado à
        esquerda, ícone de atenção e o texto em --terra (7.3:1 sobre o papel).
        `role="alert"` porque a mensagem aparece depois de uma ação do usuário e
        precisa ser anunciada sem ele ir procurá-la.
      */}
      {error && (
        <div className="banner" role="alert" style={{ borderLeftColor: 'var(--terra)', color: 'var(--terra)' }}>
          <Icon name="atencao" size={18} />
          {error}
        </div>
      )}

      {cart.isLoading ? (
        <Loading />
      ) : items.length === 0 ? (
        <div className="empty">
          Seu carrinho está vazio.{' '}
          <Link
            to="/loja"
            style={{ color: 'var(--accent)', display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            Ir à loja
            <Icon name="seta-direita" size={15} />
          </Link>
        </div>
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
                    <button className="btn ghost sm" style={botaoComIcone} onClick={() => remove.mutate(it.productId)}>
                      <Icon name="lixeira" size={15} />
                      Remover
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="row-between" style={{ padding: 16 }}>
            <button className="btn ghost sm" style={botaoComIcone} onClick={() => empty.mutate()}>
              <Icon name="limpar" size={15} />
              Esvaziar
            </button>
            <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
              <div style={{ textAlign: 'right' }}>
                <div className="label">Total</div>
                <div className="kpi">{formatBRL(cart.data?.total ?? 0)}</div>
              </div>
              {/*
                O ÚNICO `.btn.solid` desta tela: fechar a compra. Todo o resto
                do carrinho (esvaziar, remover, continuar comprando) é ação
                comum e fica em contornado ou terciário — é isso que mantém o
                ouro abaixo dos 5% de área e faz o preenchimento significar
                decisão.
              */}
              <button className="btn solid" style={botaoComIcone} disabled={doCheckout.isPending} onClick={() => doCheckout.mutate()}>
                {doCheckout.isPending ? 'Processando…' : 'Finalizar compra'}
                <Icon name="seta-direita" size={17} />
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
