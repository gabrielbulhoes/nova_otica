import { Icon } from '../brand/Icon';

/**
 * Selo persistente do modo demonstração (VITE_DEMO=1), fixo em todas as telas.
 * Texto padrão: "dados fictícios". Quando o build embarca o dataset REAL
 * (VITE_DEMO_LABEL definido no momento do build), o selo diz a verdade:
 * dados reais, estáticos (fotografia da sonda), sem nada salvo em servidor.
 *
 * A função é jurídica antes de ser visual: ninguém pode confundir esta amostra
 * com o sistema em produção. Por isso o selo continua fixo, opaco e legível —
 * o que mudou foi só o vocabulário (mono caixa alta e filete, no lugar da
 * pastilha com sombra e pulso do tema anterior).
 */
const label = import.meta.env.VITE_DEMO_LABEL as string | undefined;

export function DemoBadge() {
  return (
    <div
      className="demo-seal"
      role="note"
      /*
        A sombra difusa é herança do tema macOS: no NANOFLOW a separação entre
        superfícies é o filete de 1px, que .demo-seal já tem em --linha. O
        override é inline porque styles.css não pertence a esta onda — quando
        alguém encostar no arquivo, o lugar certo é apagar o box-shadow da
        regra e remover isto daqui.
      */
      style={{ boxShadow: 'none' }}
      title={
        label
          ? 'Amostra estática com dados reais da rede (fotografia da sincronização). Nada é salvo em servidor; ações são locais ao navegador.'
          : 'Ambiente de demonstração: todos os dados são fictícios e vivem no seu navegador. Nada é salvo em servidor.'
      }
    >
      {/*
        Saiu o quadrado dourado que pulsava a cada 2,4s: era um marcador que só
        comunicava por cor, em ouro puro sobre claro (2.17:1), e a animação
        infinita não tinha guarda de prefers-reduced-motion. O ícone de nota
        herda a tinta do selo, tem forma própria e diz o mesmo que o role="note"
        — o significado, esse, quem carrega é o texto ao lado.
      */}
      <Icon name="informacao" size={14} />
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
