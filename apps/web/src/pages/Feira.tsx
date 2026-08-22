import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getPlanoDaFeira,
  listarFeiras,
  registrarCompraDeFeira,
  type FeiraResumo,
  type PlanoDaFeira,
} from '../api/client';
import {
  AberturaDeSecao,
  ErrorState,
  Loading,
  PageHeader,
  Selo,
  StatCard,
  Unidade,
} from '../components/ui';
import { Icon } from '../brand/Icon';
import { PlanoDeCompra, type ControleDeCompra } from './Strategy';

/**
 * A FEIRA — planejar e lançar a compra de uma coleção nova.
 *
 * O modo contínuo responde "o que repor no que a rede já vende". Aqui o
 * fornecedor põe na mesa uma coleção que ninguém vendeu ainda, e a pergunta é
 * outra: dessas 800 peças, quais das minhas 1.500 unidades levo, e para onde
 * elas vão depois.
 *
 * Duas decisões desta tela que valem ser ditas:
 *
 * 1. O PLANO É O MESMO COMPONENTE do modo contínuo. A hierarquia grife → tipo
 *    → gênero → modelo, o porquê em português e a divisão por loja não mudam
 *    por a coleção ser nova. Copiar a árvore para cá criaria duas que divergem
 *    — o erro que esta base já cometeu com vocabulário duplicado.
 *
 * 2. O LANÇAMENTO VAI PARA O BANCO na hora. O concorrente guarda no navegador
 *    ("seus lançamentos ficam neste navegador durante a feira"): monousuário,
 *    sem histórico, e perdido se alguém limpar o cache no meio de uma compra
 *    de seis dígitos. Aqui o comprador e o dono podem estar na mesma feira em
 *    dois aparelhos, e no dia seguinte a compra ainda existe.
 */

const fmt = (n: number) => n.toLocaleString('pt-BR');
const dia = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' }) : null;

export function Feira() {
  const [feiraId, setFeiraId] = useState<string | null>(null);

  const feiras = useQuery({ queryKey: ['feiras'], queryFn: listarFeiras });
  const escolhida = feiraId ?? feiras.data?.[0]?.id ?? null;

  return (
    <>
      <PageHeader
        title="Feira de compra"
        subtitle="O plano de uma coleção nova: quanto levar de cada peça, por que, e para qual loja ela vai. Lance a compra aqui mesmo — o que você levar fica gravado, não no navegador."
      />

      {feiras.isLoading ? (
        <Loading />
      ) : feiras.isError ? (
        <ErrorState message="Não foi possível carregar as feiras." />
      ) : !feiras.data || feiras.data.length === 0 ? (
        <SemFeira />
      ) : (
        <>
          <SeletorDeFeira feiras={feiras.data} escolhida={escolhida} aoEscolher={setFeiraId} />
          {escolhida && <PlanoDoEvento fairId={escolhida} />}
        </>
      )}
    </>
  );
}

/**
 * A tela vazia diz COMO encher.
 *
 * Uma aba que abre em branco é lida como recurso quebrado — foi exatamente o
 * que aconteceu com a distribuição, que existia, funcionava, e voltou três
 * rodadas seguidas como "continuamos sem" porque nunca havia linha para
 * mostrar.
 */
function SemFeira() {
  return (
    <div className="card">
      <AberturaDeSecao
        eyebrow="Nenhuma feira"
        titulo="Ainda não há evento cadastrado"
        descricao="Uma feira nasce da planilha de oferta do fornecedor — a lista das peças da coleção, com preço."
      />
      <p style={{ lineHeight: 1.6 }}>
        Envie a planilha (SKU, descrição, grife e preço; tipo, gênero, formato e cor entram se vierem) e ela
        é importada como um evento. A partir daí esta tela mostra o plano: quantas unidades de cada peça, o
        motivo de cada linha e a divisão por loja.
      </p>
      <div className="banner" style={{ alignItems: 'flex-start', marginBottom: 0 }}>
        <Icon name="informacao" size={18} style={{ marginTop: 2, color: 'var(--muted)' }} />
        <span className="muted">
          Quanto mais colunas a planilha trouxer, mais fina fica a sugestão: o gênero e o formato são o que
          permitem dizer “piloto masculino já é o que sai” de uma peça que a rede nunca vendeu.
        </span>
      </div>
    </div>
  );
}

function SeletorDeFeira({
  feiras,
  escolhida,
  aoEscolher,
}: {
  feiras: FeiraResumo[];
  escolhida: string | null;
  aoEscolher: (id: string) => void;
}) {
  if (feiras.length === 1) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
      <label className="label" htmlFor="feira-escolhida">Evento</label>
      <select
        id="feira-escolhida"
        className="input"
        value={escolhida ?? ''}
        onChange={(e) => aoEscolher(e.target.value)}
        style={{ maxWidth: 460 }}
      >
        {feiras.map((f) => (
          <option key={f.id} value={f.id}>
            {f.supplier} · {f.collection} — {fmt(f.ofertas)} {f.ofertas === 1 ? 'peça' : 'peças'}
          </option>
        ))}
      </select>
    </div>
  );
}

function PlanoDoEvento({ fairId }: { fairId: string }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['feira', fairId],
    queryFn: ({ signal }) => getPlanoDaFeira(fairId, signal),
  });

  /*
   * O LANÇAMENTO OTIMISTA.
   *
   * O contador tem que responder no toque: numa feira se lança dezenas de
   * linhas em minutos, e esperar o servidor a cada clique torna a tela
   * inutilizável no balcão. O valor exibido é o do plano com o lançamento
   * local por cima; o servidor confirma depois.
   *
   * O que NÃO se faz aqui é invalidar o plano a cada lançamento: o plano é uma
   * conta sobre a rede inteira, e refazê-la a cada clique seria a Central de
   * Decisões de novo — quatro requisições concorrentes e o heap estourado.
   */
  const [local, setLocal] = useState<Record<string, number>>({});
  const [salvando, setSalvando] = useState<ReadonlySet<string>>(new Set());
  const [falhou, setFalhou] = useState<ReadonlySet<string>>(new Set());

  const doPlano = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of q.data?.detalhe.segmentos ?? []) {
      for (const l of s.linhas) m.set(l.candidato.id, l.comprado ?? 0);
    }
    return m;
  }, [q.data]);

  const mutar = useMutation({
    mutationFn: ({ offerId, bought }: { offerId: string; bought: number }) =>
      registrarCompraDeFeira(offerId, bought),
    onSuccess: (_r, { offerId }) => {
      marcar(setSalvando, offerId, false);
      marcar(setFalhou, offerId, false);
      // O cabeçalho (quanto já foi comprado) sai do servidor; ele pode
      // recarregar sozinho, sem bloquear o próximo lançamento.
      void qc.invalidateQueries({ queryKey: ['feiras'] });
    },
    onError: (_e, { offerId }) => {
      // O lançamento fica na tela com a marca de falha em vez de desaparecer:
      // sumir com o número que o comprador digitou é pior que mostrá-lo por
      // gravar.
      marcar(setSalvando, offerId, false);
      marcar(setFalhou, offerId, true);
    },
  });

  const controle: ControleDeCompra = {
    valorDe: (offerId) => local[offerId] ?? doPlano.get(offerId) ?? 0,
    lancar: (offerId, unidades) => {
      setLocal((v) => ({ ...v, [offerId]: unidades }));
      marcar(setSalvando, offerId, true);
      mutar.mutate({ offerId, bought: unidades });
    },
    salvando,
    falhou,
  };

  if (q.isLoading) return <Loading />;
  if (q.isError || !q.data) return <ErrorState message="Não foi possível carregar o plano desta feira." />;

  const naTela = [...doPlano.keys()].reduce((a, id) => a + controle.valorDe(id), 0);
  const foraDoPlano = Math.max(0, q.data.feira.comprado - q.data.feira.compradoNoPlano);

  return (
    <>
      <CabecalhoDaFeira plano={q.data} levando={naTela} foraDoPlano={foraDoPlano} />
      {falhou.size > 0 && (
        <div className="banner warn" style={{ alignItems: 'flex-start' }}>
          <Icon name="atencao" size={18} style={{ marginTop: 2 }} />
          <span>
            {falhou.size} {falhou.size === 1 ? 'lançamento não foi gravado' : 'lançamentos não foram gravados'}.
            Os números continuam na tela, marcados — toque de novo no + ou no − para tentar outra vez.
          </span>
        </div>
      )}
      <PlanoDeCompra
        plano={q.data.detalhe}
        segments={q.data.segments}
        compra={controle}
        titulo="O que levar desta coleção, e para onde vai"
        descricao="A divisão do piso entre as peças da oferta, na ordem em que a compra se pensa: grife, tipo, gênero e modelo. Clique numa linha para ver por que ela entrou e quanto vai para cada loja; use o contador para lançar o que está levando."
      />
    </>
  );
}

function CabecalhoDaFeira({
  plano,
  levando,
  foraDoPlano,
}: {
  plano: PlanoDaFeira;
  levando: number;
  foraDoPlano: number;
}) {
  const f = plano.feira;
  const chegada = dia(f.arrivesAt);
  const alvo = dia(f.targetAt);
  const restante = Math.max(0, f.floorUnits - levando);

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <AberturaDeSecao
        eyebrow="Evento"
        titulo={`${f.supplier} · ${f.collection}`}
        descricao={
          chegada && alvo
            ? `Chegada em ${chegada}, alvo de venda até ${alvo}. ${fmt(f.ofertas)} ${f.ofertas === 1 ? 'peça na oferta' : 'peças na oferta'}.`
            : `${fmt(f.ofertas)} ${f.ofertas === 1 ? 'peça na oferta' : 'peças na oferta'}.`
        }
        acoes={
          <Selo tom={plano.viable ? 'green' : 'amber'} icone={plano.viable ? 'aprovar' : 'atencao'}>
            {plano.viable ? 'Piso com lastro' : 'Piso acima da demanda'}
          </Selo>
        }
      />

      {/* Os quatro números do balcão. "Levando" é o único que sobe com o
          trabalho do comprador — por isso é o nível 1; os outros situam. */}
      <div className="grid grid-4" style={{ gap: 10 }}>
        <StatCard nivel={3} label="Piso da compra" value={fmt(f.floorUnits)} unidade="un." />
        <StatCard nivel={1} label="Levando" value={fmt(levando)} unidade="un." />
        <StatCard nivel={3} label="Falta para o piso" value={fmt(restante)} unidade="un." />
        <StatCard nivel={3} label="Peças da oferta" value={fmt(f.ofertas)} />
      </div>

      {/* O que foi comprado FORA do plano é informação, não erro: a feira tem
          peça que só se vê no balcão. O que não pode é a conta sumir. */}
      {foraDoPlano > 0 && (
        <div className="banner" style={{ alignItems: 'flex-start', marginTop: 14, marginBottom: 0 }}>
          <Icon name="informacao" size={18} style={{ marginTop: 2, color: 'var(--muted)' }} />
          <span className="muted">
            <strong>
              {fmt(foraDoPlano)}
              <Unidade>un.</Unidade>
            </strong>{' '}
            lançadas em peças que o plano não sugeriu. Entram na compra do mesmo jeito — a feira tem peça que
            só se vê no balcão.
          </span>
        </div>
      )}

      <p className="hint" style={{ marginTop: 12, marginBottom: 0 }}>
        {plano.verdict}
      </p>
    </div>
  );
}

/** Liga ou desliga um id num conjunto de estado, sem mutá-lo. */
function marcar(
  set: (f: (v: ReadonlySet<string>) => ReadonlySet<string>) => void,
  id: string,
  ligado: boolean,
) {
  set((v) => {
    const novo = new Set(v);
    if (ligado) novo.add(id);
    else novo.delete(id);
    return novo;
  });
}
