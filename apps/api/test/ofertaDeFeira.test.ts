import { describe, expect, it } from 'vitest';
import type { Planilha } from '../src/lib/xlsx.js';
import {
  lerNumero,
  lerOfertaDeFeira,
  normalizarCabecalho,
} from '../src/catalogo/ofertaDeFeira.js';

/**
 * A planilha de oferta de uma feira.
 *
 * O problema não é ler XLSX — é que cada fornecedor manda um cabeçalho
 * diferente e uma convenção de número diferente. Os dois erram em SILÊNCIO:
 * uma coluna não reconhecida vira campo vazio, e uma vírgula lida como
 * separador de milhar transforma R$ 1.234,56 em R$ 123.456.
 */

const planilha = (linhas: string[][]): Planilha => ({
  abas: ['Oferta'],
  linhas: () => linhas,
});

describe('lerNumero · as duas convenções chegam do mesmo fornecedor', () => {
  it('lê o padrão brasileiro', () => {
    expect(lerNumero('1.234,56')).toBe(1234.56);
    expect(lerNumero('R$ 1.234,56')).toBe(1234.56);
    expect(lerNumero('980,00')).toBe(980);
  });

  it('lê o padrão americano', () => {
    expect(lerNumero('1,234.56')).toBe(1234.56);
    expect(lerNumero('1234.56')).toBe(1234.56);
  });

  it('o ÚLTIMO separador é o decimal — é a regra que evita o erro de 100x', () => {
    // Separador único seguido de TRÊS dígitos é milhar: estes arquivos são de
    // preço, e preço tem duas casas. Lido como decimal, R$ 1.234 viraria
    // R$ 1,23 — e a peça subiria ao topo do plano por ser "barata".
    expect(lerNumero('1.234')).toBe(1234);
    expect(lerNumero('1,234')).toBe(1234);
    // Uma ou duas casas continuam sendo decimal, que é o caso comum.
    expect(lerNumero('1,5')).toBe(1.5);
    expect(lerNumero('98,50')).toBe(98.5);
  });

  it('vazio e lixo devolvem null, não zero', () => {
    // Zero é uma AFIRMAÇÃO sobre o preço; ausência não é.
    expect(lerNumero('')).toBeNull();
    expect(lerNumero('—')).toBeNull();
  });
});

describe('normalizarCabecalho', () => {
  it('tira acento, caixa e pontuação', () => {
    expect(normalizarCabecalho('Referência')).toBe('referencia');
    expect(normalizarCabecalho('PREÇO DE CUSTO')).toBe('preco de custo');
    expect(normalizarCabecalho('  Cor da Armação  ')).toBe('cor da armacao');
  });
});

describe('lerOfertaDeFeira · cabeçalhos que mudam a cada fornecedor', () => {
  it('reconhece o cabeçalho por sinônimo, não por posição', () => {
    const r = lerOfertaDeFeira(
      planilha([
        ['Referência', 'Produto', 'Marca', 'Tipo', 'Sexo', 'Shape', 'Cor', 'Preço de custo', 'Preço sugerido'],
        ['DB99', 'DB99 VOYAGER', 'DAVID BECKHAM', 'SOLAR', 'Masculino', 'Piloto', 'Havana', '118,00', '300,00'],
      ]),
    );
    expect(r.linhas).toHaveLength(1);
    expect(r.linhas[0]).toMatchObject({
      sku: 'DB99',
      brand: 'DAVID BECKHAM',
      genero: 'Masculino',
      formato: 'Piloto',
      unitCost: 118,
      unitPrice: 300,
    });
  });

  it('DECLARA as colunas que não reconheceu em vez de engoli-las', () => {
    // Coluna ignorada em silêncio é como o gênero nunca entra e ninguém
    // descobre — até o plano vir sem gênero nenhum meses depois.
    const r = lerOfertaDeFeira(
      planilha([
        ['SKU', 'Descrição', 'Marca', 'Preço', 'Curva ABC', 'Observações'],
        ['A1', 'PECA', 'RAY-BAN', '200', 'A', 'nada'],
      ]),
    );
    expect(r.ignoradas).toEqual(['Curva ABC', 'Observações']);
    expect(r.linhas).toHaveLength(1);
  });

  it('sem coluna obrigatória, devolve ZERO linha e diz qual faltou', () => {
    // Mil linhas erradas são piores que nenhuma linha com o motivo.
    const r = lerOfertaDeFeira(
      planilha([
        ['SKU', 'Descrição', 'Preço'],
        ['A1', 'PECA', '200'],
      ]),
    );
    expect(r.linhas).toHaveLength(0);
    expect(r.ausentes).toContain('brand');
  });

  it('descarta a linha ruim COM o motivo, e ignora a linha em branco', () => {
    const r = lerOfertaDeFeira(
      planilha([
        ['SKU', 'Descrição', 'Marca', 'Preço'],
        ['A1', 'BOA', 'RAY-BAN', '200'],
        ['', '', '', ''],
        ['A2', 'SEM PRECO', 'RAY-BAN', ''],
        ['', 'SEM SKU', 'RAY-BAN', '100'],
      ]),
    );
    expect(r.linhas).toHaveLength(1);
    // A linha totalmente vazia é o rodapé comum de planilha e não vira ruído.
    expect(r.descartadas).toEqual([
      { linha: 4, motivo: 'sem preço de venda' },
      { linha: 5, motivo: 'sem SKU' },
    ]);
  });

  it('SKU repetido: a última vence, e o operador é avisado', () => {
    const r = lerOfertaDeFeira(
      planilha([
        ['SKU', 'Descrição', 'Marca', 'Preço'],
        ['A1', 'PRIMEIRA', 'RAY-BAN', '200'],
        ['A1', 'SEGUNDA', 'RAY-BAN', '250'],
      ]),
    );
    expect(r.linhas).toHaveLength(1);
    expect(r.linhas[0].description).toBe('SEGUNDA');
    expect(r.repetidos).toBe(1);
  });

  it('custo ausente é ESTIMADO, nunca zero', () => {
    /*
     * Zero daria margem de 100% e faria a peça parecer a melhor da feira —
     * ela subiria ao topo do plano por um campo que o fornecedor não mandou.
     * A estimativa usa a mesma margem típica do resto do motor.
     */
    const r = lerOfertaDeFeira(
      planilha([
        ['SKU', 'Descrição', 'Marca', 'Preço'],
        ['A1', 'PECA', 'RAY-BAN', '300'],
      ]),
    );
    expect(r.linhas[0].unitCost).toBe(165);
    expect(r.linhas[0].unitCost).toBeGreaterThan(0);
  });

  it('duas colunas de preço não brigam pela mesma vaga', () => {
    // "Preço de custo" e "Preço sugerido" casariam ambas com "preco" numa
    // busca por substring. O casamento é exato contra a lista de sinônimos.
    const r = lerOfertaDeFeira(
      planilha([
        ['SKU', 'Descrição', 'Marca', 'Preço de custo', 'Preço de venda'],
        ['A1', 'PECA', 'RAY-BAN', '100', '300'],
      ]),
    );
    expect(r.linhas[0].unitCost).toBe(100);
    expect(r.linhas[0].unitPrice).toBe(300);
  });
});
