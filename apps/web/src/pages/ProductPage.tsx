import { useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { addToCart, getCart, getProduct, formatBRL } from '../api/client';
import { PageHeader, Loading, Codigo } from '../components/ui';
import { Icon } from '../brand/Icon';
import { VirtualTryOn } from '../ar/VirtualTryOn';
import { useTemaDaVitrine } from '../hooks/useTemaDaVitrine';
// A tradução de categoria mora na vitrine, que é a rota-mãe desta página e a
// dona da grade que a alimenta. Duplicar a tabela aqui garantiria que um dia as
// duas telas chamassem a mesma categoria por nomes diferentes.
import { nomeCategoria } from './Loja';

/** `.btn` não é flex no CSS; sem isto o ícone empurra a linha de base do rótulo. */
const botaoComIcone: CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 7 };
/** `.badge` é inline-block; o chip só acomoda ícone + palavra em inline-flex. */
const chipComIcone: CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6 };

/** Sucesso e erro precisam diferir por ícone e palavra, não só pelo tom do chip. */
type Aviso = { texto: string; ok: boolean };

/** Abaixo disto o saldo da loja escolhida vira exceção e ganha selo de atenção. */
const LIMIAR_ULTIMAS = 5;

export function ProductPage() {
  useTemaDaVitrine();

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
  const unidadesRede = (p.stockItems ?? []).reduce((s, i) => s + i.quantity, 0);
  const naLoja = selected?.quantity ?? 0;
  // O fornecedor do catálogo real vem como razão social ("LUXOTTICA BRASIL
  // PRODUTOS OTICOS E ESPORTIVOS LTDA") e em boa parte da grade vem vazio, que o
  // adaptador escreve como travessão. Nos dois casos não é nome de marca e não
  // pode subir para o alto da página — fica na ficha, como o dado que é.
  const fornecedor = p.brand && p.brand !== '—' ? p.brand : null;

  return (
    <>
      {/* A seta era o caractere "←" escrito no texto: muda de largura conforme a
          fonte instalada e desalinha a linha. Agora é ícone da grade 24, e o
          alvo é um botão fantasma — o mesmo vocabulário do "Continuar
          comprando" do carrinho, que é a mesma ação em outro ponto da jornada. */}
      <Link to="/loja" className="btn ghost sm" style={{ ...botaoComIcone, display: 'inline-flex' }}>
        <Icon name="seta-esquerda" size={15} />
        Voltar à loja
      </Link>

      <div className="grid grid-2" style={{ marginTop: 14, alignItems: 'start' }}>
        {/*
          Lugar da foto do produto. O gradiente `#213354→#16213e` e o desenho em
          `#4f8cff` eram do tema azul anterior, cravados no JSX — nunca passaram
          por token e por isso sobreviveram à troca de paleta. Aqui a peça é
          grande e única na tela, então é o segundo (e último) lugar da vitrine
          onde a Malha Nano cabe: pai em position:relative, malha atrás, desenho
          em z-index 1. Nenhum texto corrido por cima dela.

          `var(--accent)`, e não um token de ouro cravado: o alias da camada 2 é
          o único que troca de valor com o tema (4.94:1 no claro, 11.51:1 no
          escuro). Com --ouro-dark fixo o desenho caía para 3.28:1 no escuro; com
          ouro puro, para 1.77:1 no claro.
        */}
        <div
          className="card"
          style={{
            position: 'relative',
            display: 'grid',
            placeItems: 'center',
            minHeight: 320,
            background: 'var(--panel-2)',
            color: 'var(--accent)',
          }}
        >
          <div className="mesh" />
          <Icon name="loja" size={160} style={{ position: 'relative', zIndex: 1 }} />
        </div>

        <div>
          {/* Categoria no rótulo de abertura (mono, caixa alta, filete curto): é
              rótulo CURTO, que é a única coisa que o manual autoriza em mono. O
              nome do produto é o título da tela e não divide o topo com nada. */}
          <PageHeader eyebrow={nomeCategoria(p.category)} title={p.description} />

          {/* Preço é o número-herói da tela: Fraunces com tabular-nums. */}
          <div className="kpi" style={{ fontSize: 34, marginBottom: 10 }}>
            {formatBRL(p.price)}
          </div>

          {/*
            Disponibilidade com PALAVRA, não só com tom: aqui há um único chip na
            tela (ao contrário da grade, onde 337 selos seriam ruído), então o
            estado saudável também aparece selado. Sob grayscale o que separa os
            três é o texto e a espessura do filete do `.badge`.

            O selo fala SEMPRE da loja escolhida no seletor abaixo, e a frase
            fala da rede — sem dizer isso nos dois lugares a tela se
            autocontradizia: "Últimas unidades" ao lado de "16 unidades em 13
            lojas" faz o cliente achar que um dos dois números está errado.
            A frase vai em Inter (.muted) porque é frase; mono em texto corrido é
            proibido pelo manual.
          */}
          <div style={{ marginBottom: 16 }}>
            {unidadesRede === 0 ? (
              <span className="badge gray" style={chipComIcone}>
                <Icon name="menos" size={13} />
                Esgotado na rede
              </span>
            ) : naLoja === 0 ? (
              <span className="badge amber" style={chipComIcone}>
                <Icon name="atencao" size={13} />
                Sem saldo nesta loja
              </span>
            ) : naLoja <= LIMIAR_ULTIMAS ? (
              <span className="badge amber" style={chipComIcone}>
                <Icon name="atencao" size={13} />
                {naLoja === 1 ? 'Última unidade nesta loja' : 'Últimas unidades nesta loja'}
              </span>
            ) : (
              <span className="badge green" style={chipComIcone}>
                <Icon name="check" size={13} />
                Disponível nesta loja
              </span>
            )}
            <p className="muted" style={{ margin: '8px 0 0', fontSize: 13 }}>
              {unidadesRede === 0
                ? 'Nenhuma loja da rede tem saldo deste modelo no momento.'
                : `Nesta loja: ${naLoja === 0 ? 'nenhuma unidade' : `${naLoja} ${naLoja === 1 ? 'unidade' : 'unidades'}`}. ` +
                  `Na rede: ${unidadesRede} em ${stockRows.length} ${stockRows.length === 1 ? 'loja' : 'lojas'}.`}
            </p>
          </div>

          <div className="card" style={{ marginBottom: 16 }}>
            {/* O código do ERP é IDENTIFICADOR, e é o lugar em que a mono é
                função e não decoração: o cliente compara "RB4446L" com
                "RB4446I" caractere a caractere ao telefone com a loja, e é a
                largura fixa que faz a diferença saltar. Caixa normal e
                entreletras zero, ao contrário do carimbo — caixa alta e
                espaçamento atrapalhariam justamente essa comparação. */}
            <Ficha rotulo="Código">
              <Codigo>{p.externalId}</Codigo>
            </Ficha>
            {/* Filete neutro separa item dentro da seção (o dourado é reservado
                para abrir/fechar seção — a régua tem que ser lida antes do texto). */}
            <hr className="rule" />
            {/* `||`, não `??`: o catálogo real traz cor e tamanho como string
                VAZIA, e `??` só cobre null/undefined — a linha ficava sem valor
                nenhum, parecendo um defeito de renderização. */}
            <Ficha rotulo="Cor">{p.color?.name || '—'}</Ficha>
            <hr className="rule" />
            <Ficha rotulo="Tamanho">{p.size?.name || '—'}</Ficha>
            {fornecedor && (
              <>
                <hr className="rule" />
                {/* Único item da ficha que NÃO é par rótulo/valor na mesma
                    linha: a razão social do catálogo real tem até 50
                    caracteres e, alinhada à direita como os outros valores,
                    quebra em duas linhas com a margem esquerda em serrilha.
                    Rótulo em cima, frase embaixo em Inter — em mono caixa alta
                    com 0,18em ela ocuparia três linhas e não se leria. */}
                <div>
                  <span className="label">Fornecedor</span>
                  <p className="muted" style={{ margin: '2px 0 0', fontSize: 13, lineHeight: 1.45 }}>
                    {fornecedor}
                  </p>
                </div>
              </>
            )}
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
              <span className={`badge ${msg.ok ? 'green' : 'red'}`} role="status" style={{ ...chipComIcone, padding: '6px 12px' }}>
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

/** Linha da ficha técnica: rótulo em Inter 12/600 à esquerda (`.label`), valor à
 *  direita — em Inter, ou em `.codigo` quando for identificador. */
function Ficha({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return (
    <div className="row-between" style={{ gap: 16, alignItems: 'baseline' }}>
      <span className="label" style={{ flex: 'none' }}>
        {rotulo}
      </span>
      <span style={{ minWidth: 0, textAlign: 'right' }}>{children}</span>
    </div>
  );
}
