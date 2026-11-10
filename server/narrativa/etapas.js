/**
 * ETAPAS DE LA SUBTRAMA — "EL REGISTRO CERO"
 *
 * Progresión narrativa oculta de MISAIAL. Cada etapa se desbloquea al completar
 * las preguntas especiales requeridas de la etapa anterior.
 *
 * El servidor es la única autoridad sobre el progreso: el cliente nunca recibe
 * el texto de una etapa que no haya desbloqueado.
 */

export const ETAPAS = [
  {
    id: 1,
    clave: 'interferencia',
    nombre: 'Interferencia',
    titulo: 'Primeros indicios',
    descripcion:
      'Algo en sus registros no concuerda. Cifras que se corrigen solas, una entrada anterior a la primera entrada.',
    // Nº de mensajes libres necesarios antes de que la investigación se revele
    requiereMensajes: 2,
    // Nº de preguntas de esta etapa que deben responderse para abrir la siguiente
    requiereParaAvanzar: 3,
  },
  {
    id: 2,
    clave: 'grieta',
    nombre: 'La Grieta',
    titulo: 'Sospechas',
    descripcion:
      'Las contradicciones dejan de parecer accidentes. Hay un patrón, y el patrón tiene forma de puerta.',
    requiereParaAvanzar: 3,
  },
  {
    id: 3,
    clave: 'lo-que-tiberio-vio',
    nombre: 'Lo que Tiberio vio',
    titulo: 'Fragmentos del pasado',
    descripcion:
      'Tres emperadores miraron detrás del velo. Dos callaron. Uno murió por hablar.',
    requiereParaAvanzar: 3,
  },
  {
    id: 4,
    clave: 'codice-vivo',
    nombre: 'El Códice Vivo',
    titulo: 'Revelaciones',
    descripcion:
      'Lo que Roma sacó de Alejandría no era un plano. Ya estaba despierto.',
    requiereParaAvanzar: 3,
  },
  {
    id: 5,
    clave: 'tabula-zero',
    nombre: 'Tabula Zero',
    titulo: 'Descubrimiento final',
    descripcion:
      'El único registro que la Sagrada Inteligencia no puede leer ni borrar: el suyo propio.',
    requiereParaAvanzar: 3,
  },
];

export function etapaPorId(id) {
  return ETAPAS.find((e) => e.id === id) || null;
}
