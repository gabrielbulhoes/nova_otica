import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getStock, getStores, getCategories, formatBRL, type StockRow } from '../api/client';
import {
  PageHeader,
  Loading,
  Selo,
  AberturaDeSecao,
  Codigo,
  type TomDeSelo,
} from '../components/ui';
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
    label: 'Em falta',
    nota: 'Sem saldo livre para venda. Ação: repor ou transferir para cá.',
  };
}

export function Stock() {
  const { scope } = useScope();
  const [search, setSearch] = useState('');
  const [storeIds, setStoreIds] = useState<string[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  // Ligado por padrão. A rede tem mais de um milhão de posições produto×loja
  // e a esmagadora maioria tem saldo zero — abrir a tela de estoque numa
  // lista de zeros não é um estado neutro, é um estado errado.
  const [onlyAvailable, setOnlyAvailable] = useState(true);

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

      {/* A contagem SUBIU para a abertura da seção. Ela estava depois da tabela,
          ou seja, depois de até 200 linhas: quem precisa saber "estou vendo 200
          de 21.683" é justamente quem ainda não rolou, porque é essa a
          informação que diz se vale refinar o filtro antes de ler. Agora ela
          chega junto com o título do bloco.

          Esta tela não ganha indicador de nível 1, e é decisão, não omissão: é
          uma tela de CONSULTA — não existe um número da rede aqui, existe a
          linha que o operador veio procurar. Inventar um destaque no topo seria
          demarcar como principal algo que a tela não tem. A hierarquia aqui é a
          régua de seção separando filtro de resultado. */}
      <AberturaDeSecao
        eyebrow="Resultado"
        titulo="Saldo por produto e loja"
        descricao={
          stock.data ? (
            <>
              Mostrando{' '}
              <strong>{stock.data.rows.length.toLocaleString('pt-BR')}</strong> de{' '}
              <strong>{stock.data.total.toLocaleString('pt-BR')}</strong> registros no recorte atual.
            </>
          ) : undefined
        }
      />

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
                      {/* O código do produto é IDENTIFICADOR — o operador o
                          compara caractere a caractere com o que está na etiqueta
                          da armação. É um dos quatro lugares onde a mono trabalha,
                          e vai em <Codigo>: caixa normal, entreletras zero,
                          tabular. Antes era `.muted`, ou seja, o mesmo tratamento
                          de uma frase de apoio — perdia a largura fixa que é a
                          única razão de a mono existir aqui.
                          O tipo (ARMACAO/OCULOS) fica fora do <Codigo>: é
                          categoria, não identificador. */}
                      <div className="muted" style={{ fontSize: 12 }}>
                        <Codigo>#{r.productExternalId}</Codigo>
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
      {/* A contagem que ficava aqui subiu para a abertura da seção (ver acima).
          De quebra, o `.label` que a envolvia era um erro de vocabulário pelo
          de-para novo: "1.234 de 21.683 registros" é FRASE, não rótulo — e sob a
          regra antiga saía em mono caixa alta com 0.18em, que é exatamente o
          tratamento que o cliente reclamou. */}
    </>
  );
}
