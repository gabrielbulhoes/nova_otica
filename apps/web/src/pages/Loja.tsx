import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { addToCart, getArProducts, getCart, getStores, formatBRL, type ArProduct } from '../api/client';
import { Loading, Unidade } from '../components/ui';
import { Icon } from '../brand/Icon';
import { VirtualTryOn } from '../ar/VirtualTryOn';
import { useTemaDaVitrine } from '../hooks/useTemaDaVitrine';

/** `.btn` não é flex no CSS; sem isto o ícone empurra a linha de base do rótulo. */
const botaoComIcone: CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 7 };
/** `.badge` é inline-block; o chip só acomoda ícone + palavra em inline-flex. */
const chipComIcone: CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6 };

/**
 * Retorno da mutação em forma de aviso.
 *
 * Antes era só uma string com um visto colado no fim e um `.badge blue` para
 * sucesso e erro igualmente. Emoji não é ícone (renderiza diferente em cada
 * sistema e ignora a cor da marca) e um chip neutro para as duas respostas apaga
 * a diferença entre "foi" e "não foi". Agora o tom é dado por classe, ícone E
 * palavra — a cor sozinha nunca decide, que é a exigência de 1.4.1 e a razão
 * prática de parte dos usuários não separar os tons quentes entre si.
 */
type Aviso = { texto: string; ok: boolean };

/**
 * Quantos cards a grade mostra por vez.
 *
 * O catálogo real da rede traz 337 modelos com provador e saldo. Despejar os 337
 * de uma vez não é vitrine, é listagem de ERP: são 85 fileiras da grade de 4 —
 * altura suficiente para a captura de página inteira do Chromium estourar o
 * tempo limite ao tentar renderizá-la — e o preço, que é o número-herói do
 * card, deixa de ser lido porque não há hierarquia possível em 337 repetições.
 * 24 preenche seis fileiras e cabe em duas rolagens.
 */
const PAGINA = 24;

/**
 * Nome de exibição das categorias do ERP.
 *
 * O dataset traz a categoria crua da rede — 'ARMACAO', 'OCULOS' —, que é como o
 * sistema de origem escreve e como o console interno deve mesmo mostrar. Mas
 * esta é a única tela que o CONSUMIDOR vê: caixa alta sem acento ali não é
 * padrão de dado, é erro de português. A tradução é só de rótulo; o valor que
 * filtra continua sendo o do ERP, então nenhum filtro depende desta tabela.
 */
const NOME_CATEGORIA: Record<string, string> = {
  ARMACAO: 'Armação',
  OCULOS: 'Óculos de sol',
  'OCULOS DE SOL': 'Óculos de sol',
};
const semAcento = (s: string) => (s ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toUpperCase();
/** Exportado porque a página de produto mostra a mesma categoria no rótulo de
 *  abertura: uma tabela só evita que as duas telas divirjam no nome. */
export const nomeCategoria = (c: string | null) => (c ? NOME_CATEGORIA[semAcento(c)] ?? c : 'Sem categoria');

/**
 * Onde o saldo deixa de ser dado e vira alerta — calibrado contra o catálogo
 * real, não escolhido por gosto.
 *
 * Com o limiar em 5 unidades, 195 dos 337 modelos (58%) apareciam com o selo
 * âmbar: a "exceção" era a maioria da grade e o âmbar deixava de significar
 * qualquer coisa — é o mesmo mecanismo pelo qual o dourado em todo botão faria
 * o dourado sumir. Em 1 unidade o selo cai para 56 modelos (17%, cerca de um
 * por fileira de quatro) e volta a ser lido como aviso. O saldo dos demais
 * continua escrito no card, em número; só não é gritado.
 */
const LIMIAR_ULTIMA = 1;

/**
 * Disponibilidade do modelo na rede, em três estados.
 *
 * COR NUNCA SOZINHA: cada estado carrega palavra escrita, e os dois fora do
 * normal carregam também ícone e o filete do `.badge` — âmbar com a régua
 * esquerda de 2px para "atenção", cinza só de contorno para o inerte
 * ("esgotado" não pede reação; ele apenas encerra a compra daquele card). Sob
 * `filter: grayscale(1)` continua legível qual é qual, porque a diferença está
 * na palavra e na forma, não no tom.
 *
 * O estado saudável NÃO ganha chip: 337 selos verdes seriam ruído e ainda
 * roubariam a atenção dos poucos que importam. Ele fica num rótulo em mono —
 * dado de ficha, que é exatamente o que o manual reserva para a JetBrains Mono.
 */
function disponibilidade(unidades: number) {
  if (unidades <= 0) return { tipo: 'esgotado' as const, rotulo: 'Esgotado' };
  if (unidades <= LIMIAR_ULTIMA) return { tipo: 'ultima' as const, rotulo: 'Última unidade' };
  // O saudável não vira frase pronta: a página monta número + carimbo, para que
  // o "un." saia em mono (é unidade colada ao número) e o resto em Inter.
  return { tipo: 'ok' as const, rotulo: `${unidades} un. na rede`, unidades };
}

export function Loja() {
  useTemaDaVitrine();

  const qc = useQueryClient();
  const [storeId, setStoreId] = useState('');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [tryOn, setTryOn] = useState<string | null>(null);
  const [msg, setMsg] = useState<Aviso | null>(null);
  const [visiveis, setVisiveis] = useState(PAGINA);

  const stores = useQuery({ queryKey: ['stores'], queryFn: getStores });
  const products = useQuery({ queryKey: ['ar-products'], queryFn: getArProducts });
  const cart = useQuery({ queryKey: ['cart'], queryFn: getCart });

  const effectiveStore = storeId || stores.data?.rows[0]?.id || '';

  const allRows = useMemo(() => products.data?.rows ?? [], [products.data]);
  const categories = useMemo(
    () => Array.from(new Set(allRows.map((p) => p.category).filter(Boolean))) as string[],
    [allRows],
  );
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allRows.filter((p) => {
      const matchSearch =
        !q || p.description.toLowerCase().includes(q) || (p.brand ?? '').toLowerCase().includes(q);
      const matchCat = !category || p.category === category;
      return matchSearch && matchCat;
    });
  }, [allRows, search, category]);

  // Filtrar tem que devolver a grade ao topo da paginação: sem isto, quem já
  // clicou em "Mostrar mais" três vezes e depois busca "RAY BAN" continua com a
  // janela grande aberta sobre um resultado de 12 itens.
  useEffect(() => setVisiveis(PAGINA), [search, category]);

  const temFiltro = search.trim() !== '' || category !== '';
  const limparFiltros = () => {
    setSearch('');
    setCategory('');
  };

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
  const nomeLoja = stores.data?.rows.find((s) => s.id === effectiveStore)?.name ?? '';

  return (
    <>
      {/*
        A vitrine é a tela mais "marca" do produto, e este bloco é o único lugar
        dela onde a Malha Nano cabe: o manual a reserva para hero e área de
        respiro, nunca sob texto corrido. O pai precisa ser position:relative
        (`.mesh` é inset:0 absoluto) e o conteúdo sobe para z-index 1, senão a
        máscara de pontos passaria por cima do título.

        A malha fica SÓ aqui, uma vez por tela. Repetida nos cards da grade, o
        dourado somado passaria dos 5% de área que o manual autoriza e viraria
        textura de fundo — exatamente o ruído que a regra existe para evitar.
      */}
      <section className="store-hero" style={{ position: 'relative' }}>
        <div className="mesh" />
        <div style={{ position: 'relative', zIndex: 1 }}>
          {/* <div>, não <p>: `.store-hero p` é (0,1,1) e venceria `.eyebrow`
              (0,1,0), devolvendo o rótulo a 19px em --muted — ou seja, o
              utilitário de marca seria silenciosamente desligado. */}
          {/*
             ERA "A Graciosa · Rede de óticas" INTEIRO NO .eyebrow: 27
             caracteres em mono caixa alta com 0,18em de entreletras — medidos
             nesta build. Acima de ~14 caracteres esse tratamento deixa de ser
             carimbo e vira fita: as palavras perdem contorno e a linha é
             soletrada. E era a ÚNICA infração da vitrine, justo na tela que o
             cliente elogiou.

             O conserto guarda a assinatura e devolve a leitura: o nome da rede
             fica carimbado (10 caracteres, dentro do limite) e o descritivo
             desce para Inter. A marca continua sendo a primeira coisa lida.
          */}
          <div className="eyebrow" style={{ justifyContent: 'center' }}>
            A Graciosa
          </div>
          {/* <div>, e não <p>, pela MESMA razão registrada acima para o
              .eyebrow: `.store-hero p` é (0,1,1) e venceria `.hint` (0,1,0),
              devolvendo o descritivo a 19px — do tamanho do subtítulo que vem
              depois do <h1>, competindo com ele. */}
          <div className="hint" style={{ margin: '0 0 2px', textAlign: 'center' }}>
            Rede de óticas
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
          aria-label="Buscar óculos ou marca"
          style={{ minWidth: 220 }}
        />
        <select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Categoria">
          <option value="">Todas as categorias</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {nomeCategoria(c)}
            </option>
          ))}
        </select>
        <select value={effectiveStore} onChange={(e) => setStoreId(e.target.value)} aria-label="Loja de retirada">
          {stores.data?.rows.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        {/* Some quando a busca não devolve nada: ali o mesmo botão já está no
            estado vazio, onde a pessoa está olhando. Dois botões idênticos na
            mesma tela não são reforço, são ruído — a mesma regra que tira o
            "Continuar comprando" do carrinho vazio. */}
        {temFiltro && rows.length > 0 && (
          <button className="btn ghost sm" style={botaoComIcone} onClick={limparFiltros}>
            <Icon name="limpar" size={15} />
            Limpar filtros
          </button>
        )}
        {/* O aviso entra ANTES do link do carrinho, que carrega marginLeft:auto:
            assim ele aparece e some sem deslocar o botão de lugar. */}
        {msg && (
          <span
            className={`badge ${msg.ok ? 'green' : 'red'}`}
            role="status"
            style={{ ...chipComIcone, padding: '6px 12px' }}
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
        <>
          {/* NÚMERO É HERÓI, RÓTULO É SERVIÇO: a contagem do resultado é o dado
              da barra, então vem em Fraunces com o rótulo em mono por cima. A
              frase ao lado é frase — Inter em .muted, nunca o carimbo em mono. */}
          <div className="row-between" style={{ alignItems: 'flex-end', marginBottom: 14, gap: 16 }}>
            <div>
              <div className="label">{temFiltro ? 'Modelos encontrados' : 'Modelos com provador'}</div>
              <div className="kpi" style={{ fontSize: 22 }}>
                {rows.length}
              </div>
            </div>
            <p className="muted" style={{ margin: 0, fontSize: 13, textAlign: 'right' }}>
              {rows.length > visiveis
                ? `Mostrando ${visiveis} de ${rows.length}.`
                : `Mostrando todos os ${rows.length}.`}
              {nomeLoja ? ` Retirada em ${nomeLoja}.` : ''}
            </p>
          </div>

          <div className="grid grid-4">
            {rows.slice(0, visiveis).map((p) => (
              <CardProduto
                key={p.productId}
                produto={p}
                podeAdicionar={!!effectiveStore && !add.isPending}
                onProvar={() => setTryOn(p.productId)}
                onAdicionar={() => add.mutate(p.productId)}
              />
            ))}
          </div>

          {rows.length > visiveis && (
            <div style={{ display: 'flex', justifyContent: 'center', marginTop: 22 }}>
              <button
                className="btn"
                style={botaoComIcone}
                onClick={() => setVisiveis((v) => v + PAGINA)}
              >
                <Icon name="chevron-baixo" size={16} />
                Mostrar mais {Math.min(PAGINA, rows.length - visiveis)} modelos
              </button>
            </div>
          )}
        </>
      ) : (
        /*
          Dois vazios diferentes, e a diferença importa: um é resultado de filtro
          (tem saída, e a saída é um botão) e o outro é ausência de catálogo.
          O texto do segundo dizia "Cadastre assets de AR" — instrução de
          administrador na única tela que o cliente final abre.
        */
        <div className="empty">
          {temFiltro ? (
            <>
              <p style={{ margin: '0 0 14px' }}>Nenhum modelo encontrado com estes filtros.</p>
              <button className="btn ghost sm" style={{ ...botaoComIcone, margin: '0 auto' }} onClick={limparFiltros}>
                <Icon name="limpar" size={15} />
                Limpar filtros
              </button>
            </>
          ) : (
            <p style={{ margin: 0 }}>
              Nenhum modelo com provador virtual disponível no momento. Volte em instantes.
            </p>
          )}
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

/**
 * Card da grade.
 *
 * Dois botões, nenhum sólido: "Provar" é terciário (fantasma) e "Adicionar" é a
 * ação comum (contornado). Multiplicado por 24 cards visíveis, um sólido por
 * card colocaria o dourado em muito além dos 5% de área do manual e o
 * preenchimento deixaria de significar "decisão".
 */
function CardProduto({
  produto,
  podeAdicionar,
  onProvar,
  onAdicionar,
}: {
  produto: ArProduct;
  podeAdicionar: boolean;
  onProvar: () => void;
  onAdicionar: () => void;
}) {
  const estado = disponibilidade(produto.available);
  const esgotado = estado.tipo === 'esgotado';

  return (
    <article className="card" style={{ display: 'flex', flexDirection: 'column' }}>
      {/*
        Lugar da foto do produto. O gradiente `#213354→#16213e` e o desenho em
        `#4f8cff` eram do tema azul anterior, cravados no JSX — cor que não
        passava por token nenhum e sobreviveu à troca de paleta. A superfície
        agora é papel secundário e o desenho é o ícone "loja" (óculos) da grade
        24 do manual, herdando a cor por currentColor.

        `var(--accent)`, e não um token de ouro cravado: o alias da camada 2 é o
        único que TROCA de valor com o tema. Fixar --ouro-dark aqui dava 3.74:1
        no claro e 3.28:1 no escuro — passa raspando o piso de 1.4.11 para
        elemento não textual e some no papel secundário escuro. Pelo alias são
        4.94:1 no claro e 11.51:1 no escuro. (Ouro puro é pior ainda: 1.77:1
        sobre esta superfície, traço que ninguém percebe.)
      */}
      <div
        style={{
          height: 120,
          background: 'var(--panel-2)',
          border: '1px solid var(--border)',
          color: 'var(--accent)',
          display: 'grid',
          placeItems: 'center',
          marginBottom: 12,
        }}
      >
        <Icon name="loja" size={64} />
      </div>

      {/*
        A descrição vem do ERP em caixa alta e com códigos de referência
        ("RB3548NL 001 54 OCULOS RAY BAN"): comprimento irregular entre 20 e 60
        caracteres. Sem o grampo de duas linhas a grade de 4 colunas ganha cards
        de alturas diferentes e o preço — que é o número-herói — para em linhas
        distintas em cada coluna, que é o que destrói a leitura de uma vitrine.
      */}
      <Link
        to={`/loja/produto/${produto.productId}`}
        style={{
          fontWeight: 600,
          color: 'var(--text)',
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
          minHeight: '2.9em',
          lineHeight: 1.45,
        }}
        title={produto.description}
      >
        {produto.description}
      </Link>

      {/* Categoria é ETIQUETA, não frase: "Armação" (7) e "Óculos de sol" (13)
          cabem folgados no limite de 14 caracteres do carimbo. Aqui a densidade
          é baixa — um por card, contra os 40+ rótulos de uma tela do console —
          e é exatamente onde a mono paga o que custa: assina a marca na única
          tela que o consumidor final vê. `.carimbo`, e não `.label`, que desde a
          onda 5 é Inter. */}
      <div className="carimbo" style={{ marginTop: 2 }}>
        {nomeCategoria(produto.category)}
      </div>

      {/* Preço é o número-herói do card — Fraunces com tabular-nums. */}
      <div className="kpi" style={{ marginBottom: 8 }}>
        {formatBRL(produto.price)}
      </div>

      {/* Estado operacional com palavra escrita (regra 1.4.1). O saudável fica
          em rótulo de dado; os dois que pedem cautela viram chip com ícone. */}
      <div style={{ marginBottom: 12, minHeight: 22 }}>
        {estado.tipo === 'ok' ? (
          // "un." é carimbo de unidade colado ao número (`.unidade`, mono caixa
          // alta); "na rede" é frase e fica em Inter. Antes a linha inteira ia
          // em `.label`, o que jogava o carimbo para Inter junto com a frase.
          <span className="hint">
            {estado.unidades}
            <Unidade>un.</Unidade> na rede
          </span>
        ) : (
          <span className={`badge ${esgotado ? 'gray' : 'amber'}`} style={chipComIcone}>
            <Icon name={esgotado ? 'menos' : 'atencao'} size={13} />
            {estado.rotulo}
          </span>
        )}
      </div>

      {/* marginTop:auto encosta a dupla de botões no rodapé do card: com a
          descrição em 1 ou 2 linhas, é o que mantém a linha de ação alinhada
          entre as quatro colunas. */}
      <div style={{ display: 'flex', gap: 8, marginTop: 'auto' }}>
        <button className="btn ghost sm" style={botaoComIcone} onClick={onProvar}>
          <Icon name="loja" size={15} />
          Provar
        </button>
        <button
          className="btn sm"
          style={botaoComIcone}
          disabled={!podeAdicionar || esgotado}
          onClick={onAdicionar}
        >
          <Icon name="mais" size={15} />
          Adicionar
        </button>
      </div>
    </article>
  );
}
