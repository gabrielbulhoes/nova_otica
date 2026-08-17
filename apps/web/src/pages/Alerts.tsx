import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getAlerts,
  getCategories,
  getRebalancePlan,
  getStores,
  setMinStock,
  type StockAlert,
} from '../api/client';
import {
  PageHeader,
  Loading,
  ErrorState,
  StatCard,
  Selo,
  Botao,
  AberturaDeSecao,
} from '../components/ui';
import { Icon } from '../brand/Icon';
import { useAuth } from '../auth/AuthContext';
import { useScope } from '../lib/scope';

/**
 * Alertas de falta — a tela que diz o que está faltando agora.
 *
 * "Ruptura" saiu do texto da tela por pedido do Galbe (Feedbacks 6.0, item
 * 03): é jargão de gestão de estoque, e quem opera loja diz "em falta" ou
 * "furou". O estado no código continua OUT — o que mudou é a palavra que a
 * pessoa lê, não a semântica.
 *
 * SEM BOTÃO PRIMÁRIO SÓLIDO, e por decisão: esta tela é leitura e triagem. As
 * únicas coisas que ela deixa fazer são ajustar o mínimo de uma linha (utilitário
 * de linha, nunca a ação da tela) e ir para o plano de transferências — e o manual
 * é explícito em reservar o contornado para navegação e o sólido para "o que a
 * tela existe para fazer". Não há uma ação de tela aqui; forçar um ouro
 * preenchido só para ter um seria mentir sobre a hierarquia.
 *
 * O "OK" de cada linha, que era contornado em ouro, virou fantasma: com mais de
 * uma dezena de linhas visíveis por vez, uma coluna inteira de ouro estourava
 * sozinha os 5% de área dourada que o manual permite.
 */
export function Alerts() {
  const { isAdmin } = useAuth();
  const { scope } = useScope();
  const [level, setLevel] = useState('');
  const [storeId, setStoreId] = useState('');
  const [category, setCategory] = useState('');

  const stores = useQuery({ queryKey: ['stores', 'planejaveis'], queryFn: () => getStores('planejaveis'), enabled: isAdmin });
  const categories = useQuery({
    queryKey: ['categories', scope],
    queryFn: () => getCategories({ group: scope }),
  });

  // Trocar o recorte no título pode deixar um tipo escolhido fora da lista.
  // Em vez de exibir um filtro fantasma, ele se desfaz sozinho.
  const tipos = categories.data ?? [];
  const tipo = category && tipos.length > 0 && !tipos.includes(category) ? '' : category;

  const alerts = useQuery({
    queryKey: ['alerts', scope, storeId, tipo],
    queryFn: () =>
      getAlerts({ group: scope, storeId: storeId || undefined, category: tipo || undefined }),
  });
  const rows = (alerts.data?.rows ?? []).filter((r) => !level || r.level === level);

  // Alerta de transferência (feedback 07): antes de comprar, remanejar o que a
  // rede já tem. Só ADMIN (o plano é da rede inteira).
  //
  // Feedbacks 5.0, item 02 ("ainda aparece lente nos alertas"): este bloco não
  // passava `group`, então o plano vinha no padrão da API e ignorava o recorte
  // do topo — a tabela de cima obedecia, a de baixo não.
  const rebalance = useQuery({
    queryKey: ['planning-rebalance', '90', scope],
    queryFn: () => getRebalancePlan({ days: '90', group: scope }),
    enabled: isAdmin,
    staleTime: 5 * 60_000,
  });
  const transfers = rebalance.data?.rows.slice(0, 8) ?? [];

  const lojaEscolhida = stores.data?.rows.find((s) => s.id === storeId)?.name;
  const filtrando = Boolean(storeId || tipo || level);

  return (
    <>
      <PageHeader
        eyebrow="Operação"
        title="Alertas de falta"
        subtitle="Produtos sem saldo (em falta) ou abaixo do estoque mínimo, por loja."
      />

      {/* Filtros da tela: sem loja e sem tipo de produto, uma lista da rede
          inteira com tudo junto não é operável. */}
      <div className="toolbar">
        {isAdmin && (
          <select value={storeId} onChange={(e) => setStoreId(e.target.value)} aria-label="Loja">
            <option value="">Todas as lojas</option>
            {stores.data?.rows.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        )}
        <select value={tipo} onChange={(e) => setCategory(e.target.value)} aria-label="Tipo de produto">
          <option value="">Todos os tipos</option>
          {tipos.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select value={level} onChange={(e) => setLevel(e.target.value)} aria-label="Nível do alerta">
          <option value="">Em falta e estoque baixo</option>
          <option value="OUT">Somente os que faltam</option>
          <option value="LOW">Somente estoque baixo</option>
        </select>
        <span style={{ flex: 1 }} />
        {filtrando && (
          <Botao
            variante="discreto"
            pequeno
            icone="limpar"
            onClick={() => {
              setStoreId('');
              setCategory('');
              setLevel('');
            }}
          >
            Limpar filtros
          </Botao>
        )}
      </div>

      {alerts.data && (
        <>
          {/* HIERARQUIA — os três indicadores tinham UMA assinatura só: mesmo
              fundo, mesma moldura, mesmo corpo de número. Enfileirados assim,
              "2097", "288" e "1809" pesavam igual, e o maior deles (o total) é
              justamente o que menos manda agir.

              NÍVEL 1 é EM FALTA (saldo 0), e a escolha é operacional: é o único
              dos três que representa venda perdida AGORA. Estoque baixo é aviso
              (ainda há o que vender); total de alertas é a soma dos dois, ou
              seja, não é um fato novo — é aritmética dos outros dois cartões.
              `largo` porque este é o número em torno do qual a tela inteira
              existe, e a coluna dupla o separa do vizinho antes mesmo da cor. */}
          <div className="grid grid-3">
            {/* Ícone nos dois indicadores de risco: é o segundo canal de leitura
                antes do número, e é o que separa "em falta" de "baixo" no cinza. */}
            <StatCard
              nivel={1}
              className="largo"
              label="Em falta (saldo 0)"
              value={alerts.data.out}
              icon="atencao"
              unidade="itens"
              hint="Sem saldo para vender nesta seleção — cada linha é uma venda que a loja não faz hoje."
            />
            <StatCard
              label="Estoque baixo"
              value={alerts.data.low}
              icon="prazo"
              unidade="itens"
              hint="Ainda há o que vender, mas abaixo do mínimo."
            />
          </div>

          {/* NÍVEL 3 — contexto. O total não é um quarto fato: é a soma dos dois
              acima, e serve para dizer sobre QUE recorte eles foram contados.
              Sem moldura e sem fundo, recua sem sumir. */}
          <div className="grid grid-3" style={{ marginTop: 10 }}>
            <StatCard
              nivel={3}
              label="Total de alertas"
              value={alerts.data.total}
              hint={[lojaEscolhida ?? 'Toda a rede', tipo || 'todos os tipos'].join(' · ')}
            />
          </div>
        </>
      )}

      {/* A lista abre com a régua dourada do manual, como no Dashboard: sem ela
          os indicadores e a tabela chegavam ao olho como uma pilha só, que é a
          "confusão de informações" que o cliente apontou. */}
      <AberturaDeSecao
        eyebrow="Lista"
        titulo="O que está faltando agora"
        descricao="Uma linha por produto e loja. O mínimo pode ser ajustado na própria linha."
      />

      <div className="card" style={{ padding: 0 }}>
        {alerts.isError ? (
          <ErrorState message={alerts.error instanceof Error ? alerts.error.message : undefined} />
        ) : alerts.isLoading ? (
          <Loading />
        ) : rows.length > 0 ? (
          <table>
            <thead>
              <tr>
                <th>Nível</th>
                <th>Produto</th>
                <th>Loja</th>
                <th className="num">Disponível</th>
                <th className="num">Mínimo</th>
                {isAdmin && <th className="num">Ajustar mínimo</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.storeId}-${r.productId}`}>
                  <td>
                    {/* Três canais no selo: palavra, ícone e peso. O triângulo de
                        atenção e o mostrador de prazo continuam distintos em
                        escala de cinza, onde --terra e --ambar têm praticamente
                        a mesma luminância (1.19:1 entre si). */}
                    {r.level === 'OUT' ? (
                      <Selo tom="red" icone="atencao" forte title="Saldo zero: não há o que vender nesta loja.">
                        Em falta
                      </Selo>
                    ) : (
                      <Selo tom="amber" icone="prazo" title="Abaixo do estoque mínimo definido para esta loja.">
                        Baixo
                      </Selo>
                    )}
                  </td>
                  <td>{r.description}</td>
                  <td>{r.storeName}</td>
                  <td className="num">{r.availableNow}</td>
                  <td className="num">{r.threshold}</td>
                  {isAdmin && (
                    <td className="num">
                      <MinStockEditor alert={r} />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div
            className="empty"
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}
          >
            <Icon name={filtrando ? 'filtro' : 'aprovar'} size={18} />
            <span>
              {filtrando
                ? 'Nenhum alerta com esses filtros.'
                : 'Nenhum alerta — toda a rede está acima do estoque mínimo.'}
            </span>
          </div>
        )}
      </div>

      {isAdmin && rebalance.data && transfers.length > 0 && (
        <>
          {/* Mesma abertura de seção do bloco acima: o sobretítulo em mono é
              etiqueta curta (1 palavra) — é onde a caixa alta espaçada está no
              lugar dela — e o título vai em Fraunces. O <Icon> saiu porque a
              régua dourada já é o marcador de seção; os dois juntos marcavam a
              mesma coisa duas vezes. */}
          <AberturaDeSecao
            eyebrow="Remanejamento"
            titulo="Transferências sugeridas — remanejar antes de comprar"
            descricao={
              <>
                A rede tem <strong>{rebalance.data.summary.units}</strong> unidades a mover em{' '}
                <strong>{rebalance.data.summary.suggestions}</strong> sugestões (custo zero): produto
                parado numa loja com saída em outra.
              </>
            }
          />
          <div className="card">
            <table>
            <thead>
              <tr>
                <th>Produto</th>
                {/* A seta aqui é pontuação dentro do rótulo "De → Para", não
                    ícone: um <Icon> no meio de um cabeçalho de coluna leria como
                    ação clicável. Mesma razão na célula abaixo. */}
                <th>De → Para</th>
                <th className="num">Qtd</th>
                <th>Motivo</th>
              </tr>
            </thead>
            <tbody>
              {transfers.map((t, i) => (
                <tr key={`${t.productId}-${t.fromStoreId}-${t.toStoreId}-${i}`}>
                  <td>{t.description}</td>
                  <td>
                    {t.fromStoreName} <span className="muted">→</span> {t.toStoreName}
                  </td>
                  <td className="num">{t.quantity}</td>
                  <td className="muted" style={{ fontSize: 12.5 }}>
                    {t.reason}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <hr className="rule" />
          {/* Navegação leva contornado, nunca sólido — é a regra do manual. Fica
              <Link> (e não botão) para preservar abrir em nova aba e o menu do
              botão direito, que um <button> com onClick joga fora. */}
          <Link
            to="/admin/relatorios"
            className="btn sm"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}
          >
            <Icon name="relatorios" size={15} />
            Ver o relatório completo de transferências
          </Link>
          </div>
        </>
      )}
    </>
  );
}

function MinStockEditor({ alert }: { alert: StockAlert }) {
  const qc = useQueryClient();
  const [value, setValue] = useState(String(alert.threshold));
  const save = useMutation({
    // Editar numa linha de alerta define o mínimo DAQUELA loja (override).
    mutationFn: (v: number) => setMinStock(alert.productId, v, alert.storeId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['alerts'] }),
  });
  // Depois de salvar, o campo volta a ficar "sujo" assim que o operador digita:
  // sem isso o rótulo "Salvo" fica mentindo sobre um valor já alterado.
  const alterado = value !== String(alert.threshold);

  return (
    <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
      <input
        type="number"
        min={0}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        aria-label={`Estoque mínimo de ${alert.description} em ${alert.storeName}`}
        style={{ width: 70, padding: '4px 8px' }}
      />
      <Botao
        variante="discreto"
        pequeno
        icone="check"
        disabled={save.isPending}
        aria-disabled={save.isPending}
        title="Define o mínimo desta loja para este produto"
        onClick={() => save.mutate(Number(value))}
      >
        {save.isPending ? 'Salvando…' : save.isSuccess && !alterado ? 'Salvo' : 'Salvar'}
      </Botao>
    </span>
  );
}
