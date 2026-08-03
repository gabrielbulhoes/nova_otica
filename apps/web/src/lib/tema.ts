import { useSyncExternalStore } from 'react';

/**
 * TEMA DO CONSOLE — escolha do usuário, com o CLARO como ponto de partida
 * garantido.
 *
 * A regra do produto tem duas metades, e as duas importam:
 *
 *   1. O usuário pode trocar para o escuro quando quiser (o botão vive na barra
 *      de título do console).
 *   2. Toda ABERTURA começa no claro — o branco-papel do NANOFLOW, que é o
 *      padrão do manual e a aparência aprovada pelo cliente.
 *
 * POR QUE A ESCOLHA NÃO É GRAVADA NO NAVEGADOR
 * Antes ela ia para `localStorage`. Isso fazia o escuro sobreviver ao
 * fechamento do navegador: bastava alguém clicar uma vez, em qualquer momento,
 * para a demonstração seguinte naquela máquina abrir preta — sem que ninguém
 * lembrasse do clique. Guardando o tema só em memória, a metade 2 vira uma
 * propriedade do código, não uma disciplina de quem usa: não existe estado
 * gravado que possa contradizê-la. Recarregar a página, abrir outra aba ou
 * voltar no dia seguinte sempre começa no claro.
 * (Se um dia a escolha precisar mesmo sobreviver ao recarregamento, o lugar é
 * aqui: trocar as três funções abaixo por leitura/escrita em storage. Nenhuma
 * tela precisa saber.)
 *
 * POR QUE UM STORE, E NÃO UM ESTADO DENTRO DO <AdminShell>
 * O tema vale para as DUAS cascas — o console e a vitrine (/loja) —, e elas são
 * irmãs no roteador, não mãe e filha. Um `useState` no console não alcançaria a
 * loja, e foi exatamente esse buraco que fazia a vitrine abrir clara enquanto o
 * console estava escuro. Um store externo com `useSyncExternalStore` deixa as
 * duas lendo a mesma fonte, e a troca repinta as duas no mesmo quadro.
 *
 * Nada aqui consulta `prefers-color-scheme`: o tema do sistema operacional do
 * gerente nunca decidiu a aparência do produto.
 */

export type Tema = 'claro' | 'escuro';

/** O ponto de partida de toda abertura. */
const PADRAO: Tema = 'claro';

let atual: Tema = PADRAO;
const ouvintes = new Set<() => void>();

/**
 * Tema em vigor, fora do React. É o que `useTema` lê a cada aviso — e o que os
 * testes usam para verificar a promessa de que toda abertura começa no claro.
 */
export function lerTema(): Tema {
  return atual;
}

/**
 * Assina as trocas. É o que `useTema` entrega ao React — e o caminho para
 * qualquer consumidor fora de componente. Devolve a função de cancelar.
 */
export function assinarTema(aoMudar: () => void): () => void {
  ouvintes.add(aoMudar);
  return () => {
    ouvintes.delete(aoMudar);
  };
}

export function definirTema(proximo: Tema): void {
  if (proximo === atual) return;
  atual = proximo;
  for (const avisar of ouvintes) avisar();
}

export function alternarTema(): void {
  definirTema(atual === 'escuro' ? 'claro' : 'escuro');
}

/**
 * Tema em vigor. O terceiro argumento é o valor do servidor/primeiro quadro —
 * o mesmo padrão, para que não exista um instante de tema diferente na
 * hidratação.
 */
export function useTema(): Tema {
  return useSyncExternalStore(assinarTema, lerTema, () => PADRAO);
}
