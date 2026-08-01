import { UNIFORMES, RUIDO, TERRENO, ATMOSFERA, PROFUNDIDADE } from './comum.glsl.js';

/* O quadro ocupa a tela inteira e ignora a câmera: ele É a câmera. */
export const MUNDO_VERT = /* glsl */ `
void main(){
  gl_Position = vec4(position.xy, 1.0, 1.0);
}
`;

export const MUNDO_FRAG = /* glsl */ `
${UNIFORMES}
${RUIDO}
${TERRENO}
${ATMOSFERA}
${PROFUNDIDADE}

/* --- matéria do chão -------------------------------------------------------- */
vec3 materia(vec3 pos, vec3 n, float dist, out float rugosidade){
  float inclinacao = 1.0 - n.y;
  float acimaDagua = pos.y - uAgua;

  float veio = fbm2(pos.xz * 0.055, 4);
  vec3 albedo = mix(uAreia, uRocha, smoothstep(0.10, 0.52, inclinacao));
  albedo = mix(albedo, uRocha * 1.12, smoothstep(0.42, 0.72, veio) * 0.45);

  /* barro rachado — só onde secou, e só no plano */
  float escala = mix(1.4, 0.5, clamp(dist / 160.0, 0.0, 1.0));
  vec2 cel = celulas(pos.xz * escala);
  float fenda = smoothstep(0.085, 0.0, cel.y - cel.x);
  float placa = hash21(floor(pos.xz * escala));
  float seco = uFendas * smoothstep(0.34, 0.02, inclinacao) * smoothstep(-0.4, 1.6, acimaDagua);
  albedo *= 1.0 - fenda * 0.62 * seco;
  albedo *= 1.0 + (placa - 0.5) * 0.16 * seco;

  /* crosta de sal nas depressões: branco salino */
  float sal = smoothstep(1.1, -0.9, acimaDagua) * smoothstep(0.3, 0.02, inclinacao);
  albedo = mix(albedo, vec3(0.74, 0.72, 0.68), sal * 0.5 * uFendas);

  /* corais crescendo sobre pedra seca */
  float manchaBase = fbm2(pos.xz * 0.085 + 31.0, 4);
  vec2 tecido = celulas(pos.xz * 2.6 + 7.0);
  float poros = smoothstep(0.42, 0.02, tecido.y - tecido.x);
  float mancha = smoothstep(0.50, 0.80, manchaBase) * uCoral;
  albedo = mix(albedo, uCoralCor * (0.75 + 0.55 * poros), mancha * 0.85);

  /* fundo oceânico lembrado: marcas de maré escurecendo os sulcos */
  float sulco = sin(pos.x * 0.15 + pos.z * 0.04) * 0.5 + 0.5;
  albedo *= 1.0 - sulco * 0.10 * uMarulho;

  rugosidade = mix(0.92, 0.55, mancha) * mix(1.0, 0.7, sal);
  return albedo;
}

/* --- ondulação da superfície ------------------------------------------------ */
float ondas(vec2 w){
  /* o contrafluxo alonga as ondas na vertical: a água deixando de obedecer */
  vec2 a = mix(vec2(1.0, 1.0), vec2(0.35, 2.4), uContrafluxo);
  float h = fbm2(w * 0.22 * a + vec2(uTempo * 0.045, -uTempo * 0.02 - uContrafluxo * uTempo * 0.22), 3);
  h += fbm2(w * 0.85 * a - vec2(uTempo * 0.10, uTempo * 0.055 + uContrafluxo * uTempo * 0.5), 2) * 0.45;
  return h;
}

void main(){
  vec2 uv = (gl_FragCoord.xy - 0.5 * uResolucao) / uResolucao.y;
  vec3 rd = normalize(uCamDireita * (uv.x * 2.0 * uTanFov)
                    + uCamCima    * (uv.y * 2.0 * uTanFov)
                    + uCamFrente);

  float teto = tetoTerreno();
  float tTerreno = -1.0;

  bool podeAcertar = !(uCamPos.y > teto && rd.y > 0.001);
  if (podeAcertar){
    float t = 0.06;
    float anterior = t;
    for (int i = 0; i < 220; i++){
      if (float(i) >= uPassos) break;
      vec3 p = uCamPos + rd * t;
      if (p.y > teto && rd.y > 0.0) break;
      float h = p.y - alturaBaixa(p.xz);
      if (h < 0.0022 * t){ tTerreno = t; break; }
      anterior = t;
      t += max(0.05, h * 0.6) * (1.0 + t * 0.010);
      if (t > 1500.0) break;
    }
    /* três bisseções: a silhueta contra o céu precisa ser limpa */
    if (tTerreno > 0.0){
      float lo = anterior, hi = tTerreno;
      for (int k = 0; k < 3; k++){
        float m = 0.5 * (lo + hi);
        vec3 q = uCamPos + rd * m;
        if (q.y - alturaBaixa(q.xz) < 0.0) hi = m; else lo = m;
      }
      tTerreno = hi;
    }
  }

  vec3 cor;
  vec3 posTerreno = vec3(0.0);
  float distVisivel = 1e4;

  if (tTerreno > 0.0){
    posTerreno = uCamPos + rd * tTerreno;
    vec3 n = normalTerreno(posTerreno.xz, tTerreno);
    float rug;
    vec3 albedo = materia(posTerreno, n, tTerreno, rug);

    float sombra = sombraDoSol(posTerreno);
    float alturaVizinha = alturaBaixa(posTerreno.xz + n.xz * 1.8);
    float oclusao = clamp(1.0 - 1.1 * max(0.0, alturaVizinha - (posTerreno.y + n.y * 1.8)), 0.3, 1.0);

    cor = iluminar(n, albedo, sombra, oclusao, rd);

    /* cáusticas no que está submerso */
    float submersoPonto = smoothstep(0.0, -1.6, posTerreno.y - uAgua);
    cor += albedo * uSolCor * causticas(posTerreno.xz, uTempo) * submersoPonto * uCausticas * 1.5;

    /* bioluminescência: colônias acendendo no ritmo delas */
    if (uBio > 0.001){
      vec2 col = celulas(posTerreno.xz * 0.42 + 4.0);
      float nucleo = smoothstep(0.2, 0.0, col.x);
      float pulso = 0.45 + 0.55 * sin(uTempo * 0.55 + hash21(floor(posTerreno.xz * 0.42)) * 42.0);
      float onde = smoothstep(0.38, 0.72, fbm2(posTerreno.xz * 0.07 + 19.0, 3));
      cor += vec3(0.16, 0.92, 0.86) * nucleo * pulso * onde * uBio * 1.9;
    }

    cor = aplicarNeblina(cor, tTerreno, rd, posTerreno.y);
    distVisivel = tTerreno;
  } else {
    cor = ceu(rd);
    distVisivel = 1e4;
  }

  /* --- a água ---------------------------------------------------------------- */
  float tAgua = -1.0;
  float denom = rd.y;
  if (abs(denom) > 1e-5){
    float d = (uAgua - uCamPos.y) / denom;
    if (d > 0.05) tAgua = d;
  }

  if (tAgua > 0.0 && (tTerreno < 0.0 || tAgua < tTerreno)){
    vec3 pw = uCamPos + rd * tAgua;
    float escala = 1.0 / (1.0 + tAgua * 0.012);
    float e = 0.9;
    float h0 = ondas(pw.xz);
    float hx = ondas(pw.xz + vec2(e, 0.0));
    float hz = ondas(pw.xz + vec2(0.0, e));
    vec3 nw = normalize(vec3((h0 - hx) * escala * 2.2, e * 0.42, (h0 - hz) * escala * 2.2));
    if (uCamPos.y < uAgua) nw = -nw;

    vec3 refl = ceu(reflect(rd, nw));
    float fres = pow(1.0 - max(0.0, dot(-rd, nw)), 4.0);
    fres = mix(0.035, 1.0, fres);

    /* o fundo, filtrado pela coluna de água */
    float profundidade = max(0.0, (tTerreno > 0.0 ? tTerreno : tAgua + 60.0) - tAgua);
    vec3 absorcao = exp(-profundidade * (vec3(0.42, 0.16, 0.11) * 0.22 + 0.004));
    vec3 fundo = cor * absorcao;
    fundo = mix(fundo, uAguaCor, 1.0 - exp(-profundidade * 0.055));

    vec3 agua = mix(fundo, refl, fres);

    /* brilho especular do sol sobre a lâmina */
    float esp = pow(max(0.0, dot(reflect(rd, nw), uSolDir)), 320.0);
    agua += uSolCor * esp * 2.6 * (1.0 - uSubmerso);

    /* a areia virando espuma na linha onde os dois mundos se encostam */
    float leito = alturaBaixa(pw.xz);
    float beira = smoothstep(0.55, 0.0, abs(leito - uAgua));
    float renda = smoothstep(0.45, 0.85, fbm2(pw.xz * 1.5 + vec2(uTempo * 0.12, -uTempo * 0.08), 3));
    agua = mix(agua, vec3(0.86, 0.86, 0.83), beira * renda * 0.75);

    agua = aplicarNeblina(agua, tAgua, rd, pw.y);
    cor = agua;
    distVisivel = tAgua;
  }

  /* o desvelo: no primeiro instante o quadro ainda está sob o pano */
  cor = mix(cor * 0.15, cor, uDesvelo);

  gl_FragColor = vec4(cor, 1.0);
  gl_FragDepth = (distVisivel > 9000.0) ? 0.999995 : profundidadeDe(distVisivel, rd);
}
`;
