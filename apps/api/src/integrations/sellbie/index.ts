import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';
import { SellbieHttpClient } from './httpClient.js';
import { SellbieMockClient } from './mockClient.js';
import type { SellbieClient } from './types.js';

let instance: SellbieClient | null = null;

/** Retorna o cliente Sellbie conforme SELLBIE_MODE (mock | live). */
export function getSellbieClient(): SellbieClient {
  if (!instance) {
    instance = env.SELLBIE_MODE === 'live' ? new SellbieHttpClient() : new SellbieMockClient();
    logger.info('Cliente Sellbie inicializado', { mode: env.SELLBIE_MODE });
  }
  return instance;
}

export * from './types.js';
export { checkWindow, assertWindow, WindowClosedError } from './window.js';
