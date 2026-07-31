import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getSyncStatus, runSync } from '../api/client';
import { PageHeader, Loading, Selo, BotaoPrimario, type TomDeSelo } from '../components/ui';
import { Icon, type IconName } from '../brand/Icon';

/**
 * Situação de cada execução da carga.
 *
 * Antes a tabela imprimia o código cru do integrador — SUCCESS, RUNNING,
 * PARTIAL, FAILED — tingido de verde, azul, âmbar e vermelho. Dois problemas
 * somados: o código está em inglês num console inteiro em português, e o que
 * separava "gravou tudo" de "não gravou nada" era só o tom. Em escala de cinza,
 * ou para quem não distingue verde de vermelho, as quatro linhas eram a mesma
 * linha — e esta é a tela onde o gestor decide se pode confiar nos números das
 * outras dezenove.
 *
 * Agora cada situação carrega palavra em português, ícone da grade 24, filete de
 * espessura própria (o `.badge` dá 1px ao saudável, 2px à atenção, 3px ao
 * crítico) e uma nota que explica o que fazer. A cor é o quarto canal, não o
 * primeiro.
 */
interface SituacaoDeExecucao {
  label: string;
  tom: TomDeSelo;
  icone: IconName;
  forte?: boolean;
  nota: string;
}

const situacaoDaExecucao: Record<string, SituacaoDeExecucao> = {
  SUCCESS: {
    label: 'Concluída',
    tom: 'green',
    icone: 'aprovar',
    nota: 'Todos os registros da entidade foram gravados. Nada a fazer.',
  },
  RUNNING: {
    label: 'Em execução',
    tom: 'blue',
    icone: 'sincronizacao',
    nota: 'A carga está em andamento. Aguarde o fim da janela para conferir.',
  },
  PARTIAL: {
    label: 'Parcial',
    tom: 'amber',
    icone: 'atencao',
    nota: 'Parte dos registros ficou de fora. Ver a coluna Erro antes de usar os números.',
  },
  FAILED: {
    label: 'Falhou',
    tom: 'red',
    icone: 'recusar',
    forte: true,
    nota: 'Nada foi gravado nesta entidade. Os dados seguem os da execução anterior.',
  },
};

function SituacaoBadge({ status }: { status: string }) {
  // Situação desconhecida não herda a aparência de nenhuma situação real: cai em
  // neutro com o código como está, para não inventar um significado que a API
  // não deu.
  const s = situacaoDaExecucao[status];
  if (!s)
    return (
      <Selo tom="gray" icone="informacao" title="Situação não prevista pelo console.">
        {status}
      </Selo>
    );
  return (
    <Selo tom={s.tom} icone={s.icone} forte={s.forte} title={s.nota}>
      {s.label}
    </Selo>
  );
}

export function Sync() {
  const qc = useQueryClient();
  const status = useQuery({ queryKey: ['sync-status'], queryFn: getSyncStatus });

  const run = useMutation({
    mutationFn: runSync,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sync-status'] });
      qc.invalidateQueries({ queryKey: ['summary'] });
      qc.invalidateQueries({ queryKey: ['stock'] });
    },
  });

  return (
    <>
      {/* O único sólido da tela, e o caso mais fácil de todos: a tela existe
          para disparar a carga. Não há segunda ação — o resto é leitura do que
          já aconteceu. */}
      <PageHeader
        eyebrow="Governança"
        title="Sincronização"
        subtitle="Integração com a API Sellbie/CDS — disponível apenas na janela diária."
        actions={
          <BotaoPrimario icone="sincronizacao" disabled={run.isPending} onClick={() => run.mutate()}>
            {run.isPending ? 'Sincronizando…' : 'Sincronizar agora'}
          </BotaoPrimario>
        }
      />

      {status.isLoading ? (
        <Loading />
      ) : status.data ? (
        <>
          <div className="grid grid-4">
            <div className="card stat">
              <div className="label">Modo</div>
              <div className="value" style={{ fontSize: 20 }}>
                {status.data.mode === 'mock' ? 'Demonstração' : 'Ao vivo'}
              </div>
            </div>
            <div className="card stat">
              <div className="label">Janela da API</div>
              <div className="value" style={{ fontSize: 20 }}>
                {status.data.window}
              </div>
              {/* O `.dot` já separa os dois estados por FORMA (traço horizontal
                  para aberta, quadrado vazado para fechada) e o texto ao lado
                  diz qual é qual — cor nenhuma carrega a informação sozinha. */}
              <div className="hint" style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                <span className={`dot ${status.data.windowOpen ? 'green' : 'amber'}`} />
                <span>{status.data.windowOpen ? 'Aberta agora' : `Fechada (agora ${status.data.now})`}</span>
              </div>
            </div>
            <div className="card stat">
              <div className="label">Agendamento</div>
              <div className="value" style={{ fontSize: 20 }}>
                {status.data.cron}
              </div>
              {/* Nome de fuso é rótulo CURTO de dado — é literalmente o exemplo
                  que o `.carimbo` do styles.css cita. Frase vai de `.hint`;
                  "America/Sao_Paulo" vai de carimbo. */}
              <div className="carimbo">{status.data.timezone}</div>
            </div>
            <div className="card stat">
              <div className="label">Execuções registradas</div>
              <div className="value">{status.data.lastRuns.length}</div>
            </div>
          </div>

          {run.data && (
            <div className="banner ok" style={{ marginTop: 16 }} role="status">
              <Icon name="aprovar" size={18} />
              <div>Sincronização executada. Atualize as telas para ver os dados mais recentes.</div>
            </div>
          )}

          <div className="card" style={{ marginTop: 16, padding: 0 }}>
            <table>
              <thead>
                <tr>
                  <th>Início</th>
                  <th>Entidade</th>
                  {/* "Status" fica: é a palavra que Transferências já usa na
                      mesma coluna e no filtro. Uma coluna, um nome, no produto
                      inteiro. O que muda é o CONTEÚDO da célula. */}
                  <th>Status</th>
                  <th className="num">Registros</th>
                  <th>Erro</th>
                </tr>
              </thead>
              <tbody>
                {status.data.lastRuns.map((r) => (
                  <tr key={r.id}>
                    <td>{new Date(r.startedAt).toLocaleString('pt-BR')}</td>
                    <td>{r.entity}</td>
                    <td>
                      <SituacaoBadge status={r.status} />
                    </td>
                    <td className="num">{r.recordsWritten}</td>
                    <td className="muted" style={{ maxWidth: 280, fontSize: 12 }}>
                      {r.error ?? '—'}
                    </td>
                  </tr>
                ))}
                {status.data.lastRuns.length === 0 && (
                  <tr>
                    <td colSpan={5} className="empty">
                      Nenhuma sincronização executada ainda.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <div className="empty">Não foi possível obter o status da sincronização.</div>
      )}
    </>
  );
}
