import { useState } from 'react';
import type { CSSProperties } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { addToCart, getCart, getProduct, formatBRL } from '../api/client';
import { PageHeader, Loading } from '../components/ui';
import { Icon } from '../brand/Icon';
import { VirtualTryOn } from '../ar/VirtualTryOn';

/** `.btn` não é flex no CSS; sem isto o ícone empurra a linha de base do rótulo. */
const botaoComIcone: CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 7 };

/** Sucesso e erro precisam diferir por ícone e palavra, não só pelo tom do chip. */
type Aviso = { texto: string; ok: boolean };

export function ProductPage() {
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const [storeId, setStoreId] = useState('');
  const [tryOn, setTryOn] = useState(false);
  const [msg, setMsg] = useState<Aviso | null>(null);

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
      setMsg({ texto: 'Adicionado ao carrinho', ok: true });
      setTimeout(() => setMsg(null), 2500);
    },
    onError: (e: unknown) => {
      const m = (e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Erro ao adicionar.';
      setMsg({ texto: m, ok: false });
      setTimeout(() => setMsg(null), 3500);
    },
  });

  if (product.isLoading) return <Loading />;
  if (!product.data) return <div className="empty">Produto não encontrado.</div>;

  const p = product.data;

  return (
    <>
      {/* A seta era o caractere "←" escrito no texto: muda de largura conforme a
          fonte instalada e desalinha a linha. Agora é ícone da grade 24. */}
      <Link to="/loja" className="label" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <Icon name="seta-esquerda" size={15} />
        Voltar à loja
      </Link>

      <div className="grid grid-2" style={{ marginTop: 12, alignItems: 'start' }}>
        {/*
          Lugar da foto do produto. O gradiente `#213354→#16213e` e o desenho em
          `#4f8cff` eram do tema azul anterior, cravados no JSX — nunca passaram
          por token e por isso sobreviveram à troca de paleta. Aqui a peça é
          grande e única na tela, então é o segundo (e último) lugar da vitrine
          onde a Malha Nano cabe: pai em position:relative, malha atrás, desenho
          em z-index 1. Nenhum texto corrido por cima dela.

          --ouro-dark, não --ouro: ouro puro sobre esta superfície dá 1.77:1.
        */}
        <div
          className="card"
          style={{
            position: 'relative',
            display: 'grid',
            placeItems: 'center',
            minHeight: 320,
            background: 'var(--panel-2)',
            color: 'var(--ouro-dark)',
          }}
        >
          <div className="mesh" />
          <Icon name="loja" size={160} style={{ position: 'relative', zIndex: 1 }} />
        </div>

        <div>
          {/* Marca no rótulo de abertura (mono, caixa alta, filete curto): é
              dado de ficha e não pode competir com o nome do produto, que é o
              título da tela. A categoria fica na linha de apoio do cabeçalho. */}
          {p.brand && <p className="eyebrow">{p.brand}</p>}
          <PageHeader title={p.description} subtitle={p.category ?? undefined} />

          {/* Preço é o número-herói da tela: Fraunces com tabular-nums. */}
          <div className="kpi" style={{ fontSize: 34, marginBottom: 16 }}>
            {formatBRL(p.price)}
          </div>

          <div className="card" style={{ marginBottom: 16 }}>
            <div className="row-between">
              <span className="label">Cor</span>
              <span>{p.color?.name ?? '—'}</span>
            </div>
            {/* Filete neutro separa item dentro da seção (o dourado é reservado
                para abrir/fechar seção — a régua tem que ser lida antes do texto). */}
            <hr className="rule" />
            <div className="row-between">
              <span className="label">Tamanho</span>
              <span>{p.size?.name ?? '—'}</span>
            </div>
            <hr className="rule" />
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

          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <button className="btn ghost" style={botaoComIcone} onClick={() => setTryOn(true)}>
              <Icon name="loja" size={17} />
              Provar com a câmera
            </button>
            {/*
              O ÚNICO `.btn.solid` desta tela. É a decisão de compra: o ouro
              preenchido marca uma escolha por tela e nada mais. A grade da
              vitrine, com um botão por card, fica toda em contornado justamente
              para que este aqui signifique alguma coisa.
            */}
            <button
              className="btn solid"
              style={botaoComIcone}
              disabled={add.isPending || !effectiveStore || !selected}
              onClick={() => add.mutate()}
            >
              <Icon name="compras" size={17} />
              Adicionar ao carrinho
            </button>
            {msg && (
              <span
                className={`badge ${msg.ok ? 'green' : 'red'}`}
                role="status"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px' }}
              >
                <Icon name={msg.ok ? 'check' : 'atencao'} size={14} />
                {msg.texto}
              </span>
            )}
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
