/* ---------------------------------------------------------------------------
   A coleção.

   Não existem seções. Existe um único estado do mundo que se transforma
   continuamente. Cada obra é apenas um instante em que esse estado se aquieta
   o bastante para ser contemplado — e receber um nome.

   A última obra devolve exatamente o estado da primeira: o ciclo fecha.
   --------------------------------------------------------------------------- */

/** Autoria — troque por: nome do artista, cidade, ano de início do corpo de obra. */
export const AUTORIA = {
  nome: 'Nome do Artista',
  legenda: 'pinturas · 2019 — 2024',
};

export const EPIGRAFE = [
  'O sertão já foi mar.',
  'O mar já foi sertão.',
  'E inevitavelmente voltarão a ser um só.',
];

/** sRGB (0-255 hex) → linear, porque toda a renderização acontece em linear. */
function cor(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  const s = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255);
  return s.map((c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
}

/* --- estado 1 e estado 6 são o mesmo mundo. --------------------------------- */

const AURORA_SALINA = {
  agua: -4.0,
  amplitude: 12.0,
  frequencia: 1.0,
  fendas: 1.0,
  marulho: 0.12,
  coral: 0.22,
  fossil: 0.34,
  fauna: 0.55,
  neblina: 0.0040,
  bio: 0.0,
  causticas: 0.1,
  plancton: 0.12,
  contrafluxo: 0.0,
  exposicao: 1.06,
  elevacaoSol: 0.085,
  azimuteSol: 0.15,
  ceuAlto: cor('#1d3644'),
  ceuHorizonte: cor('#d8a976'),
  sol: cor('#ffdcb8'),
  neblinaCor: cor('#b3a291'),
  areia: cor('#a89179'),
  rocha: cor('#68635b'),
  coralCor: cor('#9a5b48'),
  aguaCor: cor('#26454b'),
};

export const OBRAS = [
  {
    ordem: 'i',
    titulo: 'O sertão já foi mar',
    ano: '2019',
    tecnica: 'Óleo, areia e sal sobre linho',
    dimensoes: '210 × 140 cm',
    reflexao:
      'Antes do primeiro nome, esta planície respirava sal. A memória da água não evapora — apenas aprende a esperar.',
    lado: 'esquerda',
    estado: AURORA_SALINA,
    camera: {
      pos: [0, 9.0, 26],
      alvo: [0, 5.6, -74],
      fov: 54,
      foco: 96,
      abertura: 0.22,
    },
  },
  {
    ordem: 'ii',
    titulo: 'Anatomia de uma espera',
    ano: '2020',
    tecnica: 'Óleo, pigmento mineral e gesso sobre madeira',
    dimensoes: '180 × 240 cm',
    reflexao:
      'O que chamamos de fóssil é apenas um animal que aprendeu a ter paciência. Ele continua respirando — em outra escala de tempo.',
    lado: 'direita',
    estado: {
      agua: -6.5,
      amplitude: 9.0,
      frequencia: 1.35,
      fendas: 1.0,
      marulho: 0.06,
      coral: 0.55,
      fossil: 1.0,
      fauna: 0.28,
      neblina: 0.0065,
      bio: 0.05,
      causticas: 0.05,
      plancton: 0.24,
      contrafluxo: 0.0,
      exposicao: 1.0,
      elevacaoSol: 0.22,
      azimuteSol: -0.55,
      ceuAlto: cor('#3d545c'),
      ceuHorizonte: cor('#c9b393'),
      sol: cor('#f6e2c0'),
      neblinaCor: cor('#a89578'),
      areia: cor('#a38b6b'),
      rocha: cor('#7a6d60'),
      coralCor: cor('#a8613f'),
      aguaCor: cor('#2b4a4c'),
    },
    camera: {
      pos: [4.5, 3.7, -46],
      alvo: [-2.0, 3.0, -122],
      fov: 46,
      foco: 38,
      abertura: 0.8,
    },
  },
  {
    ordem: 'iii',
    titulo: 'Os que aprenderam a andar',
    ano: '2021',
    tecnica: 'Têmpera a ovo e óleo sobre linho',
    dimensoes: '160 × 160 cm',
    reflexao:
      'Nenhuma criatura decide sair do mar. O mar é que se retira — e é preciso continuar. As patas vieram depois, quase como desculpa.',
    lado: 'esquerda',
    estado: {
      agua: -9.5,
      amplitude: 16.5,
      frequencia: 0.72,
      fendas: 0.55,
      marulho: 0.55,
      coral: 0.78,
      fossil: 0.62,
      fauna: 1.0,
      neblina: 0.0038,
      bio: 0.08,
      causticas: 0.02,
      plancton: 0.55,
      contrafluxo: 0.12,
      exposicao: 1.12,
      elevacaoSol: 0.38,
      azimuteSol: -1.4,
      ceuAlto: cor('#7b8d8a'),
      ceuHorizonte: cor('#e2cba4'),
      sol: cor('#fff3d8'),
      neblinaCor: cor('#b5ae9a'),
      areia: cor('#bda98a'),
      rocha: cor('#8a7f70'),
      coralCor: cor('#b9704a'),
      aguaCor: cor('#33565a'),
    },
    camera: {
      pos: [-6.0, 4.4, -118],
      alvo: [3.0, 6.0, -196],
      fov: 52,
      foco: 34,
      abertura: 0.95,
    },
  },
  {
    ordem: 'iv',
    titulo: 'Maré ao contrário',
    ano: '2022',
    tecnica: 'Óleo sobre linho, folha de ouro e verniz salino',
    dimensoes: '300 × 190 cm',
    reflexao:
      'Se a água pode cair, também pode voltar. A gravidade é um hábito — e hábitos, aqui, envelhecem.',
    lado: 'direita',
    estado: {
      agua: 1.4,
      amplitude: 13.0,
      frequencia: 0.9,
      fendas: 0.2,
      marulho: 0.9,
      coral: 0.92,
      fossil: 0.5,
      fauna: 0.7,
      neblina: 0.0080,
      bio: 0.22,
      causticas: 0.55,
      plancton: 0.82,
      contrafluxo: 1.0,
      exposicao: 0.94,
      elevacaoSol: 0.16,
      azimuteSol: -2.35,
      ceuAlto: cor('#3d4f5c'),
      ceuHorizonte: cor('#a37f6d'),
      sol: cor('#ffd8a8'),
      neblinaCor: cor('#8f8a80'),
      areia: cor('#9c8465'),
      rocha: cor('#6b675f'),
      coralCor: cor('#a86a55'),
      aguaCor: cor('#2f5257'),
    },
    camera: {
      pos: [2.5, 3.4, -192],
      alvo: [-4.0, 7.5, -268],
      fov: 58,
      foco: 28,
      abertura: 1.2,
    },
  },
  {
    ordem: 'v',
    titulo: 'Bioluminescência do sertão',
    ano: '2023',
    tecnica: 'Óleo, cinza vulcânica e pigmento fosforescente',
    dimensoes: '220 × 220 cm',
    reflexao:
      'A escuridão não é ausência. É o lugar onde a vida guarda a própria luz até que alguém precise dela.',
    lado: 'esquerda',
    estado: {
      agua: 13.5,
      amplitude: 10.0,
      frequencia: 1.15,
      fendas: 0.0,
      marulho: 1.0,
      coral: 1.0,
      fossil: 0.75,
      fauna: 0.85,
      neblina: 0.016,
      bio: 1.0,
      causticas: 1.0,
      plancton: 1.0,
      contrafluxo: 0.45,
      exposicao: 0.86,
      elevacaoSol: -0.06,
      azimuteSol: -3.1,
      ceuAlto: cor('#07131a'),
      ceuHorizonte: cor('#123039'),
      sol: cor('#5f9aa4'),
      neblinaCor: cor('#0d2b33'),
      areia: cor('#3f5052'),
      rocha: cor('#2b3a3e'),
      coralCor: cor('#2f7c78'),
      aguaCor: cor('#08272e'),
    },
    camera: {
      pos: [-3.0, 3.6, -262],
      alvo: [2.0, 2.6, -340],
      fov: 50,
      foco: 32,
      abertura: 1.1,
    },
  },
  {
    ordem: 'vi',
    titulo: 'E voltarão a ser um só',
    ano: '2024',
    tecnica: 'Óleo e sal sobre linho — díptico',
    dimensoes: '240 × 400 cm',
    reflexao:
      'Nada termina. O sertão vira mar, o mar vira sertão, e nós somos apenas o intervalo entre as duas coisas.',
    lado: 'direita',
    estado: AURORA_SALINA,
    camera: {
      pos: [0, 9.0, -334],
      alvo: [0, 5.6, -434],
      fov: 54,
      foco: 96,
      abertura: 0.22,
    },
  },
];

/* --- interpolação ----------------------------------------------------------- */

/** Suavização de quinta ordem: nem o início nem o fim do movimento têm arestas. */
function suave(x) {
  const t = Math.min(1, Math.max(0, x));
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/**
 * A curva de demora. Dentro de cada intervalo entre duas obras o mundo fica
 * quase parado no começo e no fim (contemplação) e se transforma no meio
 * (metamorfose). É isto que faz o visitante não perceber quando trocou de obra.
 */
function demora(f) {
  return suave((f - 0.14) / 0.72);
}

const CHAVES_NUM = [
  'agua',
  'amplitude',
  'frequencia',
  'fendas',
  'marulho',
  'coral',
  'fossil',
  'fauna',
  'neblina',
  'bio',
  'causticas',
  'plancton',
  'contrafluxo',
  'exposicao',
  'elevacaoSol',
  'azimuteSol',
];

const CHAVES_COR = [
  'ceuAlto',
  'ceuHorizonte',
  'sol',
  'neblinaCor',
  'areia',
  'rocha',
  'coralCor',
  'aguaCor',
];

/** Estado vazio reutilizado a cada quadro — nada é alocado no laço de render. */
export function estadoVazio() {
  const e = { indice: 0, fracao: 0, camera: { pos: [0, 0, 0], alvo: [0, 0, 0], fov: 45, foco: 40, abertura: 1 } };
  for (const k of CHAVES_NUM) e[k] = 0;
  for (const k of CHAVES_COR) e[k] = [0, 0, 0];
  return e;
}

/**
 * @param {number} p progresso global do scroll, 0..1
 * @param {object} destino objeto criado por estadoVazio()
 */
export function amostrar(p, destino) {
  const n = OBRAS.length - 1;
  const s = Math.min(n - 1e-6, Math.max(0, p * n));
  const i = Math.floor(s);
  const f = demora(s - i);
  const a = OBRAS[i];
  const b = OBRAS[i + 1];

  destino.indice = i;
  destino.fracao = f;

  for (const k of CHAVES_NUM) destino[k] = a.estado[k] + (b.estado[k] - a.estado[k]) * f;
  for (const k of CHAVES_COR) {
    const ca = a.estado[k];
    const cb = b.estado[k];
    const d = destino[k];
    d[0] = ca[0] + (cb[0] - ca[0]) * f;
    d[1] = ca[1] + (cb[1] - ca[1]) * f;
    d[2] = ca[2] + (cb[2] - ca[2]) * f;
  }

  const ca = a.camera;
  const cb = b.camera;
  const c = destino.camera;
  for (let j = 0; j < 3; j++) {
    c.pos[j] = ca.pos[j] + (cb.pos[j] - ca.pos[j]) * f;
    c.alvo[j] = ca.alvo[j] + (cb.alvo[j] - ca.alvo[j]) * f;
  }
  c.fov = ca.fov + (cb.fov - ca.fov) * f;
  c.foco = ca.foco + (cb.foco - ca.foco) * f;
  c.abertura = ca.abertura + (cb.abertura - ca.abertura) * f;

  return destino;
}

/** Quanto cada obra está "presente" em p — usado só pela tipografia. */
export function presenca(p, indiceObra) {
  const n = OBRAS.length - 1;
  const s = p * n;
  const d = Math.abs(s - indiceObra);
  return Math.max(0, 1 - Math.pow(d / 0.46, 1.7));
}
