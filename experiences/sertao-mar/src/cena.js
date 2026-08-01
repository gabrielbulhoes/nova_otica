/* ---------------------------------------------------------------------------
   A tela.

   Um único render por quadro: o raymarch pinta o mundo e escreve profundidade;
   as criaturas instanciadas convivem com ele no mesmo buffer; a poeira passa
   por cima. Só depois o verniz.
   --------------------------------------------------------------------------- */

import * as THREE from 'three';
import { MUNDO_VERT, MUNDO_FRAG } from './shaders/mundo.glsl.js';
import { ORGANISMO_FRAG, FLORA_VERT, FOSSIL_VERT, FAUNA_VERT } from './shaders/organismos.glsl.js';
import { PARTICULAS_VERT, PARTICULAS_FRAG } from './shaders/particulas.glsl.js';
import {
  QUADRO_VERT,
  BRILHO_FRAG,
  BORRAO_FRAG,
  REDUZIR_FRAG,
  COMPOSICAO_FRAG,
} from './shaders/pos.glsl.js';
import { colunaViva, esqueleto, peixeAndante } from './geometria.js';

THREE.ColorManagement.enabled = false;

const PERTO = 0.25;
const LONGE = 2200;

/* Distribuição das criaturas ao longo de todo o percurso da câmera. */
const CORREDOR = { z0: 70, z1: -480, largura: 130 };

function aleatorio(semente) {
  let s = semente >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export class Cena {
  constructor(canvas) {
    this.canvas = canvas;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      alpha: false,
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.renderer.setClearColor(0x000000, 1);
    this.renderer.autoClear = true;

    this.camera = new THREE.PerspectiveCamera(45, 1, PERTO, LONGE);
    this.cena = new THREE.Scene();

    this.escala = 0.85;
    this.escalaAlvo = 0.85;
    this.mediaQuadro = 16;
    this.passos = 150;

    this.u = this.criarUniformes();
    this.montar();
    this.criarAlvos();
    this.criarQuadro();
  }

  /* --- uniformes compartilhados por todos os materiais --------------------- */

  criarUniformes() {
    const v3 = () => ({ value: new THREE.Vector3() });
    return {
      uResolucao: { value: new THREE.Vector2(1, 1) },
      uTempo: { value: 0 },
      uCamPos: { value: new THREE.Vector3() },
      uCamFrente: { value: new THREE.Vector3(0, 0, -1) },
      uCamDireita: { value: new THREE.Vector3(1, 0, 0) },
      uCamCima: { value: new THREE.Vector3(0, 1, 0) },
      uTanFov: { value: 0.4 },
      uProj: { value: new THREE.Matrix4() },

      uAgua: { value: -1.15 },
      uAmplitude: { value: 5.2 },
      uFrequencia: { value: 1 },
      uFendas: { value: 1 },
      uMarulho: { value: 0.1 },
      uCoral: { value: 0.2 },
      uFossil: { value: 0.3 },
      uFauna: { value: 0.5 },
      uNeblina: { value: 0.02 },
      uBio: { value: 0 },
      uCausticas: { value: 0.1 },
      uPlancton: { value: 0.1 },
      uContrafluxo: { value: 0 },
      uExposicao: { value: 1 },
      uSubmerso: { value: 0 },
      uPassos: { value: 150 },
      uDesvelo: { value: 0 },

      uSolDir: { value: new THREE.Vector3(0.3, 0.1, -0.94).normalize() },
      uSolCor: { value: new THREE.Vector3(1, 0.85, 0.7) },
      uCeuAlto: v3(),
      uCeuHorizonte: v3(),
      uNeblinaCor: v3(),
      uAreia: v3(),
      uRocha: v3(),
      uCoralCor: v3(),
      uAguaCor: v3(),
    };
  }

  /* --- construção da cena --------------------------------------------------- */

  montar() {
    const u = this.u;

    // o mundo
    const quadGeo = new THREE.PlaneGeometry(2, 2);
    this.mundoMat = new THREE.ShaderMaterial({
      uniforms: u,
      vertexShader: MUNDO_VERT,
      fragmentShader: MUNDO_FRAG,
      depthTest: true,
      depthWrite: true,
      depthFunc: THREE.AlwaysDepth,
    });
    const mundo = new THREE.Mesh(quadGeo, this.mundoMat);
    mundo.frustumCulled = false;
    mundo.renderOrder = -10;
    this.cena.add(mundo);

    // flora
    this.cena.add(
      this.criarPovoado({
        geometria: colunaViva(),
        vertexShader: FLORA_VERT,
        quantidade: 460,
        semente: 7,
        ordem: 0,
        escalar: (r) => [0.42 + r() * 0.9, 1.1 + Math.pow(r(), 1.6) * 6.2, 0],
        agrupar: true,
        vao: 8,
      })
    );

    // fósseis — no leito seco, onde o rio (ou o mar) passou
    this.cena.add(
      this.criarPovoado({
        geometria: esqueleto(),
        vertexShader: FOSSIL_VERT,
        quantidade: 26,
        semente: 23,
        ordem: 1,
        escalar: (r) => [0.6 + r() * 1.5, 0, 0],
        faixaX: 30,
        vao: 5,
      })
    );

    // fauna
    this.cena.add(
      this.criarPovoado({
        geometria: peixeAndante(),
        vertexShader: FAUNA_VERT,
        quantidade: 150,
        semente: 41,
        ordem: 2,
        escalar: (r) => [0.5 + r() * 1.6, 3.5 + r() * 17.0, 0],
      })
    );

    // poeira que é plâncton
    const N = 26000;
    const sementes = new Float32Array(N * 3);
    const r = aleatorio(99);
    for (let i = 0; i < N * 3; i++) sementes[i] = r();
    const pontos = new THREE.BufferGeometry();
    pontos.setAttribute('position', new THREE.BufferAttribute(sementes, 3));
    pontos.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

    this.particulasMat = new THREE.ShaderMaterial({
      uniforms: u,
      vertexShader: PARTICULAS_VERT,
      fragmentShader: PARTICULAS_FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
    });
    const nuvem = new THREE.Points(pontos, this.particulasMat);
    nuvem.frustumCulled = false;
    nuvem.renderOrder = 20;
    this.cena.add(nuvem);
  }

  criarPovoado({
    geometria,
    vertexShader,
    quantidade,
    semente,
    ordem,
    escalar,
    agrupar,
    faixaX,
    vao = 0,
  }) {
    const r = aleatorio(semente);
    const iPos = new Float32Array(quantidade * 2);
    const iEscala = new Float32Array(quantidade * 3);
    const iSemente = new Float32Array(quantidade);

    const largura = faixaX ?? CORREDOR.largura;
    let cx = 0;
    let cz = 0;
    let restante = 0;

    for (let i = 0; i < quantidade; i++) {
      let x;
      let z;
      if (agrupar) {
        if (restante <= 0) {
          restante = 3 + Math.floor(r() * 7);
          cx = (r() * 2 - 1) * largura;
          cz = CORREDOR.z0 + (CORREDOR.z1 - CORREDOR.z0) * r();
        }
        restante--;
        x = cx + (r() * 2 - 1) * 7;
        z = cz + (r() * 2 - 1) * 7;
      } else {
        x = (r() * 2 - 1) * largura;
        z = CORREDOR.z0 + (CORREDOR.z1 - CORREDOR.z0) * r();
      }

      /* o vão: a faixa por onde o olhar caminha fica livre */
      if (vao > 0 && Math.abs(x) < vao) x = Math.sign(x || 1) * (vao + Math.abs(x));

      iPos[i * 2] = x;
      iPos[i * 2 + 1] = z;
      const e = escalar(r);
      iEscala[i * 3] = e[0];
      iEscala[i * 3 + 1] = e[1];
      iEscala[i * 3 + 2] = e[2];
      iSemente[i] = r() * 97.3;
    }

    const g = new THREE.InstancedBufferGeometry();
    g.index = geometria.index;
    for (const nome of Object.keys(geometria.attributes)) {
      g.setAttribute(nome, geometria.attributes[nome]);
    }
    g.setAttribute('iPos', new THREE.InstancedBufferAttribute(iPos, 2));
    g.setAttribute('iEscala', new THREE.InstancedBufferAttribute(iEscala, 3));
    g.setAttribute('iSemente', new THREE.InstancedBufferAttribute(iSemente, 1));
    g.instanceCount = quantidade;
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

    const mat = new THREE.ShaderMaterial({
      uniforms: this.u,
      vertexShader,
      fragmentShader: ORGANISMO_FRAG,
      side: THREE.DoubleSide,
    });

    const malha = new THREE.Mesh(g, mat);
    malha.frustumCulled = false;
    malha.renderOrder = ordem;
    malha.matrixAutoUpdate = false;
    return malha;
  }

  /* --- alvos de render ------------------------------------------------------ */

  criarAlvos() {
    const opcoes = {
      type: THREE.HalfFloatType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: true,
      colorSpace: THREE.LinearSRGBColorSpace,
    };

    this.rtCena = new THREE.WebGLRenderTarget(2, 2, opcoes);
    this.rtCena.depthTexture = new THREE.DepthTexture(2, 2, THREE.UnsignedIntType);
    this.rtCena.depthTexture.format = THREE.DepthFormat;

    const leve = { ...opcoes, depthBuffer: false };
    this.niveis = [1, 2, 3].map(() => ({
      a: new THREE.WebGLRenderTarget(2, 2, leve),
      b: new THREE.WebGLRenderTarget(2, 2, leve),
    }));
  }

  criarQuadro() {
    this.quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quadGeo = new THREE.PlaneGeometry(2, 2);
    this.quad = new THREE.Mesh(this.quadGeo, null);
    this.quadCena = new THREE.Scene();
    this.quadCena.add(this.quad);

    const material = (fragmentShader, uniforms) =>
      new THREE.ShaderMaterial({
        vertexShader: QUADRO_VERT,
        fragmentShader,
        uniforms,
        depthTest: false,
        depthWrite: false,
      });

    this.matBrilho = material(BRILHO_FRAG, {
      tCena: { value: null },
      uPasso: { value: new THREE.Vector2() },
      uLimiar: { value: 1.15 },
    });

    this.matBorrao = material(BORRAO_FRAG, {
      tCena: { value: null },
      uDirecao: { value: new THREE.Vector2() },
    });

    this.matReduzir = material(REDUZIR_FRAG, {
      tCena: { value: null },
      uPasso: { value: new THREE.Vector2() },
    });

    this.matComposicao = material(COMPOSICAO_FRAG, {
      tCena: { value: null },
      tProfundidade: { value: null },
      tBrilho1: { value: null },
      tBrilho2: { value: null },
      tBrilho3: { value: null },
      uResolucao: { value: new THREE.Vector2() },
      uTempo: { value: 0 },
      uPerto: { value: PERTO },
      uLonge: { value: LONGE },
      uPlanoFoco: { value: 40 },
      uAbertura: { value: 1 },
      uExposicao: { value: 1 },
      uDesvelo: { value: 0 },
      uSubmerso: { value: 0 },
      uContrafluxo: { value: 0 },
      uNeblinaCor: { value: new THREE.Vector3() },
      uAguaCor: { value: new THREE.Vector3() },
    });
  }

  desenhar(material, alvo) {
    this.quad.material = material;
    this.renderer.setRenderTarget(alvo);
    this.renderer.render(this.quadCena, this.quadCam);
  }

  /* --- dimensões ------------------------------------------------------------ */

  redimensionar(largura, altura) {
    this.larguraCss = largura;
    this.alturaCss = altura;
    this.aplicarEscala();
  }

  aplicarEscala() {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.8);
    const l = Math.max(2, Math.round(this.larguraCss * dpr * this.escala));
    const a = Math.max(2, Math.round(this.alturaCss * dpr * this.escala));
    if (this.larguraPx === l && this.alturaPx === a) return;

    this.larguraPx = l;
    this.alturaPx = a;

    this.renderer.setPixelRatio(1);
    this.renderer.setSize(l, a, false);
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';

    this.camera.aspect = l / a;
    this.camera.updateProjectionMatrix();

    this.rtCena.setSize(l, a);
    this.niveis.forEach((n, i) => {
      const d = Math.pow(2, i + 1);
      const w = Math.max(2, Math.round(l / d));
      const h = Math.max(2, Math.round(a / d));
      n.a.setSize(w, h);
      n.b.setSize(w, h);
    });

    this.u.uResolucao.value.set(l, a);
    this.matComposicao.uniforms.uResolucao.value.set(l, a);
  }

  /* --- estado por quadro ----------------------------------------------------- */

  aplicarEstado(e, tempo, desvelo) {
    const u = this.u;
    const c = e.camera;

    this.camera.fov = c.fov;
    this.camera.position.set(c.pos[0], c.pos[1], c.pos[2]);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(c.alvo[0], c.alvo[1], c.alvo[2]);
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld(true);

    const m = this.camera.matrixWorld.elements;
    u.uCamDireita.value.set(m[0], m[1], m[2]);
    u.uCamCima.value.set(m[4], m[5], m[6]);
    u.uCamFrente.value.set(-m[8], -m[9], -m[10]);
    u.uCamPos.value.copy(this.camera.position);
    u.uTanFov.value = Math.tan(THREE.MathUtils.degToRad(c.fov) * 0.5);
    u.uProj.value.copy(this.camera.projectionMatrix);

    u.uTempo.value = tempo;
    u.uDesvelo.value = desvelo;
    u.uPassos.value = this.passos;

    for (const k of [
      'uAgua:agua',
      'uAmplitude:amplitude',
      'uFrequencia:frequencia',
      'uFendas:fendas',
      'uMarulho:marulho',
      'uCoral:coral',
      'uFossil:fossil',
      'uFauna:fauna',
      'uNeblina:neblina',
      'uBio:bio',
      'uCausticas:causticas',
      'uPlancton:plancton',
      'uContrafluxo:contrafluxo',
      'uExposicao:exposicao',
    ]) {
      const [alvo, origem] = k.split(':');
      u[alvo].value = e[origem];
    }

    const el = e.elevacaoSol;
    const az = e.azimuteSol;
    u.uSolDir.value.set(Math.cos(el) * Math.sin(az), Math.sin(el), -Math.cos(el) * Math.cos(az)).normalize();

    for (const k of [
      'uSolCor:sol',
      'uCeuAlto:ceuAlto',
      'uCeuHorizonte:ceuHorizonte',
      'uNeblinaCor:neblinaCor',
      'uAreia:areia',
      'uRocha:rocha',
      'uCoralCor:coralCor',
      'uAguaCor:aguaCor',
    ]) {
      const [alvo, origem] = k.split(':');
      const c2 = e[origem];
      u[alvo].value.set(c2[0], c2[1], c2[2]);
    }

    u.uSubmerso.value = THREE.MathUtils.clamp((e.agua - this.camera.position.y) / 2.5, 0, 1);

    const cp = this.matComposicao.uniforms;
    cp.uTempo.value = tempo;
    cp.uPlanoFoco.value = c.foco;
    cp.uAbertura.value = c.abertura;
    cp.uExposicao.value = e.exposicao;
    cp.uDesvelo.value = desvelo;
    cp.uSubmerso.value = u.uSubmerso.value;
    cp.uContrafluxo.value = e.contrafluxo;
    cp.uNeblinaCor.value.copy(u.uNeblinaCor.value);
    cp.uAguaCor.value.copy(u.uAguaCor.value);
  }

  /* --- desenho --------------------------------------------------------------- */

  render(dt) {
    this.aferir(dt);

    // 1 · o mundo
    this.renderer.setRenderTarget(this.rtCena);
    this.renderer.clear(true, true, false);
    this.renderer.render(this.cena, this.camera);

    // 2 · a luz que sangra
    const [n1, n2, n3] = this.niveis;
    this.matBrilho.uniforms.tCena.value = this.rtCena.texture;
    this.matBrilho.uniforms.uPasso.value.set(1 / this.larguraPx, 1 / this.alturaPx);
    this.desenhar(this.matBrilho, n1.a);
    this.borrar(n1);

    this.reduzir(n1.a, n2.a);
    this.borrar(n2);
    this.reduzir(n2.a, n3.a);
    this.borrar(n3);

    // 3 · o verniz
    const cp = this.matComposicao.uniforms;
    cp.tCena.value = this.rtCena.texture;
    cp.tProfundidade.value = this.rtCena.depthTexture;
    cp.tBrilho1.value = n1.a.texture;
    cp.tBrilho2.value = n2.a.texture;
    cp.tBrilho3.value = n3.a.texture;
    this.desenhar(this.matComposicao, null);
  }

  borrar(nivel) {
    const w = nivel.a.width;
    const h = nivel.a.height;
    this.matBorrao.uniforms.tCena.value = nivel.a.texture;
    this.matBorrao.uniforms.uDirecao.value.set(1 / w, 0);
    this.desenhar(this.matBorrao, nivel.b);
    this.matBorrao.uniforms.tCena.value = nivel.b.texture;
    this.matBorrao.uniforms.uDirecao.value.set(0, 1 / h);
    this.desenhar(this.matBorrao, nivel.a);
  }

  reduzir(origem, destino) {
    this.matReduzir.uniforms.tCena.value = origem.texture;
    this.matReduzir.uniforms.uPasso.value.set(1 / origem.width, 1 / origem.height);
    this.desenhar(this.matReduzir, destino);
  }

  /* --- desempenho acima de tudo ---------------------------------------------- */

  aferir(dt) {
    const ms = Math.min(dt * 1000, 120);
    this.mediaQuadro += (ms - this.mediaQuadro) * 0.05;

    if (this.mediaQuadro > 21) {
      this.escalaAlvo = Math.max(0.5, this.escalaAlvo - 0.012);
      this.passos = Math.max(72, this.passos - 1.2);
    } else if (this.mediaQuadro < 12.5) {
      this.escalaAlvo = Math.min(1.0, this.escalaAlvo + 0.006);
      this.passos = Math.min(175, this.passos + 0.6);
    }

    if (Math.abs(this.escalaAlvo - this.escala) > 0.02) {
      this.escala = this.escalaAlvo;
      this.aplicarEscala();
    }
  }
}
