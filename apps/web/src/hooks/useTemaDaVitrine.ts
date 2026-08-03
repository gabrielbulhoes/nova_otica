import { useEffect } from 'react';

/**
 * Garante que a vitrine abra — e permaneça — no tema CLARO.
 *
 * Antes este efeito lia a preferência gravada pelo console (`novaotica.tema`) e
 * espelhava a escolha do usuário na loja. Essa preferência deixou de existir: o
 * produto inteiro passou a ser o branco-papel do NANOFLOW (ver o bloco "Tema"
 * em `components/AdminShell.tsx`), e ninguém mais escreve `data-tema`.
 *
 * O hook não virou linha morta por um motivo prático: o atributo mora no
 * <html>, que sobrevive à troca de rota e à troca de bundle dentro da mesma
 * aba. Um valor deixado ali por uma versão anterior do site — ou por um
 * `localStorage` antigo já aplicado antes desta atualização carregar — pintaria
 * a loja de preto sem que nenhuma linha do código atual tivesse pedido isso.
 * Limpar na entrada e na saída é barato e fecha esse caminho.
 *
 * Chamado pelas três páginas da vitrine (Loja, ProductPage, Cart), que são as
 * rotas filhas de <StoreShell>.
 */
export function useTemaDaVitrine() {
  useEffect(() => {
    document.documentElement.removeAttribute('data-tema');
    return () => {
      document.documentElement.removeAttribute('data-tema');
    };
  }, []);
}
