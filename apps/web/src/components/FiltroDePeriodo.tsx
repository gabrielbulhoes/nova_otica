import { useId } from 'react';
import { coberturaDaAmostra } from '../api/client';
import { opcoesDePeriodo, type PeriodoBase } from '../lib/periodo';

/**
 * FILTRO DE PERÍODO — degraus prontos, mais um intervalo escolhido à mão.
 *
 * O seletor oferecia só "últimos N dias". Isso responde bem à pergunta do
 * dia a dia e não alcança nenhuma das perguntas de fechamento: "como foi
 * dezembro", "quanto vendemos na Black Friday", "compare março com abril".
 * O dado para responder está no banco desde o backfill — 2,8 anos —, e a tela
 * é que não chegava até ele.
 *
 * O intervalo à mão fica ATRÁS de uma opção do próprio seletor, e não como um
 * segundo controle sempre visível: quem quer "últimos 30 dias" — a maioria das
 * vezes, todos os dias — não deve pagar com dois campos de data na barra.
 */

export interface PeriodoEscolhido {
  /** Degrau em dias, ou `PERSONALIZADO`. */
  days: string;
  /** Datas do intervalo à mão (AAAA-MM-DD). Vazias fora do modo personalizado. */
  de: string;
  ate: string;
}

export const PERSONALIZADO = 'custom';

/** Estado inicial a partir do degrau preferido da página. */
export function periodoPadrao(dias: number | string): PeriodoEscolhido {
  return { days: String(dias), de: '', ate: '' };
}

/** O período está em modo intervalo E com as duas pontas preenchidas. */
export function periodoCompleto(p: PeriodoEscolhido): boolean {
  return p.days === PERSONALIZADO && !!p.de && !!p.ate && p.de <= p.ate;
}

/**
 * Parâmetros de consulta do período.
 *
 * Manda `de`/`ate` só quando o intervalo está COMPLETO. Enquanto o usuário
 * preencheu uma data e não a outra, a tela continua mostrando o último recorte
 * válido em vez de piscar erro a cada tecla — e a API recusa meio intervalo de
 * propósito, então mandá-lo produziria um 400 a cada dígito.
 */
export function paramsDePeriodo(p: PeriodoEscolhido): { days?: string; de?: string; ate?: string } {
  return periodoCompleto(p) ? { de: p.de, ate: p.ate } : { days: p.days === PERSONALIZADO ? '90' : p.days };
}

/** Chave de cache: muda quando o recorte muda, e só então. */
export function chaveDePeriodo(p: PeriodoEscolhido): string {
  return periodoCompleto(p) ? `${p.de}..${p.ate}` : p.days;
}

export function FiltroDePeriodo({
  periodos,
  value,
  onChange,
}: {
  periodos: PeriodoBase[];
  value: PeriodoEscolhido;
  onChange: (p: PeriodoEscolhido) => void;
}) {
  const id = useId();
  const cobertura = coberturaDaAmostra();
  const personalizado = value.days === PERSONALIZADO;
  // Uma data inicial depois da final é o único engano que o campo permite;
  // dizer isso na hora vale mais do que deixar a API responder 400.
  const invertido = personalizado && !!value.de && !!value.ate && value.de > value.ate;

  return (
    <>
      <select
        value={value.days}
        onChange={(e) => onChange({ ...value, days: e.target.value })}
        aria-label="Período"
      >
        {opcoesDePeriodo(periodos).map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
        <option value={PERSONALIZADO}>Escolher datas…</option>
      </select>

      {personalizado && (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <label htmlFor={`${id}-de`} className="muted" style={{ fontSize: 12.5 }}>
            de
          </label>
          <input
            id={`${id}-de`}
            type="date"
            className="input"
            style={{ width: 150 }}
            value={value.de}
            // Na demonstração estática o filtro não pode oferecer datas que a
            // fotografia não cobre — seria o mesmo defeito que os degraus
            // desabilitados já resolvem, só que com calendário.
            min={cobertura?.de}
            max={value.ate || cobertura?.ate}
            onChange={(e) => onChange({ ...value, de: e.target.value })}
          />
          <label htmlFor={`${id}-ate`} className="muted" style={{ fontSize: 12.5 }}>
            até
          </label>
          <input
            id={`${id}-ate`}
            type="date"
            className="input"
            style={{ width: 150 }}
            value={value.ate}
            min={value.de || cobertura?.de}
            max={cobertura?.ate}
            onChange={(e) => onChange({ ...value, ate: e.target.value })}
          />
          {invertido && (
            <span role="alert" style={{ fontSize: 11.5, color: 'var(--red)' }}>
              A data inicial não pode ser posterior à final.
            </span>
          )}
          {!value.de || !value.ate ? (
            <span className="muted" style={{ fontSize: 11.5 }}>
              Preencha as duas datas.
            </span>
          ) : null}
        </span>
      )}
    </>
  );
}
