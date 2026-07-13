/**
 * Selo persistente de "dados fictícios" para o MVP/demonstração.
 * Fica fixo em um canto da tela em todas as páginas quando VITE_DEMO=1.
 */
export function DemoBadge() {
  return (
    <div
      className="demo-seal"
      role="note"
      title="Ambiente de demonstração: todos os dados são fictícios e vivem no seu navegador. Nada é salvo em servidor."
    >
      <span className="demo-seal-dot" aria-hidden />
      <span>
        Dados fictícios · <strong>demonstração</strong>
      </span>
    </div>
  );
}
