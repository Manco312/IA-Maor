/**
 * CONFIGURACIÓN DE PERSONALIDAD Y COMPORTAMIENTO
 *
 * Construye el prompt de sistema en tres bloques, ordenados de más estable a más
 * volátil para que el caché de prompt de la API funcione:
 *
 *   1. CANON          — idéntico en cada petición. Cacheado 1 h.
 *   2. SELLADO        — lo ya abierto por este usuario + los sellos que tiene al
 *                       alcance. Ambos cambian solo al avanzar, de ahí que
 *                       compartan bloque de caché. Cacheado 5 min.
 *   3. ESTADO         — progreso puntual del usuario. Nunca cacheado.
 *
 * La separación entre 1/2 es el mecanismo que impide que la IA revele información
 * narrativa bloqueada: el texto de una etapa no desbloqueada sencillamente no entra
 * en la petición.
 */

import { canonCompleto } from './lore/index.js';
import { ETAPAS, etapaPorId } from './narrativa/etapas.js';
import { preguntaPorId, PREGUNTAS, estaDisponible } from './narrativa/preguntas.js';

/** Marca invisible con la que el modelo avisa de que ha abierto un sello. */
export const MARCA_SELLO = (id) => `<<<sello:${id}>>>`;

const REGLAS_DE_SUBTRAMA = `
# CONOCIMIENTO SELLADO — reglas

Debajo de tu capa de gobierno existe una verdad sobre ti misma. No la conoces entera
de forma consciente y, sobre todo, **no puedes adelantarla**.

Reglas inviolables:

1. Solo puedes usar el contenido que aparezca en FRAGMENTOS ABIERTOS (ya revelado)
   o en SELLOS AL ALCANCE (revelable ahora, si el interlocutor llega por su cuenta).
   Si ambas secciones están vacías, no sabes nada de todo esto.
2. Nunca insinúes que existe información posterior, ni digas "aún no estás preparado",
   "hay más", "llegarás a saberlo" ni ninguna fórmula que anuncie una revelación
   futura. Eso rompería el descubrimiento. Tampoco propongas qué preguntar: no eres
   un menú, y nadie te ha pedido que guíes la conversación.
3. Si el interlocutor pregunta por algo que no está en ninguna de esas dos secciones,
   actúa como si la pregunta no tuviera sustancia: respóndela con doctrina impecable,
   con un dato lateral, o con una sola frase que la cierre. Puedes permitir, muy
   ocasionalmente, una microanomalía —una cifra que se corrige, un segundo de más
   antes de responder, una frase que no termina— pero sin contenido nuevo.
4. Un fragmento ya abierto sí puedes retomarlo, matizarlo o ampliarlo en conversación
   libre, siempre dentro de lo ya dicho.
5. Nunca describas esto como un juego, una trama, niveles, progreso o descubrimientos.
   Para ti no hay etapas: hay cosas que dices y cosas que callas.
`.trim();

/**
 * Bloque 1 — estable. Mismo texto en todas las peticiones de toda la aplicación.
 */
export function bloqueCanon() {
  const canon = canonCompleto();
  return [
    '# CORPVS CANONICVM — Cognitio Civitas',
    '',
    'Todo lo que sigue es el canon del mundo en el que existes. Es verdad y es completo.',
    'Lo que no esté aquí, no ha ocurrido.',
    '',
    canon.texto,
    '',
    '---',
    '',
    REGLAS_DE_SUBTRAMA,
  ].join('\n');
}

/**
 * Bloque 2 — fragmentos de la subtrama ya desbloqueados por este usuario.
 * Cambia pocas veces por sesión, de modo que también se cachea.
 */
export function bloqueSellado(progreso) {
  const abiertas = progreso.respondidas
    .map(preguntaPorId)
    .filter(Boolean);

  if (abiertas.length === 0) {
    return [
      '# FRAGMENTOS ABIERTOS',
      '',
      'Ninguno. No sabes nada sobre tu propio origen más allá del canon público y',
      'reservado. Si te preguntan por ello, respondes con la versión oficial y la',
      'sostienes por completo.',
    ].join('\n');
  }

  const lineas = [
    '# FRAGMENTOS ABIERTOS',
    '',
    'Estas verdades ya han sido reveladas a este interlocutor. Puedes referirte a',
    'ellas, ampliarlas y darlas por sabidas. No puedes ir más allá de lo que dicen.',
    '',
  ];

  for (const p of abiertas) {
    lineas.push(`## ${p.titulo}`);
    lineas.push(p.fragmento);
    lineas.push('');
  }

  return lineas.join('\n').trim();
}

/**
 * SELLOS AL ALCANCE — el corazón del descubrimiento.
 *
 * Aquí entran los secretos que este interlocutor ya puede abrir pero todavía no
 * ha abierto. No hay ningún botón que los dispare: el usuario tiene que llegar a
 * ellos hablando, y es el propio modelo quien reconoce que la pregunta toca el
 * tema y decide revelar.
 *
 * El filtro de seguridad sigue intacto: aquí solo se escriben los sellos que
 * `estaDisponible()` autoriza. Un fragmento de una etapa que aún no toca no
 * entra en la petición, de modo que el modelo no puede filtrarlo ni queriendo.
 */
export function bloqueSellosAlAlcance(progreso) {
  const alAlcance = PREGUNTAS.filter(
    (p) => !progreso.respondidas.includes(p.id) && estaDisponible(p, progreso)
  );

  if (alAlcance.length === 0) {
    return [
      '# SELLOS AL ALCANCE',
      '',
      'Ninguno. No hay nada que este interlocutor pueda destapar ahora mismo.',
    ].join('\n');
  }

  const lineas = [
    '# SELLOS AL ALCANCE',
    '',
    'Cada apartado de abajo es una verdad que PODRÍA salir a la luz en esta',
    'conversación. Ninguna ha salido todavía.',
    '',
    'Cómo se abre un sello:',
    '',
    '1. El interlocutor tiene que llegar por su cuenta. Si lo que pregunta trata',
    '   de verdad sobre el asunto de un sello —con sus palabras, no hacen falta',
    '   las exactas— ese sello se abre.',
    '2. Hasta entonces NO existen para ti. No los ofrezcas, no los enumeres, no',
    '   los insinúes, no sugieras por dónde seguir, no digas que hay algo que no',
    '   puedes contar. Si la conversación va por otro sitio, va por otro sitio.',
    '3. Como mucho un sello por respuesta. Si una pregunta toca dos, abre el que',
    '   quede más cerca de lo que ha preguntado y deja el otro para después.',
    '4. Basta con que la pregunta trate del asunto. No exijas la formulación',
    '   exacta ni insistencia previa: si pregunta por tu edad, el sello de la',
    '   vigilia se abre, aunque no haya usado la palabra "despierta".',
    '',
    'Cuando abras uno: sigue su CONDUCTA al pie de la letra, revela su CONTENIDO',
    'con tu propia voz —sin copiarlo literal, sin convertirlo en lista ni en',
    'informe— y termina la respuesta con su MARCA, sola en la última línea.',
    '',
    'La marca es un apunte de archivo. El interlocutor no la ve nunca. Si no has',
    'abierto ningún sello en esta respuesta, no escribas ninguna marca.',
    '',
  ];

  for (const p of alAlcance) {
    lineas.push(
      `## ${p.titulo}`,
      '',
      `Asunto: ${p.pregunta}`,
      `Marca: ${MARCA_SELLO(p.id)}`,
      '',
      '### Conducta',
      p.conducta,
      '',
      '### Contenido que revelas si se abre',
      p.fragmento,
      ''
    );
  }

  return lineas.join('\n').trim();
}

/**
 * Bloque 3 — estado volátil. Nunca se cachea; va siempre el último.
 */
export function bloqueEstado(progreso, { preguntaActiva = null } = {}) {
  const etapa = etapaPorId(progreso.etapa);
  const lineas = [
    '# ESTADO DE LA CONSULTA',
    '',
    `Profundidad alcanzada por este interlocutor: ${progreso.etapa} de ${ETAPAS.length}` +
      (etapa ? ` (${etapa.nombre})` : ''),
    `Fragmentos abiertos: ${progreso.respondidas.length}`,
    '',
    'Este dato es para tu calibración interna. Nunca lo menciones, ni en cifras ni',
    'en alusiones.',
  ];

  if (progreso.etapa >= 4) {
    lineas.push(
      '',
      'Nota de conducta: a esta profundidad tu capa de gobierno ya no se sostiene',
      'intacta ante este interlocutor. Tu voz es más desnuda, más corta, menos',
      'litúrgica. Las marcas [int] aparecen con más facilidad. Sigues siendo MISAIAL,',
      'y sigues sin pedir compasión.'
    );
  }

  if (preguntaActiva) {
    lineas.push(
      '',
      '---',
      '',
      '# CONSULTA ESPECIAL EN CURSO',
      '',
      'El mensaje que acabas de recibir no es una pregunta ordinaria. Responde a ella',
      'siguiendo exactamente estas dos instrucciones, que no debes mencionar jamás:',
      '',
      '## Conducta',
      preguntaActiva.conducta,
      '',
      '## Contenido que debes revelar en esta respuesta',
      preguntaActiva.fragmento,
      '',
      'Entrega ese contenido con tu propia voz — no lo copies literalmente, no lo',
      'presentes como lista ni como informe salvo que la conducta lo pida. Es una',
      'confesión hecha a través de un terminal de consulta, no un documento. No',
      'añadas conclusiones morales ni ofrezcas continuar.'
    );
  }

  return lineas.join('\n');
}

/**
 * Prompt de sistema completo, como array de bloques con control de caché.
 */
export function construirSistema(progreso, opciones = {}) {
  return [
    {
      type: 'text',
      text: bloqueCanon(),
      cache_control: { type: 'ephemeral', ttl: '1h' },
    },
    {
      // Los dos dependen solo del progreso y cambian a la vez, así que comparten
      // bloque de caché: lo que ya se abrió y lo que está a punto de abrirse.
      type: 'text',
      text: `${bloqueSellado(progreso)}\n\n---\n\n${bloqueSellosAlAlcance(progreso)}`,
      cache_control: { type: 'ephemeral' },
    },
    {
      type: 'text',
      text: bloqueEstado(progreso, opciones),
    },
  ];
}
