/**
 * O CALENDÁRIO DE MALOTES — feedback 6.0 · item 12.
 *
 * "Planejar transferências entre lojas de acordo com os calendários de
 * logística dos malotes."
 *
 * Até aqui o card de remanejamento dizia o que mandar e para onde, e ficava
 * calado sobre QUANDO. Na prática isso muda a decisão: uma transferência
 * sugerida numa quarta-feira para Fortaleza só embarca na segunda seguinte e
 * chega na terça — cinco dias. Se a loja de destino rompe em três, a
 * transferência não resolve, e quem decidiu não tinha como saber.
 *
 * O MALOTE É RADIAL. Todas as rotas do cliente passam por Natal; não há linha
 * direta entre Mossoró e Guarabira. Uma transferência entre duas pontas é
 * modelada como duas pernas, com a espera em Natal entre elas — que é como a
 * caixa de fato viaja.
 */

/** As praças atendidas pelo malote. */
export type Cidade = 'NATAL' | 'FORTALEZA' | 'JUAZEIRO' | 'MOSSORO' | 'GUARABIRA';

/** Uma perna do malote: de onde, para onde, em que dias sai, quanto demora. */
interface Perna {
  saidas: number[];
  /** Dias corridos entre embarque e chegada. 0 = chega no mesmo dia. */
  transito: number;
}

/**
 * O calendário, como o cliente o enviou. Domingo = 0.
 *
 * SOBRE JUAZEIRO → NATAL: o cliente informou "chega quinta-feira OU
 * sexta-feira". A tabela usa SEXTA — o pior caso. Um prazo otimista faz alguém
 * contar com a peça num dia em que ela pode não estar lá, e a decisão que o
 * card sustenta é justamente "dá tempo, ou preciso comprar?".
 */
const CALENDARIO: Partial<Record<Cidade, Partial<Record<Cidade, Perna>>>> = {
  NATAL: {
    FORTALEZA: { saidas: [1], transito: 1 }, // sai seg, chega ter
    JUAZEIRO: { saidas: [1], transito: 1 }, // sai seg, chega ter
    MOSSORO: { saidas: [1, 4], transito: 1 }, // sai seg e qui, chega ter e sex
    GUARABIRA: { saidas: [2, 4], transito: 0 }, // sai e chega ter e qui
  },
  FORTALEZA: { NATAL: { saidas: [2], transito: 1 } }, // sai ter, chega qua
  JUAZEIRO: { NATAL: { saidas: [2], transito: 3 } }, // sai ter, chega qui OU sex → sex
  MOSSORO: { NATAL: { saidas: [1, 4], transito: 1 } },
  GUARABIRA: { NATAL: { saidas: [2, 4], transito: 0 } },
};

/**
 * De que praça é cada loja, por palavra-chave no nome.
 *
 * DUAS PROCEDÊNCIAS, e a diferença importa para quem for mexer:
 *
 *  · as sete primeiras saem do próprio nome — shopping de nome único ou a
 *    cidade escrita na loja. São inferência, e inferência óbvia;
 *  · as quatro últimas foram CONFIRMADAS PELO CLIENTE em 11/08/2026, e não
 *    poderiam ter sido deduzidas. "RIOMAR" existe em Fortaleza, Natal, Recife,
 *    Aracaju e São Luís — o palpite inicial aqui foi Natal, e estava errado.
 *    "VARANDA" também é Fortaleza, contra o palpite de Natal. Foi exatamente
 *    para não acertar por sorte que estas quatro ficaram sem prazo até a
 *    confirmação chegar.
 *
 * Loja não mapeada NÃO ganha prazo: o card não fala de malote, em vez de
 * exibir uma data inventada. `lojasSemPraca()` lista o que falta — e o teste
 * `malotes.test.ts` prende a lista real das 16 lojas, para que uma filial nova
 * apareça como falha de teste em vez de sumir do calendário em silêncio.
 */
const PRACA_POR_PALAVRA: { palavra: string; cidade: Cidade }[] = [
  { palavra: 'GUARABIRA', cidade: 'GUARABIRA' },
  { palavra: 'JUAZEIRO', cidade: 'JUAZEIRO' },
  { palavra: 'MOSSORO', cidade: 'MOSSORO' },
  { palavra: 'MIDWAY', cidade: 'NATAL' },
  { palavra: 'NATAL SHOP', cidade: 'NATAL' },
  { palavra: 'PRAIA SHOPPING', cidade: 'NATAL' },
  { palavra: 'PETROPOLIS', cidade: 'NATAL' },
  // Confirmadas pelo cliente em 11/08/2026 — ver acima.
  { palavra: 'IGUATEMI', cidade: 'FORTALEZA' },
  { palavra: 'RIOMAR', cidade: 'FORTALEZA' },
  { palavra: 'RIO MAR', cidade: 'FORTALEZA' },
  { palavra: 'VARANDA', cidade: 'FORTALEZA' },
  { palavra: 'AFONSO PENA', cidade: 'NATAL' },
];

const semAcento = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();

/** A praça de uma loja, ou `null` quando o nome não permite afirmar. */
export function pracaDaLoja(storeName: string | null | undefined): Cidade | null {
  if (!storeName) return null;
  const n = semAcento(storeName);
  for (const { palavra, cidade } of PRACA_POR_PALAVRA) {
    if (n.includes(palavra)) return cidade;
  }
  return null;
}

/** As lojas que o mapa não cobre — o que falta confirmar com o cliente. */
export function lojasSemPraca(nomes: string[]): string[] {
  return [...new Set(nomes.filter((n) => pracaDaLoja(n) === null))].sort();
}

/** Quando a caixa embarca e quando chega. */
export interface PrevisaoDeMalote {
  /** Data do embarque na origem. */
  embarque: Date;
  /** Data prevista de chegada no destino. */
  chegada: Date;
  /** Dias corridos entre HOJE e a chegada — é o número que muda a decisão. */
  diasAteChegar: number;
  /** Passa por Natal? `true` quando origem e destino são duas pontas. */
  viaNatal: boolean;
}

const DIA_MS = 86_400_000;
const somarDias = (d: Date, n: number) => new Date(d.getTime() + n * DIA_MS);
const aoMeioDia = (d: Date) => {
  // Meio-dia e não meia-noite: a conta é de DIAS, e horário de verão ou fuso
  // deslocando a meia-noite mudaria o dia da semana de uma data de embarque.
  const x = new Date(d);
  x.setHours(12, 0, 0, 0);
  return x;
};

/** Próxima data (>= `a partir de`) em que sai um malote nesta perna. */
function proximaSaida(perna: Perna, apartirDe: Date): Date {
  const base = aoMeioDia(apartirDe);
  for (let i = 0; i < 14; i++) {
    const d = somarDias(base, i);
    if (perna.saidas.includes(d.getDay())) return d;
  }
  // Inalcançável com `saidas` não vazio — mas devolver a base seria fingir que
  // existe embarque onde não existe.
  throw new Error('perna de malote sem dia de saída válido');
}

/**
 * Quando uma transferência entre duas lojas embarca e chega.
 *
 * `null` quando qualquer das duas pontas não tem praça conhecida, ou quando não
 * existe rota entre elas. Silêncio é a resposta certa: o card deixa de falar de
 * prazo em vez de exibir um prazo errado.
 */
export function previsaoDeMalote(
  origem: string | null | undefined,
  destino: string | null | undefined,
  hoje: Date,
): PrevisaoDeMalote | null {
  const de = pracaDaLoja(origem);
  const para = pracaDaLoja(destino);
  if (!de || !para) return null;

  // Mesma praça: o malote não entra na história — a peça atravessa a cidade.
  if (de === para) return null;

  const direta = CALENDARIO[de]?.[para];
  if (direta) {
    const embarque = proximaSaida(direta, hoje);
    const chegada = somarDias(embarque, direta.transito);
    return { embarque, chegada, diasAteChegar: diferencaEmDias(hoje, chegada), viaNatal: false };
  }

  // Duas pontas: a caixa sobe para Natal e desce na perna seguinte. A segunda
  // perna só pode embarcar DEPOIS de a primeira chegar.
  const ida = CALENDARIO[de]?.NATAL;
  const volta = CALENDARIO.NATAL?.[para];
  if (!ida || !volta) return null;

  const embarque = proximaSaida(ida, hoje);
  const emNatal = somarDias(embarque, ida.transito);
  // O reembarque é no dia SEGUINTE à chegada, nunca no mesmo dia. A caixa desce
  // do malote e precisa ser reprocessada; contar com o embarque imediato
  // encurtaria o prazo em dois dias inteiros quando a chegada calha num dia de
  // saída — e o erro sairia sempre para o lado otimista, que é o que faz
  // alguém deixar de comprar contando com uma peça que não chegou.
  const reembarque = proximaSaida(volta, somarDias(emNatal, 1));
  const chegada = somarDias(reembarque, volta.transito);
  return { embarque, chegada, diasAteChegar: diferencaEmDias(hoje, chegada), viaNatal: true };
}

function diferencaEmDias(de: Date, ate: Date): number {
  return Math.round((aoMeioDia(ate).getTime() - aoMeioDia(de).getTime()) / DIA_MS);
}

const DIA_DA_SEMANA = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

/** A frase que vai para o card: "embarca segunda, chega terça (4 dias)". */
export function maloteEmTexto(p: PrevisaoDeMalote): string {
  const via = p.viaNatal ? ', via Natal' : '';
  return `Embarca ${DIA_DA_SEMANA[p.embarque.getDay()]}, chega ${DIA_DA_SEMANA[p.chegada.getDay()]}${via} — ${p.diasAteChegar} dia(s).`;
}
