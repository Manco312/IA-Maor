/**
 * SISTEMA DE PROGRESIÓN NARRATIVA
 *
 * Única autoridad sobre qué sabe el usuario. Decide:
 *   - qué preguntas especiales puede ver y lanzar
 *   - cuándo avanza de etapa
 *   - qué entra en el Códice
 *
 * El cliente recibe de aquí una vista "segura": nunca el texto de un fragmento
 * no desbloqueado, nunca la conducta, nunca una pista de lo que viene después.
 */

import { ETAPAS, etapaPorId } from './etapas.js';
import { PREGUNTAS, preguntaPorId, preguntasDeEtapa, estaDisponible } from './preguntas.js';

/** Nº de mensajes libres acumulados en todas las conversaciones de la sesión. */
export function mensajesLibres(sesion) {
  return sesion.conversaciones.reduce(
    (n, c) => n + c.mensajes.filter((m) => m.rol === 'usuario' && !m.especial).length,
    0
  );
}

/** ¿Está ya visible el panel de investigación? */
export function investigacionAbierta(sesion) {
  const umbral = ETAPAS[0].requiereMensajes ?? 0;
  return sesion.progreso.respondidas.length > 0 || mensajesLibres(sesion) >= umbral;
}

/** Recalcula la etapa alcanzada a partir de las preguntas respondidas. */
export function recalcularEtapa(progreso) {
  let etapa = 1;
  for (const def of ETAPAS) {
    const total = preguntasDeEtapa(def.id);
    const hechas = total.filter((p) => progreso.respondidas.includes(p.id)).length;
    if (hechas >= (def.requiereParaAvanzar ?? total.length) && etapaPorId(def.id + 1)) {
      etapa = def.id + 1;
    } else {
      break;
    }
  }
  const anterior = progreso.etapa;
  progreso.etapa = Math.max(progreso.etapa, etapa);
  return progreso.etapa > anterior ? progreso.etapa : null;
}

/**
 * Valida que una pregunta puede lanzarse ahora. Devuelve la pregunta o lanza error.
 * Esta es la puerta: si falla, el fragmento nunca llega al modelo.
 */
export function autorizarPregunta(sesion, id) {
  const pregunta = preguntaPorId(id);
  if (!pregunta) {
    const e = new Error('Consulta no registrada.');
    e.codigo = 404;
    throw e;
  }
  if (sesion.progreso.respondidas.includes(id)) {
    const e = new Error('Esa consulta ya fue formulada.');
    e.codigo = 409;
    throw e;
  }
  if (!investigacionAbierta(sesion)) {
    const e = new Error('La investigación aún no está disponible.');
    e.codigo = 403;
    throw e;
  }
  if (!estaDisponible(pregunta, sesion.progreso)) {
    const e = new Error('Sello activo: esa consulta no está disponible todavía.');
    e.codigo = 403;
    throw e;
  }
  return pregunta;
}

/**
 * Registra los sellos que el modelo dice haber abierto en una respuesta.
 *
 * El modelo propone; el servidor dispone. Un id inventado, uno ya abierto o uno
 * que todavía no está al alcance se descarta sin ruido: la autoridad sobre el
 * progreso sigue estando aquí, no en el texto que devuelve la API.
 *
 * @returns {{abiertas: Array, nuevaEtapa: number|null}}
 */
export function registrarDescubrimientos(sesion, ids = []) {
  const abiertas = [];
  let nuevaEtapa = null;

  for (const id of ids) {
    const pregunta = preguntaPorId(id);
    if (!pregunta) continue;
    if (sesion.progreso.respondidas.includes(id)) continue;
    if (!estaDisponible(pregunta, sesion.progreso)) continue;

    const r = registrarRespuesta(sesion, pregunta);
    if (r.nuevaEtapa) nuevaEtapa = r.nuevaEtapa;
    abiertas.push(pregunta);
  }

  return { abiertas, nuevaEtapa };
}

/** Registra una pregunta como respondida y actualiza códice y etapa. */
export function registrarRespuesta(sesion, pregunta) {
  const { progreso } = sesion;
  if (!progreso.respondidas.includes(pregunta.id)) {
    progreso.respondidas.push(pregunta.id);
  }
  if (pregunta.codice && !progreso.codice.some((c) => c.id === pregunta.id)) {
    progreso.codice.push({
      id: pregunta.id,
      etapa: pregunta.etapa,
      titulo: pregunta.codice.titulo,
      texto: pregunta.codice.texto,
      final: Boolean(pregunta.codice.final),
      descubierto: Date.now(),
    });
  }
  const nuevaEtapa = recalcularEtapa(progreso);
  return { nuevaEtapa };
}

/**
 * Vista del estado de la investigación para el cliente.
 *
 * Es un REGISTRO DE LO DESCUBIERTO, no un menú. Solo existen dos estados:
 * descubierta —y entonces viaja su título y la pregunta que lo abrió, como
 * anotación de archivo— o sellada, y entonces no viaja absolutamente nada.
 *
 * El estado "disponible" ya no se expone a propósito: era precisamente lo que
 * convertía el panel en una lista de lo que había que preguntar. Que un sello
 * esté al alcance ahora solo lo sabe el prompt del modelo.
 */
export function vistaInvestigacion(sesion) {
  const { progreso } = sesion;
  const abierta = investigacionAbierta(sesion);

  const etapas = ETAPAS.map((def) => {
    const desbloqueada = def.id <= progreso.etapa;
    const preguntas = preguntasDeEtapa(def.id).map((p) => {
      const descubierta = progreso.respondidas.includes(p.id);
      return {
        id: descubierta ? p.id : null,
        estado: descubierta ? 'descubierta' : 'sellada',
        titulo: descubierta ? p.titulo : null,
        pregunta: descubierta ? p.pregunta : null,
      };
    });
    return {
      id: def.id,
      nombre: desbloqueada ? def.nombre : null,
      titulo: desbloqueada ? def.titulo : null,
      descripcion: desbloqueada ? def.descripcion : null,
      desbloqueada,
      preguntas,
      completadas: preguntas.filter((p) => p.estado === 'descubierta').length,
      total: preguntas.length,
    };
  });

  return {
    abierta,
    mensajesParaAbrir: abierta
      ? 0
      : Math.max(0, (ETAPAS[0].requiereMensajes ?? 0) - mensajesLibres(sesion)),
    etapa: progreso.etapa,
    etapasTotales: ETAPAS.length,
    descubiertas: progreso.respondidas.length,
    totalSellos: PREGUNTAS.length,
    etapas,
    codice: [...progreso.codice].sort((a, b) => a.descubierto - b.descubierto),
    completado:
      progreso.respondidas.length === PREGUNTAS.length,
  };
}
