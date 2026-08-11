import { describe, expect, it } from 'vitest';
import {
  lojasSemPraca,
  maloteEmTexto,
  pracaDaLoja,
  previsaoDeMalote,
} from '../src/modules/planning/malotes.js';

/**
 * O CALENDÁRIO DE MALOTES — feedback 6.0 · item 12.
 *
 * O card de remanejamento dizia o que mandar e para onde, e ficava calado sobre
 * QUANDO. Isso muda a decisão: transferência sugerida numa quarta para
 * Fortaleza só embarca na segunda e chega na terça. Se a loja rompe em três
 * dias, a transferência não resolve — e quem decidiu não tinha como saber.
 *
 * O QUE ESTES TESTES PRENDEM é a DIREÇÃO DO ERRO. Todo arredondamento vai para
 * o lado pessimista, porque o prazo aqui sustenta a pergunta "dá tempo, ou
 * preciso comprar?". Um prazo otimista faz alguém deixar de comprar contando
 * com uma peça que não chegou; um pessimista, no pior caso, faz comprar a mais.
 */

// Datas fixas de 2026 (agosto): 10 = segunda, 11 = terça, 12 = quarta,
// 13 = quinta, 14 = sexta, 15 = sábado, 16 = domingo.
const em = (dia: number) => new Date(2026, 7, dia, 9, 0, 0);

describe('praça de cada loja', () => {
  it('reconhece as lojas cujo nome não deixa dúvida', () => {
    expect(pracaDaLoja('A GRACIOSA MIDWAY')).toBe('NATAL');
    expect(pracaDaLoja('OTICALLI PRAIA SHOPPING')).toBe('NATAL');
    expect(pracaDaLoja('GRAND OPTICAL PETROPOLIS')).toBe('NATAL');
    expect(pracaDaLoja('A GRACIOSA GUARABIRA')).toBe('GUARABIRA');
    expect(pracaDaLoja('A GRACIOSA MOSSORO PARTAGE')).toBe('MOSSORO');
    expect(pracaDaLoja('A GRACIOSA JUAZEIRO')).toBe('JUAZEIRO');
  });

  it('devolve null no que é ambíguo, em vez de chutar', () => {
    // "RIOMAR" existe em Fortaleza E em Natal; "IGUATEMI" é quase certamente
    // Fortaleza — e "quase certamente" não é base para dizer a um gerente que a
    // peça chega terça-feira.
    expect(pracaDaLoja('A GRACIOSA RIOMAR')).toBeNull();
    expect(pracaDaLoja('A GRACIOSA IGUATEMI')).toBeNull();
    expect(pracaDaLoja('A GRACIOSA VARANDA')).toBeNull();
    expect(pracaDaLoja(null)).toBeNull();
  });

  it('lista o que falta o cliente confirmar', () => {
    expect(
      lojasSemPraca(['A GRACIOSA MIDWAY', 'A GRACIOSA RIOMAR', 'A GRACIOSA IGUATEMI', 'A GRACIOSA RIOMAR']),
    ).toEqual(['A GRACIOSA IGUATEMI', 'A GRACIOSA RIOMAR']);
  });

  it('ignora acento e caixa', () => {
    expect(pracaDaLoja('a graciosa mossoró centro')).toBe('MOSSORO');
  });
});

describe('previsão do malote · rotas diretas', () => {
  it('a rota Natal → Fortaleza existe, mas nenhuma loja mapeia para lá', () => {
    // O calendário tem a perna; o que falta é saber QUE loja fica em Fortaleza.
    // "IGUATEMI" e "RIOMAR" são os candidatos, e os dois são ambíguos. Enquanto
    // o cliente não confirmar, a resposta certa é o silêncio — e este teste
    // existe para que ligar a praça de Fortaleza seja uma mudança consciente,
    // e não algo que alguém descubra por um prazo errado na tela.
    expect(previsaoDeMalote('A GRACIOSA MIDWAY', 'A GRACIOSA IGUATEMI', em(10))).toBeNull();
  });

  it('Natal → Guarabira numa segunda: embarca na terça e chega na terça', () => {
    const p = previsaoDeMalote('A GRACIOSA MIDWAY', 'A GRACIOSA GUARABIRA', em(10))!;
    expect(p).not.toBeNull();
    expect(p.embarque.getDay()).toBe(2); // terça
    expect(p.chegada.getDay()).toBe(2); // mesmo dia — Guarabira é perto
    expect(p.diasAteChegar).toBe(1);
    expect(p.viaNatal).toBe(false);
  });

  it('Natal → Mossoró numa terça: perde a segunda e espera a quinta', () => {
    // A saída é segunda e quinta. Pedido feito na terça não pega a de segunda.
    const p = previsaoDeMalote('A GRACIOSA MIDWAY', 'A GRACIOSA MOSSORO CENTRO', em(11))!;
    expect(p.embarque.getDay()).toBe(4); // quinta
    expect(p.chegada.getDay()).toBe(5); // sexta
    expect(p.diasAteChegar).toBe(3);
  });

  it('Juazeiro → Natal usa o PIOR caso do prazo informado', () => {
    // O cliente informou "chega quinta OU sexta". A tabela usa sexta.
    const p = previsaoDeMalote('A GRACIOSA JUAZEIRO', 'A GRACIOSA MIDWAY', em(10))!;
    expect(p.embarque.getDay()).toBe(2); // terça
    expect(p.chegada.getDay()).toBe(5); // sexta, não quinta
  });

  it('embarca no MESMO dia quando o pedido cai num dia de saída', () => {
    const p = previsaoDeMalote('A GRACIOSA MIDWAY', 'A GRACIOSA MOSSORO CENTRO', em(10))!;
    expect(p.embarque.getDate()).toBe(10); // a própria segunda
    expect(p.diasAteChegar).toBe(1);
  });
});

describe('previsão do malote · duas pontas, via Natal', () => {
  it('Mossoró → Guarabira sobe para Natal e desce na perna seguinte', () => {
    // Não existe linha direta. Segunda: embarca Mossoró→Natal (chega terça),
    // reembarca na quinta (a saída de terça já passou no dia da chegada), e
    // chega em Guarabira na quinta.
    const p = previsaoDeMalote('A GRACIOSA MOSSORO CENTRO', 'A GRACIOSA GUARABIRA', em(10))!;
    expect(p.viaNatal).toBe(true);
    expect(p.embarque.getDay()).toBe(1); // segunda
    expect(p.chegada.getDay()).toBe(4); // quinta
    expect(p.diasAteChegar).toBe(3);
  });

  it('a caixa NÃO reembarca no mesmo dia em que desce em Natal', () => {
    // Este é o caso que separa o prazo honesto do otimista: a perna
    // Mossoró→Natal chega numa terça, e há saída para Guarabira na terça. Se o
    // reembarque fosse imediato, o prazo encurtaria dois dias — sempre para o
    // lado que faz alguém deixar de comprar contando com peça que não chegou.
    const p = previsaoDeMalote('A GRACIOSA MOSSORO CENTRO', 'A GRACIOSA GUARABIRA', em(10))!;
    // chegada em Natal seria terça (dia 11); o embarque para Guarabira é quinta
    expect(p.chegada.getDate()).toBe(13);
  });
});

describe('previsão do malote · quando calar', () => {
  it('não fala de malote entre lojas da mesma praça', () => {
    expect(previsaoDeMalote('A GRACIOSA MIDWAY', 'OTICALLI PRAIA SHOPPING', em(10))).toBeNull();
  });

  it('não fala de malote quando uma das pontas é desconhecida', () => {
    // Silêncio é a resposta certa. O card deixa de mostrar prazo em vez de
    // mostrar um prazo errado — que é exatamente o tipo de número que ninguém
    // confere e todo mundo usa.
    expect(previsaoDeMalote('A GRACIOSA RIOMAR', 'A GRACIOSA GUARABIRA', em(10))).toBeNull();
    expect(previsaoDeMalote('A GRACIOSA GUARABIRA', 'A GRACIOSA RIOMAR', em(10))).toBeNull();
  });
});

describe('a frase que vai para o card', () => {
  it('diz os dois dias e quanto falta', () => {
    const p = previsaoDeMalote('A GRACIOSA MIDWAY', 'A GRACIOSA MOSSORO CENTRO', em(11))!;
    expect(maloteEmTexto(p)).toBe('Embarca quinta, chega sexta — 3 dia(s).');
  });

  it('avisa quando passa por Natal', () => {
    const p = previsaoDeMalote('A GRACIOSA MOSSORO CENTRO', 'A GRACIOSA GUARABIRA', em(10))!;
    expect(maloteEmTexto(p)).toContain('via Natal');
  });
});
