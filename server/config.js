/**
 * CONFIGURACIÓN
 *
 * Lee .env (si existe) y expone los ajustes del servidor. La clave de API nunca
 * se escribe en el código ni se envía al navegador.
 */

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const ENV = join(RAIZ, '.env');

if (existsSync(ENV) && typeof process.loadEnvFile === 'function') {
  try {
    process.loadEnvFile(ENV);
  } catch (err) {
    console.error('[config] .env ilegible:', err.message);
  }
}

export const CONFIG = {
  puerto: Number(process.env.PORT) || 3000,
  apiKey: process.env.ANTHROPIC_API_KEY?.trim() || '',

  // Modelo por defecto. Cámbialo en .env si quieres otro (p. ej. claude-sonnet-5-5).
  modelo: process.env.MISAIAL_MODELO?.trim() || 'claude-opus-5-5',

  // low | medium | high | xhigh | max — "low" mantiene la conversación ágil.
  esfuerzo: process.env.MISAIAL_ESFUERZO?.trim() || 'low',

  maxTokens: Number(process.env.MISAIAL_MAX_TOKENS) || 4000,

  raiz: RAIZ,
};
