import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { addToCart, getCart, getProduct, formatBRL } from '../api/client';
import { PageHeader, Loading } from '../components/ui';
import { VirtualTryOn } from '../ar/VirtualTryOn';

export function ProductPage() {
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const [storeId, setStoreId] = useState('');
  const [tryOn, setTryOn] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const product = useQuery({ queryKey: ['product', id], queryFn: () => getProduct(id), enabled: !!id });
  useQuery({ queryKey: ['cart'], queryFn: getCart });

  // Lojas que têm este produto em estoque.
  const stockRows = (product.data?.stockItems ?? []).filter((s) => s.quantity > 0);
  const effectiveStore = storeId || stockRows[0]?.store.id || '';
  const selected = stockRows.find((s) => s.store.id === effectiveStore);

  const add = useMutation({
    mutationFn: () => addToCart({ productId: id, storeId: effectiveStore, quantity: 1 }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cart'] });
      setMsg('Adicionado ao carrinho ✓');
      setTimeout(() => setMsg(null), 2500);
    },
    onError: (e: unknown) => {
      setMsg((e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Erro ao adicionar.');
      setTimeout(() => setMsg(null), 3500);
    },
  });

  if (product.isLoading) return <Loading />;
  if (!product.data) return <div className="empty">Produto não encontrado.</div>;

  const p = product.data;

  return (
    <>
      <Link to="/loja" className="muted" style={{ fontSize: 13 }}>
        ← Voltar à loja
      </Link>

      <div className="grid grid-2" style={{ marginTop: 12, alignItems: 'start' }}>
        <div
          className="card"
          style={{
            display: 'grid',
            placeItems: 'center',
            minHeight: 320,
            background: 'linear-gradient(135deg,#213354,#16213e)',
          }}
        >
          <svg width="220" height="78" viewBox="0 0 200 70" xmlns="http://www.w3.org/2000/svg">
            <g stroke="#4f8cff" strokeWidth="5" fill="rgba(79,140,255,0.15)">
              <rect x="6" y="14" width="78" height="46" rx="16" />
              <rect x="116" y="14" width="78" height="46" rx="16" />
              <path d="M84 30 q16 -10 32 0" fill="none" />
            </g>
          </svg>
        </div>

        <div>
          <PageHeader title={p.description} subtitle={`${p.brand ?? ''}${p.category ? ` · ${p.category}` : ''}`} />
          <div style={{ fontSize: 30, fontWeight: 700, letterSpacing: '-0.5px', marginBottom: 16 }}>
            {formatBRL(p.price)}
          </div>

          <div className="card" style={{ marginBottom: 16 }}>
            <div className="row-between" style={{ marginBottom: 10 }}>
              <span className="muted">Cor</span>
              <span>{p.color?.name ?? '—'}</span>
            </div>
            <div className="row-between" style={{ marginBottom: 10 }}>
              <span className="muted">Tamanho</span>
              <span>{p.size?.name ?? '—'}</span>
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>Loja de retirada/estoque</label>
              <select value={effectiveStore} onChange={(e) => setStoreId(e.target.value)}>
                {stockRows.length === 0 && <option value="">Sem estoque</option>}
                {stockRows.map((s) => (
                  <option key={s.store.id} value={s.store.id}>
                    {s.store.name} — {s.quantity} un.
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <button className="btn ghost" onClick={() => setTryOn(true)}>
              Provar com a câmera
            </button>
            <button
              className="btn"
              disabled={add.isPending || !effectiveStore || !selected}
              onClick={() => add.mutate()}
            >
              Adicionar ao carrinho
            </button>
            {msg && <span className="badge blue" style={{ padding: '6px 12px' }}>{msg}</span>}
          </div>
        </div>
      </div>

      {tryOn && (
        <VirtualTryOn
          productId={id}
          storeId={effectiveStore}
          onClose={() => setTryOn(false)}
          onAddToCart={() => {
            add.mutate();
            setTryOn(false);
          }}
        />
      )}
    </>
  );
}
