/* ---------------------------------------------------------------------------
   O sertão já foi mar.

   Um único laço: o scroll dá o tempo, o tempo dá o estado, o estado pinta a
   tela. Não há páginas, não há rotas, não há troca de cena — só um mundo que
   não para de virar outro.
   --------------------------------------------------------------------------- */

import { gsap } from 'gsap';
import { Cena } from './cena.js';
import { criarPercurso } from './percurso.js';
import { Tipografia } from './tipografia.js';
import { Paisagem } from './audio.js';
import { amostrar, estadoVazio, OBRAS } from './obras.js';

const canvas = document.getElementById('tela');
const veu = document.getElementById('veu');
const barra = document.getElementById('veu-progresso');
const botaoEntrar = document.getElementById('veu-entrada');

let cena;
try {
  cena = new Cena(canvas);
} catch (erro) {
  console.error(erro);
  veu.innerHTML =
    '<div class="veu__interior"><p class="veu__epigrafe"><span>Esta obra precisa de WebGL 2.</span>' +
    '<span>Talvez outro navegador consiga atravessá-la.</span></p></div>';
  throw erro;
}

const tipografia = new Tipografia();
const paisagem = new Paisagem();
const percurso = criarPercurso({ hospedeiro: document.getElementById('camadas') });

const estado = estadoVazio();
const desvelo = { valor: 0 };
let entrou = false;
let relogio = 0;

/* --- dimensões -------------------------------------------------------------- */

function medir() {
  cena.redimensionar(window.innerWidth, window.innerHeight);
}
medir();

let debounce;
window.addEventListener('resize', () => {
  clearTimeout(debounce);
  debounce = setTimeout(() => {
    medir();
    percurso.atualizar();
  }, 140);
});

/* --- a deriva ---------------------------------------------------------------
   Mesmo parado, o quadro respira: a câmera nunca fica exatamente onde estava.
   ---------------------------------------------------------------------------- */

function derivar(e, t) {
  const c = e.camera;
  c.pos[0] += Math.sin(t * 0.11) * 0.42 + Math.sin(t * 0.043) * 0.7;
  c.pos[1] += Math.sin(t * 0.083 + 1.7) * 0.24;
  c.pos[2] += Math.cos(t * 0.067) * 0.5;
  c.alvo[0] += Math.sin(t * 0.052 + 0.6) * 1.3;
  c.alvo[1] += Math.cos(t * 0.071 + 2.2) * 0.6;
}

/* --- o laço ------------------------------------------------------------------ */

gsap.ticker.add((tempo, delta) => {
  relogio = tempo;
  const p = percurso.progresso;

  amostrar(p, estado);
  derivar(estado, tempo);

  cena.aplicarEstado(estado, tempo, desvelo.valor);
  cena.render(delta / 1000);

  tipografia.atualizar(p, percurso.cru);
  paisagem.atualizar({
    plancton: estado.plancton,
    bio: estado.bio,
    contrafluxo: estado.contrafluxo,
    submerso: cena.u.uSubmerso.value,
  });
});

/* --- o desvelo ---------------------------------------------------------------
   Compilar os shaders leva tempo. Em vez de esconder isso atrás de uma barra
   falsa, a barra mostra o que está mesmo acontecendo — e o pano só sai quando
   o primeiro quadro já existe.
   ---------------------------------------------------------------------------- */

function progressoDoVeu(v) {
  barra.style.width = `${Math.round(v * 100)}%`;
}

async function preparar() {
  progressoDoVeu(0.12);
  amostrar(0, estado);
  cena.aplicarEstado(estado, 0, 0);

  if (cena.renderer.compileAsync) {
    await cena.renderer.compileAsync(cena.cena, cena.camera);
  } else {
    cena.renderer.compile(cena.cena, cena.camera);
  }
  progressoDoVeu(0.68);

  // dois quadros de aquecimento: o primeiro sempre custa caro
  for (let i = 0; i < 2; i++) {
    cena.render(0.016);
    await new Promise((r) => requestAnimationFrame(r));
  }
  progressoDoVeu(1);

  botaoEntrar.hidden = false;
  botaoEntrar.focus({ preventScroll: true });
}

function entrar() {
  if (entrou) return;
  entrou = true;

  veu.classList.add('aberto');
  document.body.classList.remove('imovel');
  percurso.seguir();

  gsap.to(desvelo, { valor: 1, duration: 3.2, ease: 'power2.inOut' });

  // o visitante contempla antes de descer
  gsap.delayedCall(2.6, () => tipografia.revelar());
}

document.body.classList.add('imovel');
percurso.parar();
botaoEntrar.addEventListener('click', entrar);
window.addEventListener(
  'keydown',
  (ev) => {
    if (!entrou && !botaoEntrar.hidden && (ev.key === 'Enter' || ev.key === ' ')) entrar();
  },
  { passive: true }
);

preparar().catch((erro) => {
  console.error(erro);
  progressoDoVeu(1);
  botaoEntrar.hidden = false;
});

/* --- interface invisível ------------------------------------------------------ */

const botaoSom = document.getElementById('som');
botaoSom.addEventListener('click', async () => {
  const ligado = await paisagem.alternar();
  botaoSom.setAttribute('aria-pressed', String(!!ligado));
});

const alturaRolavel = () => document.documentElement.scrollHeight - window.innerHeight;

tipografia.aoEscolher((indice, total) => {
  const alvo = (indice / (total - 1)) * alturaRolavel();
  percurso.irPara(alvo, { duration: 2.6, easing: (t) => 1 - Math.pow(1 - t, 4) });
});

document.getElementById('colofao-voltar').addEventListener('click', () => {
  percurso.irPara(0, { duration: 5.5, easing: (t) => 1 - Math.pow(1 - t, 3) });
});

/* O ciclo é literal: quem chega ao fim e continua descendo volta ao princípio. */
window.addEventListener(
  'wheel',
  (ev) => {
    if (!entrou) return;
    const fim = window.scrollY >= alturaRolavel() - 2;
    if (fim && ev.deltaY > 0) {
      percurso.irPara(0, { duration: 5.5, easing: (t) => 1 - Math.pow(1 - t, 3) });
    }
  },
  { passive: true }
);

/* Pausa quando ninguém está olhando: a obra não precisa de plateia, mas a
   bateria do visitante precisa. */
document.addEventListener('visibilitychange', () => {
  if (document.hidden) gsap.ticker.sleep();
  else gsap.ticker.wake();
});

if (import.meta.env?.DEV) {
  window.__obra = { cena, percurso, estado, OBRAS, relogio: () => relogio };
}
