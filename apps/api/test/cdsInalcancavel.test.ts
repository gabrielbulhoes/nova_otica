import { describe, expect, it } from 'vitest';
import { SellbieUnreachableError } from '../src/integrations/sellbie/httpClient.js';

/**
 * O DISJUNTOR DA CDS — incidente de 16/08/2026.
 *
 * Naquela manhã as DEZ entidades falharam com o mesmo `timeout of 30000ms
 * exceeded`. Cada uma gastou cinco tentativas de 30 s antes de desistir, e o
 * ciclo levou 39 minutos para concluir o que a PRIMEIRA rota já havia provado
 * em três: a CDS não estava respondendo.
 *
 * O CUSTO NÃO É O TEMPO DE MÁQUINA — É A JANELA. A CDS só aceita ser
 * consultada entre 06:00 e 07:00, e o cron dispara uma vez, às 06:00. Aquela
 * hora era a única chance do dia; gastá-la provando dez vezes a mesma
 * indisponibilidade eliminou qualquer segunda tentativa, e a rede passou o dia
 * servindo o dado da véspera.
 *
 * Estes testes prendem a distinção que faz o disjuntor ser seguro: CDS CALADA
 * (sem resposta nenhuma) interrompe o ciclo; CDS FALANDO (4xx/5xx) não. Uma
 * rota quebrada no conector não diz nada sobre as outras nove, e abortar por
 * causa dela perderia a sincronização inteira por um endpoint com defeito.
 */

describe('SellbieUnreachableError', () => {
  it('carrega a rota e a causa, e diz o que houve na mensagem', () => {
    const causa = new Error('timeout of 30000ms exceeded');
    const err = new SellbieUnreachableError('cds/lojas', causa);

    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('SellbieUnreachableError');
    expect(err.route).toBe('cds/lojas');
    expect(err.causa).toBe(causa);
    // A mensagem é o que chega ao Telegram do cliente. "CDS inalcançável" diz
    // onde está o problema; dez linhas de "timeout" não diziam.
    expect(err.message).toBe('CDS inalcançável em "cds/lojas": timeout of 30000ms exceeded');
  });

  it('sobrevive a uma causa que não é Error', () => {
    // `axios` pode rejeitar com objeto simples em alguns caminhos de rede, e
    // um `.message` indefinido apagaria justamente a pista do incidente.
    const err = new SellbieUnreachableError('cds/estoque', { code: 'ECONNABORTED' });
    expect(err.message).toContain('cds/estoque');
    expect(err.message).toContain('ECONNABORTED');
  });

  it('é distinguível por instanceof depois de atravessar um catch genérico', () => {
    // O `track` do sync captura `unknown` e decide pelo tipo. Herança de Error
    // em TypeScript compilado para ES2015+ preserva o protótipo — mas se
    // alguém baixar o target, isto quebra em silêncio e o disjuntor para de
    // funcionar sem nenhum teste reclamar.
    const lancar = (): never => {
      throw new SellbieUnreachableError('cds/vendas', new Error('socket hang up'));
    };
    try {
      lancar();
    } catch (e: unknown) {
      expect(e instanceof SellbieUnreachableError).toBe(true);
      expect((e as SellbieUnreachableError).route).toBe('cds/vendas');
      return;
    }
    throw new Error('deveria ter lançado');
  });
});

/**
 * A REGRA DE DECISÃO, isolada da rede.
 *
 * Reproduz o julgamento que o `httpClient` faz ao esgotar as tentativas: sem
 * `status` é CDS calada; com `status` é a CDS respondendo, ainda que com erro.
 */
const ehInalcancavel = (status: number | undefined) => status === undefined;

describe('quando a CDS está CALADA e quando está FALANDO', () => {
  it('sem resposta HTTP nenhuma → interrompe o ciclo', () => {
    // Timeout, DNS, pacote descartado por firewall. Foi o caso de 16/08.
    expect(ehInalcancavel(undefined)).toBe(true);
  });

  it('erro DA CDS não interrompe — uma rota quebrada não condena as outras', () => {
    // 500 numa rota específica é defeito do conector naquele endpoint. Abortar
    // aqui perderia a sincronização inteira por causa de um endpoint, que é o
    // oposto do que o disjuntor existe para evitar.
    expect(ehInalcancavel(500)).toBe(false);
    expect(ehInalcancavel(503)).toBe(false);
    expect(ehInalcancavel(429)).toBe(false);
    // E 401/403 menos ainda: é credencial ou allowlist, e o alerta precisa
    // dizer isso em vez de "inalcançável".
    expect(ehInalcancavel(401)).toBe(false);
    expect(ehInalcancavel(403)).toBe(false);
  });
});

/**
 * O QUE O DISJUNTOR ECONOMIZA — a aritmética do incidente.
 *
 * Não é teste de implementação: é o número que justifica a mudança, escrito
 * onde alguém vai reler antes de "simplificar" o disjuntor.
 */
describe('a janela que o disjuntor devolve', () => {
  const ENTIDADES = 10;
  const TENTATIVAS = 5; // 1 + 4 retries
  const TIMEOUT_S = 30;
  const BACKOFF_S = 2 + 4 + 8 + 16;
  const JANELA_S = 60 * 60;

  const porEntidade = TENTATIVAS * TIMEOUT_S + BACKOFF_S;

  it('sem disjuntor, o ciclo consome quase toda a janela', () => {
    const semDisjuntor = ENTIDADES * porEntidade;
    expect(semDisjuntor).toBe(1_800);
    // 30 minutos de uma janela de 60 — e foram 39 na medição real, com a
    // latência das gravações no meio.
    expect(semDisjuntor / JANELA_S).toBeGreaterThan(0.49);
  });

  it('com disjuntor, a primeira entidade decide e sobra janela para tentar de novo', () => {
    const comDisjuntor = porEntidade;
    expect(comDisjuntor).toBe(180);
    const sobra = JANELA_S - comDisjuntor;
    expect(sobra).toBeGreaterThan(3_000); // ~57 minutos
  });
});
