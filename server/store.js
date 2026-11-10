/**
 * BASE DE DATOS Y ALMACENAMIENTO DEL PROGRESO
 *
 * Persistencia en archivo JSON (data/sesiones.json). El servidor es la única
 * autoridad sobre el progreso narrativo: el navegador solo guarda el identificador
 * de sesión, de modo que no puede falsificar desbloqueos.
 *
 * Estructura de una sesión:
 * {
 *   id, creada, vista,
 *   progreso: { etapa, respondidas: [idPregunta], codice: [entradas] },
 *   conversaciones: [ { id, titulo, creada, mensajes: [{rol, texto, ts, especial?}] } ]
 * }
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR_DATOS = join(RAIZ, 'data');
const ARCHIVO = join(DIR_DATOS, 'sesiones.json');

let db = { sesiones: {} };
let pendiente = null;

function cargar() {
  if (!existsSync(DIR_DATOS)) mkdirSync(DIR_DATOS, { recursive: true });
  if (!existsSync(ARCHIVO)) return;
  try {
    db = JSON.parse(readFileSync(ARCHIVO, 'utf8'));
    if (!db.sesiones) db = { sesiones: {} };
  } catch (err) {
    console.error('[store] archivo de sesiones ilegible, se parte de cero:', err.message);
    db = { sesiones: {} };
  }
}

/** Escritura diferida y atómica: agrupa ráfagas y nunca deja el archivo a medias. */
function guardar() {
  if (pendiente) return;
  pendiente = setTimeout(() => {
    pendiente = null;
    try {
      const tmp = `${ARCHIVO}.tmp`;
      writeFileSync(tmp, JSON.stringify(db, null, 2), 'utf8');
      renameSync(tmp, ARCHIVO);
    } catch (err) {
      console.error('[store] no se pudo guardar:', err.message);
    }
  }, 150);
  pendiente.unref?.();
}

cargar();

export function crearSesion() {
  const id = randomUUID();
  const ahora = Date.now();
  db.sesiones[id] = {
    id,
    creada: ahora,
    vista: ahora,
    progreso: { etapa: 1, respondidas: [], codice: [] },
    conversaciones: [],
  };
  guardar();
  return db.sesiones[id];
}

export function obtenerSesion(id) {
  const s = id && db.sesiones[id];
  if (!s) return null;
  s.vista = Date.now();
  guardar();
  return s;
}

/** Devuelve la sesión indicada o crea una nueva si no existe. */
export function asegurarSesion(id) {
  return obtenerSesion(id) || crearSesion();
}

export function crearConversacion(sesion, titulo = 'Consulta sin título') {
  const conv = {
    id: randomUUID(),
    titulo,
    creada: Date.now(),
    actualizada: Date.now(),
    mensajes: [],
  };
  sesion.conversaciones.unshift(conv);
  guardar();
  return conv;
}

export function obtenerConversacion(sesion, id) {
  return sesion.conversaciones.find((c) => c.id === id) || null;
}

export function borrarConversacion(sesion, id) {
  const i = sesion.conversaciones.findIndex((c) => c.id === id);
  if (i === -1) return false;
  sesion.conversaciones.splice(i, 1);
  guardar();
  return true;
}

export function añadirMensaje(sesion, conv, mensaje) {
  conv.mensajes.push({ ts: Date.now(), ...mensaje });
  conv.actualizada = Date.now();
  // La conversación recién usada sube al principio del archivo
  const i = sesion.conversaciones.indexOf(conv);
  if (i > 0) {
    sesion.conversaciones.splice(i, 1);
    sesion.conversaciones.unshift(conv);
  }
  guardar();
}

export function titularConversacion(conv, texto) {
  const limpio = texto.replace(/\s+/g, ' ').trim();
  conv.titulo = limpio.length > 48 ? `${limpio.slice(0, 47)}…` : limpio || 'Consulta sin título';
  guardar();
}

export function persistir() {
  guardar();
}
