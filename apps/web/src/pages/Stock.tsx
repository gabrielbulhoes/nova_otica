import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getStock, getStores, getCategories, formatBRL, type StockRow } from '../api/client';
import { PageHeader, Loading, Selo, type TomDeSelo } from '../components/ui';
import { Icon, type IconName } from '../brand/Icon';
import { MultiSelect } from '../components/MultiSelect';
import { useScope } from '../lib/scope';

/**
 * Situação do saldo — o estado que a coluna "Disponível" carrega.
 *
 * Antes o estado morava DENTRO do número: um `.badge.green` com "1" e um
 * `.badge.red` com "0". O conteúdo do chip era o dado, não o estado, e a única
 * coisa que dizia "ruptura" era o tom mais a espessura do filete (3px contra
 * 1px). Em `filter: grayscale(1)` as duas linhas viram o mesmo chip cinza com um
 * dígito dentro — e a auditoria mediu ΔE 8.8 entre saudável e crítico sob
 * deuteranopia, ou seja, para parte dos gerentes de loja eles já são a mesma cor
 * na tela colorida.
 *
 * A separação agora é estrutural: o número volta para a coluna numérica (mono,
 * tabular, alinhado à direita, igual a Sincronizado/Reservado/Ajuste) e o estado
 * ganha coluna própria, com PALAVRA + ÍCONE + peso. Nenhum desses três canais é
 * cor.
 *
 * São três estados e não dois porque `availableNow` = saldo − reservas pode
 * ficar negativo, e "a descoberto" não é a mesma conversa que "zerado": um pede
 * reposição, o outro pede conferência da reserva antes de qualquer compra.
 */
interface SituacaoDeSaldo {
  tom: TomDeSelo;
  icone: IconName;
  label: string;
  forte?: boolean;
  nota: string;
}

function situacaoDoSaldo(disponivel: number): SituacaoDeSaldo {
  if (disponivel > 0) {
    return {
      tom: 'green',
      icone: 'aprovar',
      label: 'Em estoque',
      nota: 'Há saldo livre para vender nesta loja. Ação: nenhuma.',
    };
  }
  if (disponivel < 0) {
    return {
      tom: 'red',
      icone: 'atencao',
      forte: true,
      label: 'Negativo',
      nota: 'As reservas superam o saldo da loja. Ação: conferir as reservas antes de repor.',
    };
  }
  return {
    tom: 'red',
    icone: 'atencao',
    forte: true,
    label: 'Ruptura',
    nota: 'Sem saldo livre para venda. Ação: repor ou transferir para cá.',
  };
}

export function Stock() {
  const { scope } = useScope();
  const [search, setSearch] = useState('');
  const [storeIds, setStoreIds] = useState<string[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [onlyAvailable, setOnlyAvailable] = useState(false);

  const stores = useQuery({ queryKey: ['stores'], queryFn: getStores });
  const categoryList = useQuery({ queryKey: ['categories', scope], queryFn: () => getCategories({ group: scope }) });
  const stock = useQuery({
    queryKey: ['stock', search, storeIds, categories, onlyAvailable, scope],
    queryFn: () =>
      getStock({
        search: search || undefined,
        // Arrays → parâmetro repetido: valores seguem literais (vírgula ok).
        storeId: storeIds.length > 0 ? storeIds : undefined,
        category: categories.length > 0 ? categories : undefined,
        group: scope,
        onlyAvailable: onlyAvailable || undefined,
        limit: '200',
      }),
  });

  return (
    <>
      {/* Sem botão sólido: esta tela lê o saldo, não o altera. Quem move estoque
          é Transferências; quem compra é Planejamento. Dar ouro preenchido a um
          filtro seria prometer uma decisão que a tela não toma. */}
      <PageHeader
        eyebrow="Consulta"
        title="Estoque consolidado"
        subtitle="Saldo ao vivo por loja = base sincronizada + movimentações internas, menos reservas."
      />

      <div className="toolbar">
        <input
          // O placeholder some ao digitar: sem aria-label o campo fica sem nome
          // para o leitor de tela justamente enquanto está sendo usado.
          aria-label="Buscar produto, SKU ou marca"
          placeholder="Buscar produto, SKU ou marca…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ minWidth: 260 }}
        />
        <MultiSelect
          options={(stores.data?.rows ?? []).map((s) => ({ value: s.id, label: s.name }))}
          selected={storeIds}
          onChange={setStoreIds}
          allLabel="Todas as lojas"
          noun="lojas"
        />
        <MultiSelect
          options={(categoryList.data ?? []).map((c) => ({ value: c, label: c }))}
          selected={categories}
          onChange={setCategories}
          allLabel="Todas as categorias"
          noun="categorias"
        />
        {/* Rótulo de controle é texto de interface, não carimbo de dado: fica em
            Inter e em tinta cheia, na mesma altura de leitura dos campos ao lado. */}
        <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input
            type="checkbox"
            checked={onlyAvailable}
            onChange={(e) => setOnlyAvailable(e.target.checked)}
          />
          Só com saldo
        </label>
      </div>

      {/* overflowX no card, e não na página: a tabela ganhou a coluna Situação e
          em tela estreita ela rola dentro do próprio painel, sem arrastar a
          barra lateral junto. */}
      <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
        {stock.isLoading ? (
          <Loading />
        ) : stock.data && stock.data.rows.length > 0 ? (
          <table>
            <thead>
              <tr>
                <th>Produto</th>
                <th>Marca</th>
                <th>Loja</th>
                <th className="num">Sincronizado</th>
                <th className="num">Reservado</th>
                <th className="num">Ajuste</th>
                <th className="num">Disponível</th>
                <th className="num">Preço</th>
                <th>Situação</th>
              </tr>
            </thead>
            <tbody>
              {stock.data.rows.map((r: StockRow) => {
                const situacao = situacaoDoSaldo(r.availableNow);
                return (
                  <tr key={`${r.storeId}-${r.productId}`}>
                    <td>
                      <div>{r.description}</div>
                      <div className="muted" style={{ fontSize: 12 }}>
                        #{r.productExternalId}
                        {r.category ? ` · ${r.category}` : ''}
                      </div>
                    </td>
                    <td>{r.brand ?? '—'}</td>
                    <td>{r.storeName}</td>
                    <td className="num">{r.synced}</td>
                    <td className="num">{r.reserved || '—'}</td>
                    <td className="num">{r.pendingDelta ? (r.pendingDelta > 0 ? `+${r.pendingDelta}` : r.pendingDelta) : '—'}</td>
                    <td className="num">{r.availableNow}</td>
                    <td className="num">{formatBRL(r.price)}</td>
                    <td>
                      <Selo tom={situacao.tom} icone={situacao.icone} forte={situacao.forte} title={situacao.nota}>
                        {situacao.label}
                      </Selo>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <div
            className="empty"
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}
          >
            <Icon name="buscar" size={18} />
            <span>Nenhum item encontrado. Ajuste a busca ou os filtros.</span>
          </div>
        )}
      </div>
      {stock.data && (
        // Contagem é rótulo de dado, curto: mono caixa alta. A frase explicativa
        // fica no subtítulo, em Inter — mono não carrega texto corrido.
        <p className="label" style={{ marginTop: 10 }}>
          {stock.data.rows.length.toLocaleString('pt-BR')} de {stock.data.total.toLocaleString('pt-BR')} registros
        </p>
      )}
    </>
  );
}
