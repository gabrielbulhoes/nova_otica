/* ---------------------------------------------------------------------------
   Anatomias.

   Nada aqui é importado de um modelo: cada criatura é uma equação. Isso importa
   porque as duas formas — a seca e a marinha — precisam ter exatamente a mesma
   topologia para que uma possa virar a outra sem costura.
   --------------------------------------------------------------------------- */

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Superfície de revolução deformada. raio(v, ang) devolve o raio; alturaFn(v)
 * devolve a altura. As normais saem de diferenças finitas no espaço do
 * parâmetro — mais fiéis que as calculadas a partir dos triângulos.
 */
function revolucao(raio, alturaFn, aneis, lados) {
  const pos = [];
  const nor = [];
  const idx = [];

  const ponto = (v, a) => {
    const r = raio(v, a);
    return [Math.cos(a) * r, alturaFn(v), Math.sin(a) * r];
  };

  const dv = 1 / (aneis * 4);
  const da = (Math.PI * 2) / (lados * 4);

  for (let i = 0; i <= aneis; i++) {
    const v = i / aneis;
    for (let j = 0; j <= lados; j++) {
      const a = (j / lados) * Math.PI * 2;
      const p = ponto(v, a);

      /* Diferenças centrais: nos polos, a diferença adiantada é zero e a
         normal sai nula. Uma normal nula vira NaN no shader, e um NaN em
         varying contamina o triângulo inteiro. */
      const pv = ponto(Math.min(1, v + dv), a);
      const pw = ponto(Math.max(0, v - dv), a);
      const pa = ponto(v, a + da);
      const pb = ponto(v, a - da);

      const tv = [pv[0] - pw[0], pv[1] - pw[1], pv[2] - pw[2]];
      const ta = [pa[0] - pb[0], pa[1] - pb[1], pa[2] - pb[2]];
      // normal = ta × tv, apontando para fora
      let n = [
        ta[1] * tv[2] - ta[2] * tv[1],
        ta[2] * tv[0] - ta[0] * tv[2],
        ta[0] * tv[1] - ta[1] * tv[0],
      ];
      let m = Math.hypot(n[0], n[1], n[2]);
      if (!(m > 1e-7)) {
        // degenerou mesmo assim: aponta radialmente, inclinada para a ponta
        n = [Math.cos(a) * 0.5, v > 0.5 ? 1 : -1, Math.sin(a) * 0.5];
        m = Math.hypot(n[0], n[1], n[2]);
      }
      n = [n[0] / m, n[1] / m, n[2] / m];
      if (n[0] * p[0] + n[2] * p[2] < 0) n = [-n[0], -n[1], -n[2]];

      pos.push(p[0], p[1], p[2]);
      nor.push(n[0], n[1], n[2]);
    }
  }

  for (let i = 0; i < aneis; i++) {
    for (let j = 0; j < lados; j++) {
      const a = i * (lados + 1) + j;
      const b = a + lados + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }

  return { pos, nor, idx };
}

/* --- cacto que é coral ------------------------------------------------------ */

/** Mandacaru: coluna canelada, ponta arredondada, verticalidade seca. */
function raioSertao(v, a) {
  let r = 0.30 * (1.0 - 0.22 * v * v);
  r *= 1.0 + 0.085 * Math.cos(a * 9);
  r *= 1.0 + 0.02 * Math.sin(v * 34);
  const topo = Math.max(0, (v - 0.9) / 0.1);
  r *= Math.sqrt(Math.max(0, 1 - topo * topo));
  return Math.max(r, 0.004);
}

/** A mesma planta depois que o mar voltou: base bulbosa, coroa de tentáculos. */
function raioMar(v, a) {
  let r = 0.20 + 0.30 * Math.sin(Math.min(1, v * 1.15) * Math.PI * 0.86);
  r *= 1.0 + 0.16 * Math.sin(v * 13.0);
  const coroa = Math.max(0, (v - 0.5) / 0.5);
  r *= 1.0 + 1.05 * coroa * coroa;
  r *= 1.0 + 0.26 * Math.cos(a * 15) * coroa;
  const topo = Math.max(0, (v - 0.94) / 0.06);
  r *= Math.sqrt(Math.max(0, 1 - topo * topo * 0.82));
  return Math.max(r, 0.004);
}

export function colunaViva() {
  const aneis = 30;
  const lados = 20;
  const altura = (v) => v * 1.0;

  const seca = revolucao(raioSertao, altura, aneis, lados);
  const marinha = revolucao(raioMar, (v) => v * 1.04, aneis, lados);

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(seca.pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(seca.nor, 3));
  g.setAttribute('positionB', new THREE.Float32BufferAttribute(marinha.pos, 3));
  g.setAttribute('normalB', new THREE.Float32BufferAttribute(marinha.nor, 3));
  g.setIndex(seca.idx);
  return g;
}

/* --- tubos: costelas, espinhas, patas --------------------------------------- */

/** Tubo ao longo de uma polilinha, com raio variável. */
function tubo(caminho, raios, lados) {
  const pos = [];
  const nor = [];
  const idx = [];
  const n = caminho.length;

  for (let i = 0; i < n; i++) {
    const p = caminho[i];
    const proximo = caminho[Math.min(n - 1, i + 1)];
    const anterior = caminho[Math.max(0, i - 1)];
    const t = new THREE.Vector3().subVectors(proximo, anterior).normalize();
    if (t.lengthSq() < 1e-8) t.set(0, 1, 0);
    const ref = Math.abs(t.y) > 0.92 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const u = new THREE.Vector3().crossVectors(ref, t).normalize();
    const w = new THREE.Vector3().crossVectors(t, u).normalize();

    for (let j = 0; j <= lados; j++) {
      const a = (j / lados) * Math.PI * 2;
      const dir = new THREE.Vector3()
        .addScaledVector(u, Math.cos(a))
        .addScaledVector(w, Math.sin(a));
      pos.push(p.x + dir.x * raios[i], p.y + dir.y * raios[i], p.z + dir.z * raios[i]);
      nor.push(dir.x, dir.y, dir.z);
    }
  }

  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < lados; j++) {
      const a = i * (lados + 1) + j;
      const b = a + lados + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  return g;
}

/**
 * Um esqueleto que não existe: caixa torácica de baleia, coluna de réptil.
 * Plausível o bastante para incomodar.
 */
export function esqueleto() {
  const partes = [];
  const passos = 12;
  const lados = 7;

  // coluna, de vértebra em vértebra
  const coluna = [];
  const raiosColuna = [];
  const N = 46;
  for (let i = 0; i <= N; i++) {
    const s = i / N;
    const z = (s - 0.5) * 9.0;
    const y = Math.sin(s * Math.PI) * 0.9 + Math.sin(s * Math.PI * 3.0) * 0.10;
    coluna.push(new THREE.Vector3(Math.sin(s * 5.2) * 0.16, y, z));
    raiosColuna.push(0.085 + 0.075 * Math.sin(s * Math.PI) + 0.03 * Math.sin(s * Math.PI * 22));
  }
  partes.push(tubo(coluna, raiosColuna, 8));

  // costelas: pares abrindo para baixo, encurtando na direção da cauda
  for (let k = 0; k < 11; k++) {
    const s = 0.16 + (k / 10) * 0.52;
    const base = coluna[Math.round(s * N)];
    const comprimento = 1.55 * Math.sin((0.1 + s * 0.85) * Math.PI) + 0.35;
    for (const lado of [-1, 1]) {
      const caminho = [];
      const raios = [];
      for (let i = 0; i <= passos; i++) {
        const u = i / passos;
        const ang = u * Math.PI * 0.72;
        caminho.push(
          new THREE.Vector3(
            base.x + lado * Math.sin(ang) * comprimento,
            base.y - (1 - Math.cos(ang)) * comprimento * 1.15,
            base.z + Math.sin(u * Math.PI) * 0.16 * lado
          )
        );
        raios.push(0.055 * (1.0 - 0.55 * u) + 0.012);
      }
      partes.push(tubo(caminho, raios, lados));
    }
  }

  // crânio alongado — entre o bico de um réptil e a mandíbula de um cetáceo
  const cranio = [];
  const raiosCranio = [];
  for (let i = 0; i <= 16; i++) {
    const u = i / 16;
    cranio.push(new THREE.Vector3(0, 0.85 - u * 0.18, -4.5 - u * 2.6));
    raiosCranio.push(0.34 * Math.pow(1 - u, 0.7) + 0.03);
  }
  partes.push(tubo(cranio, raiosCranio, 9));

  const g = mergeGeometries(partes, false);
  g.computeBoundingSphere();
  return g;
}

/* --- peixe com patas -------------------------------------------------------- */

/**
 * O corpo continua sendo de peixe. As patas foram acrescentadas por
 * necessidade, e não por elegância — e é isso que precisa ficar visível.
 */
export function peixeAndante() {
  const corpo = revolucao(
    (v) => {
      const s = v;
      let r = 0.30 * Math.sin(Math.pow(s, 0.72) * Math.PI);
      r = Math.max(r, 0.012);
      return r * (1.0 + 0.12 * Math.sin(s * 9.0));
    },
    (v) => (v - 0.5) * 2.0,
    26,
    14
  );

  const gCorpo = new THREE.BufferGeometry();
  gCorpo.setAttribute('position', new THREE.Float32BufferAttribute(corpo.pos, 3));
  gCorpo.setAttribute('normal', new THREE.Float32BufferAttribute(corpo.nor, 3));
  gCorpo.setIndex(corpo.idx);
  gCorpo.rotateX(Math.PI / 2); // o eixo do corpo passa a ser Z
  marcar(gCorpo, 0);

  const partes = [gCorpo];

  // cauda
  const cauda = new THREE.BufferGeometry();
  const cp = [
    0, 0, 0.95, 0, 0.42, 1.45, 0, -0.34, 1.42, 0, 0.16, 1.02, 0, 0.5, 1.5, 0, -0.42, 1.5,
  ];
  cauda.setAttribute('position', new THREE.Float32BufferAttribute(cp, 3));
  cauda.setAttribute(
    'normal',
    new THREE.Float32BufferAttribute([1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0], 3)
  );
  cauda.setIndex([0, 1, 2, 3, 4, 5]);
  marcar(cauda, 1);
  partes.push(cauda);

  // barbatana dorsal
  const dorsal = new THREE.BufferGeometry();
  dorsal.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([0, 0.16, -0.35, 0, 0.62, 0.12, 0, 0.14, 0.45], 3)
  );
  dorsal.setAttribute('normal', new THREE.Float32BufferAttribute([1, 0, 0, 1, 0, 0, 1, 0, 0], 3));
  dorsal.setIndex([0, 1, 2]);
  marcar(dorsal, 1);
  partes.push(dorsal);

  // quatro patas curtas, articuladas de qualquer jeito
  const posicoes = [
    [0.16, -0.16, -0.42],
    [-0.16, -0.16, -0.42],
    [0.15, -0.15, 0.28],
    [-0.15, -0.15, 0.28],
  ];
  posicoes.forEach((p, i) => {
    const lado = p[0] > 0 ? 1 : -1;
    const caminho = [];
    const raios = [];
    for (let k = 0; k <= 8; k++) {
      const u = k / 8;
      caminho.push(
        new THREE.Vector3(
          p[0] + lado * Math.sin(u * 1.5) * 0.16,
          p[1] - u * 0.42,
          p[2] + Math.sin(u * Math.PI) * 0.06
        )
      );
      raios.push(0.062 * (1 - 0.6 * u) + 0.012);
    }
    const g = tubo(caminho, raios, 6);
    marcar(g, 2 + i * 0.001);
    partes.push(g);
  });

  const g = mergeGeometries(partes, false);
  g.computeBoundingSphere();
  return g;
}

function marcar(geometria, valor) {
  const n = geometria.getAttribute('position').count;
  const a = new Float32Array(n);
  a.fill(valor);
  geometria.setAttribute('aParte', new THREE.BufferAttribute(a, 1));
}
