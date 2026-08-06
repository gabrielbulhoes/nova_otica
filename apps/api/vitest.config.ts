import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    /**
     * Arquivos de teste rodam um de cada vez.
     *
     * Os testes `*.db.test.ts` compartilham UM banco, e alguns precisam
     * mutá-lo para provar o que provam: os de escopo de loja marcam uma filial
     * como retaguarda (ou como "em outro ERP") e conferem que ela sai de todas
     * as telas. Enquanto essa marca está de pé, qualquer outro arquivo que
     * meça faturamento vê um universo de lojas diferente do que espera.
     *
     * Isso apareceu de verdade: com dois arquivos mutando o escopo em vez de
     * um, o teste de faturamento do BI passou a falhar em duas de cada três
     * execuções — e falhar sempre com o MESMO número, que é o disfarce mais
     * convincente que um teste instável pode usar.
     *
     * O custo é a suíte inteira sair de ~8s para ~15s. É barato: uma suíte que
     * falha um terço das vezes ensina a equipe a rodar de novo em vez de ler o
     * erro, e a partir daí ela não gateia mais nada.
     */
    fileParallelism: false,
  },
});
