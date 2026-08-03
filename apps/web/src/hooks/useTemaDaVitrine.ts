import { useEffect } from 'react';
import { useTema } from '../lib/tema';

/**
 * Faz a vitrine obedecer ao tema que o usuário escolheu no console.
 *
 * O defeito que isto corrige: quem estava operando no escuro e clicava em
 * "Óculos" via a loja abrir clara — a escolha parecia ter sido apagada. O CSS já
 * previa a correção: o bloco do modo escuro em styles.css é
 * `:root[data-tema='escuro'], [data-tema='escuro']` e o comentário de lá diz,
 * com todas as letras, "ligue com data-tema no <html> para o app inteiro".
 * Falta só alguém ligar.
 *
 * A FONTE É O STORE, NÃO O NAVEGADOR. Antes este efeito lia a preferência
 * gravada em `localStorage`, e era essa gravação que fazia o escuro sobreviver
 * ao fechamento do navegador — o motivo de a demonstração conseguir abrir preta
 * dias depois de alguém ter clicado no botão. Agora o valor vem de
 * `lib/tema.ts`, que vive só em memória: as duas cascas leem a mesma fonte
 * dentro da sessão, e toda abertura recomeça no claro.
 *
 * Escrito em <html> (e não num <div> da página) de propósito: o fundo da loja
 * vem de `.store` e da barra `.store-nav`, que são ancestrais do conteúdo. Um
 * atributo posto abaixo deles deixaria o miolo escuro dentro de uma moldura
 * clara — pior que não ter tema nenhum.
 *
 * LUGAR CERTO vs. lugar possível: o dono natural deste efeito é
 * `src/components/StoreShell.tsx`, que embrulha as três rotas da loja — lá seria
 * uma linha. Enquanto a casca não assume, o efeito mora aqui e é chamado pelas
 * três páginas da vitrine (Loja, ProductPage, Cart), que são exatamente as
 * rotas filhas daquela casca. Quando ela assumir, basta apagar as três
 * chamadas: os dois caminhos escrevem o MESMO valor no MESMO atributo, então
 * conviver não quebra nada.
 */
export function useTemaDaVitrine() {
  const tema = useTema();

  useEffect(() => {
    if (tema === 'escuro') document.documentElement.setAttribute('data-tema', 'escuro');
    else document.documentElement.removeAttribute('data-tema');

    return () => {
      // Sair da loja tem que devolver o documento ao estado neutro: o console
      // aplica o tema no contêiner dele, e um atributo esquecido no <html>
      // forçaria escuro no painel mesmo depois de o usuário escolher claro.
      document.documentElement.removeAttribute('data-tema');
    };
  }, [tema]);
}
