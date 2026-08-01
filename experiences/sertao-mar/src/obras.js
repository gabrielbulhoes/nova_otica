/* ---------------------------------------------------------------------------
   A coleção — Vic Bulhões.

   Não existem seções. Existe um único estado do mundo que se transforma
   continuamente. Cada obra é apenas um instante em que esse estado se aquieta
   o bastante para ser contemplado — e receber um nome.

   Os poemas são do artista, transcritos das próprias pranchas. A citação de
   Darwin é a que ele copiou à mão no caderno de anatomia deste universo.

   O primeiro e o último movimento devolvem o mesmo mundo: o ciclo fecha.
   --------------------------------------------------------------------------- */

export const AUTORIA = {
  nome: 'Vic Bulhões',
  legenda: 'pintura · poesia · história natural de um mundo que não houve',
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

/* --- o mundo seco: abre e fecha a travessia ---------------------------------- */

const AURORA_SALINA = {
  agua: -4.0,
  amplitude: 12.0,
  frequencia: 1.0,
  fendas: 1.0,
  marulho: 0.12,
  coral: 0.18,
  fossil: 0.34,
  fauna: 0.55,
  neblina: 0.004,
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

/**
 * `ano`, `tecnica` e `dimensoes` ficam em branco de propósito: são dados do
 * acervo, não do site. Preencha e a ficha passa a exibi-los — o que estiver
 * vazio simplesmente não aparece.
 *
 * Movimentos sem `titulo` não recebem ficha: são a abertura e o fecho do
 * mundo, não pinturas.
 */
export const OBRAS = [
  {
    ordem: 'i',
    titulo: '',
    ano: '',
    tecnica: '',
    dimensoes: '',
    reflexao: '',
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
    titulo: 'À deriva',
    ano: '',
    tecnica: '',
    dimensoes: '',
    reflexao:
      'Me ponho à deriva tentando encontrar propósito que viva até dentro do mar. A dor que dança deixa escapar: há esperança, vá navegar.',
    lado: 'esquerda',
    estado: {
      agua: 1.2,
      amplitude: 11.0,
      frequencia: 1.15,
      fendas: 0.15,
      marulho: 0.85,
      coral: 0.25,
      fossil: 0.55,
      fauna: 0.45,
      neblina: 0.0095,
      bio: 0.04,
      causticas: 0.35,
      plancton: 0.45,
      contrafluxo: 0.0,
      exposicao: 1.02,
      elevacaoSol: 0.46,
      azimuteSol: -0.6,
      ceuAlto: cor('#8fa6b4'),
      ceuHorizonte: cor('#cbbcbe'),
      sol: cor('#fff2e2'),
      neblinaCor: cor('#a9b4bb'),
      areia: cor('#8f8577'),
      rocha: cor('#6a6560'),
      coralCor: cor('#9c5f4a'),
      aguaCor: cor('#2f6f96'),
    },
    camera: {
      pos: [3.5, 3.4, -62],
      alvo: [-3.0, 4.2, -142],
      fov: 48,
      foco: 58,
      abertura: 0.5,
    },
  },
  {
    ordem: 'iii',
    titulo: 'Dança dos tamboretes',
    ano: '',
    tecnica: '',
    dimensoes: '',
    reflexao:
      'O móvel em movimento agora vive seu momento, livre do sentar. Ao ouvir dos peixes o canto, o tamborete ou o banco se levanta e vai dançar.',
    lado: 'direita',
    estado: {
      agua: 15.0,
      amplitude: 9.5,
      frequencia: 1.3,
      fendas: 0.0,
      marulho: 1.0,
      coral: 0.7,
      fossil: 0.85,
      fauna: 0.8,
      neblina: 0.0135,
      bio: 0.25,
      causticas: 1.0,
      plancton: 1.0,
      contrafluxo: 0.15,
      exposicao: 0.98,
      elevacaoSol: 0.72,
      azimuteSol: -1.35,
      ceuAlto: cor('#0e3b3c'),
      ceuHorizonte: cor('#2b6f68'),
      sol: cor('#a8dbcc'),
      neblinaCor: cor('#17595a'),
      areia: cor('#b8ae8c'),
      rocha: cor('#4e5f5c'),
      coralCor: cor('#2f7c78'),
      aguaCor: cor('#1d6b66'),
    },
    camera: {
      pos: [-4.5, 4.8, -152],
      alvo: [4.0, 6.2, -232],
      fov: 52,
      foco: 30,
      abertura: 1.0,
    },
  },
  {
    ordem: 'iv',
    titulo: 'Arraia farpada de pano',
    ano: '',
    tecnica: '',
    dimensoes: '',
    reflexao:
      'O lençol abandonado no varal, bem lavado, aprendeu a se soltar. Tirou força do abandono, virou arraia farpada de pano: ganhou vida, ganhou mar.',
    lado: 'esquerda',
    estado: {
      agua: 13.0,
      amplitude: 12.5,
      frequencia: 0.85,
      fendas: 0.0,
      marulho: 0.95,
      coral: 0.9,
      fossil: 0.6,
      fauna: 1.0,
      neblina: 0.0105,
      bio: 0.35,
      causticas: 0.8,
      plancton: 0.95,
      contrafluxo: 1.0,
      exposicao: 1.04,
      elevacaoSol: 0.9,
      azimuteSol: -2.2,
      ceuAlto: cor('#17565c'),
      ceuHorizonte: cor('#589a8c'),
      sol: cor('#d8f2e6'),
      neblinaCor: cor('#2f8078'),
      areia: cor('#c3b894'),
      rocha: cor('#5b6c66'),
      coralCor: cor('#3f8f86'),
      aguaCor: cor('#276f6c'),
    },
    camera: {
      pos: [3.0, 6.2, -242],
      alvo: [-3.5, 9.8, -320],
      fov: 56,
      foco: 26,
      abertura: 1.2,
    },
  },
  {
    ordem: 'v',
    titulo: 'Sem título',
    ano: '',
    tecnica: '',
    dimensoes: '',
    reflexao:
      '“A existência de uma variabilidade muito maior, bem como a maior frequência de monstruosidades nos organismos sob cultivo, me levam a crer que os desvios estruturais se devem à natureza das condições de vida a que os antepassados mais remotos estiveram expostos.” — Darwin, copiado à mão',
    lado: 'direita',
    estado: {
      agua: -2.2,
      amplitude: 10.5,
      frequencia: 1.05,
      fendas: 0.45,
      marulho: 0.5,
      coral: 1.0,
      fossil: 0.8,
      fauna: 0.7,
      neblina: 0.009,
      bio: 1.0,
      causticas: 0.25,
      plancton: 0.7,
      contrafluxo: 0.2,
      exposicao: 1.4,
      elevacaoSol: 0.52,
      azimuteSol: -3.0,
      ceuAlto: cor('#121d29'),
      ceuHorizonte: cor('#243634'),
      sol: cor('#c6d6e4'),
      neblinaCor: cor('#182626'),
      areia: cor('#63614f'),
      rocha: cor('#474a3e'),
      coralCor: cor('#96596c'),
      aguaCor: cor('#06201f'),
    },
    camera: {
      pos: [-2.5, 3.8, -330],
      alvo: [2.5, 3.2, -408],
      fov: 46,
      foco: 22,
      abertura: 1.1,
    },
  },
  {
    ordem: 'vi',
    titulo: '',
    ano: '',
    tecnica: '',
    dimensoes: '',
    reflexao: '',
    lado: 'direita',
    estado: AURORA_SALINA,
    camera: {
      pos: [0, 9.0, -420],
      alvo: [0, 5.6, -520],
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
  const e = {
    indice: 0,
    fracao: 0,
    camera: { pos: [0, 0, 0], alvo: [0, 0, 0], fov: 45, foco: 40, abertura: 1 },
  };
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
