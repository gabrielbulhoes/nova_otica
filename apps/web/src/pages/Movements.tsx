import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getMovements,
  getStores,
  getProducts,
  createMovement,
  confirmMovement,
  cancelMovement,
  approveMovement,
  rejectMovement,
} from '../api/client';
import {
  PageHeader,
  Loading,
  StatusBadge,
  movementTypeLabel,
  Selo,
  Botao,
  BotaoPrimario,
  Codigo,
  AberturaDeSecao,
  Modal,
} from '../components/ui';
import { Icon } from '../brand/Icon';
import { useAuth } from '../auth/AuthContext';
import { useScope } from '../lib/scope';
import { getRebalancePlan } from '../api/client';
import type { RebalanceSuggestion } from '../api/client';

const TYPES = [
  { value: 'TRANSFER', label: 'Transferência entre lojas' },
  { value: 'SALE', label: 'Baixa por venda' },
  { value: 'RETURN', label: 'Devolução / entrada' },
  { value: 'ADJUSTMENT', label: 'Ajuste manual' },
];

/**
 * Transferências SUGERIDAS pelo motor, no topo da própria tela de
 * transferências.
 *
 * Feedback 04 do Galbe: "o quadro de transferências deveria estar bem mais
 * sugestivo após as análises, consta apenas com uma transferência sugerida".
 * A conta estava certa — ele abriu o REGISTRO de movimentações, que só tinha a
 * linha que ele mesmo criou. As sugestões existiam, em outras duas telas. O
 * defeito é de arquitetura de informação: a tela não entrega o que o nome
 * promete. Agora entrega, e criar a movimentação é um clique.
 */
function SugestoesDeTransferencia({ onCriada }: { onCriada: () => void }) {
  const { scope } = useScope();
  const [criadas, setCriadas] = useState<Set<string>>(new Set());
  const [erro, setErro] = useState<string | null>(null);

  const plano = useQuery({
    queryKey: ['planning-rebalance', '90', scope],
    queryFn: () => getRebalancePlan({ days: '90', group: scope }),
    staleTime: 5 * 60_000,
  });

  const criar = useMutation({
    mutationFn: (r: RebalanceSuggestion) =>
      createMovement({
        type: 'TRANSFER',
        productId: r.productId,
        fromStoreId: r.fromStoreId,
        toStoreId: r.toStoreId,
        quantity: r.quantity,
        reason: r.friendlyReason ?? r.reason,
      }),
    onError: (e: unknown) => setErro(e instanceof Error ? e.message : 'Falha ao criar a movimentação.'),
    onSuccess: (_d, r) => {
      setErro(null);
      setCriadas((s) => new Set(s).add(chave(r)));
      onCriada();
    },
  });

  const chave = (r: RebalanceSuggestion) => `${r.productId}:${r.fromStoreId}:${r.toStoreId}`;
  const rows = plano.data?.rows ?? [];

  if (plano.isLoading) return <Loading />;

  return (
    <>
      {/* ONDA 6 · o título e a explicação saem de DENTRO do card e viram uma
          abertura de seção de verdade. Esta tela empilha dois blocos — o que o
          motor SUGERE e o que já foi REGISTRADO — e eles chegavam ao olho como
          dois retângulos iguais, um debaixo do outro, sem régua nem sobretítulo.
          Era o bloco de título mais fraco de uma tela cuja confusão o cliente
          apontou por nome. A régua dourada + "REMANEJAMENTO" em mono + o título
          em Fraunces dizem, antes de qualquer dado, que ali começa outro
          assunto. */}
      <AberturaDeSecao
        eyebrow="Remanejamento"
        titulo="Transferências sugeridas pelo motor"
        descricao={
          rows.length > 0
            ? `${rows.length} ${rows.length > 1 ? 'sugestões' : 'sugestão'} — de onde está parado para onde vende, somando ${
                plano.data?.summary?.units ?? 0
              } unidades.`
            : 'Nenhuma sugestão no recorte atual. Troque o recorte no topo ou confira o Planejamento.'
        }
      />
      <div className="card" style={{ padding: 0, marginBottom: 18 }}>
        {/* role="alert": a falha acontece longe do olho (o botão fica na última
            coluna da linha), então o leitor de tela precisa anunciá-la sozinho.
            O ícone entra porque `--red` sozinho não é sinal para quem não separa
            vermelho de verde nem para a folha impressa. */}
        {erro && (
          <div
            role="alert"
            style={{
              display: 'flex',
              gap: 6,
              alignItems: 'center',
              fontSize: 12,
              color: 'var(--red)',
              padding: '12px 16px 0',
            }}
          >
            <Icon name="atencao" size={14} />
            <span>{erro}</span>
          </div>
        )}

        {rows.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>Produto</th>
              <th>Rota</th>
              <th className="num">Qtd.</th>
              <th>Por quê</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 30).map((r) => {
              const k = chave(r);
              const feita = criadas.has(k);
              return (
                <tr key={k}>
                  {/* ONDA 6 · A SEGUNDA LINHA ERA UM TRAVESSÃO.
                      Medido nesta build: 24 das 30 linhas traziam, sob a
                      descrição, uma segunda linha em `.muted` contendo só "—".
                      A fonte devolve o travessão como marca ausente, e o JSX só
                      testava `r.brand &&` — string não-vazia, logo verdadeira.
                      O custo não é estético: são 24 linhas de tabela com três
                      linhas de altura em vez de duas, para carregar zero
                      informação. E quando a marca EXISTE ela quase sempre já
                      está no fim da descrição ("... OCULOS RAY BAN"), então
                      repeti-la abaixo também não informa. Só sai a marca que
                      acrescenta alguma coisa. */}
                  <td>
                    <div>{r.description}</div>
                    {r.brand &&
                      !/^[—–-]+$/.test(r.brand.trim()) &&
                      !r.description.toUpperCase().includes(r.brand.trim().toUpperCase()) && (
                        <div className="muted" style={{ fontSize: 11.5 }}>
                          {r.brand}
                        </div>
                      )}
                  </td>
                  {/* Seta como pontuação de rota ("Centro → Shopping"), dentro da
                      frase. Não é ícone e não vira <Icon>: aqui ela é lida como
                      "para" e mora entre dois nomes de loja. */}
                  <td style={{ fontSize: 12.5 }}>
                    {r.fromStoreName} <span className="muted">→</span> <strong>{r.toStoreName}</strong>
                  </td>
                  <td className="num">{r.quantity}</td>
                  <td className="muted" style={{ fontSize: 12 }}>{r.friendlyReason ?? r.reason}</td>
                  <td style={{ textAlign: 'right' }}>
                    {feita ? (
                      /* Era um chip verde escrito "solicitada" — verde é o tom de
                         "concluído", e a movimentação criada aqui nasce em
                         REQUESTED, esperando aprovação. Passa a usar o mesmo par
                         tom+ícone que o StatusBadge dá a REQUESTED na tabela
                         abaixo: um estado, uma aparência, na tela inteira. */
                      <Selo tom="blue" icone="fluxo" title="Na fila, aguardando análise.">
                        solicitada
                      </Selo>
                    ) : (
                      /* ONDA 6 · "Criar movimentação" QUEBRAVA EM DUAS LINHAS.
                         Medido nesta build: 30 de 30 botões desta coluna saíam
                         com 42px de altura contra os ~25px de um botão inteiro
                         — "Criar / movimentação" partido no meio, em toda
                         linha. É o mesmo defeito que o "EM / ESTOQUE" do
                         Estoque, e pela mesma razão: rótulo longo demais para a
                         largura que a coluna pode dar. A correção certa não é
                         alargar a coluna (o espaço vem das colunas de texto,
                         que são as que já quebram) e sim encurtar o rótulo até
                         o verbo. "Transferir" é o que o botão faz — a sugestão
                         é sempre uma transferência entre lojas —, cabe em uma
                         linha e diz mais que "Criar". A frase inteira continua
                         disponível no `title`. */
                      <Botao
                        pequeno
                        icone="transferencias"
                        disabled={criar.isPending}
                        title="Criar a movimentação de transferência desta sugestão."
                        onClick={() => criar.mutate(r)}
                      >
                        Transferir
                      </Botao>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
        {rows.length > 30 && (
          // Frase de rodapé do bloco: `.hint`, Inter 12/400.
          <div className="hint" style={{ padding: '10px 16px' }}>
            Mostrando as 30 de maior impacto, de {rows.length}. O conjunto completo está em Decisões.
          </div>
        )}
      </div>
    </>
  );
}

export function Movements() {
  const qc = useQueryClient();
  const { isAdmin } = useAuth();
  const [statusFilter, setStatusFilter] = useState('');
  const [open, setOpen] = useState(false);

  const movements = useQuery({
    queryKey: ['movements', statusFilter],
    queryFn: () => getMovements({ status: statusFilter || undefined }),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['movements'] });
    qc.invalidateQueries({ queryKey: ['stock'] });
    qc.invalidateQueries({ queryKey: ['alerts'] });
  };

  const confirm = useMutation({ mutationFn: confirmMovement, onSuccess: invalidate });
  const cancel = useMutation({ mutationFn: cancelMovement, onSuccess: invalidate });
  const approve = useMutation({ mutationFn: (id: string) => approveMovement(id), onSuccess: invalidate });
  const reject = useMutation({
    mutationFn: (id: string) => rejectMovement(id, 'Rejeitada pela rede'),
    onSuccess: invalidate,
  });

  return (
    <>
      {/* O ÚNICO sólido da tela.
          A tentação era dar ouro preenchido a "Aprovar", que é o ato de
          governança do fluxo — mas "Aprovar" mora dentro da linha e se repete
          uma vez por movimentação na fila. Trinta botões dourados numa tabela
          não são trinta ações principais: são zero, porque o olho perde a
          referência do que a tela quer que ele faça. O primário fica na única
          ação que existe uma vez só e que responde "para que esta tela existe?":
          registrar uma movimentação. Aprovar/Rejeitar/Confirmar/Cancelar descem
          para contornado e perigo, que é a altura certa de ação por item.
          O "+" que abria o rótulo era glifo fazendo papel de ícone — virou
          <Icon name="mais">, que tem a mesma grade e o mesmo traço do resto. */}
      <PageHeader
        eyebrow="Operação"
        title="Transferências e movimentações"
        subtitle="Operações de estoque registradas em tempo real, reconciliadas na sincronização da manhã."
        actions={
          <BotaoPrimario icone="mais" onClick={() => setOpen(true)}>
            Nova movimentação
          </BotaoPrimario>
        }
      />

      <SugestoesDeTransferencia onCriada={invalidate} />

      {/* O segundo assunto da tela ganha abertura própria: o de cima é o que o
          motor PROPÕE, este é o que já foi REGISTRADO. Sem a régua e o
          sobretítulo, o filtro de status aparecia solto no meio da página, sem
          dizer o que ele filtra. */}
      <AberturaDeSecao
        eyebrow="Registro"
        titulo="Movimentações registradas"
        descricao="Tudo o que já entrou na fila: solicitado, aprovado, confirmado, recusado ou reconciliado."
      />

      <div className="toolbar">
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">Todos os status</option>
          <option value="REQUESTED">Solicitadas</option>
          <option value="PENDING">Aprovadas/Pendentes</option>
          <option value="CONFIRMED">Confirmadas</option>
          <option value="REJECTED">Rejeitadas</option>
          <option value="CANCELLED">Canceladas</option>
          <option value="RECONCILED">Reconciliadas</option>
        </select>
      </div>

      <div className="card" style={{ padding: 0 }}>
        {movements.isLoading ? (
          <Loading />
        ) : movements.data && movements.data.rows.length > 0 ? (
          <table>
            <thead>
              <tr>
                <th>Data</th>
                <th>Tipo</th>
                <th>Produto</th>
                <th>Origem</th>
                <th>Destino</th>
                <th className="num">Qtd.</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {movements.data.rows.map((m) => (
                <tr key={m.id}>
                  {/* Carimbo de data/hora é identificador — é por ele que o
                      gestor casa a movimentação com o que a loja relatou no
                      telefone. Mono caixa normal, entreletras zero, tabular:
                      é a única coluna desta tabela em que os caracteres
                      precisam alinhar de linha para linha. */}
                  <td>
                    <Codigo>{new Date(m.createdAt).toLocaleString('pt-BR')}</Codigo>
                  </td>
                  <td>{movementTypeLabel(m.type)}</td>
                  <td>{m.product.description}</td>
                  <td>{m.fromStore?.name ?? '—'}</td>
                  <td>{m.toStore?.name ?? '—'}</td>
                  <td className="num">{m.quantity}</td>
                  <td>
                    <StatusBadge status={m.status} />
                  </td>
                  {/* Um flex com gap no lugar do {' '} entre botões: espaço em
                      branco de JSX some quando o botão vira inline-flex, e os
                      dois controles encostavam um no outro. */}
                  <td className="right">
                    <span style={{ display: 'inline-flex', gap: 6, justifyContent: 'flex-end' }}>
                      {m.status === 'REQUESTED' && isAdmin && (
                        <>
                          <Botao
                            pequeno
                            icone="aprovar"
                            disabled={approve.isPending}
                            onClick={() => approve.mutate(m.id)}
                          >
                            Aprovar
                          </Botao>
                          <Botao
                            variante="perigo"
                            pequeno
                            icone="recusar"
                            disabled={reject.isPending}
                            onClick={() => reject.mutate(m.id)}
                          >
                            Rejeitar
                          </Botao>
                        </>
                      )}
                      {m.status === 'REQUESTED' && !isAdmin && (
                        <Botao
                          variante="perigo"
                          pequeno
                          icone="limpar"
                          disabled={cancel.isPending}
                          onClick={() => cancel.mutate(m.id)}
                        >
                          Cancelar
                        </Botao>
                      )}
                      {m.status === 'PENDING' && (
                        <>
                          <Botao
                            pequeno
                            icone="check"
                            disabled={confirm.isPending}
                            onClick={() => confirm.mutate(m.id)}
                          >
                            Confirmar
                          </Botao>
                          <Botao
                            variante="perigo"
                            pequeno
                            icone="limpar"
                            disabled={cancel.isPending}
                            onClick={() => cancel.mutate(m.id)}
                          >
                            Cancelar
                          </Botao>
                        </>
                      )}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="empty">Nenhuma movimentação registrada.</div>
        )}
      </div>

      {open && <MovementModal onClose={() => setOpen(false)} />}
    </>
  );
}

function MovementModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  /*
   * `operacionais`, e é a ÚNICA tela que pede isso.
   *
   * As demais passaram a listar só as 16 lojas de varejo (nova rodada · item
   * 06). Aqui a retaguarda continua, porque o GMAIS é a ORIGEM legítima da
   * distribuição do recebimento — o fluxo entregue no feedback 6.0 · item 06 —
   * e uma transferência sem origem possível não é uma tela mais limpa, é uma
   * tela quebrada.
   *
   * ZEISS fica de fora mesmo aqui: mexer no saldo de uma filial cujo número
   * chega desatualizado de outro ERP é escrever ficção sobre estoque real.
   */
  const stores = useQuery({ queryKey: ['stores', 'operacionais'], queryFn: () => getStores('operacionais') });
  const products = useQuery({
    queryKey: ['products', 'modal'],
    queryFn: () => getProducts({ limit: 300 }),
  });

  const [form, setForm] = useState({
    type: 'TRANSFER',
    productId: '',
    fromStoreId: '',
    toStoreId: '',
    quantity: 1,
    reason: '',
    confirm: false,
  });
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: createMovement,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['movements'] });
      qc.invalidateQueries({ queryKey: ['stock'] });
      onClose();
    },
    onError: (err: unknown) => {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        'Erro ao registrar movimentação.';
      setError(msg);
    },
  });

  const needsFrom = form.type === 'TRANSFER' || form.type === 'SALE' || form.type === 'ADJUSTMENT';
  const needsTo = form.type === 'TRANSFER' || form.type === 'RETURN' || form.type === 'ADJUSTMENT';

  const submit = () => {
    setError(null);
    create.mutate({
      type: form.type,
      productId: form.productId,
      fromStoreId: form.fromStoreId || undefined,
      toStoreId: form.toStoreId || undefined,
      quantity: Number(form.quantity),
      reason: form.reason || undefined,
      confirm: form.confirm,
      createdBy: 'web',
    });
  };

  return (
    <Modal titulo="Nova movimentação" onClose={onClose}>

        <div className="field">
          <label>Tipo</label>
          <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
            {TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label>Produto</label>
          <select
            value={form.productId}
            onChange={(e) => setForm({ ...form, productId: e.target.value })}
          >
            <option value="">Selecione…</option>
            {products.data?.rows.map((p) => (
              <option key={p.id} value={p.id}>
                {p.description} (#{p.externalId})
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-2">
          {needsFrom && (
            <div className="field">
              <label>Origem</label>
              <select
                value={form.fromStoreId}
                onChange={(e) => setForm({ ...form, fromStoreId: e.target.value })}
              >
                <option value="">Selecione…</option>
                {stores.data?.rows.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          {needsTo && (
            <div className="field">
              <label>Destino</label>
              <select
                value={form.toStoreId}
                onChange={(e) => setForm({ ...form, toStoreId: e.target.value })}
              >
                <option value="">Selecione…</option>
                {stores.data?.rows.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        <div className="grid grid-2">
          <div className="field">
            <label>Quantidade</label>
            <input
              type="number"
              min={1}
              value={form.quantity}
              onChange={(e) => setForm({ ...form, quantity: Number(e.target.value) })}
            />
          </div>
          <div className="field">
            <label>Motivo (opcional)</label>
            <input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
          </div>
        </div>

        <label className="muted" style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 14 }}>
          <input
            type="checkbox"
            checked={form.confirm}
            onChange={(e) => setForm({ ...form, confirm: e.target.checked })}
          />
          Confirmar imediatamente (efetiva no estoque)
        </label>

        {/* Era um `.badge red`, ou seja: a mensagem inteira do servidor saía em
            JetBrains Mono CAIXA ALTA com 0,18em de entreletras. Frase nenhuma se
            lê assim — some o contorno da palavra, que é o que o olho usa para
            reconhecer forma —, e o manual proíbe mono em texto corrido. Vira
            `.banner` com o filete de 3px na cor do estado (borda IMPRIME,
            preenchimento não) e a frase em Inter. */}
        {error && (
          <div
            role="alert"
            className="banner"
            style={{
              marginBottom: 12,
              fontSize: 12.5,
              lineHeight: 1.4,
              color: 'var(--red)',
              borderLeftColor: 'var(--red)',
            }}
          >
            <Icon name="atencao" size={18} />
            <div>{error}</div>
          </div>
        )}

        <div className="row-between">
          <Botao variante="discreto" onClick={onClose}>
            Cancelar
          </Botao>
          {/* O sólido do MODAL. A tela por trás tem o seu próprio primário
              ("Nova movimentação"), mas nunca os dois ao mesmo tempo: enquanto
              este diálogo está aberto, o overlay deixa a página inerte. Uma
              superfície, um sólido. */}
          <BotaoPrimario
            icone="check"
            disabled={create.isPending || !form.productId}
            onClick={submit}
          >
            {create.isPending ? 'Salvando…' : 'Registrar'}
          </BotaoPrimario>
        </div>
    </Modal>
  );
}
