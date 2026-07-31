import { useEffect } from 'react';
import { CHAVE_TEMA } from '../components/AdminShell';

/**
 * Faz a vitrine obedecer ao tema que o usuário escolheu no console.
 *
 * O defeito que isto corrige: a preferência é gravada em localStorage
 * (`novaotica.tema`) e aplicada por <AdminShell> como PROP `data-tema` na
 * própria janela do console. A casca da loja não lê essa preferência, então
 * quem estava operando no escuro e clicava em "Óculos" via a loja abrir clara —
 * a escolha parecia ter sido apagada. O CSS já previa a correção: o bloco do
 * modo escuro em styles.css é `:root[data-tema='escuro'], [data-tema='escuro']`
 * e o comentário de lá diz, com todas as letras, "ligue com data-tema no <html>
 * para o app inteiro". Falta só alguém ligar.
 *
 * LUGAR CERTO vs. lugar possível: o dono natural deste efeito é
 * `src/components/StoreShell.tsx`, que embrulha as três rotas da loja — lá seria
 * uma linha. Esse arquivo não está sob minha responsabilidade nesta onda, então
 * o efeito mora aqui e é chamado pelas três páginas da vitrine (Loja,
 * ProductPage, Cart), que são exatamente as rotas filhas daquela casca. Quando
 * a casca assumir, basta apagar as três chamadas: os dois caminhos escrevem o
 * MESMO valor no MESMO atributo, então conviver não quebra nada.
 *
 * Escrito em <html> (e não num <div> da página) de propósito: o fundo da loja
 * vem de `.store` e da barra `.store-nav`, que são ancestrais do conteúdo. Um
 * atributo posto abaixo deles deixaria o miolo escuro dentro de uma moldura
 * clara — pior que não ter tema nenhum.
 */
export function useTemaDaVitrine() {
  useEffect(() => {
    const aplicar = () => {
      let escuro = false;
      try {
        escuro = localStorage.getItem(CHAVE_TEMA) === 'escuro';
      } catch {
        // Safari em navegação privada chega a lançar só na LEITURA do storage;
        // sem preferência legível vale o padrão do produto, que é o claro.
        escuro = false;
      }
      if (escuro) document.documentElement.setAttribute('data-tema', 'escuro');
      else document.documentElement.removeAttribute('data-tema');
    };

    aplicar();
    // Duas abas abertas: trocar o tema no console repinta a loja da outra aba.
    window.addEventListener('storage', aplicar);
    return () => {
      window.removeEventListener('storage', aplicar);
      // Sair da loja tem que devolver o documento ao estado neutro: o console
      // aplica o tema no contêiner dele, e um atributo esquecido no <html>
      // forçaria escuro no painel mesmo depois de o usuário escolher claro.
      document.documentElement.removeAttribute('data-tema');
    };
  }, []);
}
