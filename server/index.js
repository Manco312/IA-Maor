/**
 * TERMINAL DEL TEMPLO — servidor
 *
 * Expone la interfaz estática y la API de consulta. Toda la lógica narrativa vive
 * aquí dentro: el navegador nunca ve un fragmento que no se haya ganado.
 */

import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { CONFIG } from './config.js';
import * as store from './store.js';
import { responder, motorActivo } from './misaial.js';
import { canonCompleto } from './lore/index.js';
import {
  autorizarPregunta,
  registrarRespuesta,
  registrarDescubrimientos,
  vistaInvestigacion,
  investigacionAbierta,
} from './narrativa/progresion.js';
import { etapaPorId } from './narrativa/etapas.js';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const app = express();

app.use(express.json({ limit: '128kb' }));
app.use(express.static(join(RAIZ, 'public'), { extensions: ['html'] }));

// ───────────────────────────── utilidades ────────────────────────────────────

/** Resuelve la sesión a partir de la cabecera; crea una si no existe. */
function sesionDe(req) {
  const id = req.get('x-sesion') || req.body?.sesion || null;
  return store.asegurarSesion(id);
}

function resumenConversacion(c) {
  return {
    id: c.id,
    titulo: c.titulo,
    creada: c.creada,
    actualizada: c.actualizada,
    mensajes: c.mensajes.length,
  };
}

function estadoCompleto(sesion) {
  return {
    sesion: sesion.id,
    conversaciones: sesion.conversaciones.map(resumenConversacion),
    investigacion: vistaInvestigacion(sesion),
    motor: motorActivo() ? 'nucleo' : 'oraculo',
  };
}

// ───────────────────────────────── API ───────────────────────────────────────

app.get('/api/estado', (req, res) => {
  const sesion = sesionDe(req);
  res.json(estadoCompleto(sesion));
});

app.get('/api/canon', (_req, res) => {
  const canon = canonCompleto();
  res.json({ documentos: canon.documentos, caracteres: canon.caracteres });
});

app.get('/api/conversaciones/:id', (req, res) => {
  const sesion = sesionDe(req);
  const conv = store.obtenerConversacion(sesion, req.params.id);
  if (!conv) return res.status(404).json({ error: 'Consulta no encontrada.' });
  res.json({ ...resumenConversacion(conv), mensajes: conv.mensajes });
});

app.post('/api/conversaciones', (req, res) => {
  const sesion = sesionDe(req);
  const conv = store.crearConversacion(sesion);
  res.json({ ...resumenConversacion(conv), mensajes: [] });
});

app.delete('/api/conversaciones/:id', (req, res) => {
  const sesion = sesionDe(req);
  const ok = store.borrarConversacion(sesion, req.params.id);
  if (!ok) return res.status(404).json({ error: 'Consulta no encontrada.' });
  res.json(estadoCompleto(sesion));
});

/**
 * Consulta a MISAIAL. Respuesta en Server-Sent Events.
 * Cuerpo: { conversacion?, mensaje?, pregunta? }
 *   - `mensaje`  → conversación libre
 *   - `pregunta` → id de pregunta especial (el texto lo pone el servidor)
 */
app.post('/api/consulta', async (req, res) => {
  const sesion = sesionDe(req);
  const { conversacion: convId, mensaje: textoLibre, pregunta: preguntaId } = req.body || {};

  let preguntaActiva = null;
  let texto;

  try {
    if (preguntaId) {
      preguntaActiva = autorizarPregunta(sesion, preguntaId);
      texto = preguntaActiva.pregunta;
    } else {
      texto = String(textoLibre || '').trim();
      if (!texto) return res.status(400).json({ error: 'Consulta vacía.' });
      if (texto.length > 4000) {
        return res.status(400).json({ error: 'Consulta demasiado extensa.' });
      }
    }
  } catch (err) {
    return res.status(err.codigo || 400).json({ error: err.message });
  }

  let conv = convId ? store.obtenerConversacion(sesion, convId) : null;
  if (!conv) conv = store.crearConversacion(sesion);
  const esPrimero = conv.mensajes.length === 0;

  const historial = conv.mensajes.slice(-40);
  store.añadirMensaje(sesion, conv, {
    rol: 'usuario',
    texto,
    especial: preguntaActiva ? preguntaActiva.id : undefined,
  });
  if (esPrimero) store.titularConversacion(conv, texto);

  // ── SSE ──
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  // OJO: no se puede usar `req.on('close')` para detectar que el navegador se
  // ha ido. Express ya ha consumido el cuerpo de la petición, así que el stream
  // de `req` se cierra de inmediato y silenciaría la respuesta entera salvo el
  // primer fragmento. El que importa es el cierre de `res`.
  let abortado = false;
  res.on('close', () => {
    if (!res.writableEnded) abortado = true;
  });

  const enviar = (evento, datos) => {
    if (abortado || res.writableEnded) return;
    res.write(`event: ${evento}\ndata: ${JSON.stringify(datos)}\n\n`);
  };

  enviar('inicio', {
    conversacion: conv.id,
    titulo: conv.titulo,
    usuario: { rol: 'usuario', texto, especial: preguntaActiva?.id },
  });

  try {
    const { texto: respuesta, sellos } = await responder({
      progreso: sesion.progreso,
      historial,
      mensaje: texto,
      preguntaActiva,
      onTexto: (delta) => {
        if (!abortado) enviar('texto', delta);
      },
    });

    // Dos caminos hacia el mismo sitio:
    //   - `preguntaActiva`: disparo explícito por id (ya no lo usa la interfaz,
    //     se mantiene para poder probar un sello concreto sin tener que dar con él).
    //   - `sellos`: lo normal. El modelo ha reconocido que la conversación llegó
    //     a un secreto y lo ha marcado. La progresión revalida cada id.
    let abiertas = [];
    let nuevaEtapa = null;

    if (preguntaActiva) {
      ({ nuevaEtapa } = registrarRespuesta(sesion, preguntaActiva));
      abiertas = [preguntaActiva];
    } else if (sellos?.length) {
      ({ abiertas, nuevaEtapa } = registrarDescubrimientos(sesion, sellos));
    }

    store.añadirMensaje(sesion, conv, {
      rol: 'misaial',
      texto: respuesta,
      revelacion: abiertas[0]?.id,
    });

    let avance = null;
    if (abiertas.length) {
      const etapa = nuevaEtapa ? etapaPorId(nuevaEtapa) : null;
      const ids = new Set(abiertas.map((p) => p.id));
      avance = {
        // Todas las entradas de códice que ha dejado ESTA respuesta, no solo la última.
        codices: sesion.progreso.codice.filter((c) => ids.has(c.id)),
        nuevaEtapa: etapa
          ? { id: etapa.id, nombre: etapa.nombre, titulo: etapa.titulo, descripcion: etapa.descripcion }
          : null,
      };
    }

    store.persistir();

    enviar('fin', {
      conversacion: conv.id,
      titulo: conv.titulo,
      avance,
      investigacion: vistaInvestigacion(sesion),
      conversaciones: sesion.conversaciones.map(resumenConversacion),
    });
  } catch (err) {
    console.error('[consulta]', err);
    const mensaje =
      err?.status === 401
        ? 'Credencial del núcleo rechazada. Revisa ANTHROPIC_API_KEY en el archivo .env.'
        : err?.status === 429
          ? 'El núcleo está saturado. Repite la consulta en unos instantes.'
          : 'Fallo en el módulo de propagación. La consulta no ha llegado al núcleo.';
    enviar('error', { mensaje });
  } finally {
    res.end();
  }
});

app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Ruta no registrada.' });

  // Un archivo que no existe —el logo aún sin colocar, por ejemplo— debe
  // responder 404. Devolverle la página entera con estado 200 haría que el
  // navegador recibiera HTML donde esperaba una imagen, y que las cachés
  // intermedias guardaran esa respuesta como si fuera el recurso bueno.
  if (/\.[a-z0-9]+$/i.test(req.path)) {
    return res.status(404).type('txt').send('No encontrado.');
  }

  res.sendFile(join(RAIZ, 'public', 'index.html'));
});

// ──────────────────────────────── arranque ───────────────────────────────────

const canon = canonCompleto();
app.listen(CONFIG.puerto, () => {
  const modo = motorActivo()
    ? `núcleo activo · modelo ${CONFIG.modelo} · esfuerzo ${CONFIG.esfuerzo}`
    : 'MODO ORÁCULO (sin ANTHROPIC_API_KEY: respuestas canónicas pregrabadas)';
  console.log('');
  console.log('  ┌─ COGNITIO CIVITAS ─────────────────────────────────────');
  console.log('  │  Terminal del Templo — Monte Palatino');
  console.log(`  │  http://localhost:${CONFIG.puerto}`);
  console.log(`  │  ${modo}`);
  console.log(
    `  │  Canon: ${canon.documentos.length} documentos · ${canon.caracteres.toLocaleString('es')} caracteres`
  );
  console.log('  └────────────────────────────────────────────────────────');
  console.log('');
});
