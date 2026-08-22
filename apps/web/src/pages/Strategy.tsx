import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getCommercialStrategy } from '../api/client';
import type { LinhaDoPlano, PlanoDetalhado, RiskProfile, StrategySegment } from '../api/client';
import { AberturaDeSecao, Botao, Loading, PageHeader, Selo, StatCard, Unidade } from '../components/ui';
import { Icon } from '../brand/Icon';

/**
 * Cor de cada fatia da compra.
 *
 * Os três tons precisam ser separáveis SEM cor — a barra empilhada é lida de
 * relance e a auditoria mostrou que a paleta quente do manual colapsa sob
 * deuteranopia. Por isso a escolha é por LUMINÂNCIA, não por matiz:
 * verde (cinza 92) · tinta (cinza 38) · âmbar (cinza 73). Os três também
 * passam de 3:1 como filete de 3px, que é o papel que cumprem no topo dos
 * cartões abaixo.
 *
 * O que NÃO serve aqui, e o motivo: --accent (ouro-texto) fica a 7 pontos de
 * cinza do âmbar, ou seja, duas fatias viram a mesma barra em P&B; e o ouro
 * puro daria um filete de 2.17:1 no cartão — o mesmo erro que a Onda 2 já
 * corrigiu no .banner.warn e no .action-card.
 *
 * São ALIASES da camada 2 de propósito: é o alias que troca de valor no tema
 * escuro; o token da camada 1 ficaria preso ao tema claro.
 */
const segColor: Record<StrategySegment['key'], string> = {
  'best-seller': 'var(--green)',
  lancamento: 'var(--text)',
  aposta: 'var(--amber)',
};
const riskLabel: Record<RiskProfile, string> = {
  conservador: 'Conservador',
  equilibrado: 'Equilibrado',
  agressivo: 'Agressivo',
};
const WINDOWS = [3, 6, 9, 12, 18];
const fmt = (n: number) => n.toLocaleString('pt-BR');

export function Strategy() {
  const [floor, setFloor] = useState(1500);
  const [windowMonths, setWindowMonths] = useState(9);
  const [risk, setRisk] = useState<RiskProfile>('equilibrado');

  const params = { floor, window: windowMonths, risk, days: 90 };
  const q = useQuery({ queryKey: ['strategy', params], queryFn: () => getCommercialStrategy(params) });
  const s = q.data;
  const sliderMax = Math.max(2000, Math.round((s?.capacity ?? 3000) * 1.2));

  return (
    <>
      {/* Sem botão primário nesta tela, e é resposta certa: aqui não se executa
          nada — mexe-se nos parâmetros e o motor recalcula. O ouro preenchido
          fica para a tela que tem uma ação a cometer (Planejamento & Compras). */}
      <PageHeader
        title="Estratégia comercial"
        subtitle="Piso, risco e janela — a estratégia da compra. Defina quanto comprar e como distribuir; o motor valida contra a capacidade da rede e divide em best-seller, lançamento e aposta."
      />

      <div className="grid grid-2" style={{ alignItems: 'start', gap: 16 }}>
        {/* ── Parâmetros ── */}
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          {/* O sobretítulo estava solto, sem a régua e sem título: `.eyebrow`
              sozinho é a etiqueta da seção, não a seção. A abertura completa
              (régua dourada + sobretítulo + título) é o que o manual prevê, e
              esta tela tinha ZERO `.rule-section`. */}
          <AberturaDeSecao
            eyebrow="Entrada"
            titulo="Parâmetros da compra"
            descricao="O que você define. O motor valida contra a rede à direita."
          />

          {/* Deixou de ser um <label> só: ele envolvia DOIS campos, e o rótulo
              nativo só endereça o primeiro. Cada campo carrega o seu aria-label. */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div className="label">Piso de compra</div>
            {/* ONDA 5 · O "un." estava em `.label` — que desde esta onda é Inter
                12/600 caixa normal, ou seja, o carimbo de unidade tinha virado
                um rótulo do tamanho e do peso de um nome de campo, colado a um
                número de 34px. É o caso que o de-para proíbe por escrito
                ("NUNCA .label para carimbo de unidade"). `.unidade` dimensiona
                em relação ao número (0.34em) e volta à mono caixa alta, que é o
                papel legítimo dela: etiquetar, não nomear. */}
            <div className="kpi">
              {fmt(floor)}
              <Unidade>un.</Unidade>
            </div>
            <input
              type="range"
              min={0}
              max={sliderMax}
              step={50}
              value={Math.min(floor, sliderMax)}
              onChange={(e) => setFloor(Number(e.target.value))}
              aria-label="Piso de compra (controle deslizante)"
              style={{ width: '100%', accentColor: 'var(--accent)', border: 'none', padding: 0 }}
            />
            <input
              type="number"
              min={0}
              value={floor}
              onChange={(e) => setFloor(Math.max(0, Number(e.target.value) || 0))}
              aria-label="Piso de compra em unidades"
              style={{ width: 130 }}
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div className="label">Perfil de risco</div>
            <div className="segmented">
              {(['conservador', 'equilibrado', 'agressivo'] as RiskProfile[]).map((k) => (
                <button
                  key={k}
                  type="button"
                  className={risk === k ? 'active' : ''}
                  onClick={() => setRisk(k)}
                  aria-pressed={risk === k}
                >
                  {riskLabel[k]}
                </button>
              ))}
            </div>
            <div className="hint">Conservador reforça o que já vende; agressivo abre mais espaço para aposta.</div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <label className="label" htmlFor="janela-de-venda">Janela de venda</label>
            <select
              id="janela-de-venda"
              className="input"
              value={windowMonths}
              onChange={(e) => setWindowMonths(Number(e.target.value))}
              style={{ width: 160 }}
            >
              {WINDOWS.map((m) => <option key={m} value={m}>{m} meses</option>)}
            </select>
          </div>
        </div>

        {/* ── Decisão do motor ── */}
        <div className="card">
          {/* "Decisão do motor" tem 16 caracteres, e o sobretítulo é mono caixa
              alta a 0.18em — acima de ~14 caracteres a entreletras desmancha a
              palavra. Encurtado para uma palavra, que é a dose que o de-para
              pede para `.eyebrow` (1 a 2 palavras); o nome inteiro passou para o
              título, em Fraunces, onde ele se lê. */}
          <AberturaDeSecao
            eyebrow="Motor"
            titulo="Decisão do motor"
            descricao="A validação contra a capacidade real da rede na janela escolhida."
          />
          {q.isLoading || !s ? (
            <Loading />
          ) : (
            <>
              {/* Era um bloco com fundo em color-mix e canto arredondado: fora do
                  sistema (superfície é papel, raio 0) e com o estado só na cor.
                  O .banner já traz filete esquerdo na cor do estado, e o selo
                  traz a palavra e o ícone — três canais, nenhum deles cromático. */}
              <div className={`banner ${s.viable ? 'ok' : 'warn'}`} style={{ alignItems: 'flex-start' }}>
                <Selo
                  tom={s.viable ? 'green' : 'amber'}
                  icone={s.viable ? 'aprovar' : 'atencao'}
                  forte={!s.viable}
                >
                  {s.viable ? 'Viável' : 'Atenção'}
                </Selo>
                <span style={{ lineHeight: 1.45 }}>{s.verdict}</span>
              </div>

              {/* Os três números que sustentam o veredito eram três <div> soltos
                  com `.label` + `.kpi`, num flex de 28px de intervalo: a mesma
                  informação que o resto do console entrega em <StatCard>, mas
                  desenhada à mão e sem nível. São CONTEXTO do banner de veredito
                  logo acima — a conta que o motor fez para dizer "viável" —, e
                  contexto é literalmente o papel do nível 3: filete de topo,
                  sem moldura e sem fundo, número em 20px. Recuam sem sumir, e
                  ocupam 102px em vez de 181px.
                  O "un." do primeiro saiu de `.label` para `.unidade`, pelo
                  mesmo motivo do piso de compra acima. */}
              <div className="grid grid-3" style={{ marginBottom: 18 }}>
                <StatCard
                  nivel={3}
                  label="Capacidade na janela"
                  value={fmt(s.capacity)}
                  unidade="un."
                />
                <StatCard nivel={3} label="Uso da capacidade" value={`${s.capacityUsedPct}%`} />
                <StatCard nivel={3} label="Com lastro" value={`${s.backedPct}%`} />
              </div>

              {/* Barra empilhada */}
              <div className="hint" style={{ marginTop: 0, marginBottom: 6 }}>
                Como as {fmt(s.floorUnits)} un. se dividem
              </div>
              <div style={{ display: 'flex', height: 22, overflow: 'hidden', border: '1px solid var(--border)' }}>
                {s.segments.filter((x) => x.units > 0).map((seg) => (
                  <div key={seg.key} title={`${seg.label}: ${fmt(seg.units)} un. (${seg.pct}%)`}
                       style={{ width: `${seg.pct}%`, background: segColor[seg.key] }} />
                ))}
                {s.floorUnits === 0 && <div style={{ width: '100%', background: 'var(--panel-2)' }} />}
              </div>

              {/* Legenda direta, na MESMA ordem da barra. Sem ela a barra separa
                  as fatias só por cor, e cor sozinha não opera (WCAG 1.4.1):
                  o nome escrito e a ordem são o que sobra em escala de cinza. */}
              <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginTop: 8 }}>
                {s.segments.map((seg) => (
                  <span key={seg.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 12.5 }}>
                    <span style={{ width: 14, height: 3, background: segColor[seg.key], flex: 'none' }} />
                    {seg.label}
                    <span className="muted">{seg.pct}%</span>
                  </span>
                ))}
              </div>

              {s.withoutBacking > 0 && (
                <div className="banner warn" style={{ marginTop: 14, marginBottom: 0 }}>
                  <Icon name="atencao" size={18} />
                  <span>
                    <strong>
                      {fmt(s.withoutBacking)}
                      <Unidade>un.</Unidade>
                    </strong>{' '}
                    acima da demanda projetada (sem lastro).
                  </span>
                </div>
              )}

              <div className="grid grid-3" style={{ marginTop: 16, gap: 10 }}>
                {s.segments.map((seg) => (
                  // Os três seguem NO MESMO nível de propósito: são as três
                  // fatias de uma divisão, e promover uma seria mentir sobre a
                  // decisão do motor. O que os separa é o filete de topo de 3px
                  // na cor da fatia — o mesmo canal geométrico do nível 1,
                  // usado aqui para IDENTIDADE e não para hierarquia, e na
                  // mesma ordem da barra empilhada logo acima.
                  <div key={seg.key} className="card" style={{ padding: 14, borderTop: `3px solid ${segColor[seg.key]}` }}>
                    <div className="label">{seg.label}</div>
                    <div className="kpi">
                      {fmt(seg.units)}
                      <Unidade>un.</Unidade>
                    </div>
                    <div className="hint">{seg.rationale} · {seg.pct}%</div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── O PLANO DETALHADO ──
          Os cartões acima param em "quanto". Daqui para baixo é "o quê" e
          "para onde" — a distância entre "compre 900 peças" e "compre 16 do
          DB99 Voyager, 6 para Guarabira". */}
      {s?.detalhe && <PlanoDeCompra plano={s.detalhe} segments={s.segments} />}
    </>
  );
}

// ─── O plano DETALHADO — o que comprar, e para onde ─────────────────────────
//
// "ele sugere a compra, mas ele não sugere como distribuir isso pra por loja.
//  É isso que a gente precisa sacar."
//
// Os três cartões acima respondem QUANTO. Daqui para baixo é O QUÊ e PARA
// ONDE, na hierarquia que o cliente usa para pensar a compra:
// Marca → Tipo → Gênero → SKU.

type Agrupado = { chave: string; units: number; linhas: LinhaDoPlano[]; filhos?: Agrupado[] };

/**
 * O BALCÃO — só o modo feira usa.
 *
 * O plano é igual nos dois modos; o que a feira acrescenta é lançar, ali de
 * pé, o que se decidiu levar. Entra como um controle opcional em vez de uma
 * segunda árvore copiada: duas hierarquias com a mesma regra divergem, e esta
 * base já pagou esse preço três vezes com vocabulário duplicado.
 */
export interface ControleDeCompra {
  /** O que mostrar no contador — com o lançamento otimista por cima. */
  valorDe: (offerId: string) => number;
  lancar: (offerId: string, unidades: number) => void;
  salvando: ReadonlySet<string>;
  falhou: ReadonlySet<string>;
}

/** O contador de balcão de uma linha: menos, quanto, mais. */
function ContadorDeCompra({ offerId, controle }: { offerId: string; controle: ControleDeCompra }) {
  const valor = controle.valorDe(offerId);
  const salvando = controle.salvando.has(offerId);
  const falhou = controle.falhou.has(offerId);
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, justifyContent: 'flex-end' }}>
      <Botao
        variante="discreto"
        pequeno
        onClick={() => controle.lancar(offerId, Math.max(0, valor - 1))}
        disabled={valor === 0}
        aria-label="Levar uma a menos"
      >
        −
      </Botao>
      <input
        type="number"
        min={0}
        value={valor}
        onChange={(e) => controle.lancar(offerId, Math.max(0, Math.trunc(Number(e.target.value) || 0)))}
        aria-label="Unidades levadas"
        style={{
          width: 62,
          textAlign: 'right',
          // O estado de falha não pode viver só na cor: vem com o título e com
          // o aviso escrito abaixo da tabela.
          borderColor: falhou ? 'var(--amber)' : undefined,
          opacity: salvando ? 0.6 : 1,
        }}
        title={falhou ? 'Não foi possível gravar este lançamento.' : undefined}
      />
      <Botao
        variante="discreto"
        pequeno
        onClick={() => controle.lancar(offerId, valor + 1)}
        aria-label="Levar uma a mais"
      >
        +
      </Botao>
    </span>
  );
}

/** Agrupa linhas por uma chave, somando unidades e ordenando por volume. */
function agrupar(linhas: LinhaDoPlano[], chave: (l: LinhaDoPlano) => string): Agrupado[] {
  const m = new Map<string, LinhaDoPlano[]>();
  for (const l of linhas) {
    const k = chave(l) || '—';
    (m.get(k) ?? m.set(k, []).get(k)!).push(l);
  }
  return [...m.entries()]
    .map(([k, ls]) => ({ chave: k, units: ls.reduce((a, x) => a + x.units, 0), linhas: ls }))
    .sort((a, b) => b.units - a.units || a.chave.localeCompare(b.chave, 'pt-BR'));
}

/** Uma peça do plano, com o porquê que abre ao clicar. */
function LinhaDeSku({ linha, compra }: { linha: LinhaDoPlano; compra?: ControleDeCompra }) {
  const [aberto, setAberto] = useState(false);
  const c = linha.candidato;
  const colunas = compra ? 5 : 4;
  return (
    <>
      <tr>
        <td>
          <Botao
            variante="discreto"
            pequeno
            icone={aberto ? 'chevron-baixo' : 'chevron-direita'}
            onClick={() => setAberto((v) => !v)}
            aria-expanded={aberto}
          >
            {c.description}
          </Botao>
        </td>
        <td className="num">
          <strong>{linha.units}</strong>
          <Unidade>un.</Unidade>
        </td>
        {/* NA FEIRA o contador fica colado na sugestão, porque a comparação que
            o comprador faz de pé é essa: sugeri 16, estou levando 20. */}
        {compra && (
          <td className="num">
            <ContadorDeCompra offerId={c.id} controle={compra} />
          </td>
        )}
        {/* A margem fica ao lado da quantidade porque é o par que o comprador
            lê junto — quanto levar e quanto sobra. */}
        <td className="num">{linha.margemPct.toLocaleString('pt-BR')}%</td>
        <td>
          {linha.lojas && linha.lojas.length > 0 ? (
            <span className="muted" style={{ fontSize: 12 }}>
              {linha.lojas.length} {linha.lojas.length === 1 ? 'loja' : 'lojas'}
            </span>
          ) : (
            <span className="muted" style={{ fontSize: 12 }}>—</span>
          )}
        </td>
      </tr>
      {aberto && (
        <tr>
          <td colSpan={colunas} style={{ background: 'var(--panel-2)' }}>
            {/* O PORQUÊ. É a diferença entre um número e uma decisão — e é
                onde o concorrente entrega log de máquina ao comprador. */}
            <p style={{ margin: '4px 0 10px', lineHeight: 1.55 }}>{linha.porque}</p>
            {linha.lojas && linha.lojas.length > 0 && (
              <table style={{ marginTop: 4 }}>
                <thead>
                  <tr>
                    <th>Loja</th>
                    <th className="num">Recebe</th>
                  </tr>
                </thead>
                <tbody>
                  {linha.lojas.map((r) => (
                    <tr key={r.storeId}>
                      <td>{r.storeName}</td>
                      <td className="num">
                        <strong>{r.suggestedQty}</strong>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {linha.semLoja != null && linha.semLoja > 0 && (
              <p className="hint" style={{ marginTop: 8 }}>
                {linha.semLoja} un. sem loja definida — nenhuma filial elegível está abaixo do alvo
                de cobertura desta peça. Ficam para divisão manual.
              </p>
            )}
            {linha.excludedByMix && linha.excludedByMix.length > 0 && (
              <p className="hint" style={{ marginTop: 6 }}>
                Fora da divisão por não trabalharem a grife: {linha.excludedByMix.join(', ')}.
              </p>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

/** Um nível da hierarquia que abre para o próximo. */
function Nivel({
  titulo,
  units,
  detalhe,
  children,
}: {
  titulo: string;
  units: number;
  detalhe?: string;
  children: ReactNode;
}) {
  const [aberto, setAberto] = useState(false);
  return (
    <div className="card" style={{ padding: 0, marginBottom: 6 }}>
      <div
        role="button"
        tabIndex={0}
        aria-expanded={aberto}
        onClick={() => setAberto((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') setAberto((v) => !v);
        }}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '10px 14px',
          cursor: 'pointer',
        }}
      >
        <Icon name={aberto ? 'chevron-baixo' : 'chevron-direita'} size={16} style={{ color: 'var(--muted)' }} />
        <strong style={{ flex: 1, minWidth: 0 }}>{titulo}</strong>
        {detalhe && <span className="muted" style={{ fontSize: 12 }}>{detalhe}</span>}
        <span style={{ whiteSpace: 'nowrap' }}>
          <strong>{fmt(units)}</strong>
          <Unidade>un.</Unidade>
        </span>
      </div>
      {aberto && <div style={{ padding: '0 14px 12px' }}>{children}</div>}
    </div>
  );
}

/** O plano de um segmento, na hierarquia Marca → Tipo → Gênero → SKU. */
function SegmentoDoPlano({ linhas, compra }: { linhas: LinhaDoPlano[]; compra?: ControleDeCompra }) {
  if (linhas.length === 0) {
    return (
      <div className="empty">
        Nenhuma peça entrou neste cenário — veja o motivo declarado acima.
      </div>
    );
  }
  return (
    <>
      {agrupar(linhas, (l) => l.candidato.brand).map((marca) => (
        <Nivel
          key={marca.chave}
          titulo={marca.chave}
          units={marca.units}
          detalhe={`${marca.linhas.length} ${marca.linhas.length === 1 ? 'linha' : 'linhas'}`}
        >
          {agrupar(marca.linhas, (l) => l.candidato.tipo ?? '—').map((tipo) => (
            <Nivel key={tipo.chave} titulo={tipo.chave} units={tipo.units}>
              {agrupar(tipo.linhas, (l) => l.candidato.genero ?? 'Sem gênero na ficha').map((gen) => (
                <Nivel key={gen.chave} titulo={gen.chave} units={gen.units}>
                  <table>
                    <thead>
                      <tr>
                        <th>Peça</th>
                        <th className="num">{compra ? 'Sugerido' : 'Comprar'}</th>
                        {compra && <th className="num">Levando</th>}
                        <th className="num">Margem</th>
                        <th>Destino</th>
                      </tr>
                    </thead>
                    <tbody>
                      {gen.linhas.map((l) => (
                        <LinhaDeSku key={`${l.segmento}-${l.candidato.id}`} linha={l} compra={compra} />
                      ))}
                    </tbody>
                  </table>
                </Nivel>
              ))}
            </Nivel>
          ))}
        </Nivel>
      ))}
    </>
  );
}

/**
 * O bloco inteiro do plano: as três abas, a visão por loja e o motivo do que
 * não coube.
 */
export function PlanoDeCompra({
  plano,
  segments,
  compra,
  titulo = 'O que comprar, e para onde vai',
  descricao = 'A divisão do piso em peças concretas, na ordem em que a compra se pensa: grife, tipo, gênero e modelo. Clique em qualquer linha para ver por que ela entrou e quanto vai para cada loja.',
}: {
  plano: PlanoDetalhado;
  segments: StrategySegment[];
  /** Só na feira: o contador de balcão em cada linha. */
  compra?: ControleDeCompra;
  titulo?: string;
  descricao?: string;
}) {
  const rotulo = new Map(segments.map((s) => [s.key, s.label]));
  const doSegmento = (k: StrategySegment['key']) =>
    plano.segmentos.find((s) => s.segmento === k);

  /*
   * A ABA ABRE NO CENÁRIO QUE TEM CONTEÚDO.
   *
   * Abrir sempre em best-seller parece neutro e não é: numa feira de coleção
   * nova esse balde é vazio POR CONSTRUÇÃO — não há o que repor —, então a
   * primeira coisa que o usuário vê é "nenhuma peça entrou neste cenário".
   * Tela que abre vazia é lida como quebrada, e esta é a quarta vez que este
   * produto tropeça nisso (a aba de distribuição voltou três rodadas seguidas
   * como "continuamos sem").
   *
   * O motivo declarado continua acima, visível nas três abas — quem quiser
   * saber por que o balde está vazio não precisa achá-lo aberto para ler.
   */
  const primeiraComLinhas =
    segments.find((s) => (doSegmento(s.key)?.linhas.length ?? 0) > 0)?.key ?? segments[0]?.key ?? 'best-seller';
  const [abaEscolhida, setAba] = useState<StrategySegment['key'] | 'lojas' | null>(null);
  const aba = abaEscolhida ?? primeiraComLinhas;

  return (
    <>
      <AberturaDeSecao
        eyebrow="Plano de compra"
        titulo={titulo}
        descricao={descricao}
        acoes={
          <Selo tom="gray" icone="ideia" title="Peças analisadas para montar este plano.">
            {fmt(plano.candidatosExaminados)} de {fmt(plano.universo)} peças
          </Selo>
        }
      />

      {/* O MOTIVO vem ANTES da lista, não depois.
          Plano curto sem explicação é lido como tela quebrada — foi o que
          aconteceu com a aba de distribuição, que existia e abria vazia. */}
      {plano.motivo && (
        <div className="banner" style={{ alignItems: 'flex-start' }}>
          <Icon name="informacao" size={18} style={{ marginTop: 2, color: 'var(--muted)' }} />
          <span className="muted">{plano.motivo}</span>
        </div>
      )}

      <div className="segmented" role="group" aria-label="Cenário" style={{ marginBottom: 12 }}>
        {segments.map((s) => (
          <button
            key={s.key}
            type="button"
            className={aba === s.key ? 'active' : ''}
            onClick={() => setAba(s.key)}
            aria-pressed={aba === s.key}
          >
            {s.label} · {fmt(doSegmento(s.key)?.alocado ?? 0)}
          </button>
        ))}
        {/* A VISÃO POR LOJA é uma aba irmã, não um apêndice: é a leitura de
            quem monta o malote, e foi a metade que faltou três rodadas. */}
        <button
          type="button"
          className={aba === 'lojas' ? 'active' : ''}
          onClick={() => setAba('lojas')}
          aria-pressed={aba === 'lojas'}
        >
          Por loja · {plano.porLoja.length}
        </button>
      </div>

      {aba === 'lojas' ? (
        <div className="card" style={{ padding: 0 }}>
          {plano.porLoja.length === 0 ? (
            <div className="empty">Nenhuma peça foi endereçada a loja alguma neste plano.</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Loja</th>
                  <th className="num">Recebe deste plano</th>
                </tr>
              </thead>
              <tbody>
                {plano.porLoja.map((l) => (
                  <tr key={l.storeId}>
                    <td>{l.storeName}</td>
                    <td className="num">
                      <strong>{fmt(l.units)}</strong>
                      <Unidade>un.</Unidade>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ) : (
        <>
          <div style={{ marginBottom: 8 }}>
            <span className="hint">
              {rotulo.get(aba)} · meta {fmt(doSegmento(aba)?.meta ?? 0)} un. · alocado{' '}
              {fmt(doSegmento(aba)?.alocado ?? 0)} un.
            </span>
          </div>
          <SegmentoDoPlano linhas={doSegmento(aba)?.linhas ?? []} compra={compra} />
        </>
      )}
    </>
  );
}
