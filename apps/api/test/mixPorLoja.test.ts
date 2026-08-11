import { describe, expect, it } from 'vitest';
import { derivarMixPorLoja, mixEmCsv, type EvidenciaDeMix } from '../src/catalogo/mixPorLoja.js';

/**
 * O MIX POR LOJA SEMEADO DO HISTÓRICO — feedback 6.0 · item 03.
 *
 * "Todos os Dior estão sendo sugeridos para A Graciosa Guarabira, e Dior não
 * está entre as grifes dessa loja."
 *
 * O motor sempre soube respeitar a regra; o catálogo que a alimenta é que nunca
 * existiu — 1.008 marcações que ninguém digitou. Isto deriva um rascunho do que
 * a rede já fez.
 *
 * O QUE ESTES TESTES PRENDEM não é a derivação em si: é a DIREÇÃO DO ERRO.
 * Excluir uma loja por engano some com sugestão legítima de compra e de
 * transferência, e o gestor não tem como saber que sumiu. Não excluir por
 * engano mantém o defeito de hoje — ruim, mas visível. Toda dúvida cai para o
 * lado permissivo, e cada guarda abaixo é uma dessas dúvidas.
 */

const LOJAS = ['A GRACIOSA MIDWAY', 'A GRACIOSA GUARABIRA', 'A GRACIOSA PARTAGE', 'A GRACIOSA MOSSORO'];

const ev = (loja: string, grife: string, vendidas = 0, estoque = 0): EvidenciaDeMix => ({
  storeName: loja,
  grife,
  unidadesVendidas: vendidas,
  unidadesEmEstoque: estoque,
});

describe('mix por loja · o caso do feedback', () => {
  it('grife sem histórico numa loja passa a excluir aquela loja', () => {
    const r = derivarMixPorLoja(
      [
        ev('A GRACIOSA MIDWAY', 'DIOR', 12),
        ev('A GRACIOSA PARTAGE', 'DIOR', 5),
        ev('A GRACIOSA MOSSORO', 'DIOR', 0, 3),
        // Guarabira: nada. É o caso literal do cliente.
      ],
      LOJAS,
    );
    expect(r.premiumStores['DIOR']).toEqual([
      'A GRACIOSA MIDWAY',
      'A GRACIOSA MOSSORO',
      'A GRACIOSA PARTAGE',
    ]);
    expect(r.derivado.find((d) => d.grife === 'DIOR')!.lojasDeFora).toEqual(['A GRACIOSA GUARABIRA']);
  });

  it('estoque parado conta como evidência, mesmo sem venda', () => {
    // A loja tem a peça na vitrine e ainda não vendeu. Excluí-la faria o motor
    // parar de sugerir reposição de algo que ela demonstravelmente trabalha.
    const r = derivarMixPorLoja(
      [ev('A GRACIOSA MIDWAY', 'CHANEL', 9), ev('A GRACIOSA GUARABIRA', 'CHANEL', 0, 4)],
      LOJAS,
    );
    expect(r.premiumStores['CHANEL']).toContain('A GRACIOSA GUARABIRA');
  });
});

describe('mix por loja · as guardas contra excluir demais', () => {
  it('grife presente em quase toda loja NÃO vira regra', () => {
    // Ray-Ban está em toda parte. Listá-la não acrescenta regra nenhuma e cria
    // uma chance a mais de exclusão por divergência de nome de loja entre o
    // catálogo e o banco.
    const r = derivarMixPorLoja(
      LOJAS.map((l) => ev(l, 'RAY BAN', 40)),
      LOJAS,
    );
    expect(r.premiumStores['RAY BAN']).toBeUndefined();
    expect(r.derivado[0].motivoParaNaoRestringir).toBe('universal');
  });

  it('grife com evidência numa loja só NÃO vira regra', () => {
    // Uma peça que entrou por acaso — devolução, transferência avulsa, compra
    // de mostruário. Restringir a grife àquela loja congelaria o acaso como
    // decisão comercial e cortaria a compra nas outras quinze.
    const r = derivarMixPorLoja([ev('A GRACIOSA MIDWAY', 'BRIONI', 1)], LOJAS);
    expect(r.premiumStores['BRIONI']).toBeUndefined();
    expect(r.derivado[0].motivoParaNaoRestringir).toBe('evidencia-rala');
  });

  it('grife em TODAS as lojas não entra no catálogo nem como lista cheia', () => {
    const r = derivarMixPorLoja(
      LOJAS.map((l) => ev(l, 'OAKLEY', 10)),
      LOJAS,
    );
    expect(Object.keys(r.premiumStores)).toHaveLength(0);
  });

  it('a chave gravada é a NORMALIZADA — a mesma que o motor compara', () => {
    // `storeCarriesBrand` compara por `normBrandKey`. Gravar em outra forma
    // faria a regra existir no arquivo e não valer no motor — foi exatamente
    // esse o defeito que a migração a11 veio consertar noutra tabela.
    const r = derivarMixPorLoja(
      [ev('a graciosa midway', 'Dolce & Gabbana', 8), ev('A Graciosa Partage', 'dolce & gabbana', 6)],
      LOJAS,
    );
    expect(Object.keys(r.premiumStores)).toEqual(['DOLCE & GABBANA']);
    expect(r.premiumStores['DOLCE & GABBANA']).toEqual(['A GRACIOSA MIDWAY', 'A GRACIOSA PARTAGE']);
  });
});

describe('mix por loja · o CSV que o cliente confere', () => {
  const evidencias = [
    ev('A GRACIOSA MIDWAY', 'DIOR', 12),
    ev('A GRACIOSA PARTAGE', 'DIOR', 5),
    ev('A GRACIOSA MOSSORO', 'DIOR', 0, 3),
  ];

  it('traz a evidência ao lado da decisão, linha a linha', () => {
    // Sem os números na mesma linha, conferir 1.008 marcações é adivinhação: o
    // gerente precisa VER que Guarabira tem 0 e 0 para poder discordar com
    // conhecimento de causa.
    const csv = mixEmCsv(derivarMixPorLoja(evidencias, LOJAS), evidencias);
    const linhas = csv.trim().split('\n');
    expect(linhas[0]).toBe('grife;loja;trabalha;vendidas_12m;em_estoque;decisao_do_gerador');
    expect(linhas).toHaveLength(1 + LOJAS.length);

    const guarabira = linhas.find((l) => l.includes('GUARABIRA'))!;
    expect(guarabira).toBe('DIOR;A GRACIOSA GUARABIRA;NAO;0;0;SEM histórico — seria excluída');
    expect(linhas.find((l) => l.includes('MIDWAY'))).toBe('DIOR;A GRACIOSA MIDWAY;SIM;12;0;tem histórico');
  });

  it('a grife que não restringe aparece com todas as lojas em SIM', () => {
    // O CSV mostra TUDO, inclusive o que não virou regra. Omitir as universais
    // faria o cliente conferir uma lista e concluir que o resto está excluído.
    const universais = LOJAS.map((l) => ev(l, 'RAY BAN', 30));
    const csv = mixEmCsv(derivarMixPorLoja(universais, LOJAS), universais);
    const linhas = csv.trim().split('\n').slice(1);
    expect(linhas).toHaveLength(LOJAS.length);
    expect(linhas.every((l) => l.includes(';SIM;'))).toBe(true);
    expect(linhas.every((l) => l.includes('grife universal'))).toBe(true);
  });
});
