/* ---------------------------------------------------------------------------
   Pós-processamento — o verniz.

   Aqui a imagem deixa de ser um render e passa a ser uma pintura: a lente
   respira (profundidade de campo), a luz sangra (bloom), o pigmento tem grão,
   a tela tem trama, e as bordas escurecem como num quadro antigo.
   --------------------------------------------------------------------------- */

export const QUADRO_VERT = /* glsl */ `
varying vec2 vUv;
void main(){
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

export const BRILHO_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D tCena;
uniform vec2 uPasso;
uniform float uLimiar;
varying vec2 vUv;

void main(){
  vec3 s = vec3(0.0);
  s += texture2D(tCena, vUv + uPasso * vec2(-1.0, -1.0)).rgb;
  s += texture2D(tCena, vUv + uPasso * vec2( 1.0, -1.0)).rgb;
  s += texture2D(tCena, vUv + uPasso * vec2(-1.0,  1.0)).rgb;
  s += texture2D(tCena, vUv + uPasso * vec2( 1.0,  1.0)).rgb;
  s *= 0.25;

  float lum = dot(s, vec3(0.2126, 0.7152, 0.0722));
  float peso = max(0.0, lum - uLimiar) / max(lum, 1e-4);
  gl_FragColor = vec4(s * peso, 1.0);
}
`;

export const BORRAO_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D tCena;
uniform vec2 uDirecao;
varying vec2 vUv;

void main(){
  /* gaussiana de 9 taps em amostragem linear */
  vec3 s = texture2D(tCena, vUv).rgb * 0.2270270270;
  s += texture2D(tCena, vUv + uDirecao * 1.3846153846).rgb * 0.3162162162;
  s += texture2D(tCena, vUv - uDirecao * 1.3846153846).rgb * 0.3162162162;
  s += texture2D(tCena, vUv + uDirecao * 3.2307692308).rgb * 0.0702702703;
  s += texture2D(tCena, vUv - uDirecao * 3.2307692308).rgb * 0.0702702703;
  gl_FragColor = vec4(s, 1.0);
}
`;

export const REDUZIR_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D tCena;
uniform vec2 uPasso;
varying vec2 vUv;
void main(){
  vec3 s = texture2D(tCena, vUv + uPasso * vec2(-1.0, -1.0)).rgb;
  s += texture2D(tCena, vUv + uPasso * vec2( 1.0, -1.0)).rgb;
  s += texture2D(tCena, vUv + uPasso * vec2(-1.0,  1.0)).rgb;
  s += texture2D(tCena, vUv + uPasso * vec2( 1.0,  1.0)).rgb;
  gl_FragColor = vec4(s * 0.25, 1.0);
}
`;

export const COMPOSICAO_FRAG = /* glsl */ `
precision highp float;

uniform sampler2D tCena;
uniform sampler2D tProfundidade;
uniform sampler2D tBrilho1;
uniform sampler2D tBrilho2;
uniform sampler2D tBrilho3;

uniform vec2  uResolucao;
uniform float uTempo;
uniform float uPerto;
uniform float uLonge;
uniform float uPlanoFoco;
uniform float uAbertura;
uniform float uExposicao;
uniform float uDesvelo;
uniform float uSubmerso;
uniform float uContrafluxo;
uniform vec3  uNeblinaCor;
uniform vec3  uAguaCor;

varying vec2 vUv;

float profundidadeLinear(float d){
  float ndc = d * 2.0 - 1.0;
  return (2.0 * uPerto * uLonge) / (uLonge + uPerto - ndc * (uLonge - uPerto));
}

/* ACES aproximado — contraste de cinema sem estourar os ocres */
vec3 aces(vec3 x){
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

float ruidoBranco(vec2 p){
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

void main(){
  vec2 uv = vUv;
  vec2 centro = uv - 0.5;
  float raio2 = dot(centro, centro);


  /* --- aberração cromática: mínima, só nas bordas ------------------------- */
  float desvio = (0.0016 + 0.004 * uSubmerso) * raio2;

  /* --- profundidade de campo -------------------------------------------- */
  float z = profundidadeLinear(texture2D(tProfundidade, uv).x);
  /* círculo de confusão simétrico e limitado: o primeiro plano desfoca, mas
     não vira papa */
  float coc = abs(z - uPlanoFoco) / max(z + uPlanoFoco, 0.001);
  coc = clamp(coc * uAbertura, 0.0, 1.0);
  coc = pow(coc, 1.15);
  float raioPx = coc * 9.0;

  vec3 cor = vec3(0.0);
  float peso = 0.0;
  const float DOURADO = 2.39996323;
  for (int i = 0; i < 14; i++){
    float fi = float(i);
    float r = sqrt((fi + 0.5) / 14.0) * raioPx;
    float a = fi * DOURADO + uTempo * 0.05;
    vec2 amostra = uv + vec2(cos(a), sin(a)) * r / uResolucao;
    vec3 c = texture2D(tCena, amostra).rgb;
    /* pesa mais o que está desfocado do que o que está nítido: evita halo */
    float zi = profundidadeLinear(texture2D(tProfundidade, amostra).x);
    float w = (zi > z - 1.0) ? 1.0 : 0.35;
    cor += c * w;
    peso += w;
  }
  cor /= max(peso, 1e-4);

  /* franja cromática aplicada sobre o resultado já borrado */
  vec3 fringe;
  fringe.r = texture2D(tCena, uv + centro * desvio).r;
  fringe.g = cor.g;
  fringe.b = texture2D(tCena, uv - centro * desvio).b;
  cor = mix(cor, vec3(fringe.r, cor.g, fringe.b), 0.55);

  /* --- bloom: a luz sangrando ------------------------------------------- */
  vec3 sangue = texture2D(tBrilho1, uv).rgb * 0.42
              + texture2D(tBrilho2, uv).rgb * 0.30
              + texture2D(tBrilho3, uv).rgb * 0.26;
  cor += sangue * 0.30;

  /* --- verniz ------------------------------------------------------------ */
  cor *= uExposicao;
  cor = aces(cor * 1.05);

  /* a pintura precisa de decisão: um pouco mais de cor e um pouco mais de
     distância entre a luz e a sombra */
  float lum = dot(cor, vec3(0.2126, 0.7152, 0.0722));
  cor = clamp(mix(vec3(lum), cor, 1.05), 0.0, 1.0);
  cor = clamp((cor - 0.5) * 1.08 + 0.5, 0.0, 1.0);

  /* trama do linho: baixíssima, mas o olho sabe que está lá */
  float trama = sin(uv.x * uResolucao.x * 1.4) * sin(uv.y * uResolucao.y * 1.4);
  cor *= 1.0 + trama * 0.012;

  /* grão de pigmento */
  float grao = ruidoBranco(uv * uResolucao + fract(uTempo) * 431.0) - 0.5;
  cor += grao * 0.015 * (1.0 - 0.6 * dot(cor, vec3(0.333)));

  /* sombra de galeria nas bordas */
  float vinheta = smoothstep(0.98, 0.22, raio2 * 1.9);
  cor *= mix(0.60, 1.0, vinheta);

  /* a água puxando tudo para o próprio tom */
  cor = mix(cor, cor * (uAguaCor * 2.0 + 0.15), uSubmerso * 0.45);

  /* correção de gama — a tela é linear, o olho não */
  cor = pow(max(cor, 0.0), vec3(1.0 / 2.2));

  /* o pano ainda cobrindo o quadro */
  cor *= smoothstep(0.0, 1.0, uDesvelo);

  gl_FragColor = vec4(cor, 1.0);
}
`;
