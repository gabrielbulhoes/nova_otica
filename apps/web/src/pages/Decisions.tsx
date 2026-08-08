import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  keepPreviousData,
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { getDecisionBoard, createMovement, formatBRL, getStores, recordDecision } from '../api/client';
import type {
  DecisionCard,
  DecisionType,
  DecisionPriority,
  DecisionBoard as DecisionBoardT,
} from '../api/client';
import {
  CARDS_POR_CLIQUE,
  juntarPaginas,
  proximaPagina,
  restantes,
} from '../lib/paginacao';
import {
  Loading,
  ErrorState,
  PageHeader,
  StatCard,
  Selo,
  Botao,
  Codigo,
  Unidade,
  AberturaDeSecao,
  type TomDeSelo,
} from '../components/ui';
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

/**
 * Parâmetro da regra, em linha.
 *
 * ONDA 5 · A LINHA TROCOU DE LADO. Ela tinha o RÓTULO em `.label` (Inter 12/600,
 * escuro) e o VALOR em Inter regular — ou seja, o nome do parâmetro pesava mais
 * que o número, e "Margem / Degraus / Parada" chegavam ao olho com a mesma
 * força do desconto sugerido logo acima, que é a única coisa desta caixa em que
 * alguém age. Agora o rótulo recua (Inter 12, `--muted`, peso normal) e o valor
 * vem em `.codigo`.
 *
 * O valor em mono aqui não é decoração: "45%", "0 de 10 p.p.", "15 dias" são
 * exatamente o que se COMPARA de um card para o outro, lado a lado, numa grade
 * de três. É a regra de ouro do de-para — mono para o que se compara, Inter
 * para o que se lê — e é caixa NORMAL com entreletras zero, porque comparar
 * dígito com dígito é o que a largura fixa serve, e a caixa alta atrapalharia.
 */
function Parametro({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 5 }}>
      <span className="muted" style={{ fontSize: 12 }}>{rotulo}</span>
      <Codigo>{valor}</Codigo>
    </span>
  );
}

/* A hierarquia DENTRO do card é resolvida por `.acao-do-card` (styles.css): a
   zona que carrega o que a pessoa vai FAZER — o desconto a aplicar, a rota da
   transferência — ganha superfície própria e filete dourado de 3px, a mesma
   gramática do cartão nível 1, enquanto a JUSTIFICATIVA do motor fica fora
   dela, em Inter recuado. A nota longa sobre por que o filete vai à esquerda,
   e não no topo, está junto da regra. */

/**
 * Rota de transferência: "de A → B". É a informação que a pessoa executa, e por
 * isso vem em Inter com o par de lojas em <strong> — nome de loja é NOME, se lê
 * inteiro, e mono aqui só custaria contorno de palavra.
 *
 * A seta é pontuação dentro da frase, não ícone: continua caractere.
 */
function Rota({ de, para, quantidade }: { de: string; para: string; quantidade?: number | null }) {
  return (
    <p style={{ margin: '4px 0 0', fontSize: 13, lineHeight: 1.4 }}>
      {quantidade != null && quantidade > 0 && (
        <>
          <strong>{quantidade}</strong>
          <Unidade>un.</Unidade>{' '}
        </>
      )}
      <span className="muted">de </span>
      <strong>{de}</strong>
      <span className="muted"> → </span>
      <strong>{para}</strong>
    </p>
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
      // `reset` e não `invalidate`: o quadro é uma consulta paginada, e
      // invalidar rebuscaria TODAS as páginas já carregadas — uma execução do
      // motor por página. Voltar à primeira custa uma, e é a leitura honesta:
      // a transferência muda o quadro inteiro, não só a página em que se está.
      qc.resetQueries({ queryKey: ['decisions'] });
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
      // Mesma razão do escoamento: uma execução do motor, não N.
      qc.resetQueries({ queryKey: ['decisions'] });
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
        {/* O motivo entra no `title` do próprio selo: "Alta" sem o porquê foi
            metade do feedback 6.0 · item 04 — o gestor via o rótulo e não tinha
            como discordar dele, porque a origem não aparecia em lugar nenhum. */}
        <Selo
          tom={p.tom}
          icone={p.icone}
          forte={p.forte}
          title={c.priorityReason ? `${p.nota}\nPor quê: ${c.priorityReason}` : p.nota}
        >
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
        {/* ONDA 5 · O identificador saiu de `.carimbo` (mono CAIXA ALTA a
            0.18em) para `.codigo` (mono caixa normal, entreletras ZERO). "#L3L.MV4"
            é a cadeia que o operador cola num chamado e confere caractere a
            caractere; a caixa alta apagava a diferença entre o 0 e o O, e o
            0.18em separava tanto os glifos que a cadeia deixava de se ler como
            uma unidade. É o caso em que a mono é FUNÇÃO — e função pede a caixa
            e o espaçamento que a leitura usa, não os que a etiqueta usa. */}
        <span style={{ marginLeft: 'auto' }}>
          <Codigo>{c.id}</Codigo>
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

      {/* No card de remanejamento o "Alvo" É a rota, e a rota agora vive na zona
          de ação logo abaixo. Repeti-la aqui punha o mesmo dado duas vezes no
          mesmo card, com pesos diferentes — que é exatamente a confusão que esta
          onda veio desfazer. Aqui sobra o prazo, que é o que ainda não foi dito. */}
      <div style={{ fontSize: 12.5, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 9 }}>
        {c.type !== 'REMANEJAMENTO' && (
          <>
            <span className="muted">Alvo:</span>
            <strong>{c.target}</strong>
            {c.quantity != null && c.quantity > 0 && (
              <span className="muted">
                · {c.quantity}
                <Unidade>un.</Unidade>
              </span>
            )}
          </>
        )}
        {c.urgencyDays != null && (
          <span style={{ color: 'var(--red)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <Icon name="atencao" size={13} />
            vai faltar em ~{c.urgencyDays}d
          </span>
        )}
      </div>

      {/* ═══ O QUE FAZER ═══════════════════════════════════════════════════
          Feedback 05 pedia que o card respondesse "liquidar como?" e "remanejar
          para onde?" — e ele respondia, só que na mesma voz de tudo o mais.
          Onda 5 separa as duas naturezas que o card carrega:

            · a AÇÃO — o desconto a aplicar e a rota da transferência. É o que
              a pessoa vai executar, e agora mora numa zona promovida
              (`.acao-do-card`: superfície própria + filete de 3px em ouro à
              esquerda), com o número em Fraunces 27px, o mesmo corpo do
              indicador nível 2.
            · a JUSTIFICATIVA — margem, degraus, dias parado, o texto da regra.
              Fica FORA da zona, em Inter recuado, sob o rótulo "Por que este
              número". Continua inteira na tela (ele pediu os parâmetros
              explicitamente), mas para de disputar a leitura com a ação.

          Sem isso, "o desconto é 30%" e "a margem estimada é 45%" chegam com o
          mesmo peso, e são coisas de ordens diferentes: uma é ordem de serviço,
          a outra é nota de rodapé. */}
      {c.type === 'LIQUIDACAO' && (c.discountPct ?? 0) > 0 && (
        <>
          <hr className="rule" />
          <div className="acao-do-card">
            <div className="label">Como liquidar</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
              <span
                style={{
                  fontFamily: 'var(--font-titulo)',
                  // 20px → 27px: o mesmo corpo do número do cartão nível 2. O
                  // desconto é o dado que a tela existe para entregar neste
                  // card; a 20px ele ficava menor que o impacto do rodapé.
                  fontSize: 27,
                  lineHeight: 1,
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                −{c.discountPct}%
              </span>
              <span className="muted" style={{ fontSize: 12.5 }}>
                desconto sugerido
              </span>
            </div>
            {c.outletStoreName && (
              <p style={{ margin: '6px 0 0', fontSize: 12.5 }}>
                <span className="muted">Melhor destino: </span>
                <strong>{c.outletStoreName}</strong>
                <span className="muted">
                  {c.outletBasis === 'marca' ? ' — é onde a marca mais sai' : ' — é onde a peça mais sai'}
                </span>
              </p>
            )}
            {/* Destino é informação; transferência é ação — as duas ficam na
                zona promovida porque a segunda depende da primeira. */}
            {c.outletFromStoreId && c.outletQuantity != null && (
              <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <Rota
                  de={c.outletFromStoreName ?? '—'}
                  para={c.outletStoreName ?? '—'}
                  quantidade={c.outletQuantity}
                />
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
          </div>

          {/* "É importante entender os parâmetros que estão sendo utilizados
              pra sugestão" — então eles ficam na tela, não no código. Fora da
              zona de ação e sob um rótulo que diz o que são: justificativa. */}
          {(c.discountReason || c.discountParams || c.discountMaxPct != null) && (
            <div style={{ marginTop: 9 }} title="Parâmetros da regra da rede, usados para chegar neste número">
              <p className="hint" style={{ margin: 0, fontWeight: 600 }}>Por que este número</p>
              {c.discountReason && (
                <p className="muted" style={{ margin: '3px 0 0', fontSize: 12, lineHeight: 1.4 }}>
                  {c.discountReason}
                </p>
              )}
              <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 6 }}>
                {c.discountMaxPct != null && <Parametro rotulo="Teto" valor={`${c.discountMaxPct}%`} />}
                {c.discountParams && (
                  <>
                    <Parametro rotulo="Margem" valor={`${c.discountParams.marginPct}%`} />
                    <Parametro
                      rotulo="Degraus"
                      valor={`${c.discountParams.steps} de ${c.discountParams.stepPct} p.p.`}
                    />
                    {c.discountParams.stuckDays != null && (
                      <Parametro rotulo="Parada" valor={`${c.discountParams.stuckDays} dias`} />
                    )}
                  </>
                )}
              </div>
              {c.discountParams?.ceilingEstimated && (
                <p className="muted" style={{ margin: '5px 0 0', fontSize: 11.5 }}>
                  Margem estimada — falta o valor de compra deste produto.
                </p>
              )}
            </div>
          )}
        </>
      )}

      {/* O card de remanejamento tinha a rota SÓ dentro do título ("Mover X de A
          para B", em frase corrida) e o botão de aprovar no rodapé, a três
          blocos de distância do dado que ele executa. Quem opera precisa ver
          origem → destino → quantidade sem ler a frase: agora a rota é a zona
          promovida do card, na mesma assinatura da liquidação. */}
      {c.type === 'REMANEJAMENTO' && c.target.includes('→') && (
        <>
          <hr className="rule" />
          <div className="acao-do-card">
            <div className="label">Rota da transferência</div>
            {/* O motor já entrega o par pronto em `target` ("ORIGEM → DESTINO",
                planning.math.ts). Aqui ele é partido só para que cada ponta
                receba o <strong> — o par é o dado, a seta é pontuação. */}
            <Rota
              de={c.target.split('→')[0].trim()}
              para={c.target.split('→')[1].trim()}
              quantidade={c.quantity}
            />
          </div>
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

      {/* Por que esta prioridade — feedback 6.0 · item 04.
          A prioridade passou a ser a PIOR entre três leituras (urgência,
          confiança e valor em jogo), e esta linha nomeia a que mandou. Sem ela
          a mudança seria invisível: o gestor veria outro rótulo no mesmo lugar,
          sem nada que explicasse por que ele mudou. */}
      {c.priorityReason && (
        <p className="muted" style={{ margin: '6px 0 0', fontSize: 11.5, lineHeight: 1.4 }}>
          Prioridade {p.label.toLowerCase()}: {c.priorityReason}.
        </p>
      )}

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
        {/* Carimbo de data/hora: o de-para manda em `.codigo` — mono, caixa
            normal, entreletras zero, tabular. "31/07, 06:00" é uma cadeia que se
            compara com a de ontem, e a tabular é o que faz as duas alinharem. */}
        <Codigo>{quando}</Codigo>
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
  const qc = useQueryClient();
  const [typeF, setTypeF] = useState<TypeFilter>('ALL');
  const [prioF, setPrioF] = useState<PrioFilter>('ALL');
  // Feedback 6.0 · item 05 — "na Central de Decisões é importante ter o filtro
  // de loja e grife".
  //
  // Os quatro continuam sendo filtros de VISTA: recortam quais cards a grade
  // mostra e não mexem em número nenhum do resumo. O que mudou foi ONDE eles
  // rodam. Enquanto o quadro vinha inteiro, filtrar no navegador era natural;
  // com a resposta paginada, filtrar a PÁGINA seria mentira — escolher uma
  // grife que não coubesse nos primeiros 60 cards devolveria "nenhum card" com
  // o quadro cheio deles. Por isso vão na consulta.
  //
  // `loja`, e NÃO `storeId`: `storeId` passa por `scopedStoreId` no servidor e
  // muda o ESCOPO DO CÁLCULO — a compra deixaria de ser de rede e a tela
  // passaria a responder outra pergunta. Aqui só se quer achar cards.
  const [lojaF, setLojaF] = useState<string>('ALL');
  const [grifeF, setGrifeF] = useState<string>('ALL');

  const params = {
    days: 90,
    group: 'principal',
    tipo: typeF === 'ALL' ? undefined : typeF,
    prioridade: prioF === 'ALL' ? undefined : prioF,
    loja: lojaF === 'ALL' ? undefined : lojaF,
    grife: grifeF === 'ALL' ? undefined : grifeF,
  };
  // "Ver mais" pede a PRÓXIMA PÁGINA, com `pageSize` FIXO, e a tela acumula o
  // que chega.
  //
  // Crescer o `pageSize` — como esta tela fazia — não funciona: a rota prende o
  // tamanho num teto, e a partir do clique em que o pedido passa do teto a
  // grade para de crescer para sempre. O botão continuava anunciando "mais 60
  // de 11.737 restantes", nenhum card novo aparecia, os cards além do teto
  // ficavam INALCANÇÁVEIS pela tela, e cada clique inútil ainda pagava uma
  // execução completa do motor. Com página, o botão só some quando a última
  // chegou (`proximaPagina` → `undefined`).
  //
  // `signal`: o AbortSignal que o React Query entrega vai para o axios, e a
  // requisição em voo morre quando a chave muda. Sem isso, trocar de filtro
  // quatro vezes dentro da janela de resposta empilha quatro execuções
  // concorrentes do motor — e a quarta estoura o heap de 768 MB do processo.
  //
  // `keepPreviousData` porque trocar de filtro muda a chave da consulta: sem
  // ele a tela inteira voltaria para "Carregando…", piscando os indicadores que
  // nem mudaram.
  const board = useInfiniteQuery({
    queryKey: ['decisions', params],
    queryFn: ({ pageParam, signal }) =>
      getDecisionBoard({ ...params, page: pageParam, pageSize: CARDS_POR_CLIQUE }, signal),
    initialPageParam: 1,
    getNextPageParam: (ultima) => proximaPagina(ultima.pagina),
    placeholderData: keepPreviousData,
  });
  const lojas = useQuery({ queryKey: ['stores'], queryFn: getStores });

  const paginas = board.data?.pages;
  /** A resposta mais recente: é dela que saem o resumo e o tamanho da vista. */
  const ultima = paginas?.[paginas.length - 1];

  // As grifes vêm do QUADRO INTEIRO, calculadas no servidor: tirá-las de
  // `cards` daria as grifes da PÁGINA, e o seletor perderia exatamente as
  // opções que o gestor precisa procurar.
  const grifes = ultima?.grifes ?? [];
  const cards = juntarPaginas(
    paginas?.map((p) => p.cards),
    (c) => c.id,
  );
  /** Cards que a vista ainda tem para entregar — nunca os que já estão na tela. */
  const faltam = restantes(ultima?.pagina, cards.length);

  const s = ultima?.summary;
  const filtrando = typeF !== 'ALL' || prioF !== 'ALL' || lojaF !== 'ALL' || grifeF !== 'ALL';
  // Compras somem sob filtro de loja porque não têm loja — dito, não escondido.
  // A pergunta é sobre o QUADRO ("existem cards de compra?"), então a resposta
  // vem do resumo: sob filtro de loja eles já não estão mais em `cards`.
  const comprasOcultas = lojaF !== 'ALL' && (s?.byType.compra ?? 0) > 0;
  // Trocar de filtro muda a chave da consulta, e a acumulação de páginas
  // recomeça sozinha na primeira — não há mais contador de "visíveis" para
  // zerar à mão e esquecer num dos quatro controles.
  //
  // `buscando` desabilita os quatro enquanto há busca em voo, como o "Ver mais"
  // já fazia. Um filtro clicável durante a busca é um convite a empilhar
  // execuções do motor, e o processo não sobrevive à quarta.
  const buscando = board.isFetching;
  /**
   * Depois de uma decisão o quadro RECOMEÇA na primeira página, em vez de
   * rebuscar as páginas já carregadas.
   *
   * Duas razões, e as duas pesam: rebuscar N páginas custa N execuções do motor
   * por decisão registrada; e o card decidido sai do quadro, empurrando todos
   * os seguintes para trás — as páginas antigas passariam a descrever um quadro
   * que não existe mais.
   */
  const recomecar = () => qc.resetQueries({ queryKey: ['decisions'] });

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
          <BatchLine board={ultima} />
          {/* ═══ HIERARQUIA DA GRADE DE INDICADORES ═══════════════════════════
              Os três indicadores eram três `.card.stat` idênticos: mesma
              superfície, mesmo filete, mesmo corpo de número. Três respostas com
              a mesma voz para três perguntas de importâncias diferentes — e o
              olho, sem nada que o guie, lê da esquerda para a direita e para no
              primeiro que encontra, seja ele qual for.

              Agora a tela declara o que é: uma FILA de decisões, com uma parte
              que tem prazo.

                nível 1 (largo) · Cards em aberto — o tamanho da fila. É o
                  número que a tela existe para mostrar, e ocupa duas colunas.
                nível 2 · Críticos e Alta prioridade — o recorte com prazo.
                  Apoio: o que se consulta depois de saber o tamanho da fila.
                nível 3 · a repartição por tipo. Era uma frase de 60 caracteres
                  espremida no `hint` de cima ("126 comprar · 1203 remanejar ·
                  51 liquidar"), onde três números diferentes chegavam como
                  texto corrido. Como três cartões de contexto eles voltam a ser
                  números — e custam 102px em vez dos 181px de um cartão normal,
                  o que devolve à tela a altura que o nível 1 tomou. A
                  hierarquia aqui não cobra densidade: ela paga. */}
          <div className="grid grid-4">
            <StatCard
              nivel={1}
              className="largo"
              label="Cards em aberto"
              value={String(s.total)}
              hint={
                s.decididos > 0
                  ? `${s.decididos} já decidido${s.decididos > 1 ? 's' : ''} neste lote — esses saíram da fila.`
                  : 'Nenhum decidido neste lote ainda.'
              }
            />
            {/* Feedbacks 6.0, item 01 (Galbe): "vamos tirar essa info? acho que é
                confusa de entender e passa a impressão de uma falsa verdade".
                Ele está certo, e o defeito é de soma: `impactTotal` juntava
                capital que SAI (comprar) com capital que VOLTA (liquidar). São
                sinais opostos no caixa, e o resultado não é dinheiro nenhum —
                era um número grande sem referente. Os dois valores continuam
                onde significam alguma coisa: no card de cada decisão. */}
            {/* Ícone só nos dois indicadores que carregam risco — é a regra do
                StatCard. Com ele, "alta prioridade" e "crítico" continuam se
                distinguindo do resto sem depender do vermelho que estava aqui. */}
            <StatCard
              label="Críticos (~7 dias)"
              value={String(s.criticos)}
              icon="prazo"
              hint="Vai faltar antes de o pedido chegar."
            />
            <StatCard
              label="Alta prioridade"
              value={String(s.byPriority.alta)}
              icon="atencao"
              hint={`${s.byPriority.media} de média · ${s.byPriority.baixa} de baixa.`}
            />
          </div>

          <div className="grid grid-3" style={{ marginTop: 6, marginBottom: 18 }}>
            <StatCard nivel={3} label="A comprar" value={String(s.byType.compra)} />
            <StatCard nivel={3} label="A remanejar" value={String(s.byType.remanejamento)} />
            <StatCard nivel={3} label="A liquidar" value={String(s.byType.liquidacao)} />
          </div>

          {/* A grade de cards abria sem nada que dissesse onde a leitura dos
              indicadores termina e onde o trabalho começa: os filtros vinham
              soltos, e depois deles a grade, sem título. Esta tela tinha ZERO
              `.rule-section` — a ferramenta que o manual prevê para abrir seção
              estava no CSS e não na tela. */}
          <AberturaDeSecao
            eyebrow="Quadro"
            titulo="Cards de decisão"
            descricao="Cada card traz a ação em destaque e a justificativa do motor logo abaixo."
          />

          {/* Os quatro controles ficam INERTES enquanto há busca em voo. Cada
              troca de filtro é uma execução completa do motor no servidor, e o
              processo tem 768 MB de heap: três concorrentes já batem em 769 MB
              medidos, e a quarta derruba o contêiner. O "Ver mais" já se
              protegia assim; os filtros, que são quatro cliques a um dedo de
              distância um do outro, não. */}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
            <div className="segmented" role="group" aria-label="Filtrar por tipo de decisão">
              {(['ALL', 'COMPRA', 'REMANEJAMENTO', 'LIQUIDACAO'] as TypeFilter[]).map((k) => (
                <button
                  key={k}
                  type="button"
                  className={typeF === k ? 'active' : ''}
                  disabled={buscando}
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
                  disabled={buscando}
                  onClick={() => setPrioF(k)}
                  aria-pressed={prioF === k}
                >
                  {k === 'ALL' ? 'Todas' : prioMeta[k].label}
                </button>
              ))}
            </div>

            {/* Loja e grife são LISTAS, não segmentos: 16 lojas e dezenas de
                grifes não cabem numa barra de botões. */}
            <select
              className="input"
              style={{ maxWidth: 230 }}
              aria-label="Filtrar por loja"
              value={lojaF}
              disabled={buscando}
              onChange={(e) => setLojaF(e.target.value)}
            >
              <option value="ALL">Todas as lojas</option>
              {(lojas.data?.rows ?? []).map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>

            <select
              className="input"
              style={{ maxWidth: 230 }}
              aria-label="Filtrar por grife"
              value={grifeF}
              disabled={buscando}
              onChange={(e) => setGrifeF(e.target.value)}
            >
              <option value="ALL">Todas as grifes</option>
              {grifes.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          </div>

          {/* Comprar é decisão de REDE — o card não tem loja, e por isso some
              quando se filtra por uma. Dizer isso custa uma linha; não dizer
              custa a confiança de quem acha que o filtro comeu os cards. */}
          {comprasOcultas && (
            <p className="hint" style={{ margin: '0 0 12px' }}>
              Os cards de compra não aparecem com filtro de loja: comprar é decisão de rede, e a
              divisão entre as lojas acontece no recebimento do pedido.
            </p>
          )}

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
            <>
              <div className="grid grid-3">
                {cards.map((c) => (
                  <Card key={c.id} c={c} onDecided={recomecar} />
                ))}
              </div>
              {/* A grade desenhava os 1.377 cards de uma vez, e a resposta
                  trazia os 18.541: 16,5 MB por recarga, que é a origem do 503.
                  Agora o corte é do SERVIDOR — o "ver mais" busca a PÁGINA
                  seguinte e junta com o que já está na tela. Como o quadro vem
                  ordenado por prioridade e impacto, os primeiros já são os que
                  importam; mas o botão só desaparece quando a última página
                  chegou, então nenhum card fica fora de alcance.

                  A condição é `hasNextPage`, e não uma comparação de tamanhos
                  feita aqui: quem sabe se ainda há página é o `pagina` da
                  própria resposta. O rótulo mostra o que a próxima ida traz de
                  fato — antes ele anunciava 60 cards que a rota já não
                  entregava mais. */}
              {board.hasNextPage && (
                <div style={{ display: 'flex', justifyContent: 'center', marginTop: 16 }}>
                  <Botao
                    variante="discreto"
                    icone="mais"
                    // Buscar mais é ida ao servidor: sem isto, clicar duas
                    // vezes rápido dispararia duas consultas ao motor.
                    disabled={buscando}
                    onClick={() => board.fetchNextPage()}
                  >
                    {buscando
                      ? 'Buscando…'
                      : `Ver mais ${Math.min(CARDS_POR_CLIQUE, faltam)} de ${faltam} restantes`}
                  </Botao>
                </div>
              )}
            </>
          )}
        </>
      )}
    </>
  );
}
