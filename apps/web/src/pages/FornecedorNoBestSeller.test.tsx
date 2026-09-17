import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { montarPlanoDetalhado, type CandidatoDeCompra, type PerfilQueVende } from '@planning';
import { PlanoDeCompra } from './Strategy';

/**
 * "Best seller continua sem separar por fornecedor." — Galbe, 17/09/2026.
 *
 * O trilho da rodada anterior ficou na tela de Pedido de compra, porque era o
 * PEDIDO que o texto do cliente mandava agrupar. Só que a compra se fecha por
 * fornecedor, e nesta aba ela aparecia dissolvida entre grifes: Ray-Ban e
 * Oakley, que saem na MESMA nota da Luxottica, eram dois blocos distantes.
 *
 * COMO NOS OUTROS TESTES DE TELA, o plano vem do motor de verdade. Um objeto
 * escrito à mão teria os campos que o teste inventou — foi assim que uma coluna
 * saiu vazia numa entrega inteira com typecheck verde.
 */

const cand = (o: Partial<CandidatoDeCompra>): CandidatoDeCompra => ({
  id: 'x',
  sku: 'X',
  description: 'PECA',
  brand: 'Ray-Ban',
  fornecedor: 'Luxottica',
  tipo: 'ARMACAO',
  genero: 'Unissex',
  formato: 'Quadrado',
  cor: 'Preto',
  unitCost: 100,
  unitPrice: 300,
  unitsSold: 10,
  currentStock: 1,
  coberturaDaGrifeMeses: 3,
  absorcao: null,
  ...o,
});

const PERFIL: PerfilQueVende = {
  porTipoGenero: new Map([['armacao|unissex', 100]]),
  porFormato: new Map(),
  porCor: new Map(),
};

// O motor devolve os segmentos; a tela também lê o que o SERVIÇO acrescenta
// depois (destino por loja, universo examinado, motivo). Sem esses campos o
// componente quebra em `fmt(undefined)` — e essa é a diferença entre testar o
// motor e testar a tela.
const planoCom = (candidatos: CandidatoDeCompra[]) => {
  const p = montarPlanoDetalhado(candidatos, { 'best-seller': 60, lancamento: 0 }, PERFIL, () => 'porque sim');
  return {
    ...p,
    porLoja: [],
    days: 90,
    candidatosExaminados: candidatos.length,
    universo: candidatos.length,
    truncado: false,
    motivo: '',
  };
};

const SEGMENTOS = [
  { key: 'best-seller' as const, label: 'Best-seller', rationale: '', units: 60, pct: 100 },
  { key: 'lancamento' as const, label: 'Lançamento', rationale: '', units: 0, pct: 0 },
];

/*
 * NA ÁRVORE, NÃO NA TELA INTEIRA.
 *
 * A primeira versão destes testes perguntava `getAllByText('Luxottica')` e
 * passava mesmo com a árvore agrupando por MARCA — porque o trilho também
 * escreve o nome do fornecedor. Quatro dos cinco testes não provavam nada.
 * O recorte abaixo é o que separa "aparece em algum lugar" de "é o nível".
 */
const naArvore = (texto: string) =>
  screen.queryAllByText(texto).filter((el) => !el.closest('nav[aria-label*="ornecedor"]'));

describe('a aba de best-seller separa por fornecedor', () => {
  it('duas grifes do MESMO fornecedor ficam sob um cabeçalho só, na árvore', () => {
    const plano = planoCom([
      cand({ id: 'a', sku: 'RB-1', description: 'ARMACAO RAY-BAN', brand: 'Ray-Ban', fornecedor: 'Luxottica', unitsSold: 20 }),
      cand({ id: 'b', sku: 'OK-1', description: 'ARMACAO OAKLEY', brand: 'Oakley', fornecedor: 'Luxottica', unitsSold: 15 }),
      cand({ id: 'c', sku: 'KE-1', description: 'ARMACAO GUCCI', brand: 'Gucci', fornecedor: 'Kering', unitsSold: 10 }),
    ]);

    render(<PlanoDeCompra plano={plano} segments={SEGMENTOS} />);

    // O fornecedor é NÍVEL da árvore, e um só por fornecedor — com duas grifes
    // da Luxottica, "Luxottica" aparece UMA vez ali, não duas.
    expect(naArvore('Luxottica')).toHaveLength(1);
    expect(naArvore('Kering')).toHaveLength(1);

    // E as duas grifes continuam existindo, agora por baixo dele.
    expect(naArvore('Ray-Ban')).toHaveLength(1);
    expect(naArvore('Oakley')).toHaveLength(1);

    // O nível do fornecedor vem ANTES do da grife na ordem do documento — é o
    // que "acima de" significa numa árvore aninhada.
    const luxottica = naArvore('Luxottica')[0];
    const rayban = naArvore('Ray-Ban')[0];
    expect(luxottica.compareDocumentPosition(rayban) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('o trilho lista cada fornecedor com as suas linhas e unidades', () => {
    const plano = planoCom([
      cand({ id: 'a', brand: 'Ray-Ban', fornecedor: 'Luxottica', unitsSold: 20 }),
      cand({ id: 'b', brand: 'Oakley', fornecedor: 'Luxottica', unitsSold: 15 }),
      cand({ id: 'c', brand: 'Gucci', fornecedor: 'Kering', unitsSold: 10 }),
    ]);

    render(<PlanoDeCompra plano={plano} segments={SEGMENTOS} />);

    const trilho = screen.getByRole('navigation', { name: /fornecedor/i });
    expect(within(trilho).getByText('Todos os fornecedores')).toBeTruthy();
    expect(within(trilho).getByText('Luxottica')).toBeTruthy();
    expect(within(trilho).getByText('Kering')).toBeTruthy();
    // Duas linhas da Luxottica contra uma da Kering.
    expect(within(trilho).getByText(/2 linhas/)).toBeTruthy();
  });

  it('peça sem fornecedor não some — vai para um grupo nomeado', () => {
    const plano = planoCom([
      cand({ id: 'a', brand: 'Ray-Ban', fornecedor: 'Luxottica', unitsSold: 20 }),
      cand({ id: 'b', brand: 'Generica', fornecedor: null, unitsSold: 15 }),
    ]);

    render(<PlanoDeCompra plano={plano} segments={SEGMENTOS} />);

    // Ausência é informação, não um buraco a esconder — a mesma disciplina da
    // ficha do fornecedor no pedido de compra. E é NÍVEL, não só botão.
    expect(naArvore('Sem fornecedor')).toHaveLength(1);
  });

  it('fornecedor único não vira trilho, mas continua sendo o nível de cima', () => {
    const plano = planoCom([
      cand({ id: 'a', brand: 'Ray-Ban', fornecedor: 'Luxottica', unitsSold: 20 }),
      cand({ id: 'b', brand: 'Oakley', fornecedor: 'Luxottica', unitsSold: 15 }),
    ]);

    render(<PlanoDeCompra plano={plano} segments={SEGMENTOS} />);

    // Um botão só não é escolha: o trilho não aparece.
    expect(screen.queryByRole('navigation', { name: /fornecedor/i })).toBeNull();
    // Mas a árvore continua dizendo de quem se compra.
    expect(naArvore('Luxottica')).toHaveLength(1);
  });

  it('grife igual ao fornecedor NÃO desenha dois níveis iguais', () => {
    // Peça sem grife reconhecível na descrição: a grife de análise cai no campo
    // do ERP, que é o próprio fornecedor. "Hoya › Hoya" é degrau sem informação
    // e um clique a mais — visto no navegador ao subir o nível de fornecedor.
    const plano = planoCom([
      cand({ id: 'a', brand: 'Hoya', fornecedor: 'Hoya', unitsSold: 20 }),
      cand({ id: 'b', brand: 'Ray-Ban', fornecedor: 'Luxottica', unitsSold: 15 }),
    ]);

    render(<PlanoDeCompra plano={plano} segments={SEGMENTOS} />);

    // Uma só ocorrência de "Hoya" na árvore (o trilho é outro nó e traz a sua).
    expect(naArvore('Hoya')).toHaveLength(1);
  });
});
