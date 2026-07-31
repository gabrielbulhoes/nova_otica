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
import { PageHeader, Loading, ErrorState, StatCard, Selo, Botao } from '../components/ui';
import { Icon } from '../brand/Icon';
import { useAuth } from '../auth/AuthContext';
import { useScope } from '../lib/scope';

/**
 * Alertas de ruptura — a tela que diz o que está faltando agora.
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

  const stores = useQuery({ queryKey: ['stores'], queryFn: getStores, enabled: isAdmin });
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
  const rebalance = useQuery({
    queryKey: ['planning-rebalance', '90'],
    queryFn: () => getRebalancePlan({ days: '90' }),
    enabled: isAdmin,
    staleTime: 5 * 60_000,
  });
  const transfers = rebalance.data?.rows.slice(0, 8) ?? [];

  const lojaEscolhida = stores.data?.rows.find((s) => s.id === storeId)?.name;
  const filtrando = Boolean(storeId || tipo || level);

  return (
    <>
      <PageHeader
        title="Alertas de ruptura"
        subtitle="Produtos sem saldo (ruptura) ou abaixo do estoque mínimo, por loja."
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
          <option value="">Ruptura e estoque baixo</option>
          <option value="OUT">Somente rupturas</option>
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
        <div className="grid grid-3">
          <StatCard
            label="Total de alertas"
            value={alerts.data.total}
            hint={[lojaEscolhida ?? 'Toda a rede', tipo || 'todos os tipos'].join(' · ')}
          />
          {/* Ícone nos dois indicadores de risco: é o segundo canal de leitura
              antes do número, e é o que separa "ruptura" de "baixo" no cinza. */}
          <StatCard label="Rupturas (saldo 0)" value={alerts.data.out} icon="atencao" />
          <StatCard label="Estoque baixo" value={alerts.data.low} icon="prazo" />
        </div>
      )}

      <div className="card" style={{ marginTop: 16, padding: 0 }}>
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
                        Ruptura
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
        <div className="card" style={{ marginTop: 16 }}>
          <h3 className="section-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Icon name="transferencias" size={20} />
            Transferências sugeridas — remanejar antes de comprar
          </h3>
          <p className="muted" style={{ marginTop: -4, marginBottom: 10, fontSize: 12.5 }}>
            A rede tem <strong>{rebalance.data.summary.units}</strong> unidades a mover em{' '}
            <strong>{rebalance.data.summary.suggestions}</strong> sugestões (custo zero): produto parado numa loja
            com saída em outra.
          </p>
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
