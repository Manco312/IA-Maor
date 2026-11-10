/**
 * BASE DE CONOCIMIENTO
 *
 * Carga los documentos del universo desde disco. Cualquier archivo .md que se añada
 * a esta carpeta se incorpora automáticamente al canon, ordenado por nombre de
 * archivo (por eso el prefijo numérico). No hace falta tocar código para ampliar
 * el universo: basta con dejar un .md aquí y reiniciar el servidor.
 *
 * Separación de niveles de acceso:
 *   canon      → todo lo que MISAIAL sabe y puede usar siempre
 *   sellado    → fragmentos de la subtrama, entregados uno a uno por el motor narrativo
 */

import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const AQUI = dirname(fileURLToPath(import.meta.url));

function cargarDocumentos() {
  const archivos = readdirSync(AQUI)
    .filter((f) => f.endsWith('.md'))
    .sort();

  return archivos.map((nombre) => ({
    nombre,
    texto: readFileSync(join(AQUI, nombre), 'utf8').trim(),
  }));
}

let cache = null;

/** Canon completo, ensamblado una sola vez y estable byte a byte (clave para el caché de prompt). */
export function canonCompleto() {
  if (cache) return cache;

  const docs = cargarDocumentos();
  const cuerpo = docs
    .map((d) => `<<< DOCUMENTO: ${d.nombre} >>>\n\n${d.texto}`)
    .join('\n\n\n');

  cache = {
    texto: cuerpo,
    documentos: docs.map((d) => d.nombre),
    caracteres: cuerpo.length,
  };
  return cache;
}

/** Fuerza la recarga desde disco (útil en desarrollo tras editar el canon). */
export function recargarCanon() {
  cache = null;
  return canonCompleto();
}
