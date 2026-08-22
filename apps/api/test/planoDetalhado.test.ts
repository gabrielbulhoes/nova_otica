import { describe, expect, it } from 'vitest';
import {
  TETO_POR_LINHA_PCT,
  chaveDePerfil,
  classificarCandidato,
  evidenciaDoPerfil,
  familiaDePeca,
  explicarLinha,
  margemPct,
  montarPlanoDetalhado,
  type CandidatoDeCompra,
  type PerfilQueVende,
} from '../src/modules/planning/planning.math.js';

/**
 * O plano de compra DETALHADO — Segmento → Marca → Tipo → Gênero → SKU.
 *
 * "ele sugere a compra, mas ele não sugere como distribuir isso por loja… ele
 *  tem que detalhar um pouco mais, tantas peças por tais marcas."
 *
 * `buildCommercialStrategy` responde QUANTO comprar. Este bloco responde O
 * QUÊ, e é a distância entre "compre 900 peças" e "compre 16 do DB99 Voyager".
 */

const peca = (over: Partial<CandidatoDeCompra> = {}): CandidatoDeCompra => ({
  id: 'x',
  sku: 'X-1',
  description: 'ARMACAO TESTE',
  brand: 'TESTE',
  tipo: 'SOLAR',
  genero: 'Masculino',
  formato: 'Piloto',
  cor: 'Havana',
  unitCost: 100,
  unitPrice: 300,
  unitsSold: 0,
  currentStock: 0,
  coberturaDaGrifeMeses: null,
  ...over,
});

const perfilVazio: PerfilQueVende = {
  porTipoGenero: new Map(),
  porFormato: new Map(),
  porCor: new Map(),
};

const perfilComSolarMasculino: PerfilQueVende = {
  porTipoGenero: new Map([[chaveDePerfil('SOLAR', 'Masculino'), 400]]),
  porFormato: new Map([['PILOTO', 120]]),
  porCor: new Map([['HAVANA', 90]]),
};

describe('classificarCandidato · a ordem das perguntas É a regra', () => {
  it('vendeu → best-seller, e nada mais decide isso', () => {
    const c = peca({ unitsSold: 12 });
    expect(classificarCandidato(c, perfilVazio)).toBe('best-seller');
  });

  it('não vendeu, mas o PERFIL vende → lançamento, não aposta', () => {
    /*
     * A distinção que sustenta o módulo inteiro.
     *
     * Numa feira quase toda peça chega com venda zero — é coleção nova. Se
     * "nunca vendeu" bastasse para virar aposta, a coleção inteira cairia no
     * balde especulativo, e o plano diria que 100% da compra é risco. O que
     * decide é se o PERFIL dela já roda na rede.
     */
    const c = peca({ unitsSold: 0 });
    expect(classificarCandidato(c, perfilComSolarMasculino)).toBe('lancamento');
  });

  it('sem giro e sem perfil → aposta', () => {
    const c = peca({ unitsSold: 0, tipo: 'RELOGIO', genero: 'Unissex' });
    expect(classificarCandidato(c, perfilComSolarMasculino)).toBe('aposta');
  });
});

describe('montarPlanoDetalhado · a soma fecha', () => {
  const explicar = (c: CandidatoDeCompra, s: 'best-seller' | 'lancamento' | 'aposta', u: number) =>
    explicarLinha(c, s, u);

  it('cada segmento fecha EXATO na meta — o concorrente não fecha', () => {
    /*
     * O Chico exibe "TOTAL best-seller: 419 un / meta 426 (aprox. no
     * re-escalonamento)". Ele perde 7 peças no arredondamento e declara isso
     * como nota de rodapé.
     *
     * Aqui fecha, porque o excedente do teto por linha é REDISTRIBUÍDO entre
     * quem tem folga, não descartado. Uma meta de compra que não fecha obriga
     * o comprador a conferir a conta na feira, no celular, com o vendedor
     * esperando.
     */
    const candidatos = Array.from({ length: 30 }, (_, i) =>
      peca({ id: `p${i}`, sku: `S${i}`, description: `PECA ${i}`, unitsSold: i + 1 }),
    );
    const plano = montarPlanoDetalhado(
      candidatos,
      { 'best-seller': 426, lancamento: 0, aposta: 0 },
      perfilVazio,
      explicar,
    );
    const bs = plano.segmentos.find((s) => s.segmento === 'best-seller')!;
    expect(bs.alocado).toBe(426);
    expect(bs.linhas.reduce((a, l) => a + l.units, 0)).toBe(426);
  });

  it('nenhuma linha passa do teto — e o excedente não some', () => {
    // Uma peça com giro esmagador levaria metade do balde. É correto na conta
    // e suicida na vitrine: concentra a compra num SKU e deixa a loja sem
    // variedade.
    const candidatos = [
      peca({ id: 'gigante', sku: 'G', description: 'GIGANTE', unitsSold: 10_000 }),
      ...Array.from({ length: 9 }, (_, i) =>
        peca({ id: `p${i}`, sku: `S${i}`, description: `PECA ${i}`, unitsSold: 5 }),
      ),
    ];
    const meta = 400;
    const plano = montarPlanoDetalhado(
      candidatos,
      { 'best-seller': meta, lancamento: 0, aposta: 0 },
      perfilVazio,
      explicar,
    );
    const bs = plano.segmentos.find((s) => s.segmento === 'best-seller')!;
    const teto = Math.ceil((meta * TETO_POR_LINHA_PCT) / 100);
    for (const l of bs.linhas) expect(l.units).toBeLessThanOrEqual(teto);
    // E a meta continua fechando: o que o teto cortou foi redistribuído.
    expect(bs.alocado).toBe(meta);
  });

  it('segmento sem candidato declara o resto em vez de sumir com ele', () => {
    // Acontece de verdade na feira: um fornecedor de uma grife só não tem o
    // que oferecer para o balde de lançamento. A meta não pode evaporar.
    const plano = montarPlanoDetalhado(
      [peca({ unitsSold: 3 })],
      { 'best-seller': 100, lancamento: 50, aposta: 25 },
      perfilVazio,
      explicar,
    );
    expect(plano.naoAlocado).toBe(150);
    expect(plano.total + plano.naoAlocado).toBe(175);
  });

  it('meta zero não inventa compra', () => {
    const plano = montarPlanoDetalhado(
      [peca({ unitsSold: 3 })],
      { 'best-seller': 0, lancamento: 0, aposta: 0 },
      perfilVazio,
      explicar,
    );
    expect(plano.total).toBe(0);
    expect(plano.segmentos.every((s) => s.linhas.length === 0)).toBe(true);
  });
});

describe('explicarLinha · a frase que o concorrente não escreve', () => {
  it('best-seller cita o giro comprovado, não uma estimativa', () => {
    const frase = explicarLinha(peca({ unitsSold: 14, currentStock: 3 }), 'best-seller', 16);
    expect(frase).toContain('14');
    expect(frase).toMatch(/giro comprovado/i);
  });

  it('lançamento nomeia o RANKING do formato e da cor', () => {
    // "piloto é o 2º formato do segmento e Havana, a 2ª cor" diz mais que
    // "formato que vende": situa a peça contra as concorrentes dela.
    const frase = explicarLinha(peca(), 'lancamento', 8, { rankFormato: 2, rankCor: 2 });
    expect(frase).toMatch(/2º formato/);
    expect(frase).toMatch(/2ª cor/);
  });

  it('a margem vem SEMPRE comparada com a média', () => {
    // 60,6% não significa nada até virar "abaixo da média de 64,5%".
    const abaixo = explicarLinha(peca({ unitCost: 118, unitPrice: 300 }), 'best-seller', 5, {
      margemMedia: 64.5,
    });
    expect(abaixo).toMatch(/abaixo da média de 64,?5%|abaixo da média de 64.5%/);
    expect(abaixo).toMatch(/[Aa]tenção/);
  });

  it('linha com zero unidade não gera frase', () => {
    expect(explicarLinha(peca(), 'aposta', 0)).toBe('');
  });
});

describe('margemPct', () => {
  it('calcula sobre o PREÇO, como a rede fala de margem', () => {
    expect(margemPct(300, 100)).toBe(66.7);
  });

  it('preço zero não vira divisão por zero', () => {
    expect(margemPct(0, 100)).toBe(0);
  });
});

/**
 * A PONTE DE VOCABULÁRIO — o defeito que a primeira execução do modo feira
 * expôs, e que teria ido a produção sem barulho.
 *
 * O histórico da rede vem do CDS e diz "OCULOS DE SOL" / "ARMACOES". A oferta
 * do fornecedor vem da planilha dele e diz "SOLAR" / "ARMACAO". São a mesma
 * coisa, nunca casam por texto, e o efeito medido foi 100% da coleção caindo
 * no balde de aposta — o plano dizendo que a compra inteira é especulação.
 *
 * É a terceira vez que esta base tropeça em dois vocabulários tratados como
 * um: a grife contra o fornecedor, o mix por nome de loja contra o id, e agora
 * o tipo da peça.
 */
describe('familiaDePeca · dois vocabulários, uma chave', () => {
  it('o CDS e o fornecedor chegam à MESMA família', () => {
    expect(familiaDePeca('OCULOS DE SOL')).toBe(familiaDePeca('SOLAR'));
    expect(familiaDePeca('ARMACOES')).toBe(familiaDePeca('ARMACAO'));
    // E com acento, que é como o ERP às vezes devolve.
    expect(familiaDePeca('Óculos de Sol')).toBe('solar');
    expect(familiaDePeca('Armações')).toBe('armacao');
  });

  it('não confunde famílias diferentes', () => {
    // "SOLAR" e "ARMACAO" precisam continuar separados: o perfil de um não
    // pode servir de lastro para o outro.
    expect(familiaDePeca('SOLAR')).not.toBe(familiaDePeca('ARMACAO'));
    expect(familiaDePeca('LENTES')).toBe('lente');
    expect(familiaDePeca('RELOGIOS')).toBe('relogio');
  });

  it('vocabulário desconhecido cai em si mesmo, sem inventar', () => {
    // Duas planilhas que usem o mesmo termo estranho continuam casando entre
    // si; nenhuma delas é forçada para dentro de uma família que não é a sua.
    expect(familiaDePeca('JOALHERIA')).toBe('joalheria');
    expect(familiaDePeca('')).toBe('');
    expect(familiaDePeca(null)).toBe('');
  });

  it('a chave de perfil degrada de gênero para tipo', () => {
    /*
     * A outra metade do mesmo defeito. A oferta do fornecedor SABE o gênero
     * (é o catálogo dele); o histórico da rede quase nunca sabe — 4.339 de 61
     * mil peças têm ficha. Exigir casamento exato compara um lado que sabe com
     * outro que não sabe, e nunca casa.
     */
    const perfil: PerfilQueVende = {
      porTipoGenero: new Map([[chaveDePerfil('OCULOS DE SOL', null), 400]]),
      porFormato: new Map(),
      porCor: new Map(),
    };
    // Com gênero: não casa exato, mas o tipo casa — meia evidência, e vale.
    expect(evidenciaDoPerfil('SOLAR', 'Masculino', perfil)).toBeGreaterThan(0);
    // Casar nos dois vale MAIS que casar só no tipo: o gênero é informação.
    const comAmbos: PerfilQueVende = {
      porTipoGenero: new Map([
        [chaveDePerfil('OCULOS DE SOL', null), 400],
        [chaveDePerfil('OCULOS DE SOL', 'Masculino'), 400],
      ]),
      porFormato: new Map(),
      porCor: new Map(),
    };
    expect(evidenciaDoPerfil('SOLAR', 'Masculino', comAmbos)).toBeGreaterThan(
      evidenciaDoPerfil('SOLAR', 'Masculino', perfil),
    );
  });

  it('peça de coleção nova com perfil conhecido é LANÇAMENTO, não aposta', () => {
    // A invariante que sustenta o modo feira. Numa feira toda peça tem
    // `unitsSold: 0`; se isso bastasse, a compra inteira viraria especulação.
    const perfil: PerfilQueVende = {
      porTipoGenero: new Map([[chaveDePerfil('OCULOS DE SOL', null), 400]]),
      porFormato: new Map(),
      porCor: new Map(),
    };
    const nova = peca({ unitsSold: 0, tipo: 'SOLAR', genero: 'Masculino' });
    expect(classificarCandidato(nova, perfil)).toBe('lancamento');
  });
});
