import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getDecisionBoard, createMovement, formatBRL, recordDecision } from '../api/client';
import type {
  DecisionCard,
  DecisionType,
  DecisionPriority,
  DecisionBoard as DecisionBoardT,
} from '../api/client';
import { Loading, ErrorState, PageHeader, StatCard, Selo, Botao, type TomDeSelo } from '../components/ui';
import { Icon, type IconName } from '../brand/Icon';

/**
 * Portal de Decisões — o quadro onde o gerente decide o que fazer hoje.
 *
 * DUAS ESCOLHAS DE HIERARQUIA QUE VALEM PARA A TELA INTEIRA:
 *
 * 1. Esta tela NÃO tem botão primário sólido, e isso é decisão, não esquecimento.
 *    O sólido dourado responde "para que esta tela existe?" com UM clique — e aqui
 *    a resposta são N decisões, uma por card. Dar o ouro preenchido ao botão de um
 *    card diria "este card importa mais", o que é falso: o board já vem ordenado
 *    por prioridade e impacto. Dentro de cada card, a ação que o card existe para
 *    disparar leva o contornado (ouro de traço) e todo o resto vira fantasma.
 *
 * 2. O tipo do card (comprar / remanejar / liquidar) deixou de ser pintado com as
 *    cores de estado. Antes, remanejar era verde e liquidar era âmbar — as mesmas
 *    cores que no resto do produto significam "saudável" e "atenção". Um card de
 *    alta prioridade chegava com tarja verde. Agora o tipo é neutro (selo
 *    informativo + ícone da grade 24) e verde/âmbar/vermelho ficam livres para
 *    dizer só uma coisa: estado.
 */

const typeMeta: Record<DecisionType, { label: string; icone: IconName }> = {
  COMPRA: { label: 'Comprar', icone: 'compras' },
  REMANEJAMENTO: { label: 'Remanejar', icone: 'transferencias' },
  LIQUIDACAO: { label: 'Liquidar', icone: 'etiqueta' },
};

/**
 * `espessura` é o filete esquerdo do card. É o mesmo canal não cromático que o
 * `.badge` do styles.css já usa (3px crítico · 2px atenção · 1px saudável): a
 * prioridade sobrevive ao cinza e à impressão porque é ESPESSURA, não tom. O
 * filete fica neutro de propósito — quem carrega a cor é o selo, que também
 * carrega a palavra.
 */
const prioMeta: Record<
  DecisionPriority,
  { label: string; tom: TomDeSelo; icone: IconName; forte?: boolean; espessura: number; nota: string }
> = {
  ALTA: {
    label: 'Alta',
    tom: 'red',
    icone: 'atencao',
    forte: true,
    espessura: 3,
    nota: 'Prioridade alta: resolver nesta semana.',
  },
  MEDIA: {
    label: 'Média',
    tom: 'amber',
    icone: 'prazo',
    espessura: 2,
    nota: 'Prioridade média: entra na fila do mês.',
  },
  BAIXA: {
    label: 'Baixa',
    tom: 'gray',
    icone: 'fluxo',
    espessura: 1,
    nota: 'Prioridade baixa: sem urgência.',
  },
};

type TypeFilter = 'ALL' | DecisionType;
type PrioFilter = 'ALL' | DecisionPriority;

/**
 * Par rótulo/valor do manual: número em Fraunces (herói), rótulo em mono caixa
 * alta (serviço). É a mesma gramática do indicador — o card não inventa outra.
 */
function Numero({ rotulo, valor, title }: { rotulo: string; valor: string; title?: string }) {
  return (
    <div title={title} style={{ minWidth: 0 }}>
      <div className="label">{rotulo}</div>
      <div
        style={{
          fontFamily: 'var(--font-titulo)',
          fontSize: 19,
          lineHeight: 1.15,
          marginTop: 3,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {valor}
      </div>
    </div>
  );
}

/** Parâmetro da regra em linha: rótulo curto em mono, valor em Inter legível. */
function Parametro({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 6 }}>
      <span className="label">{rotulo}</span>
      <span style={{ fontSize: 12.5, fontVariantNumeric: 'tabular-nums' }}>{valor}</span>
    </span>
  );
}

/** Erro inline: a palavra e o ícone comunicam; o vermelho só reforça. */
function ErroInline({ children }: { children: string }) {
  return (
    <span
      role="alert"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        fontSize: 11.5,
        color: 'var(--red)',
      }}
    >
      <Icon name="atencao" size={14} />
      {children}
    </span>
  );
}

function Card({ c, onDecided }: { c: DecisionCard; onDecided: () => void }) {
  const t = typeMeta[c.type];
  const p = prioMeta[c.priority];
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [state, setState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  // Decisão persistida (trilha de auditoria). Recusar exige justificativa.
  const [decided, setDecided] = useState<'APPROVED' | 'REJECTED' | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState('');
  const [deciding, setDeciding] = useState(false);
  const [decErr, setDecErr] = useState('');

  const decide = async (outcome: 'APPROVED' | 'REJECTED') => {
    setDeciding(true);
    setDecErr('');
    try {
      await recordDecision({
        cardId: c.id,
        cardType: c.type,
        outcome,
        impact: c.impact,
        note: outcome === 'REJECTED' ? note.trim() : undefined,
        productId: c.productId,
        storeId: c.toStoreId ?? c.fromStoreId,
      });
      setDecided(outcome);
      setRejecting(false);
      onDecided();
    } catch (e) {
      setDecErr(e instanceof Error ? e.message : 'Não foi possível registrar a decisão.');
    } finally {
      setDeciding(false);
    }
  };
  const [err, setErr] = useState('');
  // Transferência de escoamento (card de liquidação) — estado próprio, para
  // não se confundir com a aprovação do card de remanejamento.
  const [escoa, setEscoa] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [escoaErr, setEscoaErr] = useState('');

  /**
   * "Ainda não está gerando o direcionamento e sugestão de transferência, que
   * para mim é a grande entrega dessa categoria" (feedback 05). O card de
   * liquidação agora cria a movimentação: origem, destino e quantidade saem do
   * próprio motor.
   */
  const criarEscoamento = async () => {
    if (!c.outletFromStoreId || !c.outletStoreId || !c.outletQuantity) return;
    setEscoa('loading');
    try {
      await createMovement({
        type: 'TRANSFER',
        productId: c.productId,
        fromStoreId: c.outletFromStoreId,
        toStoreId: c.outletStoreId,
        quantity: c.outletQuantity,
        reason: `Escoamento sugerido no portal de Decisões: liquidar a −${c.discountPct}% em ${
          c.outletStoreName
        } (${c.outletBasis === 'marca' ? 'onde a marca mais sai' : 'onde a peça mais sai'}).`,
      });
      setEscoa('done');
      qc.invalidateQueries({ queryKey: ['movements'] });
      qc.invalidateQueries({ queryKey: ['decisions'] });
    } catch (e) {
      setEscoa('error');
      const ex = e as { response?: { data?: { error?: string } } };
      setEscoaErr(ex.response?.data?.error ?? 'Falha ao criar a transferência.');
    }
  };

  const approveTransfer = async () => {
    if (!c.fromStoreId || !c.toStoreId || !c.quantity) return;
    setState('loading');
    try {
      await createMovement({
        type: 'TRANSFER',
        productId: c.productId,
        fromStoreId: c.fromStoreId,
        toStoreId: c.toStoreId,
        quantity: c.quantity,
        reason: 'Aprovado no portal de Decisões (remanejamento por giro).',
      });
      setState('done');
      qc.invalidateQueries({ queryKey: ['movements'] });
      qc.invalidateQueries({ queryKey: ['decisions'] });
    } catch (e) {
      setState('error');
      const ex = e as { response?: { data?: { error?: string } } };
      setErr(ex.response?.data?.error ?? 'Falha ao solicitar. Tente novamente.');
    }
  };

  return (
    <article
      className="card"
      style={{
        display: 'flex',
        flexDirection: 'column',
        // O filete esquerdo diz a prioridade pela espessura (3/2/1), não pela cor.
        borderLeft: `${p.espessura}px solid var(--border-strong)`,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <Selo tom="blue" icone={t.icone}>
          {t.label}
        </Selo>
        <Selo tom={p.tom} icone={p.icone} forte={p.forte} title={p.nota}>
          {p.label}
        </Selo>
        {/* Idade do card vem do lote de geração: sem isso, um card que
            reaparece há dois meses fica igualzinho ao que estreou hoje. */}
        {c.isNew && (
          <Selo tom="blue" icone="mais" title="Estreou no lote mais recente">
            Novo
          </Selo>
        )}
        {c.isOverdue && (
          <Selo tom="red" icone="prazo" forte title={`${c.ageDays} dias sem decisão registrada`}>
            {c.ageDays}d sem decisão
          </Selo>
        )}
        <span className="carimbo" style={{ marginLeft: 'auto', marginTop: 0 }}>
          {c.id}
        </span>
      </div>

      <div style={{ marginTop: 10 }}>
        <h3 style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.25, margin: 0, fontFamily: 'var(--font-corpo)' }}>
          {c.title}
        </h3>
        <p className="muted" style={{ fontSize: 12.5, margin: '2px 0 0' }}>
          {c.description}
          {c.brand ? ` · ${c.brand}` : ''}
        </p>
      </div>

      <div style={{ fontSize: 12.5, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 9 }}>
        <span className="muted">Alvo:</span>
        <strong>{c.target}</strong>
        {c.quantity != null && c.quantity > 0 && <span className="muted">· {c.quantity} un.</span>}
        {c.urgencyDays != null && (
          <span style={{ color: 'var(--red)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <Icon name="atencao" size={13} />
            ruptura em ~{c.urgencyDays}d
          </span>
        )}
      </div>

      {/* Feedback 05: "liquidar como? remanejar para onde?" — o card passa
          a responder as duas, com o porquê do número. O bloco deixou de ser uma
          caixa dentro da caixa: a régua hierárquica abre a seção, que é como o
          manual constrói hierarquia (filete, não empilhamento de superfícies —
          panel-2 sobre panel dá 1.22:1 e simplesmente não se vê). */}
      {c.type === 'LIQUIDACAO' && (c.discountPct ?? 0) > 0 && (
        <>
          <hr className="rule" />
          <div className="label">Como liquidar</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
            <span
              style={{
                fontFamily: 'var(--font-titulo)',
                fontSize: 20,
                lineHeight: 1,
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              −{c.discountPct}%
            </span>
            <span className="muted" style={{ fontSize: 12.5 }}>
              desconto sugerido
            </span>
            {c.discountMaxPct != null && (
              <span className="muted" style={{ fontSize: 12.5 }}>
                · teto {c.discountMaxPct}%{' '}
                {c.discountParams?.ceilingEstimated ? '(margem estimada)' : '(zera a margem)'}
              </span>
            )}
          </div>
          {c.outletStoreName && (
            <p style={{ margin: '5px 0 0', fontSize: 12.5 }}>
              <span className="muted">Melhor destino: </span>
              <strong>{c.outletStoreName}</strong>
              <span className="muted">
                {c.outletBasis === 'marca' ? ' — é onde a marca mais sai' : ' — é onde a peça mais sai'}
              </span>
            </p>
          )}
          {/* Destino é informação; transferência é ação. A seta em "de A → B" é
              pontuação dentro da frase, não ícone — por isso continua caractere. */}
          {c.outletFromStoreId && c.outletQuantity != null && (
            <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12 }}>
                <span className="muted">Mover </span>
                <strong>{c.outletQuantity} un.</strong>
                <span className="muted">
                  {' '}
                  de {c.outletFromStoreName} → {c.outletStoreName}
                </span>
              </span>
              {escoa === 'done' ? (
                <Selo tom="green" icone="aprovar">
                  Transferência solicitada
                </Selo>
              ) : (
                <Botao
                  variante="discreto"
                  pequeno
                  icone="transferencias"
                  disabled={escoa === 'loading'}
                  aria-disabled={escoa === 'loading'}
                  onClick={criarEscoamento}
                  title="Cria a movimentação de transferência com origem, destino e quantidade do motor"
                >
                  {escoa === 'loading' ? 'Criando…' : 'Criar transferência'}
                </Botao>
              )}
              {escoa === 'error' && <ErroInline>{escoaErr}</ErroInline>}
            </div>
          )}
          {c.discountReason && (
            <p className="muted" style={{ margin: '6px 0 0', fontSize: 12 }}>
              {c.discountReason}
            </p>
          )}
          {/* "É importante entender os parâmetros que estão sendo utilizados
              pra sugestão" — então eles ficam na tela, não no código. Saíram do
              bloco em mono corrido: mono é rótulo curto, não frase de 75
              caracteres. Rótulo em mono, valor em Inter. */}
          {c.discountParams && (
            <>
              <div
                style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 7 }}
                title="Parâmetros da regra da rede, usados para chegar neste número"
              >
                <Parametro rotulo="Margem" valor={`${c.discountParams.marginPct}%`} />
                <Parametro
                  rotulo="Degraus"
                  valor={`${c.discountParams.steps} de ${c.discountParams.stepPct} p.p.`}
                />
                {c.discountParams.stuckDays != null && (
                  <Parametro rotulo="Parada" valor={`${c.discountParams.stuckDays} dias`} />
                )}
              </div>
              {c.discountParams.ceilingEstimated && (
                <p className="muted" style={{ margin: '5px 0 0', fontSize: 11.5 }}>
                  Margem estimada — falta o valor de compra deste produto.
                </p>
              )}
            </>
          )}
        </>
      )}

      <hr className="rule" />

      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
        <Icon name="ideia" size={16} style={{ marginTop: 1, color: 'var(--muted)' }} />
        <div style={{ minWidth: 0 }}>
          <div className="label">Por quê</div>
          <p style={{ fontSize: 12.5, lineHeight: 1.45, margin: '2px 0 0' }}>{c.reason}</p>
        </div>
      </div>

      {/* marginTop:auto encosta o rodapé no pé do card: numa grade de três, os
          números ficam na mesma linha mesmo com corpos de alturas diferentes. */}
      <hr className="rule" style={{ marginTop: 'auto' }} />

      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12 }}>
        <Numero rotulo={c.impactLabel} valor={c.impact > 0 ? formatBRL(c.impact) : '—'} />
        <div style={{ textAlign: 'right' }}>
          <Numero
            rotulo="Confiança"
            valor={`${c.confidence}%`}
            title="Confiabilidade da decisão: mais vendas e histórico = mais confiável."
          />
        </div>
      </div>

      <hr className="rule" />

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        {/* UMA ação contornada por card — a que o card existe para disparar.
            Todo o resto é fantasma. Nenhum sólido: ver a nota do topo. */}
        {decided ? (
          <Selo
            tom={decided === 'APPROVED' ? 'green' : 'gray'}
            icone={decided === 'APPROVED' ? 'aprovar' : 'recusar'}
            title="Registrado na trilha de auditoria"
          >
            {decided === 'APPROVED' ? 'Aprovado' : 'Recusa registrada'}
          </Selo>
        ) : c.type === 'REMANEJAMENTO' ? (
          state === 'done' ? (
            <Selo tom="green" icone="aprovar">
              Transferência solicitada
            </Selo>
          ) : (
            <Botao
              pequeno
              icone="transferencias"
              onClick={approveTransfer}
              disabled={state === 'loading'}
              aria-disabled={state === 'loading'}
            >
              {state === 'loading' ? 'Solicitando…' : 'Aprovar transferência'}
            </Botao>
          )
        ) : (
          <Botao
            pequeno
            icone="aprovar"
            disabled={deciding}
            aria-disabled={deciding}
            onClick={() => decide('APPROVED')}
            title="Registra a aprovação na trilha de auditoria"
          >
            {deciding ? 'Registrando…' : 'Aprovar'}
          </Botao>
        )}

        {!decided && c.type !== 'REMANEJAMENTO' && (
          <Botao variante="discreto" pequeno icone="compras" onClick={() => navigate('/admin/planejamento')}>
            Abrir em Compras
          </Botao>
        )}

        {!decided && state !== 'done' && (
          <Botao
            variante="discreto"
            pequeno
            icone="recusar"
            disabled={deciding}
            aria-disabled={deciding}
            aria-expanded={rejecting}
            onClick={() => setRejecting((v) => !v)}
          >
            Recusar
          </Botao>
        )}

        {state === 'error' && <ErroInline>{err}</ErroInline>}
        {decErr && <div style={{ flexBasis: '100%' }}><ErroInline>{decErr}</ErroInline></div>}

        {rejecting && !decided && (
          <div style={{ flexBasis: '100%', display: 'flex', gap: 6, marginTop: 6 }}>
            <input
              className="input"
              style={{ flex: 1, fontSize: 12 }}
              placeholder="Por que recusar? (obrigatório — fica no histórico)"
              aria-label="Justificativa da recusa"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && note.trim()) decide('REJECTED');
              }}
              autoFocus
            />
            {/* Recusar é a ação irreversível do card: variante de perigo, não ouro.
                O ouro do card já está na aprovação. */}
            <Botao
              variante="perigo"
              pequeno
              icone="recusar"
              disabled={!note.trim() || deciding}
              aria-disabled={!note.trim() || deciding}
              onClick={() => decide('REJECTED')}
            >
              Confirmar recusa
            </Botao>
          </div>
        )}
      </div>
    </article>
  );
}

/**
 * Lote de geração: responde "quando isso foi calculado?" e "o que apareceu de
 * novo?" — as duas primeiras perguntas de quem abre a tela de manhã. O motor
 * recalcula tudo a cada sincronização, então sem esta linha os números da tela
 * não têm data.
 */
function BatchLine({ board }: { board?: DecisionBoardT }) {
  const b = board?.batch;
  if (!b) return null;
  const quando = new Date(b.generatedAt).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
  const novos = board?.summary.novos ?? 0;
  const atrasados = board?.summary.atrasados ?? 0;
  return (
    <div
      className="card"
      style={{
        padding: '10px 14px',
        marginBottom: 14,
        fontSize: 12.5,
        display: 'flex',
        gap: 14,
        flexWrap: 'wrap',
        alignItems: 'center',
      }}
    >
      <span className="label">Lote</span>
      <span>
        <strong>{quando}</strong>
        <span className="muted">
          {b.source === 'CRON' ? ' · sincronização das 6h' : ' · sincronização manual'}
        </span>
      </span>
      <span className="muted">{b.cardsTotal} cards gerados</span>
      {/* "Novos" é informação, não estado operacional: selo neutro. O verde de
          antes dizia "saudável" para algo que é só uma contagem. */}
      {novos > 0 && (
        <Selo tom="blue" icone="mais" title="Cards que estrearam neste lote">
          {novos} novo{novos > 1 ? 's' : ''}
        </Selo>
      )}
      {atrasados > 0 && (
        <Selo tom="red" icone="prazo" forte title="Cards abertos há mais de 30 dias sem decisão registrada">
          {atrasados} atrasado{atrasados > 1 ? 's' : ''}
        </Selo>
      )}
      {/* Na demo não há execuções passadas: a idade dos cards é derivada, não
          medida. Melhor dizer do que exibir número derivado como se fosse real. */}
      {b.simulated && (
        <span className="muted" style={{ fontSize: 11.5, marginLeft: 'auto' }}>
          idades dos cards simuladas nesta demonstração
        </span>
      )}
    </div>
  );
}

export function Decisions() {
  const [typeF, setTypeF] = useState<TypeFilter>('ALL');
  const [prioF, setPrioF] = useState<PrioFilter>('ALL');
  const params = { days: 90, group: 'principal' };
  const board = useQuery({ queryKey: ['decisions', params], queryFn: () => getDecisionBoard(params) });

  const cards = useMemo(() => {
    const all = board.data?.cards ?? [];
    return all.filter(
      (c) => (typeF === 'ALL' || c.type === typeF) && (prioF === 'ALL' || c.priority === prioF),
    );
  }, [board.data, typeF, prioF]);

  const s = board.data?.summary;
  const filtrando = typeF !== 'ALL' || prioF !== 'ALL';

  return (
    <>
      <PageHeader
        title="Decisões"
        subtitle="Cada oportunidade da rede vira um card: o que comprar, o que remanejar e o que liquidar — com prioridade, impacto e o porquê. Ordenado pela prioridade e pelo maior impacto."
      />

      {/* Erro antes de carregamento: sem isso, `!s` mantinha o "Carregando…" para
          sempre quando a consulta falhava, e a tela mentia sobre o próprio estado. */}
      {board.isError ? (
        <ErrorState message={board.error instanceof Error ? board.error.message : undefined} />
      ) : board.isLoading || !s ? (
        <Loading />
      ) : (
        <>
          <BatchLine board={board.data} />
          <div className="grid grid-4" style={{ marginBottom: 18 }}>
            <StatCard
              label="Cards em aberto"
              value={String(s.total)}
              hint={`${s.byType.compra} comprar · ${s.byType.remanejamento} remanejar · ${s.byType.liquidacao} liquidar${
                s.decididos > 0 ? ` · ${s.decididos} já decidido${s.decididos > 1 ? 's' : ''}` : ''
              }`}
            />
            <StatCard
              label="Impacto sob decisão"
              value={formatBRL(s.impactTotal)}
              hint="Capital a comprar somado ao capital a liberar."
            />
            {/* Ícone só nos dois indicadores que carregam risco — é a regra do
                StatCard. Com ele, "alta prioridade" e "crítico" continuam se
                distinguindo do resto sem depender do vermelho que estava aqui. */}
            <StatCard
              label="Alta prioridade"
              value={String(s.byPriority.alta)}
              icon="atencao"
              hint={`${s.byPriority.media} de prioridade média · ${s.byPriority.baixa} de baixa.`}
            />
            <StatCard
              label="Críticos (~7 dias)"
              value={String(s.criticos)}
              icon="prazo"
              hint="Ruptura próxima: o estoque acaba antes de o pedido chegar."
            />
          </div>

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
            <div className="segmented" role="group" aria-label="Filtrar por tipo de decisão">
              {(['ALL', 'COMPRA', 'REMANEJAMENTO', 'LIQUIDACAO'] as TypeFilter[]).map((k) => (
                <button
                  key={k}
                  type="button"
                  className={typeF === k ? 'active' : ''}
                  onClick={() => setTypeF(k)}
                  aria-pressed={typeF === k}
                >
                  {k === 'ALL' ? 'Todos' : typeMeta[k].label}
                </button>
              ))}
            </div>
            <div className="segmented" role="group" aria-label="Filtrar por prioridade">
              {(['ALL', 'ALTA', 'MEDIA', 'BAIXA'] as PrioFilter[]).map((k) => (
                <button
                  key={k}
                  type="button"
                  className={prioF === k ? 'active' : ''}
                  onClick={() => setPrioF(k)}
                  aria-pressed={prioF === k}
                >
                  {k === 'ALL' ? 'Todas' : prioMeta[k].label}
                </button>
              ))}
            </div>
          </div>

          {cards.length === 0 ? (
            <div className="empty" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
              <Icon name={filtrando ? 'filtro' : 'aprovar'} size={18} />
              <span>
                {filtrando
                  ? 'Nenhum card com estes filtros. Volte para "Todos" para ver o quadro inteiro.'
                  : 'Nenhum card em aberto — a rede está ajustada neste recorte.'}
              </span>
            </div>
          ) : (
            <div className="grid grid-3">
              {cards.map((c) => (
                <Card key={c.id} c={c} onDecided={() => board.refetch()} />
              ))}
            </div>
          )}
        </>
      )}
    </>
  );
}
