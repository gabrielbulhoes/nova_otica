/* ---------------------------------------------------------------------------
   O percurso.

   O scroll não rola uma página: ele arrasta o tempo. Lenis tira o atrito da
   roda; o scrub do ScrollTrigger acrescenta uma inércia de sonho — o mundo
   chega sempre um instante depois do gesto, como acontece ao acordar.
   --------------------------------------------------------------------------- */

import Lenis from 'lenis';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { OBRAS } from './obras.js';

gsap.registerPlugin(ScrollTrigger);

export function criarPercurso({ hospedeiro }) {
  /* Cada obra ganha um trecho de rolagem. O primeiro é mais longo: é preciso
     ficar parado diante do quadro antes de começar a descer. */
  OBRAS.forEach((_, i) => {
    const trecho = document.createElement('section');
    trecho.className = 'trecho';
    trecho.dataset.obra = String(i);
    if (i === 0) trecho.style.height = '190vh';
    else if (i === OBRAS.length - 1) trecho.style.height = '210vh';
    hospedeiro.appendChild(trecho);
  });

  const lenis = new Lenis({
    lerp: 0.062,
    wheelMultiplier: 0.85,
    touchMultiplier: 1.5,
    smoothWheel: true,
    syncTouch: false,
    autoRaf: false,
  });

  lenis.on('scroll', ScrollTrigger.update);
  gsap.ticker.add((t) => lenis.raf(t * 1000));
  gsap.ticker.lagSmoothing(0);

  const estado = { p: 0, cru: 0 };

  gsap.to(estado, {
    p: 1,
    ease: 'none',
    scrollTrigger: {
      trigger: document.documentElement,
      start: 0,
      end: 'max',
      scrub: 1.35,
      onUpdate: (self) => {
        estado.cru = self.progress;
      },
    },
  });

  ScrollTrigger.refresh();

  return {
    /** progresso amortecido — é este que pinta o mundo */
    get progresso() {
      return estado.p;
    },
    /** progresso instantâneo — para a interface, que precisa ser imediata */
    get cru() {
      return estado.cru;
    },
    parar: () => lenis.stop(),
    seguir: () => lenis.start(),
    irPara: (alvo, opcoes) => lenis.scrollTo(alvo, opcoes),
    atualizar: () => ScrollTrigger.refresh(),
  };
}
