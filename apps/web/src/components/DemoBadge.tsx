/**
 * Selo persistente do modo demonstração (VITE_DEMO=1), fixo em todas as telas.
 * Texto padrão: "dados fictícios". Quando o build embarca o dataset REAL
 * (VITE_DEMO_LABEL definido no momento do build), o selo diz a verdade:
 * dados reais, estáticos (fotografia da sonda), sem nada salvo em servidor.
 */
const label = import.meta.env.VITE_DEMO_LABEL as string | undefined;

export function DemoBadge() {
  return (
    <div
      className="demo-seal"
      role="note"
      title={
        label
          ? 'Amostra estática com dados reais da rede (fotografia da sincronização). Nada é salvo em servidor; ações são locais ao navegador.'
          : 'Ambiente de demonstração: todos os dados são fictícios e vivem no seu navegador. Nada é salvo em servidor.'
      }
    >
      <span className="demo-seal-dot" aria-hidden />
      <span>
        {label ? (
          <>
            {label} · <strong>estático</strong>
          </>
        ) : (
          <>
            Dados fictícios · <strong>demonstração</strong>
          </>
        )}
      </span>
    </div>
  );
}
