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
 * Opções do <select>, com as que a amostra não cobre desabilitadas.
 *
 * Quando NENHUMA das opções da página cabe na cobertura (a tela de compras
 * oferece 90, 180 e 365, e a amostra tem 7), a cobertura entra como primeira
 * opção. Assim sempre sobra exatamente uma escolha válida — um <select> com
 * todas as opções desabilitadas seria um beco sem saída.
 */
export function opcoesDePeriodo(base: PeriodoBase[]): OpcaoPeriodo[] {
  const cobertura = coberturaDaAmostra();
  if (!cobertura) {
    return base.map((b) => ({ value: String(b.dias), label: b.label, disabled: false }));
  }

  const alcancaveis = base.filter((b) => b.dias <= cobertura.dias);
  const lista =
    alcancaveis.length > 0
      ? base
      : [{ dias: cobertura.dias, label: `${cobertura.dias} dias · toda a amostra` }, ...base];

  return lista.map((b) => ({
    value: String(b.dias),
    label: b.dias <= cobertura.dias ? b.label : `${b.label} — ${FORA}`,
    disabled: b.dias > cobertura.dias,
  }));
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

/**
 * Frase curta para a barra de filtros. `null` quando não há limite — nesse caso
 * a tela não ganha linha nenhuma.
 */
export function legendaDaAmostra(): string | null {
  const c = coberturaDaAmostra();
  if (!c) return null;
  const ano = c.ate.slice(0, 4);
  return `Amostra estática: ${c.dias} dias de venda (${diaMes(c.de)} a ${diaMes(c.ate)}/${ano}). Recortes maiores voltam quando a extração cobrir a janela cheia.`;
}
