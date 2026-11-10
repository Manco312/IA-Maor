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

// ─────────────────────── filtro de marcas de sello ───────────────────────────

const RE_SELLO = /<<<sello:([a-z0-9-]+)>>>/gi;
const INICIO_MARCA = '<<<sello:';

/**
 * Las marcas `<<<sello:id>>>` son un apunte interno: el navegador no debe verlas
 * nunca. Como el texto llega en fragmentos, una marca puede partirse entre dos
 * deltas, así que no basta con filtrar cada delta por separado.
 *
 * Este filtro retiene la cola del búfer mientras pueda ser el principio de una
 * marca y suelta el resto de inmediato, para que la escritura en pantalla siga
 * pareciendo fluida.
 */
function filtroSellos(onTexto) {
  let buffer = '';
  const sellos = [];

  const extraer = () => {
    buffer = buffer.replace(RE_SELLO, (_, id) => {
      const limpio = id.toLowerCase();
      if (!sellos.includes(limpio)) sellos.push(limpio);
      return '';
    });
  };

  // Tope de seguridad: si algo parece el principio de una marca pero nunca la
  // cierra, se suelta igualmente en vez de retener texto para siempre.
  const MAX_RETENIDO = INICIO_MARCA.length + 72;

  // ¿La cola a partir de `i` podría acabar siendo una marca completa?
  const puedeSerMarca = (cola) =>
    cola.length <= MAX_RETENIDO &&
    (INICIO_MARCA.startsWith(cola) || cola.startsWith(INICIO_MARCA));

  /**
   * Devuelve el primer punto a partir del cual hay que retener, o -1.
   * Tiene que ser el PRIMER '<' que aún pueda crecer hasta ser marca, no el
   * último: con "...<<" el último '<' es prefijo válido, pero soltar el que va
   * delante parte la marca en dos y ya no se reconoce al llegar el resto.
   */
  const puntoDeCorte = () => {
    for (let i = buffer.indexOf('<'); i !== -1; i = buffer.indexOf('<', i + 1)) {
      if (puedeSerMarca(buffer.slice(i))) return i;
    }
    return -1;
  };

  return {
    escribir(delta) {
      buffer += delta;
      extraer();

      const i = puntoDeCorte();
      const seguro = i === -1 ? buffer : buffer.slice(0, i);
      buffer = i === -1 ? '' : buffer.slice(i);

      if (seguro) onTexto?.(seguro);
    },

    cerrar() {
      extraer();
      if (buffer) onTexto?.(buffer);
      buffer = '';
      return sellos;
    },
  };
}

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

  // El texto que se guarda y se envía al navegador va ya sin marcas; los ids de
  // los sellos abiertos salen por separado, para que los registre la progresión.
  let texto = '';
  const filtro = filtroSellos((limpio) => {
    texto += limpio;
    onTexto?.(limpio);
  });

  stream.on('text', (delta) => filtro.escribir(delta));

  const final = await stream.finalMessage();
  const sellos = filtro.cerrar();

  if (final.stop_reason === 'refusal') {
    const aviso =
      '[int]…interferencia en el canal de propagación. La consulta no ha podido ser procesada.[/int]\n\nFormúlala de otro modo, ciudadano.';
    onTexto?.(aviso);
    return { texto: aviso, uso: final.usage ?? null, rechazada: true, sellos: [] };
  }

  return { texto: texto.trimEnd(), uso: final.usage ?? null, sellos };
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
  return { texto, uso: null, oraculo: true, sellos: [] };
}

function hash(s = '') {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}
