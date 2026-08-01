import { UNIFORMES, RUIDO, TERRENO, ATMOSFERA } from './comum.glsl.js';

/* Cabeçalho comum aos três vertex shaders das criaturas. */
const CABECA = /* glsl */ `
${UNIFORMES}
${RUIDO}
${TERRENO}

attribute vec2  iPos;      // posição no plano do mundo
attribute vec3  iEscala;   // largura, altura, parâmetro livre
attribute float iSemente;

varying vec3 vNormal;
varying vec3 vMundo;
varying vec3 vAlbedo;
varying vec3 vDados;       // sombra, emissivo, semente

mat3 giroY(float a){
  float c = cos(a), s = sin(a);
  return mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c);
}

/* normalize(vec3(0)) devolve NaN, e um NaN em varying apaga o triângulo
   inteiro. Toda normal desta cena passa por aqui. */
vec3 versor(vec3 v){
  float d = dot(v, v);
  return d > 1e-10 ? v * inversesqrt(d) : vec3(0.0, 1.0, 0.0);
}

/* Nada encosta na lente e nada é desenhado longe demais para ser visto.
   Fora desses limites a criatura simplesmente encolhe até deixar de existir —
   sem pop, sem transparência, sem custo. */
float aparicao(vec2 xz, float perto, float longe){
  float d = distance(uCamPos.xz, xz);
  return smoothstep(perto, perto * 3.4, d) * (1.0 - smoothstep(longe * 0.8, longe, d));
}
`;

/* O fragmento é o mesmo para tudo o que é matéria viva: uma luz, um céu,
   a mesma neblina do raymarch. É isso que faz criatura e paisagem parecerem
   pintadas na mesma tela. */
export const ORGANISMO_FRAG = /* glsl */ `
${UNIFORMES}
${RUIDO}
${TERRENO}
${ATMOSFERA}

vec3 versor(vec3 v){
  float d = dot(v, v);
  return d > 1e-10 ? v * inversesqrt(d) : vec3(0.0, 1.0, 0.0);
}

varying vec3 vNormal;
varying vec3 vMundo;
varying vec3 vAlbedo;
varying vec3 vDados;

void main(){
  vec3 n = versor(vNormal);
  vec3 dv = vMundo - uCamPos;
  float dist = length(dv);
  vec3 rd = dv / max(dist, 1e-4);
  if (!gl_FrontFacing) n = -n;

  vec3 cor = iluminar(n, vAlbedo, vDados.x, 1.0, rd);

  /* translucidez: a luz atravessando o tecido fino do coral */
  float atravessa = pow(max(0.0, dot(rd, uSolDir)), 3.0);
  cor += vAlbedo * uSolCor * atravessa * 0.55;

  /* cáusticas no que está debaixo d'água */
  float submersoPonto = smoothstep(0.0, -1.4, vMundo.y - uAgua);
  cor += vAlbedo * uSolCor * causticas(vMundo.xz * 1.6, uTempo) * submersoPonto * uCausticas * 1.2;

  /* a luz que a vida guardou — cor de pavio, não de LED */
  float pulso = 0.62 + 0.38 * sin(uTempo * 1.7 + vDados.z * 37.0)
                     + 0.10 * sin(uTempo * 5.3 + vDados.z * 11.0);
  cor += vec3(1.0, 0.60, 0.26) * vDados.y * uBio * pulso * 0.85;

  cor = aplicarNeblina(cor, dist, rd, vMundo.y);
  cor = mix(cor * 0.15, cor, uDesvelo);

  gl_FragColor = vec4(cor, 1.0);
}
`;

/* --- flora: a coluna que era cacto e vira anêmona --------------------------- */

export const FLORA_VERT = /* glsl */ `
${CABECA}

attribute vec3 positionB;
attribute vec3 normalB;

void main(){
  float s = hash11(iSemente * 1.7);

  /* cada indivíduo cede ao mar no seu próprio tempo */
  float m = clamp((uCoral - s * 0.42) / 0.58, 0.0, 1.0);
  m = m * m * (3.0 - 2.0 * m);

  vec3 p = mix(position, positionB, m);
  vec3 n = versor(mix(normal, normalB, m));

  /* corais crescem — devagar, e nunca voltam ao tamanho anterior */
  float crescimento = mix(0.82, 1.14, m);
  vec3 esc = max(vec3(iEscala.x, iEscala.y * crescimento, iEscala.x), vec3(1e-3));
  p *= esc;
  n = versor(n / esc);

  /* respiração: quase imperceptível, e por isso mesmo necessária */
  float respiro = sin(uTempo * 0.5 + iSemente * 11.0);
  p.xz *= 1.0 + respiro * 0.018 * (0.35 + m);

  mat3 R = giroY(s * 6.28318);
  p = R * p;
  n = R * n;

  /* o vento muda de direção */
  float faseVento = uTempo * 0.28 + iPos.x * 0.02 + iPos.y * 0.013;
  vec2 vento = vec2(sin(faseVento), cos(faseVento * 0.63));
  float alcance = pow(clamp(p.y / max(iEscala.y, 0.01), 0.0, 1.0), 2.1);
  p.xz += vento * alcance * iEscala.y * (0.028 + 0.11 * m);

  p *= aparicao(iPos, 3.0, 340.0);

  float h = alturaTerreno(iPos);
  vec3 mundo = vec3(iPos.x + p.x, h + p.y - 0.10, iPos.y + p.z);

  vec3 seco = mix(vec3(0.070, 0.098, 0.046), vec3(0.145, 0.158, 0.066), s);
  vec3 marinho = uCoralCor * (0.62 + 0.85 * hash11(iSemente + 3.1));
  vAlbedo = mix(seco, marinho, m);

  vNormal = n;
  vMundo = mundo;
  vDados = vec3(sombraDoSol(mundo), m * 0.30 * step(0.62, hash11(iSemente + 8.0)), iSemente);

  gl_Position = projectionMatrix * viewMatrix * vec4(mundo, 1.0);
}
`;

/* --- fósseis: o animal que aprendeu a ter paciência -------------------------- */

export const FOSSIL_VERT = /* glsl */ `
${CABECA}

void main(){
  float s = hash11(iSemente * 2.3);
  vec3 p = position * iEscala.x;

  mat3 R = giroY(s * 6.28318);
  p = R * p;
  vec3 n = versor(R * normal);

  /* emergem do chão conforme a memória da água vai voltando */
  float emerge = smoothstep(0.0, 1.0, uFossil);
  float afundado = mix(-2.6 * iEscala.x, 0.05 * iEscala.x, emerge);

  /* as pedras respiram */
  float respiro = sin(uTempo * 0.32 + iSemente * 7.0) * 0.5 + 0.5;
  p *= 1.0 + respiro * 0.012;

  p *= step(hash11(iSemente * 4.1), clamp(0.25 + 0.9 * uFossil, 0.0, 1.0));
  p *= aparicao(iPos, 5.0, 320.0);

  float h = alturaTerreno(iPos);
  vec3 mundo = vec3(iPos.x + p.x, h + p.y + afundado, iPos.y + p.z);

  float calcario = 0.55 + 0.45 * hash11(iSemente + 1.9);
  vec3 osso = mix(vec3(0.155, 0.140, 0.115), vec3(0.275, 0.252, 0.212), calcario);
  vAlbedo = mix(osso, uCoralCor * 0.55, uCoral * 0.35);

  vNormal = n;
  vMundo = mundo;
  vDados = vec3(sombraDoSol(mundo), 0.07 * uCoral, iSemente);

  gl_Position = projectionMatrix * viewMatrix * vec4(mundo, 1.0);
}
`;

/* --- fauna: peixes onde deveriam existir pássaros --------------------------- */

export const FAUNA_VERT = /* glsl */ `
${CABECA}

attribute float aParte;   // 0 corpo · 1 barbatana · 2+ patas

void main(){
  float s = hash11(iSemente * 3.7);
  float fase = iSemente * 6.28318;
  float vel = 0.05 + 0.09 * s;

  vec3 p = position;

  /* o corpo ainda nada, mesmo sem água */
  float onda = sin(p.z * 3.1 - uTempo * 2.4 - fase);
  p.x += onda * 0.13 * (0.30 + p.z) * (1.0 - step(1.5, aParte));

  /* as patas remam no ar, num gesto que não serve para nada */
  if (aParte > 1.5){
    float r = uTempo * 3.2 + aParte * 340.0 + fase;
    p.z += sin(r) * 0.075;
    p.y += max(0.0, cos(r)) * 0.045;
  }

  p *= iEscala.x;

  /* deriva lenta em torno do próprio ponto */
  float raio = 5.0 + 9.0 * s;
  vec2 orbita = vec2(sin(uTempo * vel + fase), cos(uTempo * vel * 0.78 + fase * 1.3)) * raio;
  vec2 xz = iPos + orbita;

  /* aponta para onde vai */
  float rumo = atan(cos(uTempo * vel + fase), -sin(uTempo * vel * 0.78 + fase * 1.3));
  mat3 R = giroY(rumo);
  p = R * p;
  vec3 n = versor(R * normal);

  p *= step(hash11(iSemente * 6.7), clamp(uFauna, 0.0, 1.0));
  p *= aparicao(xz, 2.2, 220.0);

  float h = alturaTerreno(xz);
  float voo = iEscala.y + sin(uTempo * 0.34 + fase) * 0.9 + uContrafluxo * 3.0;
  vec3 mundo = vec3(xz.x + p.x, h + voo + p.y, xz.y + p.z);

  vec3 escamas = mix(vec3(0.050, 0.062, 0.072), vec3(0.115, 0.098, 0.074), s);
  vAlbedo = mix(escamas, uCoralCor * 0.5, uCoral * 0.4);
  vAlbedo = mix(vAlbedo, vAlbedo * 1.5 + 0.03, step(0.5, aParte) * step(aParte, 1.5));

  vNormal = n;
  vMundo = mundo;
  vDados = vec3(mix(0.6, 1.0, sombraDoSol(mundo)), 0.02, iSemente);

  gl_Position = projectionMatrix * viewMatrix * vec4(mundo, 1.0);
}
`;
