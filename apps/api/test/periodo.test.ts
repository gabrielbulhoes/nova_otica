import { describe, expect, it } from 'vitest';
import {
  MAX_DIAS_PERSONALIZADO,
  parsePeriodo,
  periodoDeDias,
  periodoNaResposta,
} from '../src/http/periodo.js';

/**
 * O período deixou de ser um número de dias e virou um intervalo fechado. A
 * troca parece cosmética e não é: um intervalo tem duas pontas, e as duas têm
 * armadilha de fuso e de contagem inclusiva.
 *
 * `agora` é sempre injetado — teste de data que depende do relógio passa hoje
 * e falha na virada do mês.
 */

/** 15/03/2026, 14h30 no fuso local. */
const AGORA = new Date(2026, 2, 15, 14, 30, 0);

describe('período por dias — o comportamento de sempre', () => {
  it('"últimos 7 dias" inclui hoje inteiro e os 6 anteriores', () => {
    const p = periodoDeDias(7, AGORA);
    expect(p.dias).toBe(7);
    expect(p.de.getDate()).toBe(9);
    expect(p.de.getHours()).toBe(0);
    // O fim é 23:59:59.999 de HOJE: com meia-noite, a venda das 14h30 de hoje
    // — que existe, é a que acabou de acontecer — ficaria de fora.
    expect(p.ate.getDate()).toBe(15);
    expect(p.ate.getHours()).toBe(23);
    expect(p.personalizado).toBe(false);
  });

  it('1 dia é só hoje, não zero dias', () => {
    const p = periodoDeDias(1, AGORA);
    expect(p.de.getDate()).toBe(15);
    expect(p.ate.getDate()).toBe(15);
    expect(p.dias).toBe(1);
  });

  it('sem parâmetro nenhum, cai no padrão da rota', () => {
    expect(parsePeriodo({}, 30, 365, AGORA).dias).toBe(30);
  });

  it('days fora do limite cai no padrão em vez de estourar', () => {
    expect(parsePeriodo({ days: '9999' }, 30, 365, AGORA).dias).toBe(30);
    expect(parsePeriodo({ days: 'abacaxi' }, 30, 365, AGORA).dias).toBe(30);
    expect(parsePeriodo({ days: '-5' }, 30, 365, AGORA).dias).toBe(30);
  });

  it('365 dias passa — é o recorte de um ano que a tela oferece', () => {
    expect(parsePeriodo({ days: '365' }, 30, 365, AGORA).dias).toBe(365);
  });
});

describe('período personalizado', () => {
  it('conta os dias de forma INCLUSIVA', () => {
    // 01/03 a 01/03 é um dia. Contado por diferença simples daria zero, e a
    // série diária sairia sem balde nenhum.
    expect(parsePeriodo({ de: '2026-03-01', ate: '2026-03-01' }, 30, 365, AGORA).dias).toBe(1);
    expect(parsePeriodo({ de: '2026-03-01', ate: '2026-03-10' }, 30, 365, AGORA).dias).toBe(10);
  });

  it('alcança além do teto de days — é para isso que ele existe', () => {
    // `days` para em 365. O histórico da rede tem 2,8 anos, e o recorte
    // personalizado é o único caminho até ele.
    const p = parsePeriodo({ de: '2023-10-11', ate: '2026-03-15' }, 30, 365, AGORA);
    expect(p.dias).toBeGreaterThan(880);
    expect(p.personalizado).toBe(true);
  });

  it('a data final vira o FIM do dia, não a meia-noite', () => {
    const p = parsePeriodo({ de: '2026-03-01', ate: '2026-03-05' }, 30, 365, AGORA);
    expect(p.ate.getDate()).toBe(5);
    expect(p.ate.getHours()).toBe(23);
    expect(p.ate.getMinutes()).toBe(59);
  });

  it('a data é lida no fuso LOCAL, não em UTC', () => {
    // `new Date('2026-03-01')` é meia-noite UTC — 21h de 28/02 no Brasil. Quem
    // digita 01/03 quer o dia 1 na loja.
    const p = parsePeriodo({ de: '2026-03-01', ate: '2026-03-01' }, 30, 365, AGORA);
    expect(p.de.getDate()).toBe(1);
    expect(p.de.getMonth()).toBe(2);
  });

  it('o rótulo da resposta não escorrega um dia para a frente', () => {
    // `toISOString().slice(0,10)` sobre 23:59:59.999 local em fuso negativo
    // devolve o dia SEGUINTE. O erro só aparece na ponta final do intervalo —
    // que é a primeira coisa que o usuário confere.
    const r = periodoNaResposta(parsePeriodo({ de: '2026-03-01', ate: '2026-03-05' }, 30, 365, AGORA));
    expect(r.de).toBe('2026-03-01');
    expect(r.ate).toBe('2026-03-05');
    expect(r.days).toBe(5);
    expect(r.personalizado).toBe(true);
  });

  it('data futura é aparada em hoje, sem virar erro', () => {
    // Pedir até 31/12 não é engano — é só um recorte que ainda não aconteceu.
    // Semear a série com dias futuros produziria uma faixa de zeros à direita.
    const p = parsePeriodo({ de: '2026-03-10', ate: '2026-12-31' }, 30, 365, AGORA);
    expect(p.ate.getDate()).toBe(15);
    expect(p.ate.getMonth()).toBe(2);
    expect(p.dias).toBe(6);
  });
});

describe('período personalizado — o que é recusado, e por quê', () => {
  const erro = (q: Record<string, unknown>) => () => parsePeriodo(q, 30, 365, AGORA);

  it('só uma das datas é erro, não meio recorte', () => {
    expect(erro({ de: '2026-03-01' })).toThrow(/duas datas/i);
    expect(erro({ ate: '2026-03-01' })).toThrow(/duas datas/i);
  });

  it('data mal formada é ERRO, não silêncio', () => {
    // Cair de volta para "últimos 30 dias" mostraria números plausíveis de um
    // período que ninguém pediu — a categoria de defeito que esta base inteira
    // vem tentando eliminar.
    expect(erro({ de: '01/03/2026', ate: '2026-03-05' })).toThrow(/AAAA-MM-DD/);
    expect(erro({ de: '2026-3-1', ate: '2026-03-05' })).toThrow(/AAAA-MM-DD/);
  });

  it('data que não existe no calendário é recusada', () => {
    // 31/02 vira 03/03 no construtor do Date e passaria despercebida.
    expect(erro({ de: '2026-02-31', ate: '2026-03-05' })).toThrow(/AAAA-MM-DD/);
    expect(erro({ de: '2026-13-01', ate: '2026-03-05' })).toThrow(/AAAA-MM-DD/);
  });

  it('intervalo invertido é recusado', () => {
    expect(erro({ de: '2026-03-10', ate: '2026-03-01' })).toThrow(/posterior/i);
  });

  it('intervalo absurdo é recusado com o número na mensagem', () => {
    // Um `de=1900-01-01` digitado por engano viraria varredura da tabela.
    expect(erro({ de: '1900-01-01', ate: '2026-03-15' })).toThrow(
      new RegExp(String(MAX_DIAS_PERSONALIZADO)),
    );
  });
});
