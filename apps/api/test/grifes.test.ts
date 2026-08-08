import { describe, expect, it } from 'vitest';
import {
  analyzeProduct,
  buildPurchaseOrders,
  extractBrand,
  DEFAULT_PLANNING_CONFIG,
} from '../src/modules/planning/planning.math.js';

/**
 * Feedback do Galbe · item 04 — "a lista de grifes está pegando lixo da
 * descrição".
 *
 * O bloco que já existia em `planning.test.ts:519` continua verde palavra por
 * palavra depois desta mudança, e é exatamente por isso que ele precisa
 * crescer: ele provava que a extração funciona no formato
 * `<TIPO> <GRIFE> <cor>` ("Armação Oakley Preto"), que é como um seed escreve.
 * O CDS escreve ao contrário — `<modelo> <cor> <calibre> <TIPO> <GRIFE>` — e
 * nenhuma das treze asserções tocava nesse formato. Um teste que não pode
 * falhar não é rede de segurança.
 *
 * As descrições abaixo são literais do catálogo da rede.
 */
describe('grifes · o código de cor do fabricante não é uma marca', () => {
  it('extrai a grife DEPOIS da palavra de tipo, não o código de cor', () => {
    // O segundo token de cada uma destas é o código de cor do fabricante —
    // ABAG, ABLK, AGGY, AGLD, ABBIEGS. Sem dígito, sem acento, sem ser cor em
    // português: passava por todas as guardas e era promovido a grife.
    expect(extractBrand('AN4290 ABAG 55 OCULOS ARNETTE', 'OCULOS')).toBe('ARNETTE');
    expect(extractBrand('VO5573 ABLK 52 ARMACAO VOGUE', 'ARMACAO')).toBe('VOGUE');
    expect(extractBrand('OO9208 AGGY 38 OCULOS OAKLEY', 'OCULOS')).toBe('OAKLEY');
    expect(extractBrand('MK1088 AGLD 54 ARMACAO MICHAEL KORS', 'ARMACAO')).toBe('MICHAEL KORS');
    expect(extractBrand('AMQ0412 ABBIEGS 56 OCULOS ALEXANDER MCQUEEN', 'OCULOS')).toBe(
      'ALEXANDER MCQUEEN',
    );
  });

  it('o calibre com hífen também não engana mais', () => {
    // `59-18` e `57-9O` são calibre-ponte. Têm dígito, então a varredura antiga
    // os pulava — e ficava com o token anterior, que é o código de cor.
    expect(extractBrand('DB1181 ANS 59-18 ARMACAO DAVID BECKHAM', 'ARMACAO')).toBe('DAVID BECKHAM');
    expect(extractBrand('HER0111S KDX 57-9O OCULOS CAROLINA HERRERA', 'OCULOS')).toBe(
      'CAROLINA HERRERA',
    );
  });

  it('quatro pseudo-marcas da mesma grife viram uma', () => {
    // FLOO, GUI, OLIVER e TICO são MODELOS da DUSSELDORF, escritos na frente da
    // descrição. Cada um virava uma "grife" própria — e cada cor multiplicava
    // outra vez: FLOO, FLOO HAVANA, FLOO MARFIM, FLOO MEL.
    const dusseldorf = [
      'FLOO TARTARUGA FOSCO ARMACAO DUSSELDORF',
      'GUI HAVANA PRETO ARMACAO DUSSELDORF',
      'OLIVER NUDE ARMACAO DUSSELDORF',
      'TICO MARROM ARMACAO DUSSELDORF',
    ];
    expect(new Set(dusseldorf.map((d) => extractBrand(d, 'ARMACAO')))).toEqual(
      new Set(['DUSSELDORF']),
    );
  });

  it('grife ANTES da palavra de tipo continua sendo encontrada', () => {
    // O fallback importa: nem toda descrição põe a grife no fim. Quando a
    // varredura a partir do tipo não acha nada, vale a varredura inteira —
    // que é o comportamento de sempre.
    expect(extractBrand('ARNETTE OCULOS PRETO', 'OCULOS')).toBe('ARNETTE');
    expect(extractBrand('Armação Oakley Preto', 'ARMACAO')).toBe('Oakley');
    expect(extractBrand('RAY BAN OCULOS', 'OCULOS')).toBe('RAY BAN');
  });

  it('descrição que é SÓ tipo continua devolvendo null', () => {
    // Aqui a palavra de tipo é o último token: não há nada depois dela para
    // varrer, e não pode haver invenção de rótulo.
    expect(extractBrand('RB3548NL 001 54 OCULOS', 'OCULOS')).toBeNull();
    expect(extractBrand('Óculos de Sol', 'OCULOS')).toBeNull();
  });

  it('a mudança não reabre o caso da lente', () => {
    // A guarda de categoria continua vindo primeiro: em lente a descrição é a
    // LINHA do produto, e extrair dali fragmentava a ZEISS em dezesseis.
    expect(extractBrand('MULTIGRESSIV MONOFOCAIS B.I.G. NORM 1,50', 'LENTES')).toBeNull();
    expect(extractBrand('ZEISS ANTIRREFLEXO X-TRA CLEAN', 'TRATAMENTO')).toBeNull();
  });
});

describe('grifes · a etiqueta do pedido de compra', () => {
  const plano = (description: string, category: string, brand: string | null) =>
    analyzeProduct(
      {
        productId: `p-${description}`,
        description,
        brand,
        category,
        unitsSold: 90,
        currentStock: 5,
        unitCost: 100,
        unitPrice: 200,
      },
      90,
      { ...DEFAULT_PLANNING_CONFIG, leadTimeDays: 30 },
    );

  it('o pedido de lente não ganha a linha do produto como se fosse grife', () => {
    // `buildPurchaseOrders` chamava `extractBrand` SEM categoria — a única
    // chamada do motor que ainda fazia isso. O resultado era um pedido à ZEISS
    // etiquetado com "MULTIGRESSIV MONOFOCAIS", que não é grife nenhuma.
    const po = buildPurchaseOrders(
      [
        plano('MULTIGRESSIV MONOFOCAIS B.I.G. NORM 1,50', 'LENTES', 'ZEISS'),
        plano('IMPRESSION B.I.G. NORM 1,67 LAYR', 'LENTES VISAO SIMPLES', 'ZEISS'),
      ],
      90,
    );
    const zeiss = po.orders.find((o) => o.supplier === 'ZEISS');
    expect(zeiss).toBeDefined();
    expect(zeiss!.items).toHaveLength(2);
    expect(zeiss!.brands).toEqual([]);
    // A informação não se perde: o item continua no pedido, e o cabeçalho do
    // pedido já diz ZEISS. O que sumiu foi a etiqueta inventada.
    expect(zeiss!.items.every((i) => i.brand === null)).toBe(true);
  });

  it('em armação a etiqueta continua existindo, e agora certa', () => {
    const po = buildPurchaseOrders(
      [
        plano('AN4290 ABAG 55 OCULOS ARNETTE', 'OCULOS', 'LUXOTTICA'),
        plano('VO5573 ABLK 52 ARMACAO VOGUE', 'ARMACAO', 'LUXOTTICA'),
      ],
      90,
    );
    const lux = po.orders.find((o) => o.supplier === 'LUXOTTICA')!;
    expect(new Set(lux.brands)).toEqual(new Set(['ARNETTE', 'VOGUE']));
  });
});
