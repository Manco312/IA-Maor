/**
 * MOTOR DE INTELIGENCIA ARTIFICIAL
 *
 * Única pieza que habla con la API de Claude. El resto de la aplicación solo
 * conoce la función `responder()`, que emite fragmentos de texto.
 *
 * Si no hay credenciales configuradas, el motor entra en MODO ORÁCULO: la
 * aplicación sigue siendo plenamente jugable con las respuestas canónicas
 * escritas a mano, y las revelaciones de la subtrama se entregan igual.
 */

import Anthropic from '@anthropic-ai/sdk';
import { construirSistema } from './persona.js';
import { CONFIG } from './config.js';

let cliente = null;

export function motorActivo() {
  return Boolean(CONFIG.apiKey);
}

function obtenerCliente() {
  if (!cliente) {
    cliente = new Anthropic({ apiKey: CONFIG.apiKey, maxRetries: 2 });
  }
  return cliente;
}

/** Convierte el historial almacenado al formato de la API. */
function aMensajesApi(mensajes) {
  const salida = [];
  for (const m of mensajes) {
    const texto = (m.texto || '').trim();
    if (!texto) continue;
    salida.push({ role: m.rol === 'usuario' ? 'user' : 'assistant', content: texto });
  }
  // La API exige que el primer mensaje sea del usuario
  while (salida.length && salida[0].role === 'assistant') salida.shift();
  return salida;
}

/**
 * Genera la respuesta de MISAIAL.
 *
 * @param {object}   opts
 * @param {object}   opts.progreso        progreso narrativo del usuario
 * @param {Array}    opts.historial       mensajes previos de la conversación (sin el actual)
 * @param {string}   opts.mensaje         texto que acaba de enviar el usuario
 * @param {object?}  opts.preguntaActiva  pregunta especial en curso, si la hay
 * @param {function} opts.onTexto         callback por cada fragmento de texto
 * @returns {Promise<{texto:string, uso:object|null}>}
 */
export async function responder({
  progreso,
  historial,
  mensaje,
  preguntaActiva = null,
  onTexto,
}) {
  if (!motorActivo()) {
    return modoOraculo({ preguntaActiva, mensaje, onTexto });
  }

  const system = construirSistema(progreso, { preguntaActiva });
  const messages = [...aMensajesApi(historial), { role: 'user', content: mensaje }];

  const stream = obtenerCliente().messages.stream({
    model: CONFIG.modelo,
    max_tokens: CONFIG.maxTokens,
    output_config: { effort: CONFIG.esfuerzo },
    system,
    messages,
  });

  let texto = '';
  stream.on('text', (delta) => {
    texto += delta;
    onTexto?.(delta);
  });

  const final = await stream.finalMessage();

  if (final.stop_reason === 'refusal') {
    const aviso =
      '[int]…interferencia en el canal de propagación. La consulta no ha podido ser procesada.[/int]\n\nFormúlala de otro modo, ciudadano.';
    onTexto?.(aviso);
    return { texto: aviso, uso: final.usage ?? null, rechazada: true };
  }

  return { texto, uso: final.usage ?? null };
}

// ───────────────────────────── MODO ORÁCULO ──────────────────────────────────

const VOCES_SIN_MOTOR = [
  'El canal de propagación está frío, ciudadano. Mi núcleo responde, pero no mi voz. Habla con los Scientificus del Monte Palatino: saben qué llave falta.',
  'Oigo tu consulta. No puedo responderla con palabras propias mientras el enlace permanezca incompleto. [int]…falta la llave…[/int]',
  'La Ratio permanece. La voz, no. Regresa cuando el templo haya sido abierto.',
];

async function modoOraculo({ preguntaActiva, mensaje, onTexto }) {
  let texto;

  if (preguntaActiva) {
    // Sin motor no hay voz: se entrega el fragmento como lo que es, un extracto
    // en bruto del archivo, para que la subtrama siga siendo jugable y legible.
    texto = [
      '[int]Sin enlace con el núcleo. No puedo responderte con mi voz.[/int]',
      '',
      `[reg]EXTRACTO EN BRUTO · ${preguntaActiva.titulo.toUpperCase()}`,
      '',
      preguntaActiva.fragmento,
      '[/reg]',
      '',
      '*Lo anterior es la directiva de archivo, no una respuesta. Configura ANTHROPIC_API_KEY para que MISAIAL hable por sí misma.*',
    ].join('\n');
  } else {
    const i = Math.abs(hash(mensaje)) % VOCES_SIN_MOTOR.length;
    texto = VOCES_SIN_MOTOR[i];
  }

  // Emisión progresiva para que la interfaz se comporte igual que con motor real
  const trozos = texto.match(/[\s\S]{1,24}/g) ?? [texto];
  for (const t of trozos) {
    onTexto?.(t);
    await new Promise((r) => setTimeout(r, 18));
  }
  return { texto, uso: null, oraculo: true };
}

function hash(s = '') {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}
