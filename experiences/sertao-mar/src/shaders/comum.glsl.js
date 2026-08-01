/* ---------------------------------------------------------------------------
   Vocabulário comum a todos os passes.

   O terreno é definido uma única vez, em GLSL, e é avaliado tanto pelo
   raymarch quanto pelos vertex shaders das malhas instanciadas. Assim nada
   flutua e nada afunda: a flora nasce exatamente do chão que a câmera vê.
   --------------------------------------------------------------------------- */

export const UNIFORMES = /* glsl */ `
uniform vec2  uResolucao;
uniform float uTempo;

uniform vec3  uCamPos;
uniform vec3  uCamFrente;
uniform vec3  uCamDireita;
uniform vec3  uCamCima;
uniform float uTanFov;
uniform mat4  uProj;

uniform float uAgua;
uniform float uAmplitude;
uniform float uFrequencia;
uniform float uFendas;
uniform float uMarulho;
uniform float uCoral;
uniform float uFossil;
uniform float uFauna;
uniform float uNeblina;
uniform float uBio;
uniform float uCausticas;
uniform float uPlancton;
uniform float uContrafluxo;
uniform float uExposicao;
uniform float uSubmerso;
uniform float uPassos;
uniform float uDesvelo;

uniform vec3  uSolDir;
uniform vec3  uSolCor;
uniform vec3  uCeuAlto;
uniform vec3  uCeuHorizonte;
uniform vec3  uNeblinaCor;
uniform vec3  uAreia;
uniform vec3  uRocha;
uniform vec3  uCoralCor;
uniform vec3  uAguaCor;
`;

export const RUIDO = /* glsl */ `
float hash11(float p){ p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }

float hash21(vec2 p){
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec2 hash22(vec2 p){
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}

vec3 hash31(float p){
  vec3 p3 = fract(vec3(p) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xxy + p3.yzz) * p3.zyx);
}

float ruido2(vec2 p){
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float ruido3(vec3 p){
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  vec2 uv = i.xy + vec2(37.0, 17.0) * i.z + f.xy;
  float a = hash21(uv);
  float b = hash21(uv + vec2(37.0, 17.0));
  return mix(a, b, f.z);
}

const mat2 GIRO = mat2(0.80, 0.60, -0.60, 0.80);

float fbm2(vec2 p, int oitavas){
  float s = 0.0, amp = 0.5, norma = 0.0;
  for (int i = 0; i < 8; i++){
    if (i >= oitavas) break;
    s += amp * ruido2(p);
    norma += amp;
    amp *= 0.5;
    p = GIRO * p * 2.03;
  }
  return s / max(norma, 1e-4);
}

float fbm3(vec3 p, int oitavas){
  float s = 0.0, amp = 0.5, norma = 0.0;
  for (int i = 0; i < 6; i++){
    if (i >= oitavas) break;
    s += amp * ruido3(p);
    norma += amp;
    amp *= 0.5;
    p *= 2.07;
  }
  return s / max(norma, 1e-4);
}

/* Células — usado para as fendas do barro rachado e para o tecido do coral. */
vec2 celulas(vec2 p){
  vec2 n = floor(p);
  vec2 f = fract(p);
  float d1 = 8.0, d2 = 8.0;
  for (int j = -1; j <= 1; j++){
    for (int i = -1; i <= 1; i++){
      vec2 g = vec2(float(i), float(j));
      vec2 o = hash22(n + g);
      float d = length(g + o - f);
      if (d < d1){ d2 = d1; d1 = d; }
      else if (d < d2){ d2 = d; }
    }
  }
  return vec2(d1, d2);
}
`;

/* --------------------------------------------------------------------------- */

export const TERRENO = /* glsl */ `
/* Perfil grosso: o que o raio percorre. Barato de propósito.

   A geografia tem três decisões:
   · um corredor rebaixado, por onde o olhar caminha — daí a sensação de vale;
   · serras erguidas dos dois lados, que dão silhueta contra o céu;
   · e a borda do mundo, que afunda até abaixo da linha da água. É por isso que
     existe sempre mar no horizonte, de qualquer ponto do percurso. */
float alturaBaixa(vec2 p){
  vec2 q = p * (0.0072 * uFrequencia);

  float base = fbm2(q, 3);
  base = pow(clamp(base, 0.0, 1.0), 1.5);

  float cr = fbm2(q * 0.44 + 17.0, 3);
  float cristas = 1.0 - abs(cr * 2.0 - 1.0);
  cristas = pow(clamp(cristas, 0.0, 1.0), 2.7);

  /* o corredor: perto do eixo do percurso o relevo se aplaina */
  float corredor = smoothstep(14.0, 100.0, abs(p.x));
  /* e as serras param antes da beira, para não taparem o mar */
  float serra = corredor * (1.0 - smoothstep(100.0, 158.0, abs(p.x)));

  float alt = (base - 0.30) * uAmplitude * mix(0.22, 1.0, corredor);
  alt += cristas * uAmplitude * 1.45 * serra;

  /* o leito seco que um dia foi rio — ou canal, ou fenda */
  float eixo = p.x + sin(p.y * 0.006) * 7.0;
  alt -= exp(-pow(abs(eixo) * 0.032, 2.0)) * (2.1 + 1.2 * uMarulho);

  /* marcas de maré: o fundo do oceano lembrando o que era */
  alt += sin(p.x * 0.15 + p.y * 0.04) * cos(p.y * 0.105) * 0.36 * uMarulho;

  /* a borda do mundo desce até o mar */
  float borda = length(vec2(p.x * 0.9, min(0.0, p.y + 470.0)));
  alt -= smoothstep(120.0, 330.0, borda) * (30.0 + 9.0 * uMarulho);

  return alt;
}

/* Perfil fino: só no ponto de impacto, para normal e matéria. */
float alturaTerreno(vec2 p){
  float alt = alturaBaixa(p);
  vec2 q = p * (0.0072 * uFrequencia);
  alt += (fbm2(GIRO * q * 11.0, 3) - 0.5) * uAmplitude * 0.11;
  alt += (ruido2(p * 1.35) - 0.5) * 0.075;
  return alt;
}

vec3 normalTerreno(vec2 p, float dist){
  float e = clamp(0.012 * dist, 0.02, 1.4);
  float h  = alturaTerreno(p);
  float hx = alturaTerreno(p + vec2(e, 0.0));
  float hz = alturaTerreno(p + vec2(0.0, e));
  return normalize(vec3(h - hx, e, h - hz));
}

float tetoTerreno(){
  return uAmplitude * 2.25 + 3.0;
}

/* Sombra projetada pelo próprio relevo — o sol raso do sertão é implacável. */
float sombraDoSol(vec3 p){
  float res = 1.0;
  float t = 0.9;
  float teto = tetoTerreno();
  for (int i = 0; i < 18; i++){
    vec3 q = p + uSolDir * t;
    if (q.y > teto) break;
    float h = q.y - alturaBaixa(q.xz);
    res = min(res, 7.5 * h / t);
    if (res < 0.03) break;
    t += clamp(h * 0.85, 0.45, 11.0);
    if (t > 110.0) break;
  }
  return clamp(res, 0.0, 1.0);
}
`;

/* --------------------------------------------------------------------------- */

export const ATMOSFERA = /* glsl */ `
vec3 ceu(vec3 rd){
  float h = clamp(rd.y * 0.5 + 0.5, 0.0, 1.0);
  vec3 c = mix(uCeuHorizonte, uCeuAlto, pow(h, 0.62));

  float sol = max(0.0, dot(rd, uSolDir));
  c += uSolCor * pow(sol, 1400.0) * 4.2;
  c += uSolCor * pow(sol, 22.0) * 0.20;
  c += uSolCor * pow(sol, 3.0) * 0.035;

  /* bruma pousada sobre a linha do horizonte */
  c = mix(c, uNeblinaCor, pow(1.0 - abs(rd.y), 14.0) * 0.35);

  /* nuvens finas, quase invisíveis, correndo devagar */
  float cobertura = smoothstep(0.02, 0.34, rd.y);
  vec2 cp = rd.xz / max(rd.y, 0.06) * 0.9 + vec2(uTempo * 0.004, uTempo * 0.0015);
  float n = fbm2(cp * 0.75, 4);
  float veu = smoothstep(0.55, 0.82, n) * cobertura * (0.18 - 0.15 * uBio);
  c = mix(c, mix(uNeblinaCor, uSolCor, 0.35) * 1.15, veu);

  return c;
}

/* Corpo de água entre o olho e a superfície: absorve, esfria, some. */
vec3 aplicarNeblina(vec3 cor, float dist, vec3 rd, float alturaPonto){
  /* a bruma é pesada: assenta no chão e deixa o céu limpo */
  float densidade = uNeblina * mix(1.0, 2.4, uSubmerso);
  float faixa = exp(-max(0.0, alturaPonto - uAgua) * 0.075);
  float f = 1.0 - exp(-dist * densidade * mix(0.18, 1.0, faixa));

  float sol = max(0.0, dot(rd, uSolDir));
  vec3 corNeblina = mix(uNeblinaCor, uSolCor, pow(sol, 7.0) * 0.32 * (1.0 - uSubmerso));
  corNeblina = mix(corNeblina, uAguaCor, uSubmerso);

  return mix(cor, corNeblina, clamp(f, 0.0, 1.0));
}

/* Cáusticas: a luz lembrando que atravessou água. */
float causticas(vec2 p, float t){
  vec2 q = p * 0.30;
  float a = sin(q.x * 1.7 + t * 0.55 + ruido2(q * 0.8) * 6.28);
  float b = sin(q.y * 1.4 - t * 0.42 + ruido2(q * 0.6 + 11.0) * 6.28);
  float c = sin((q.x + q.y) * 1.1 + t * 0.31);
  float v = (a * b + c * 0.5) * 0.5 + 0.5;
  return pow(clamp(v, 0.0, 1.0), 3.2);
}

/* Luz. Um sol e um céu, nada mais — como numa tela pintada com duas fontes. */
vec3 iluminar(vec3 normal, vec3 albedo, float sombra, float oclusao, vec3 rd){
  float difusa = max(0.0, dot(normal, uSolDir));
  float ceuLuz = clamp(0.5 + 0.5 * normal.y, 0.0, 1.0);
  float rebote = clamp(0.35 - 0.35 * normal.y, 0.0, 1.0);

  vec3 luz = uSolCor * difusa * sombra * 1.28;
  luz += mix(uCeuHorizonte, uCeuAlto, 0.62) * ceuLuz * 0.62;
  luz += uNeblinaCor * rebote * 0.18;

  vec3 cor = albedo * luz * oclusao;

  /* espalhamento rasante: a poeira em suspensão acendendo contra o sol */
  float rasante = pow(max(0.0, dot(rd, uSolDir)), 4.0);
  cor += uSolCor * rasante * 0.05 * sombra;
  return cor;
}
`;

export const PROFUNDIDADE = /* glsl */ `
/* Converte distância ao longo do raio em profundidade de tela, para que as
   malhas instanciadas convivam com o raymarch no mesmo buffer. */
float profundidadeDe(float dist, vec3 rd){
  float zVista = -dist * dot(rd, uCamFrente);
  float zClip = uProj[2][2] * zVista + uProj[3][2];
  float wClip = -zVista;
  return clamp((zClip / max(wClip, 1e-5)) * 0.5 + 0.5, 0.0, 1.0);
}
`;
