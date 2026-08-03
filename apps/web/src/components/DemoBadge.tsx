import { useLayoutEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
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

/**
 * Há algum escopo escuro ligado no documento agora?
 *
 * O `:not(.demo-seal)` não é preciosismo: o próprio selo passa a carregar
 * `data-tema` quando escurece, e sem excluí-lo a consulta encontraria a si
 * mesma — o selo travaria no escuro para sempre, inclusive depois de o usuário
 * voltar o console para o claro.
 *
 * A pergunta é deliberadamente ampla ("existe escopo escuro?") e não amarrada à
 * classe da casca: a vitrine ganha tema próprio, e um seletor com o nome de cada
 * casca quebraria em silêncio na próxima que aparecesse. O preço é que, se
 * alguém escurecer só um bloco (o manual permite, para o painel de BI), o selo
 * acompanha. É o erro barato dos dois: selo escuro sobre um canto claro incomoda;
 * selo claro sobre o console preto é o defeito que esta função existe para tirar.
 */
function documentoEstaEscuro(): boolean {
  if (typeof document === 'undefined') return false;
  return document.querySelector('[data-tema="escuro"]:not(.demo-seal)') !== null;
}

/**
 * Tema em vigor no console, visto de fora da casca.
 *
 * O selo é irmão de <App/> em App.tsx, não descendente da casca, então ele não
 * tem como receber o tema por contexto nem por cascata de CSS — e ler a
 * preferência gravada daria a resposta errada: com "escuro" guardado e o
 * usuário no /login (onde nenhuma casca está montada), a tela é clara e o selo
 * ficaria preto por cima dela. Quem responde certo é o DOM: o selo espelha o
 * que está desenhado embaixo dele.
 *
 * Duas fontes de mudança, porque são dois eventos diferentes:
 * · o atributo sendo escrito e apagado no mesmo elemento (o usuário alternando
 *   o tema) — é o que o MutationObserver filtrado por `data-tema` pega;
 * · o elemento que JÁ tem o atributo entrando ou saindo da árvore (navegar de
 *   /login para /admin monta a casca inteira de uma vez) — aí não há mutação de
 *   atributo nenhuma, e quem avisa é a troca de rota.
 *
 * É efeito de LAYOUT, e não de efeito comum, para a primeira leitura acontecer
 * antes da pintura: em useEffect o selo apareceria claro por um quadro sobre o
 * console preto, que é exatamente o defeito que esta correção existe para tirar.
 */
function useConsoleEscuro(): boolean {
  const { pathname } = useLocation();
  const [escuro, setEscuro] = useState(documentoEstaEscuro);

  useLayoutEffect(() => {
    const reler = () => setEscuro(documentoEstaEscuro());
    reler();
    if (typeof MutationObserver === 'undefined') return;
    // Observa a raiz com subtree porque `data-tema` mora no contêiner da casca,
    // que troca a cada rota; o filtro por atributo mantém o custo perto de zero.
    const observador = new MutationObserver(reler);
    observador.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-tema'],
      subtree: true,
    });
    return () => observador.disconnect();
  }, [pathname]);

  return escuro;
}

export function DemoBadge() {
  const escuro = useConsoleEscuro();

  return (
    <div
      className="demo-seal"
      role="note"
      /*
        Escrever `data-tema` NO SELO é o que conserta o selo claro brilhando por
        cima do console preto. Os tokens do tema escuro são redeclarados em
        `[data-tema='escuro']`, e não só em `:root[data-tema='escuro']`, de
        propósito — justamente para escurecer um bloco solto. Como .demo-seal
        pinta-se pelos aliases (--window-solid, --text, --accent), o atributo
        sozinho já leva o selo para preto/branco/ouro-lux, sem uma segunda
        paleta escrita à mão aqui ou no CSS.
      */
      data-tema={escuro ? 'escuro' : undefined}
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
