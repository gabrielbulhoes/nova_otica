/* ---------------------------------------------------------------------------
   Paisagem sonora generativa.

   Não há música. Há vento, ondas, insetos, pedra e o silêncio embaixo d'água —
   e a proporção entre eles muda com o mundo. Nada toca em loop reconhecível:
   tudo é ruído filtrado e eventos sorteados, para que o ouvido nunca preveja.
   --------------------------------------------------------------------------- */

export class Paisagem {
  constructor() {
    this.ctx = null;
    this.ligado = false;
    this.proximoInseto = 0;
    this.proximaPedra = 0;
    this.estado = { agua: 0, plancton: 0, bio: 0, submerso: 0, contrafluxo: 0 };
  }

  get disponivel() {
    return typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
  }

  montar() {
    const AC = window.AudioContext || window.webkitAudioContext;
    const ctx = new AC();
    this.ctx = ctx;

    this.mestre = ctx.createGain();
    this.mestre.gain.value = 0;
    this.mestre.connect(ctx.destination);

    // um pouco de sala: a galeria tem paredes
    const conv = ctx.createConvolver();
    conv.buffer = this.reverberacao(2.6);
    const envio = ctx.createGain();
    envio.gain.value = 0.28;
    conv.connect(this.mestre);
    envio.connect(conv);
    this.envio = envio;

    const ruido = this.ruidoRosa();

    // vento — banda estreita varrendo devagar
    this.vento = this.cadeia(ruido, 'bandpass', 520, 0.9, 0.0);
    this.ventoLfo = this.oscilacao(0.035, 260, this.vento.filtro.frequency);

    // ondas — grave, com maré própria
    this.ondas = this.cadeia(ruido, 'lowpass', 380, 0.7, 0.0);
    this.ondasLfo = this.oscilacao(0.055, 0.55, this.ondas.ganho.gain, 0.55);

    // submerso — quase tudo cortado, e uma pressão no peito
    this.fundo = this.cadeia(ruido, 'lowpass', 150, 3.0, 0.0);

    // pedra — duas senoides muito baixas, batendo entre si
    this.pedra = ctx.createGain();
    this.pedra.gain.value = 0;
    this.pedra.connect(this.mestre);
    this.pedra.connect(envio);
    [43.5, 65.0].forEach((f, i) => {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.value = i ? 0.5 : 1.0;
      o.connect(g).connect(this.pedra);
      o.start();
      const det = ctx.createOscillator();
      det.frequency.value = 0.021 + i * 0.013;
      const dg = ctx.createGain();
      dg.gain.value = 0.7;
      det.connect(dg).connect(o.frequency);
      det.start();
    });

    this.ligado = true;
  }

  ruidoRosa() {
    const ctx = this.ctx;
    const segundos = 6;
    const buf = ctx.createBuffer(1, ctx.sampleRate * segundos, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < d.length; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.016898;
      d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
      b6 = w * 0.115926;
    }
    const fonte = ctx.createBufferSource();
    fonte.buffer = buf;
    fonte.loop = true;
    fonte.start();
    return fonte;
  }

  reverberacao(segundos) {
    const ctx = this.ctx;
    const n = Math.floor(ctx.sampleRate * segundos);
    const buf = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < n; i++) {
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 3.2);
      }
    }
    return buf;
  }

  cadeia(fonte, tipo, freq, q, ganhoInicial) {
    const ctx = this.ctx;
    const filtro = ctx.createBiquadFilter();
    filtro.type = tipo;
    filtro.frequency.value = freq;
    filtro.Q.value = q;
    const ganho = ctx.createGain();
    ganho.gain.value = ganhoInicial;
    fonte.connect(filtro).connect(ganho);
    ganho.connect(this.mestre);
    ganho.connect(this.envio);
    return { filtro, ganho };
  }

  oscilacao(freq, amplitude, alvo, base = 0) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.value = amplitude;
    o.connect(g);
    g.connect(alvo);
    o.start();
    if (base) alvo.value = base;
    return o;
  }

  /** Um inseto. Ou o que restou de um, num mundo em que o mar voltou. */
  inseto(quando) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'square';
    const base = 2400 + Math.random() * 3200;
    o.frequency.setValueAtTime(base, quando);
    o.frequency.linearRampToValueAtTime(base * 0.82, quando + 0.09);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, quando);
    g.gain.linearRampToValueAtTime(0.006 + Math.random() * 0.008, quando + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, quando + 0.11);
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = base;
    f.Q.value = 12;
    o.connect(f).connect(g);
    g.connect(this.mestre);
    g.connect(this.envio);
    o.start(quando);
    o.stop(quando + 0.16);
  }

  /** Uma pedra assentando. Embaixo d'água vira um estalo distante. */
  pedraSolta(quando, molhado) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'sine';
    const f0 = molhado ? 320 : 120;
    o.frequency.setValueAtTime(f0, quando);
    o.frequency.exponentialRampToValueAtTime(f0 * 0.35, quando + 0.35);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, quando);
    g.gain.linearRampToValueAtTime(molhado ? 0.03 : 0.05, quando + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, quando + (molhado ? 0.5 : 0.9));
    o.connect(g);
    g.connect(this.mestre);
    g.connect(this.envio);
    o.start(quando);
    o.stop(quando + 1.0);
  }

  async alternar() {
    if (!this.ligado) {
      if (!this.disponivel) return false;
      this.montar();
    }
    const ctx = this.ctx;
    if (ctx.state === 'suspended') await ctx.resume();

    const agora = ctx.currentTime;
    const alvo = this.mestre.gain.value > 0.01 ? 0 : 0.85;
    this.mestre.gain.cancelScheduledValues(agora);
    this.mestre.gain.setValueAtTime(this.mestre.gain.value, agora);
    this.mestre.gain.linearRampToValueAtTime(alvo, agora + (alvo ? 4.5 : 1.6));
    return alvo > 0;
  }

  atualizar(e) {
    if (!this.ligado || this.mestre.gain.value < 0.005) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const suave = (param, valor) => {
      param.setTargetAtTime(valor, t, 0.9);
    };

    const seco = 1 - Math.min(1, Math.max(0, e.plancton));
    const sub = e.submerso;

    suave(this.vento.ganho.gain, 0.16 * seco * (1 - sub) + 0.02);
    suave(this.ondas.ganho.gain, 0.22 * (1 - seco) * (1 - sub * 0.6) + 0.03);
    suave(this.fundo.ganho.gain, 0.34 * sub);
    suave(this.pedra.gain, 0.05 + 0.09 * e.bio + 0.05 * e.contrafluxo);
    suave(this.vento.filtro.Q, 0.9 + 3.0 * e.contrafluxo);

    // eventos: insetos só no seco, pedras sempre — cada vez mais raras
    if (t > this.proximoInseto) {
      if (seco > 0.35 && sub < 0.3 && Math.random() < 0.55) this.inseto(t + Math.random() * 0.4);
      this.proximoInseto = t + 0.5 + Math.random() * 3.2;
    }
    if (t > this.proximaPedra) {
      if (Math.random() < 0.4) this.pedraSolta(t + Math.random() * 1.2, sub > 0.4 || seco < 0.4);
      this.proximaPedra = t + 4 + Math.random() * 12;
    }
  }
}
