import { env } from '../../config/env.js';

export interface FiscalEmissionResult {
  status: 'PROCESSING' | 'AUTHORIZED' | 'REJECTED';
  accessKey?: string;
  number?: string;
  series?: string;
  danfeUrl?: string;
  xmlUrl?: string;
  error?: string;
}

/**
 * Abstração do emissor fiscal: o serviço fala só com esta interface. O
 * provider real (Focus NFe) hospeda o certificado A1 e conversa com a SEFAZ;
 * o mock autoriza na hora para desenvolvimento/demonstração.
 */
export interface FiscalProvider {
  readonly name: string;
  emit(kind: 'nfe' | 'nfce', ref: string, payload: unknown): Promise<FiscalEmissionResult>;
  status(kind: 'nfe' | 'nfce', ref: string): Promise<FiscalEmissionResult>;
}

class MockFiscalProvider implements FiscalProvider {
  readonly name = 'mock';

  async emit(kind: 'nfe' | 'nfce', ref: string): Promise<FiscalEmissionResult> {
    // Chave fictícia estável por ref (44 dígitos) — inequivocamente de teste.
    const digits = `${ref}${kind}`.split('').map((c) => c.charCodeAt(0) % 10).join('');
    const accessKey = `9999${digits}`.padEnd(44, '0').slice(0, 44);
    return { status: 'AUTHORIZED', accessKey, number: String(Math.abs(hash(ref)) % 100000), series: '1' };
  }

  async status(): Promise<FiscalEmissionResult> {
    return { status: 'AUTHORIZED' };
  }
}

function hash(s: string): number {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0;
  return h;
}

/** Focus NFe (https://focusnfe.com.br): API agregadora que fala com a SEFAZ. */
class FocusNfeProvider implements FiscalProvider {
  readonly name = 'focusnfe';

  private get base() {
    return env.FISCAL_ENV === 'producao'
      ? 'https://api.focusnfe.com.br'
      : 'https://homologacao.focusnfe.com.br';
  }

  private get auth() {
    return `Basic ${Buffer.from(`${env.FOCUS_NFE_TOKEN}:`).toString('base64')}`;
  }

  private map(data: Record<string, unknown>): FiscalEmissionResult {
    const st = String(data.status ?? '');
    if (st === 'autorizado') {
      return {
        status: 'AUTHORIZED',
        accessKey: data.chave_nfe ? String(data.chave_nfe).replace(/^NFe/, '') : undefined,
        number: data.numero ? String(data.numero) : undefined,
        series: data.serie ? String(data.serie) : undefined,
        danfeUrl: data.caminho_danfe ? `${this.base}${data.caminho_danfe}` : undefined,
        xmlUrl: data.caminho_xml_nota_fiscal ? `${this.base}${data.caminho_xml_nota_fiscal}` : undefined,
      };
    }
    if (st === 'erro_autorizacao' || st === 'denegado') {
      return { status: 'REJECTED', error: String(data.mensagem_sefaz ?? data.mensagem ?? st) };
    }
    return { status: 'PROCESSING' };
  }

  async emit(kind: 'nfe' | 'nfce', ref: string, payload: unknown): Promise<FiscalEmissionResult> {
    const res = await fetch(`${this.base}/v2/${kind}?ref=${encodeURIComponent(ref)}`, {
      method: 'POST',
      headers: { Authorization: this.auth, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok && res.status !== 422) {
      return { status: 'REJECTED', error: `Focus NFe HTTP ${res.status}: ${JSON.stringify(data).slice(0, 200)}` };
    }
    return this.map(data);
  }

  async status(kind: 'nfe' | 'nfce', ref: string): Promise<FiscalEmissionResult> {
    const res = await fetch(`${this.base}/v2/${kind}/${encodeURIComponent(ref)}`, {
      headers: { Authorization: this.auth },
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return this.map(data);
  }
}

let provider: FiscalProvider | null = null;

export function getFiscalProvider(): FiscalProvider {
  if (!provider) provider = env.FISCAL_PROVIDER === 'focusnfe' ? new FocusNfeProvider() : new MockFiscalProvider();
  return provider;
}
