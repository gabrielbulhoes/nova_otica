import { describe, expect, it } from 'vitest';
import {
  EIXOS_DO_DETALHAMENTO,
  detalharPorCaracteristicas,
  folhasDeCaracteristicas,
  generoProvavel,
  montarPlanoDetalhado,
  explicarLinha,
  type CandidatoDeCompra,
  type LinhaDoPlano,
  type PerfilQueVende,
  type SegmentoDoPlano,
} from '../src/modules/planning/planning.math.js';

/**
 * O PEDIDO SEM SKU — rodada final final.
 *
 * "Na aba de lançamentos, como não iremos especificar sobre SKU's, devemos
 *  orientar detalhando ao máximo as características daquele pedido/quantidade.
 *  Seguindo a seguinte ordem de prioridade: Marca - Grupo (óculos ou armação) -
 *  Gênero - Formato da Lente - Cor. Esse detalhamento só se aplica à aba de
 *  lançamentos. A aba best-seller mantém o padrão da versão anterior."
 *                                                     — Galbe, 16/09/2026
 */
// `...o` por último, e não `o.campo ?? padrão`: com o `??`, passar
// `formato: null` devolvia o padrão e o teste do campo ausente provava o
// contrário do que dizia provar.
const cand = (o: Partial<CandidatoDeCompra>): CandidatoDeCompra => ({
  id: 'x',
  sku: 'X',
  description: 'PECA',
  brand: 'Ray-Ban',
  tipo: 'OCULOS',
  genero: 'Feminino',
  formato: 'Gatinho',
  cor: 'Preto',
  unitCost: 100,
  unitPrice: 300,
  unitsSold: 0,
  currentStock: 0,
  coberturaDaGrifeMeses: null,
  absorcao: null,
  ...o,
});

const linha = (c: Partial<CandidatoDeCompra>, units: number): LinhaDoPlano => ({
  candidato: cand(c),
  segmento: 'lancamento',
  units,
  margemPct: 66,
  porque: '',
});

describe('generoProvavel — "ajustar ao mais provável por falta de informação"', () => {
  it('gênero declarado não é palpite', () => {
    expect(generoProvavel('Unisex')).toEqual({ genero: 'UNISSEX', presumido: false });
    expect(generoProvavel('Menina')).toEqual({ genero: 'FEMININO', presumido: false });
  });

  it('sem gênero, lê a descrição — e declara que leu', () => {
    expect(generoProvavel(null, 'RB3025 OCULOS RAY BAN FEMININO')).toEqual({
      genero: 'FEMININO',
      presumido: true,
    });
  });

  it('sem nada, cai em unissex — o único dos três que não inventa um gênero', () => {
    expect(generoProvavel(null, 'RB3025 001 58 OCULOS RAY BAN')).toEqual({
      genero: 'UNISSEX',
      presumido: true,
    });
    expect(generoProvavel(null, null)).toEqual({ genero: 'UNISSEX', presumido: true });
  });
});

describe('detalharPorCaracteristicas', () => {
  it('a ordem dos eixos é a do cliente, e é ordem de prioridade', () => {
    expect([...EIXOS_DO_DETALHAMENTO]).toEqual(['marca', 'grupo', 'genero', 'formato', 'cor']);
  });

  it('agrupa peças diferentes com as MESMAS características numa linha só', () => {
    // É o ponto inteiro do pedido sem SKU: o comprador pede "doze Ray-Ban
    // solares femininos gatinho pretos", não três pedidos de quatro.
    const arvore = detalharPorCaracteristicas([
      linha({ id: 'a', sku: 'A' }, 4),
      linha({ id: 'b', sku: 'B' }, 5),
      linha({ id: 'c', sku: 'C' }, 3),
    ]);
    const folhas = folhasDeCaracteristicas(arvore);
    expect(folhas).toHaveLength(1);
    expect(folhas[0].units).toBe(12);
    expect(folhas[0].pecas).toBe(3);
    expect(folhas[0].descricao).toBe('Ray-Ban · Óculos de sol · Feminino · Gatinho (cat-eye) · Preto');
  });

  it('a grafia não separa o pedido: "Cat-Eye" e "gatinho" são a mesma linha', () => {
    const folhas = folhasDeCaracteristicas(
      detalharPorCaracteristicas([
        linha({ id: 'a', formato: 'Cat-Eye' }, 6),
        linha({ id: 'b', formato: 'gatinho' }, 6),
        linha({ id: 'c', cor: 'PRETO' }, 6),
      ]),
    );
    expect(folhas).toHaveLength(1);
    expect(folhas[0].units).toBe(18);
  });

  it('separa por cada eixo, e ordena por unidades em cada nível', () => {
    const arvore = detalharPorCaracteristicas([
      linha({ id: 'a', brand: 'Oakley', tipo: 'ARMACAO', genero: 'Masculino', formato: 'Quadrado', cor: 'Azul' }, 3),
      linha({ id: 'b' }, 10),
      linha({ id: 'c', cor: 'Havana' }, 7),
    ]);
    // Nível 1: marca, a de mais unidades primeiro (Ray-Ban 17 × Oakley 3).
    expect(arvore.map((n) => n.rotulo)).toEqual(['Ray-Ban', 'Oakley']);
    expect(arvore[0].units).toBe(17);
    expect(arvore[0].pecas).toBe(2);
    // E a folha da Ray-Ban abre em duas cores, a maior primeiro.
    const folhas = folhasDeCaracteristicas([arvore[0]]);
    expect(folhas.map((f) => f.units)).toEqual([10, 7]);
    expect(folhas[1].descricao).toContain('Havana');
  });

  it('"óculos" e "armação" são grupos distintos, com os nomes do cliente', () => {
    const folhas = folhasDeCaracteristicas(
      detalharPorCaracteristicas([
        linha({ id: 'a', tipo: 'OCULOS DE SOL' }, 5),
        linha({ id: 'b', tipo: 'ARMACAO' }, 5),
      ]),
    );
    expect(folhas.map((f) => f.caminho[1].rotulo).sort()).toEqual(['Armação', 'Óculos de sol']);
  });

  it('campo ausente vira "Não identificado" — a linha não some do pedido', () => {
    // Sumir seria pior: o comprador fecharia um pedido com menos peças do que
    // o plano mandou comprar, sem nada na tela dizendo por quê.
    const folhas = folhasDeCaracteristicas(
      detalharPorCaracteristicas([linha({ id: 'a', formato: null, cor: null }, 9)]),
    );
    expect(folhas).toHaveLength(1);
    expect(folhas[0].units).toBe(9);
    expect(folhas[0].descricao).toContain('Não identificado');
  });

  it('gênero presumido vem MARCADO, eixo a eixo', () => {
    const folhas = folhasDeCaracteristicas(
      detalharPorCaracteristicas([linha({ id: 'a', genero: null, description: 'RB3025 OCULOS' }, 4)]),
    );
    expect(folhas[0].presumidos).toEqual(['genero']);
    expect(folhas[0].descricao).toContain('Unissex');
  });

  it('um balde com UMA peça declarada deixa de ser presumido', () => {
    // O selo precisa significar "ninguém sabe"; com uma peça declarada no meio,
    // o balde é afirmável — e sem esta regra o selo apareceria em quase tudo.
    const arvore = detalharPorCaracteristicas([
      linha({ id: 'a', genero: null, description: 'RB3025 OCULOS' }, 4),
      linha({ id: 'b', genero: 'Unissex' }, 4),
    ]);
    const folhas = folhasDeCaracteristicas(arvore);
    expect(folhas).toHaveLength(1);
    expect(folhas[0].presumidos).toEqual([]);
  });

  it('a soma das folhas é a soma das linhas — o pedido não ganha nem perde peça', () => {
    const linhas = [
      linha({ id: 'a' }, 11),
      linha({ id: 'b', brand: 'Vogue', genero: 'Masculino' }, 7),
      linha({ id: 'c', cor: 'Havana', tipo: 'ARMACAO' }, 5),
      linha({ id: 'd' }, 0), // linha zerada não entra em folha nenhuma
    ];
    const folhas = folhasDeCaracteristicas(detalharPorCaracteristicas(linhas));
    expect(folhas.reduce((a, f) => a + f.units, 0)).toBe(23);
  });
});

describe('o detalhamento acompanha o plano — e só no segmento certo', () => {
  const perfil: PerfilQueVende = {
    porTipoGenero: new Map(),
    porFormato: new Map(),
    porCor: new Map(),
  };
  const explicar = (c: CandidatoDeCompra, s: SegmentoDoPlano, u: number) => explicarLinha(c, s, u);

  it('lançamento traz a árvore; best-seller NÃO — ali o SKU é a resposta', () => {
    const plano = montarPlanoDetalhado(
      [cand({ id: 'novo', unitsSold: 0 }), cand({ id: 'gira', sku: 'G', unitsSold: 30 })],
      { 'best-seller': 20, lancamento: 40 },
      perfil,
      explicar,
    );
    const bs = plano.segmentos.find((s) => s.segmento === 'best-seller')!;
    const lanc = plano.segmentos.find((s) => s.segmento === 'lancamento')!;

    expect(bs.detalhamento).toEqual([]);
    expect(bs.linhas.length).toBeGreaterThan(0);

    expect(lanc.detalhamento.length).toBeGreaterThan(0);
    // A INVARIANTE: a árvore e as linhas somam o mesmo. São duas leituras de um
    // pedido, e calculá-las em lugares diferentes é como o total do cabeçalho
    // passa a discordar da tabela.
    const naArvore = folhasDeCaracteristicas(lanc.detalhamento).reduce((a, f) => a + f.units, 0);
    expect(naArvore).toBe(lanc.alocado);
  });
});
