import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { addToCart, getArProducts, getCart, getStores, formatBRL } from '../api/client';
import { PageHeader, Loading } from '../components/ui';
import { VirtualTryOn } from '../ar/VirtualTryOn';

export function Loja() {
  const qc = useQueryClient();
  const [storeId, setStoreId] = useState('');
  const [tryOn, setTryOn] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const stores = useQuery({ queryKey: ['stores'], queryFn: getStores });
  const products = useQuery({ queryKey: ['ar-products'], queryFn: getArProducts });
  const cart = useQuery({ queryKey: ['cart'], queryFn: getCart });

  const effectiveStore = storeId || stores.data?.rows[0]?.id || '';

  const add = useMutation({
    mutationFn: (productId: string) => addToCart({ productId, storeId: effectiveStore, quantity: 1 }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cart'] });
      setMsg('Adicionado ao carrinho ✓');
      setTimeout(() => setMsg(null), 2500);
    },
    onError: (e: unknown) => {
      const m = (e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Erro ao adicionar.';
      setMsg(m);
      setTimeout(() => setMsg(null), 3500);
    },
  });

  const cartCount = cart.data?.items.reduce((s, i) => s + i.quantity, 0) ?? 0;

  return (
    <>
      <div className="row-between">
        <PageHeader title="Loja online" subtitle="Prove os óculos pela câmera e compre em tempo real." />
        <Link to="/carrinho" className="btn">
          Carrinho ({cartCount})
        </Link>
      </div>

      <div className="toolbar">
        <label className="muted">Loja de retirada/estoque</label>
        <select value={effectiveStore} onChange={(e) => setStoreId(e.target.value)}>
          {stores.data?.rows.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        {msg && <span className="badge blue" style={{ padding: '6px 12px' }}>{msg}</span>}
      </div>

      {products.isLoading ? (
        <Loading />
      ) : products.data && products.data.rows.length > 0 ? (
        <div className="grid grid-4">
          {products.data.rows.map((p) => (
            <div className="card" key={p.productId}>
              <div
                style={{
                  height: 120,
                  borderRadius: 10,
                  background: 'linear-gradient(135deg,#213354,#16213e)',
                  display: 'grid',
                  placeItems: 'center',
                  marginBottom: 12,
                }}
              >
                <svg width="96" height="34" viewBox="0 0 200 70" xmlns="http://www.w3.org/2000/svg">
                  <g stroke="#4f8cff" strokeWidth="6" fill="rgba(79,140,255,0.15)">
                    <rect x="6" y="14" width="78" height="46" rx="16" />
                    <rect x="116" y="14" width="78" height="46" rx="16" />
                    <path d="M84 30 q16 -10 32 0" fill="none" />
                  </g>
                </svg>
              </div>
              <div style={{ fontWeight: 600 }}>{p.description}</div>
              <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>
                {p.brand ?? ''} {p.category ? `· ${p.category}` : ''}
              </div>
              <div style={{ fontWeight: 700, marginBottom: 10 }}>{formatBRL(p.price)}</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn ghost sm" onClick={() => setTryOn(p.productId)}>
                  Provar
                </button>
                <button className="btn sm" disabled={add.isPending || !effectiveStore} onClick={() => add.mutate(p.productId)}>
                  Adicionar
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="empty">Nenhum produto com provador disponível. Cadastre assets de AR.</div>
      )}

      {tryOn && (
        <VirtualTryOn
          productId={tryOn}
          storeId={effectiveStore}
          onClose={() => setTryOn(null)}
          onAddToCart={() => {
            add.mutate(tryOn);
            setTryOn(null);
          }}
        />
      )}
    </>
  );
}
