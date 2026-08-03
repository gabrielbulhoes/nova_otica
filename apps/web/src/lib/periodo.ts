import { coberturaDaAmostra } from '../api/client';

/**
 * PERÍODO DE ANÁLISE — o filtro passa a oferecer só o que a base responde.
 *
 * O defeito: a fotografia estática do CDS cobre 7 dias de venda (07/07 a
 * 13/07/2026), e os filtros ofereciam 7, 30, 90 e 180. A matemática já usava a
 * janela MEDIDA, então escolher "30 dias" devolvia exatamente os mesmos
 * números de 7 — com o rótulo de 30. Quem operava a tela concluía, com toda a
 * razão, que o filtro estava quebrado; e quem confiava no rótulo lia uma
 * receita de sete dias como se fosse de um mês.
 *
 * A correção não é esconder o filtro nem inventar dado: é declarar o limite.
 * Os períodos além da cobertura continuam VISÍVEIS — desabilitados e com o
 * motivo escrito no próprio rótulo. Some o filtro que mentia, sem sumir a
 * informação de que aquele recorte existe e volta quando a extração crescer.
 *
 * Fora da amostra estática (backend ao vivo, ou demonstração com dados
 * fictícios, que são gerados para a janela inteira) nada muda: todas as opções
 * ficam habilitadas e não há legenda.
 */

export interface PeriodoBase {
  /** Dias do recorte. */
  dias: number;
  /** Rótulo da página — cada tela mantém o seu vocabulário. */
  label: string;
}

export interface OpcaoPeriodo {
  value: string;
  label: string;
  disabled: boolean;
}

/** Sufixo único para todo período que a base não alcança. */
const FORA = 'fora da amostra';

/**
 * Escada canônica de recortes. Dentro da cobertura, o filtro oferece os degraus
 * que cabem — é o que faz MUDAR o filtro MUDAR o dado: com uma amostra de 7
 * dias, "1 dia" e "3 dias" são recortes medidos de verdade, não arredondamentos.
 */
const ESCADA = [1, 3, 7, 14, 30, 60, 90, 180, 365];

const rotuloDeDias = (dias: number) => (dias === 1 ? '1 dia' : `${dias} dias`);

/**
 * Opções do <select>: os degraus que a amostra responde, mais os períodos da
 * própria página; o que passa da cobertura fica desabilitado, com o motivo no
 * rótulo.
 *
 * Os degraus internos existem por um motivo concreto: sem eles a amostra de 7
 * dias deixava UMA opção só no seletor, e um filtro com uma opção não é filtro.
 * Com 1 e 3 dias, mudar o recorte muda de fato o faturamento, a série diária e
 * o desempenho por loja — os três recortes que a fotografia mede com data.
 */
export function opcoesDePeriodo(base: PeriodoBase[]): OpcaoPeriodo[] {
  const cobertura = coberturaDaAmostra();
  if (!cobertura) {
    return base.map((b) => ({ value: String(b.dias), label: b.label, disabled: false }));
  }

  const dentro = new Map<number, string>();
  // Degraus medidos, incluindo sempre a amostra inteira.
  for (const d of ESCADA) if (d < cobertura.dias) dentro.set(d, rotuloDeDias(d));
  dentro.set(cobertura.dias, `${rotuloDeDias(cobertura.dias)} · toda a amostra`);
  // O vocabulário da página vence quando o período dela cabe na cobertura.
  for (const b of base) if (b.dias <= cobertura.dias) dentro.set(b.dias, b.label);

  const alcancaveis = [...dentro.entries()]
    .sort(([a], [b]) => a - b)
    .map(([dias, label]) => ({ value: String(dias), label, disabled: false }));

  const fora = base
    .filter((b) => b.dias > cobertura.dias)
    .sort((a, b) => a.dias - b.dias)
    .map((b) => ({ value: String(b.dias), label: `${b.label} — ${FORA}`, disabled: true }));

  return [...alcancaveis, ...fora];
}

/**
 * Valor inicial honesto: o preferido da página quando ele cabe, senão o maior
 * recorte que a base responde de verdade.
 */
export function periodoInicial(base: PeriodoBase[], preferido: number): string {
  const cobertura = coberturaDaAmostra();
  if (!cobertura || preferido <= cobertura.dias) return String(preferido);

  const cabem = base.filter((b) => b.dias <= cobertura.dias).map((b) => b.dias);
  return String(cabem.length > 0 ? Math.max(...cabem) : cobertura.dias);
}

/** dd/mm a partir de uma data ISO, sem passar por Date (evita fuso). */
function diaMes(iso: string): string {
  const [, mes, dia] = iso.split('-');
  return dia && mes ? `${dia}/${mes}` : iso;
}

/** Soma um número de dias a uma data ISO, sem passar por fuso local. */
function somaDias(iso: string, dias: number): string {
  const t = Date.parse(`${iso}T00:00:00Z`) + dias * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

/**
 * Frase para a barra de filtros. `null` quando não há limite — nesse caso a
 * tela não ganha linha nenhuma.
 *
 * Com um recorte MENOR que a amostra, a frase muda: além das datas do recorte,
 * ela separa o que acompanha o filtro do que não acompanha. Essa separação é o
 * ponto — dentro da fotografia, faturamento, série diária e desempenho por loja
 * têm data medida; marca, produto, vendedor e forma de pagamento vêm da sonda
 * como total do período, sem dia. Dizer isso é o que impede o rótulo do filtro
 * de prometer um recorte que aquele bloco não fez.
 */
export function legendaDaAmostra(days?: number | string): string | null {
  const c = coberturaDaAmostra();
  if (!c) return null;

  const ano = c.ate.slice(0, 4);
  const janelaCheia = `${c.dias} dias de venda (${diaMes(c.de)} a ${diaMes(c.ate)}/${ano})`;

  const pedido = Number(days);
  const recorte = Number.isFinite(pedido) ? Math.max(1, Math.min(pedido, c.dias)) : c.dias;
  if (recorte >= c.dias) {
    return `Amostra estática: ${janelaCheia}. Recortes maiores voltam quando a extração cobrir a janela cheia.`;
  }

  const inicio = somaDias(c.ate, -(recorte - 1));
  const rotulo = recorte === 1 ? 'Recorte de 1 dia' : `Recorte de ${recorte} dias`;
  return (
    `${rotulo} (${diaMes(inicio)} a ${diaMes(c.ate)}/${ano}), dentro da amostra de ${c.dias} dias. ` +
    'Faturamento, série diária e desempenho por loja acompanham o recorte; ' +
    'as quebras por marca, produto, vendedor e forma de pagamento não têm data na amostra ' +
    `e seguem mostrando os ${c.dias} dias.`
  );
}
