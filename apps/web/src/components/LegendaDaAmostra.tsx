import { Icon } from '../brand/Icon';
import { legendaDaAmostra } from '../lib/periodo';

/**
 * Diz, ao lado do filtro, qual janela a base responde de verdade.
 *
 * Fica logo abaixo da barra de filtros de propósito: o limite é uma
 * propriedade DO FILTRO, e uma nota no rodapé da página chega tarde demais —
 * o operador já leu o número e já tirou a conclusão dele.
 *
 * Não renderiza nada quando não há limite a declarar (backend ao vivo ou
 * demonstração com dados fictícios). Uma linha que aparece só quando tem o que
 * dizer não vira ruído de fundo.
 */
export function LegendaDaAmostra() {
  const texto = legendaDaAmostra();
  if (!texto) return null;

  return (
    <p
      className="hint"
      style={{ display: 'flex', alignItems: 'flex-start', gap: 7, margin: '0 0 12px' }}
    >
      {/* Sem `title`: o ícone é decorativo, e o texto ao lado já diz tudo. */}
      <Icon name="informacao" size={14} style={{ marginTop: 2 }} />
      <span>{texto}</span>
    </p>
  );
}
