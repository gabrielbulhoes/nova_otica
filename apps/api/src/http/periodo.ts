import { badRequest } from './helpers.js';

/**
 * PERÍODO DE ANÁLISE — um intervalo fechado, não um número de dias.
 *
 * Até aqui todo recorte era `?days=N`, e cada consulta fazia
 * `saleDate >= hoje - N`. Isso responde "os últimos N dias" e mais nada: não
 * há como perguntar "dezembro passado", "a Black Friday do ano retrasado" ou
 * "de 01/03 a 15/04". Com 2,8 anos de histórico no banco desde o backfill, a
 * ausência começou a doer — o dado está lá e a tela não alcança.
 *
 * A troca é de representação: o período vira `{ de, ate }`, e "últimos N dias"
 * passa a ser um atalho para produzir esse par. Quem chama com `?days=`
 * continua funcionando exatamente igual.
 *
 * Duas sutilezas que a versão de `days` não tinha e esta precisa ter:
 *
 *  · `ate` é o FIM do dia (23:59:59.999). Com `days`, a consulta só tinha
 *    limite inferior, então a venda das 18h de hoje entrava naturalmente. Um
 *    intervalo fechado com `ate` à meia-noite cortaria o dia inteiro — o
 *    último dia do recorte escolhido pelo usuário sairia vazio.
 *
 *  · `dias` é contado de forma INCLUSIVA (01/03 a 01/03 é um dia, não zero).
 *    É o número que a série diária usa para semear os baldes, e um erro de um
 *    aqui produz um gráfico com um dia a menos que o rótulo promete.
 */
export interface Periodo {
  /** Início do primeiro dia (00:00:00.000). */
  de: Date;
  /** Fim do último dia (23:59:59.999). */
  ate: Date;
  /** Dias corridos do intervalo, contados de forma inclusiva. */
  dias: number;
  /** O usuário escolheu as datas, em vez de um "últimos N dias". */
  personalizado: boolean;
}

const DIA_MS = 86_400_000;

/**
 * Teto do intervalo personalizado. O ERP da rede começa em outubro de 2023, e
 * 5 anos cobrem isso com folga — o limite existe para que um `de=1900-01-01`
 * digitado por engano não vire uma varredura da tabela inteira.
 */
export const MAX_DIAS_PERSONALIZADO = 1826;

function inicioDoDia(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function fimDoDia(d: Date): Date {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

/** "Últimos N dias", terminando hoje — o comportamento de sempre. */
export function periodoDeDias(dias: number, agora = new Date()): Periodo {
  const n = Math.max(1, Math.trunc(dias));
  const ate = fimDoDia(agora);
  const de = inicioDoDia(new Date(agora.getTime() - (n - 1) * DIA_MS));
  return { de, ate, dias: n, personalizado: false };
}

/**
 * Data `YYYY-MM-DD` → Date local, ou null. Interpretamos como data LOCAL e não
 * como UTC de propósito: quem digita "01/03" no filtro quer o dia 1 de março
 * na loja, e `new Date('2026-03-01')` devolveria meia-noite UTC — que no
 * fuso do Brasil é 21h do dia 28 de fevereiro.
 */
function dataLocal(v: unknown): Date | null {
  if (typeof v !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v.trim());
  if (!m) return null;
  const [, a, mes, d] = m;
  const dt = new Date(Number(a), Number(mes) - 1, Number(d));
  // Rejeita data inexistente (31/02 vira 03/03 no construtor do Date).
  if (dt.getFullYear() !== Number(a) || dt.getMonth() !== Number(mes) - 1 || dt.getDate() !== Number(d)) {
    return null;
  }
  return dt;
}

/**
 * Lê o período da query: `?de=YYYY-MM-DD&ate=YYYY-MM-DD` quando os dois vêm,
 * senão `?days=N`.
 *
 * Data mal formada é ERRO, não silêncio. Cair de volta para "últimos 30 dias"
 * porque o usuário digitou 31/02 mostraria números perfeitamente plausíveis de
 * um período que ele não pediu — que é a categoria de defeito que esta base
 * inteira vem tentando eliminar.
 */
export function parsePeriodo(
  query: Record<string, unknown>,
  padraoDias = 30,
  maxDias = 365,
  agora = new Date(),
): Periodo {
  const temDe = query.de !== undefined && query.de !== '';
  const temAte = query.ate !== undefined && query.ate !== '';
  if (!temDe && !temAte) {
    const n = Number(query.days);
    const dias = Number.isFinite(n) && n > 0 && n <= maxDias ? Math.trunc(n) : padraoDias;
    return periodoDeDias(dias, agora);
  }

  if (!temDe || !temAte) {
    throw badRequest('Período personalizado exige as duas datas: "de" e "ate".');
  }

  const de = dataLocal(query.de);
  const ate = dataLocal(query.ate);
  if (!de || !ate) throw badRequest('Datas do período devem estar no formato AAAA-MM-DD.');
  if (de.getTime() > ate.getTime()) throw badRequest('A data inicial não pode ser posterior à final.');

  const dias = Math.round((inicioDoDia(ate).getTime() - inicioDoDia(de).getTime()) / DIA_MS) + 1;
  if (dias > MAX_DIAS_PERSONALIZADO) {
    throw badRequest(
      `Período personalizado no máximo de ${MAX_DIAS_PERSONALIZADO} dias (pedido: ${dias}).`,
    );
  }

  // Data futura não é erro — é só um recorte que ainda não tem venda. Cortar
  // no fim de hoje evita semear a série diária com dias que não existiram.
  const fim = fimDoDia(ate);
  const hoje = fimDoDia(agora);
  const ateReal = fim.getTime() > hoje.getTime() ? hoje : fim;
  const diasReais = Math.max(
    1,
    Math.round((inicioDoDia(ateReal).getTime() - inicioDoDia(de).getTime()) / DIA_MS) + 1,
  );

  return { de: inicioDoDia(de), ate: ateReal, dias: diasReais, personalizado: true };
}

/**
 * `YYYY-MM-DD` no fuso LOCAL.
 *
 * `toISOString().slice(0,10)` não serve aqui: `ate` é 23:59:59.999 local, o
 * que em UTC-3 cai às 02:59 do dia SEGUINTE — e a resposta rotularia o
 * recorte com um dia a mais do que ele tem. O erro só aparece no último dia
 * do intervalo, que é justamente o que o usuário confere primeiro.
 */
function diaLocalIso(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/** Como o período volta na resposta, para a tela rotular o que está vendo. */
export function periodoNaResposta(p: Periodo) {
  return {
    days: p.dias,
    de: diaLocalIso(p.de),
    ate: diaLocalIso(p.ate),
    personalizado: p.personalizado,
  };
}
