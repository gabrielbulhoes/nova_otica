/* ---------------------------------------------------------------------------
   A tipografia.

   Aparece devagar, nunca disputa o centro, e sai antes de ser notada saindo.
   Cada ficha só existe enquanto a obra correspondente está presente.
   --------------------------------------------------------------------------- */

import { gsap } from 'gsap';
import { OBRAS, AUTORIA, presenca } from './obras.js';

export class Tipografia {
  constructor() {
    this.fichas = [];
    this.marcas = [];

    const alvo = document.getElementById('fichas');
    OBRAS.forEach((obra, i) => {
      const el = document.createElement('article');
      el.className = 'ficha';
      el.dataset.lado = obra.lado;
      el.innerHTML = `
        <span class="ficha__ordem">obra ${obra.ordem}</span>
        <h2 class="ficha__titulo">${obra.titulo}</h2>
        <p class="ficha__tecnica">
          <span>${obra.ano}</span>
          <span>${obra.tecnica}</span>
          <span>${obra.dimensoes}</span>
        </p>
        <p class="ficha__reflexao">${obra.reflexao}</p>
      `;
      alvo.appendChild(el);

      const lado = obra.lado === 'direita' ? 1 : -1;
      this.fichas.push({
        el,
        lado,
        opacidade: gsap.quickTo(el, 'opacity', { duration: 0.5, ease: 'power2.out' }),
        desloc: gsap.quickTo(el, 'x', { duration: 0.9, ease: 'power2.out' }),
        desfoque: gsap.quickSetter(el, 'filter'),
        anterior: -1,
      });
    });

    // frontispício e colofão
    this.frontispicio = document.getElementById('frontispicio');
    this.autor = document.getElementById('frontispicio-autor');
    this.autor.textContent = `${AUTORIA.nome} · ${AUTORIA.legenda}`;
    this.colofao = document.getElementById('colofao');
    this.convite = document.getElementById('convite');

    this.opFrontispicio = gsap.quickTo(this.frontispicio, 'opacity', {
      duration: 0.7,
      ease: 'power2.out',
    });
    this.deslocFrontispicio = gsap.quickTo(this.frontispicio, 'y', {
      duration: 1.1,
      ease: 'power2.out',
    });
    this.opColofao = gsap.quickTo(this.colofao, 'opacity', { duration: 0.9, ease: 'power2.out' });

    // rastro: seis marcas discretas, uma por obra
    const rastro = document.getElementById('rastro');
    OBRAS.forEach((obra, i) => {
      const b = document.createElement('button');
      b.className = 'rastro__marca';
      b.type = 'button';
      b.setAttribute('aria-label', `${obra.titulo}, obra ${obra.ordem}`);
      b.dataset.indice = String(i);
      rastro.appendChild(b);
      this.marcas.push(b);
    });
    this.rastro = rastro;
  }

  aoEscolher(callback) {
    this.marcas.forEach((b, i) => {
      b.addEventListener('click', () => callback(i, this.marcas.length));
    });
  }

  revelar() {
    this.rastro.classList.add('presente');
    document.getElementById('som').classList.add('presente');
    this.convite.classList.add('presente');
  }

  atualizar(p, cru) {
    for (let i = 0; i < this.fichas.length; i++) {
      const f = this.fichas[i];
      let pres = presenca(p, i);
      /* a primeira ficha espera o frontispício sair de cena */
      if (i === 0) pres = Math.min(pres, Math.max(0, cru * 22 - 0.35));
      const suave = pres * pres * (3 - 2 * pres);

      if (Math.abs(suave - f.anterior) > 0.002) {
        f.opacidade(suave);
        f.desloc((1 - suave) * 26 * f.lado);
        f.desfoque(`blur(${((1 - suave) * 7).toFixed(2)}px)`);
        f.anterior = suave;
      }
    }

    // o frontispício some assim que a descida começa
    const inicio = Math.max(0, 1 - cru * 9);
    this.opFrontispicio(inicio);
    this.deslocFrontispicio((1 - inicio) * -40);
    this.convite.style.opacity = String(Math.max(0, 1 - cru * 14));

    // o colofão só existe no fim do ciclo
    const fim = Math.max(0, (cru - 0.965) / 0.035);
    this.opColofao(fim);
    this.colofao.classList.toggle('presente', fim > 0.6);

    // o rastro
    const n = this.marcas.length;
    for (let i = 0; i < n; i++) {
      const local = Math.min(1, Math.max(0, cru * n - i));
      this.marcas[i].style.setProperty('--preenchimento', local.toFixed(3));
    }
  }
}
