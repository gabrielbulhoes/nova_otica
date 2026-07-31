import { useState } from 'react';
import type { CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { addToCart, getArProducts, getCart, getStores, formatBRL } from '../api/client';
import { Loading } from '../components/ui';
import { Icon } from '../brand/Icon';
import { VirtualTryOn } from '../ar/VirtualTryOn';

/** `.btn` não é flex no CSS; sem isto o ícone empurra a linha de base do rótulo. */
const botaoComIcone: CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 7 };

/**
 * Retorno da mutação em forma de aviso.
 *
 * Antes era só uma string com "✓" colado no fim e um `.badge blue` para sucesso
 * e erro igualmente. Emoji não é ícone (renderiza diferente em cada sistema e
 * ignora a cor da marca) e um chip neutro para as duas respostas apaga a
 * diferença entre "foi" e "não foi". Agora o tom é dado por classe, ícone E
 * palavra — a cor sozinha nunca decide, que é a exigência de 1.4.1 e a razão
 * prática de parte dos usuários não separar os tons quentes entre si.
 */
type Aviso = { texto: string; ok: boolean };

export function Loja() {
  const qc = useQueryClient();
  const [storeId, setStoreId] = useState('');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [tryOn, setTryOn] = useState<string | null>(null);
  const [msg, setMsg] = useState<Aviso | null>(null);

  const stores = useQuery({ queryKey: ['stores'], queryFn: getStores });
  const products = useQuery({ queryKey: ['ar-products'], queryFn: getArProducts });
  const cart = useQuery({ queryKey: ['cart'], queryFn: getCart });

  const effectiveStore = storeId || stores.data?.rows[0]?.id || '';

  const allRows = products.data?.rows ?? [];
  const categories = Array.from(new Set(allRows.map((p) => p.category).filter(Boolean))) as string[];
  const rows = allRows.filter((p) => {
    const q = search.trim().toLowerCase();
    const matchSearch =
      !q || p.description.toLowerCase().includes(q) || (p.brand ?? '').toLowerCase().includes(q);
    const matchCat = !category || p.category === category;
    return matchSearch && matchCat;
  });

  const add = useMutation({
    mutationFn: (productId: string) => addToCart({ productId, storeId: effectiveStore, quantity: 1 }),
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

  const cartCount = cart.data?.items.reduce((s, i) => s + i.quantity, 0) ?? 0;

  return (
    <>
      {/*
        A vitrine é a tela mais "marca" do produto, e este bloco é o único lugar
        dela onde a Malha Nano cabe: o manual a reserva para hero e área de
        respiro, nunca sob texto corrido. O pai precisa ser position:relative
        (`.mesh` é inset:0 absoluto) e o conteúdo sobe para z-index 1, senão a
        máscara de pontos passaria por cima do título.

        A malha fica SÓ aqui, uma vez por tela. Repetida nos 20 cards da grade,
        o dourado somado passaria dos 5% de área que o manual autoriza e viraria
        textura de fundo — exatamente o ruído que a regra existe para evitar.
      */}
      <section className="store-hero" style={{ position: 'relative' }}>
        <div className="mesh" />
        <div style={{ position: 'relative', zIndex: 1 }}>
          {/* <div>, não <p>: `.store-hero p` é (0,1,1) e venceria `.eyebrow`
              (0,1,0), devolvendo o rótulo a 19px em --muted — ou seja, o
              utilitário de marca seria silenciosamente desligado. */}
          <div className="eyebrow" style={{ justifyContent: 'center' }}>
            A Graciosa · Rede de óticas
          </div>
          <h1>Loja online</h1>
          <p>Prove os óculos pela câmera e compre em tempo real.</p>
        </div>
      </section>

      {/* Filete em gradiente dourado = abre/fecha seção. Aqui fecha o hero e
          entrega a tela para a área operacional (filtros + grade). */}
      <hr className="rule-section" />

      <div className="toolbar">
        <input
          placeholder="Buscar óculos ou marca…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ minWidth: 220 }}
        />
        <select value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">Todas as categorias</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select value={effectiveStore} onChange={(e) => setStoreId(e.target.value)}>
          {stores.data?.rows.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
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
        {/*
          Nenhum `.btn.solid` nesta tela, de propósito. O primário preenchido é
          limitado a UM por tela e o lugar dele na jornada é a decisão de compra
          (página do produto e carrinho); aqui ele competiria com os dois botões
          de cada card e o ouro deixaria de marcar decisão.
        */}
        <Link to="/loja/carrinho" className="btn sm" style={{ ...botaoComIcone, marginLeft: 'auto' }}>
          <Icon name="compras" size={16} />
          Carrinho ({cartCount})
        </Link>
      </div>

      {products.isLoading ? (
        <Loading />
      ) : rows.length > 0 ? (
        <div className="grid grid-4">
          {rows.map((p) => (
            <div className="card" key={p.productId}>
              {/*
                Lugar da foto do produto. O gradiente `#213354→#16213e` e o
                desenho em `#4f8cff` eram do tema azul anterior, cravados no JSX
                — cor que não passava por token nenhum e sobreviveu à troca de
                paleta. A superfície agora é papel secundário e o desenho é o
                ícone "loja" (óculos) da grade 24 do manual, herdando a cor por
                currentColor.

                --ouro-dark, não --ouro: ouro puro sobre esta superfície dá
                1.77:1 e o traço simplesmente não é percebido.
              */}
              <div
                style={{
                  height: 120,
                  background: 'var(--panel-2)',
                  border: '1px solid var(--border)',
                  color: 'var(--ouro-dark)',
                  display: 'grid',
                  placeItems: 'center',
                  marginBottom: 12,
                }}
              >
                <Icon name="loja" size={64} />
              </div>
              <Link to={`/loja/produto/${p.productId}`} style={{ fontWeight: 600, color: 'var(--text)' }}>
                {p.description}
              </Link>
              {/* Marca e categoria são dado de ficha, não texto corrido: é o
                  caso exato do rótulo em mono caixa alta do manual. */}
              <div className="label" style={{ marginBottom: 6 }}>
                {p.brand ?? ''}
                {p.category ? ` · ${p.category}` : ''}
              </div>
              {/* Preço é o número-herói do card — Fraunces com tabular-nums. */}
              <div className="kpi" style={{ marginBottom: 10 }}>
                {formatBRL(p.price)}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn ghost sm" style={botaoComIcone} onClick={() => setTryOn(p.productId)}>
                  <Icon name="loja" size={15} />
                  Provar
                </button>
                <button
                  className="btn sm"
                  style={botaoComIcone}
                  disabled={add.isPending || !effectiveStore}
                  onClick={() => add.mutate(p.productId)}
                >
                  <Icon name="mais" size={15} />
                  Adicionar
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="empty">
          {allRows.length === 0
            ? 'Nenhum produto com provador disponível. Cadastre assets de AR.'
            : 'Nenhum produto encontrado com os filtros atuais.'}
        </div>
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
