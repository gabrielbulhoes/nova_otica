import { UNIFORMES, RUIDO } from './comum.glsl.js';

/* A poeira e o plâncton são a mesma coisa. Só muda o meio em que flutuam —
   e é por isso que uma pode virar a outra sem que ninguém veja o momento. */

export const PARTICULAS_VERT = /* glsl */ `
${UNIFORMES}
${RUIDO}

varying float vBrilho;
varying float vMar;
varying float vDist;

const vec3 CAIXA = vec3(78.0, 40.0, 78.0);

void main(){
  vec3 semente = position;                 // 0..1 em cada eixo
  float s = hash11(semente.x * 91.7 + semente.y * 13.3 + semente.z * 47.1);

  float fase = uTempo;
  vec2 vento = vec2(sin(fase * 0.19), cos(fase * 0.11)) * (1.4 + s * 1.6);

  /* a subida: no contrafluxo, tudo o que devia cair sobe */
  float subida = mix(-0.06 - s * 0.10, 0.35 + s * 0.5, uPlancton);
  subida += uContrafluxo * (1.6 + s * 2.4);

  vec3 desloc = vec3(vento.x, subida, vento.y * 0.7) * fase;
  vec3 p = semente * CAIXA + desloc;

  /* turbilhão: a partícula nunca anda em linha reta */
  p += vec3(
    sin(fase * 0.35 + semente.y * 40.0),
    sin(fase * 0.27 + semente.z * 33.0),
    cos(fase * 0.31 + semente.x * 37.0)
  ) * (0.7 + 1.9 * uPlancton);

  p = mod(p, CAIXA);
  vec3 mundo = uCamPos + p - CAIXA * 0.5;

  /* nada de partícula enterrada no chão */
  mundo.y = max(mundo.y, uCamPos.y - CAIXA.y * 0.5);

  vec4 vista = viewMatrix * vec4(mundo, 1.0);
  vDist = -vista.z;

  float tamanho = mix(1.0 + s * 1.1, 1.6 + s * 2.6, uPlancton);
  gl_PointSize = tamanho * (uResolucao.y * 0.0009) * (60.0 / max(vDist, 1.0));
  gl_PointSize = clamp(gl_PointSize, 0.6, 13.0);

  /* desaparecem antes de tocar a borda da caixa: ninguém vê a costura */
  vec3 borda = min(p, CAIXA - p) / (CAIXA * 0.5);
  float margem = smoothstep(0.0, 0.22, min(min(borda.x, borda.y), borda.z));

  vMar = uPlancton;
  vBrilho = margem * mix(0.16 + s * 0.24, 0.42 + s * 0.7, uPlancton);
  vBrilho *= mix(1.0, 1.15, uBio);
  vBrilho *= smoothstep(2.0, 9.0, vDist);       // não engasga na lente

  gl_Position = projectionMatrix * vista;
}
`;

export const PARTICULAS_FRAG = /* glsl */ `
${UNIFORMES}

varying float vBrilho;
varying float vMar;
varying float vDist;

void main(){
  vec2 c = gl_PointCoord - 0.5;
  float r = length(c) * 2.0;
  if (r > 1.0) discard;

  float nucleo = pow(1.0 - r, 2.4);
  float halo = pow(1.0 - r, 0.7) * 0.25;

  vec3 poeira = uSolCor * 0.55 + uNeblinaCor * 0.85;
  vec3 plancton = mix(vec3(0.20, 0.66, 0.66), vec3(0.16, 0.74, 0.68), uBio);
  vec3 cor = mix(poeira, plancton, pow(vMar, 1.7));

  /* a névoa também engole a poeira */
  float sumico = exp(-vDist * uNeblina * mix(1.0, 2.2, uSubmerso) * 1.6);

  float a = (nucleo + halo) * vBrilho * sumico * uDesvelo;
  gl_FragColor = vec4(cor * a, a);
}
`;
