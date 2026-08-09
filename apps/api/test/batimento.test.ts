import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildSyncHeartbeatPayload, buildSyncStalePayload } from '../src/lib/opsAlert.js';

/**
 * O BATIMENTO — e o buraco que ele fecha.
 *
 * O canal de alertas só falava quando havia problema. Isso parece econômico e
 * não é: o vigia roda DENTRO do processo que ele vigia, então contêiner parado
 * derruba os dois de uma vez, e a ausência de alerta fica idêntica à saúde.
 *
 * A operação levantou isso da forma mais direta possível — dois dias de
 * silêncio depois de um alerta de "base VENCIDA", e nenhuma maneira de saber,
 * pelo Telegram, se o sync tinha voltado ou se o vigia tinha morrido junto com
 * o contêiner. As duas coisas são silêncio.
 *
 * Com o batimento diário, o silêncio passa a ser o alarme.
 */
describe('buildSyncHeartbeatPayload', () => {
  const LIMITE = 26;

  it('diz que está em dia, com o último sucesso e as horas', () => {
    const p = buildSyncHeartbeatPayload({
      ultimoSucesso: new Date('2026-08-08T09:00:00.000Z'),
      horas: 3,
      limiteHoras: LIMITE,
    });
    expect(p.event).toBe('sync.ok');
    expect(p.severity).toBe('info');
    expect(p.text).toContain('2026-08-08T09:00:00.000Z');
    expect(p.text).toContain('há 3h');
    expect(p.text).toContain('26h');
  });

  it('as horas viajam no texto, não só no campo — é o que faz o batimento ser lido', () => {
    // Um batimento que só diz "ok" vira ruído que ninguém abre. Dizendo "há 3h"
    // todo dia, um "há 25h" salta aos olhos ANTES de virar incidente: o limite
    // é 26h, e a diferença entre os dois é uma manhã de operação.
    const quase = buildSyncHeartbeatPayload({
      ultimoSucesso: new Date('2026-08-07T08:00:00.000Z'),
      horas: 25,
      limiteHoras: LIMITE,
    });
    expect(quase.text).toContain('há 25h');
  });

  it('o texto ensina como lê-lo — a ausência é que é o alarme', () => {
    // Sem esta frase, o batimento depende de alguém ter entendido o combinado.
    // Com ela, a própria mensagem carrega a instrução de uso.
    const p = buildSyncHeartbeatPayload({ ultimoSucesso: new Date(), horas: 1, limiteHoras: LIMITE });
    expect(p.text).toMatch(/silêncio é o alarme/i);
  });

  it('não se confunde com o alerta: símbolo, evento e severidade diferentes', () => {
    // Os dois chegam no mesmo chat, um por dia. Se lidos de relance forem
    // parecidos, o batimento vira camuflagem para o alerta — o oposto do que
    // ele veio fazer.
    const ok = buildSyncHeartbeatPayload({ ultimoSucesso: new Date(), horas: 2, limiteHoras: LIMITE });
    const ruim = buildSyncStalePayload({ ultimoSucesso: new Date(), horas: 40, limiteHoras: LIMITE });

    expect(ok.text.startsWith('✅')).toBe(true);
    expect(ruim.text.startsWith('⚠️')).toBe(true);
    expect(ok.event).not.toBe(ruim.event);
    expect(ok.severity).toBe('info');
    expect(ruim.severity).toBe('error');
  });
});

/**
 * O vigia de ponta a ponta, com o Telegram simulado.
 *
 * Os testes acima provam o TEXTO. Este prova a FIAÇÃO — que é onde esta
 * plataforma já se queimou mais de uma vez: função certa, escrita, testada, e
 * nunca chamada em produção (`stuckDaysByProduct` é o precedente literal).
 *
 * O módulo é importado dinamicamente depois dos `vi.doMock` porque `env` e
 * `prisma` são resolvidos no topo dos módulos reais.
 */
describe('vigia · o batimento sai de verdade pelo canal', () => {
  const CHAT = '-100123';
  let enviadas: { url: string; body: string }[] = [];

  const montar = async (frescor: {
    vencido: boolean;
    ultimoSucesso: Date | null;
    horas: number | null;
    limiteHoras: number;
  }, heartbeat = true) => {
    enviadas = [];
    vi.stubGlobal('fetch', async (url: string, init: { body: string }) => {
      enviadas.push({ url: String(url), body: String(init.body) });
      return { ok: true, status: 200 } as Response;
    });
    vi.doMock('../src/config/env.js', () => ({
      env: {
        ALERT_WEBHOOK_URL: '',
        ALERT_TELEGRAM_BOT_TOKEN: 'token-de-teste',
        ALERT_TELEGRAM_CHAT_ID: CHAT,
        SYNC_HEARTBEAT: heartbeat,
      },
    }));
    vi.doMock('../src/sync/syncHealth.js', () => ({ getFrescor: async () => frescor }));
    // O scheduler importa node-cron e o syncService (que puxa o Prisma e o
    // cliente CDS) só para agendar. Aqui o alvo é `conferirFrescor`, então os
    // dois entram como casca — sem isso o teste subiria meia aplicação.
    vi.doMock('node-cron', () => ({
      default: { validate: () => true, schedule: () => ({ stop: () => {} }) },
    }));
    vi.doMock('../src/sync/syncService.js', () => ({
      runFullSync: async () => {},
      SyncInProgressError: class extends Error {},
    }));
  };

  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.doUnmock('../src/config/env.js');
    vi.doUnmock('../src/sync/syncHealth.js');
  });

  it('base em dia → o VIGIA dispara o batimento no chat certo', async () => {
    // Pelo `conferirFrescor`, e não por `notifySyncHeartbeat` direto: o que
    // precisa ser provado é que o vigia CHAMA o batimento, não que a função
    // sabe montar a mensagem (isso é o bloco de cima).
    await montar({
      vencido: false,
      ultimoSucesso: new Date('2026-08-08T09:00:00.000Z'),
      horas: 3,
      limiteHoras: 26,
    });
    const { conferirFrescor } = await import('../src/sync/scheduler.js');
    await conferirFrescor();

    expect(enviadas).toHaveLength(1);
    expect(enviadas[0].url).toContain('/bottoken-de-teste/sendMessage');
    const corpo = JSON.parse(enviadas[0].body);
    expect(corpo.chat_id).toBe(CHAT);
    expect(corpo.text).toContain('✅');
    expect(corpo.text).toContain('há 3h');
  });

  it('base vencida → o vigia manda o ALERTA, e não o batimento', async () => {
    await montar({
      vencido: true,
      ultimoSucesso: new Date('2026-08-04T20:16:53.588Z'),
      horas: 40,
      limiteHoras: 26,
    });
    const { conferirFrescor } = await import('../src/sync/scheduler.js');
    await conferirFrescor();

    expect(enviadas).toHaveLength(1);
    const corpo = JSON.parse(enviadas[0].body);
    expect(corpo.text).toContain('⚠️');
    expect(corpo.text).toContain('VENCIDA');
    expect(corpo.text).not.toContain('✅');
  });

  it('com `SYNC_HEARTBEAT=false`, o vigia cala quando está tudo bem', async () => {
    // O desligamento precisa desligar SÓ o batimento. Se ele calasse o alerta
    // junto, a configuração viraria uma armadilha silenciosa.
    await montar(
      { vencido: false, ultimoSucesso: new Date(), horas: 2, limiteHoras: 26 },
      false,
    );
    const { conferirFrescor } = await import('../src/sync/scheduler.js');
    await conferirFrescor();
    expect(enviadas).toHaveLength(0);
  });

  it('sem canal configurado, o batimento não vira linha de erro no log', async () => {
    // Uma instalação sem Telegram passaria a escrever um `error` por dia
    // dizendo que está tudo bem. Log de erro que grita rotina é log que
    // ninguém lê no dia do incidente de verdade — e a linha de erro para
    // ALERTA sem canal, essa sim, precisa continuar gritando.
    vi.resetModules();
    enviadas = [];
    vi.doMock('../src/config/env.js', () => ({
      env: { ALERT_WEBHOOK_URL: '', ALERT_TELEGRAM_BOT_TOKEN: '', ALERT_TELEGRAM_CHAT_ID: '' },
    }));
    const erros: unknown[] = [];
    vi.doMock('../src/lib/logger.js', () => ({
      logger: {
        child: () => ({
          error: (...a: unknown[]) => erros.push(a),
          warn: () => {},
          info: () => {},
        }),
      },
    }));

    const { notifySyncHeartbeat, notifySyncStale } = await import('../src/lib/opsAlert.js');
    await notifySyncHeartbeat({ ultimoSucesso: new Date(), horas: 1, limiteHoras: 26 });
    expect(erros).toHaveLength(0);

    await notifySyncStale({ ultimoSucesso: new Date(), horas: 40, limiteHoras: 26 });
    expect(erros).toHaveLength(1);

    vi.doUnmock('../src/lib/logger.js');
  });
});
