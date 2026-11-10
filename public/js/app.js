/* ═══════════════════════════════════════════════════════════════════════════
   TERMINAL DEL TEMPLO — cliente
   El navegador no conoce la trama: solo pinta lo que el servidor le concede.
   ═══════════════════════════════════════════════════════════════════════════ */

const $ = (sel) => document.querySelector(sel);

const el = {
  conversacion: $('#conversacion'),
  bienvenida: $('#bienvenida'),
  sugerencias: $('#sugerencias'),
  redactor: $('#redactor'),
  entrada: $('#entrada'),
  btnEnviar: $('#btnEnviar'),
  btnNueva: $('#btnNueva'),
  listaConv: $('#listaConversaciones'),
  etapas: $('#etapas'),
  investigacionCerrada: $('#investigacionCerrada'),
  etapaContador: $('#etapaContador'),
  codiceBloque: $('#codiceBloque'),
  codiceLista: $('#codiceLista'),
  estadoMotor: $('#estadoMotor'),
  revelacion: $('#revelacion'),
  revelacionTitulo: $('#revelacionTitulo'),
  revelacionTexto: $('#revelacionTexto'),
  revelacionCerrar: $('#revelacionCerrar'),
  puntoInvestigacion: $('#puntoInvestigacion'),
};

const estado = {
  sesion: localStorage.getItem('misaial.sesion') || null,
  conversacion: null,
  ocupado: false,
  investigacion: null,
  listaConv: null,
  etapasAbiertas: new Set(),
  codiceVistos: new Set(),
};

// ────────────────────────────── red ──────────────────────────────

function cabeceras() {
  const h = { 'Content-Type': 'application/json' };
  if (estado.sesion) h['x-sesion'] = estado.sesion;
  return h;
}

async function api(ruta, opciones = {}) {
  const r = await fetch(ruta, { headers: cabeceras(), ...opciones });
  if (!r.ok) {
    const cuerpo = await r.json().catch(() => ({}));
    throw new Error(cuerpo.error || `Error ${r.status}`);
  }
  return r.json();
}

function recordarSesion(id) {
  if (id && id !== estado.sesion) {
    estado.sesion = id;
    localStorage.setItem('misaial.sesion', id);
  }
}

// ──────────────────────── render de texto ────────────────────────

const escapar = (s) =>
  s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );

/**
 * Convierte el texto de MISAIAL en HTML.
 * Marcas propias: [int]…[/int] interferencia, [reg]…[/reg] registro de archivo.
 * Además, *énfasis* simple.
 */
function pintarVoz(texto) {
  const bloques = [];
  let resto = escapar(texto);

  // registros de archivo → fuera del flujo de párrafos
  resto = resto.replace(/\[reg\]([\s\S]*?)(?:\[\/reg\]|$)/g, (_, c) => {
    bloques.push(`<span class="reg">${c.trim()}</span>`);
    return `\u0000${bloques.length - 1}\u0000`;
  });

  resto = resto
    .replace(/\[int\]([\s\S]*?)(?:\[\/int\]|$)/g, '<span class="int">$1</span>')
    .replace(/(^|[\s(¡¿"“—-])\*(?!\s)([^*\n]+?)\*(?=$|[\s.,;:!?)"”—-])/g, '$1<em>$2</em>');

  const html = resto
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      const marcador = p.match(/^\u0000(\d+)\u0000$/);
      if (marcador) return bloques[Number(marcador[1])];
      return `<p>${p.replace(/\n/g, '<br />').replace(/\u0000(\d+)\u0000/g, (_, i) => bloques[Number(i)])}</p>`;
    })
    .join('');

  return html;
}

// ──────────────────────── mensajes ────────────────────────

function ocultarBienvenida() {
  if (el.bienvenida && !el.bienvenida.hidden) el.bienvenida.hidden = true;
}

function nodoMensaje({ rol, texto = '', especial, revelacion }) {
  const art = document.createElement('article');
  const mia = rol === 'usuario';
  art.className = `msg ${mia ? 'msg--yo' : 'msg--ella'}`;
  if (especial) art.classList.add('msg--especial');
  if (revelacion) art.classList.add('msg--revelacion');

  const firma = document.createElement('div');
  firma.className = 'msg__firma';
  firma.textContent = mia
    ? especial
      ? 'Consulta sellada'
      : 'Ciudadano'
    : revelacion
      ? 'MISAIAL · canal sin registro'
      : 'MISAIAL';

  const cuerpo = document.createElement('div');
  cuerpo.className = 'msg__cuerpo';
  if (mia) {
    cuerpo.textContent = texto;
  } else {
    cuerpo.innerHTML = pintarVoz(texto);
  }

  art.append(firma, cuerpo);
  return { art, cuerpo };
}

function añadirMensaje(m) {
  ocultarBienvenida();
  const { art, cuerpo } = nodoMensaje(m);
  el.conversacion.append(art);
  abajo();
  return cuerpo;
}

function abajo(forzar = false) {
  const c = el.conversacion;
  const cerca = c.scrollHeight - c.scrollTop - c.clientHeight < 180;
  if (forzar || cerca) c.scrollTop = c.scrollHeight;
}

function mostrarError(mensaje) {
  const p = document.createElement('p');
  p.className = 'aviso-error';
  p.textContent = mensaje;
  el.conversacion.append(p);
  abajo(true);
}

// ──────────────────────── consulta ────────────────────────

async function consultar({ mensaje, pregunta }) {
  if (estado.ocupado) return;
  estado.ocupado = true;
  el.btnEnviar.disabled = true;
  el.entrada.disabled = true;

  // Indicador de proceso
  ocultarBienvenida();
  const proceso = document.createElement('div');
  proceso.className = 'msg msg--ella';
  proceso.innerHTML =
    '<div class="procesando"><span class="procesando__anillo"></span>MISAIAL procesa</div>';
  el.conversacion.append(proceso);
  abajo(true);

  let cuerpoDestino = null;
  let acumulado = '';

  try {
    const r = await fetch('/api/consulta', {
      method: 'POST',
      headers: cabeceras(),
      body: JSON.stringify({
        conversacion: estado.conversacion,
        mensaje,
        pregunta,
      }),
    });

    if (!r.ok || !r.body) {
      const cuerpo = await r.json().catch(() => ({}));
      throw new Error(cuerpo.error || 'El terminal no ha podido alcanzar el núcleo.');
    }

    const lector = r.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = '';

    for (;;) {
      const { value, done } = await lector.read();
      if (done) break;
      buffer += value;

      let corte;
      while ((corte = buffer.indexOf('\n\n')) !== -1) {
        const crudo = buffer.slice(0, corte);
        buffer = buffer.slice(corte + 2);

        const lineas = crudo.split('\n');
        const evento = lineas.find((l) => l.startsWith('event: '))?.slice(7).trim();
        const datos = lineas
          .filter((l) => l.startsWith('data: '))
          .map((l) => l.slice(6))
          .join('\n');
        if (!evento) continue;

        let payload = null;
        try { payload = JSON.parse(datos); } catch { continue; }

        if (evento === 'inicio') {
          estado.conversacion = payload.conversacion;
          proceso.remove();
          añadirMensaje(payload.usuario);
          // indicador de nuevo, bajo el mensaje del usuario
          el.conversacion.append(proceso);
          abajo(true);
        } else if (evento === 'texto') {
          if (!cuerpoDestino) {
            proceso.remove();
            cuerpoDestino = añadirMensaje({ rol: 'misaial', revelacion: pregunta });
          }
          acumulado += payload;
          cuerpoDestino.innerHTML = pintarVoz(acumulado) + '<span class="cursor"></span>';
          abajo();
        } else if (evento === 'fin') {
          if (cuerpoDestino) cuerpoDestino.innerHTML = pintarVoz(acumulado);
          aplicarFin(payload);
        } else if (evento === 'error') {
          proceso.remove();
          if (cuerpoDestino) cuerpoDestino.innerHTML = pintarVoz(acumulado);
          mostrarError(payload.mensaje);
        }
      }
    }
  } catch (err) {
    proceso.remove();
    mostrarError(err.message);
  } finally {
    proceso.remove();
    estado.ocupado = false;
    el.btnEnviar.disabled = false;
    el.entrada.disabled = false;
    el.entrada.focus();
  }
}

function aplicarFin(payload) {
  if (payload.conversaciones) pintarConversaciones(payload.conversaciones);
  if (payload.investigacion) pintarInvestigacion(payload.investigacion);
  if (payload.avance?.nuevaEtapa) {
    mostrarRevelacion(payload.avance.nuevaEtapa);
  }
}

// ──────────────────────── archivo ────────────────────────

function fecha(ts) {
  const d = new Date(ts);
  const hoy = new Date();
  const mismoDia = d.toDateString() === hoy.toDateString();
  return mismoDia
    ? d.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString('es', { day: '2-digit', month: 'short' });
}

function pintarConversaciones(lista) {
  estado.listaConv = lista;
  el.listaConv.innerHTML = '';
  if (!lista.length) {
    const li = document.createElement('li');
    li.className = 'vacio';
    li.textContent = 'Sin consultas registradas.';
    el.listaConv.append(li);
    return;
  }

  for (const c of lista) {
    const li = document.createElement('li');
    li.className = 'conv' + (c.id === estado.conversacion ? ' is-activa' : '');
    li.innerHTML = `
      <span class="conv__texto">
        <span class="conv__titulo"></span>
        <span class="conv__meta"></span>
      </span>
      <button type="button" class="conv__borrar" aria-label="Eliminar consulta">×</button>`;
    li.querySelector('.conv__titulo').textContent = c.titulo;
    li.querySelector('.conv__meta').textContent =
      `${fecha(c.actualizada)} · ${c.mensajes} ${c.mensajes === 1 ? 'entrada' : 'entradas'}`;

    li.addEventListener('click', (e) => {
      if (e.target.closest('.conv__borrar')) return;
      abrirConversacion(c.id);
    });
    li.querySelector('.conv__borrar').addEventListener('click', async (e) => {
      e.stopPropagation();
      const r = await api(`/api/conversaciones/${c.id}`, { method: 'DELETE' });
      if (estado.conversacion === c.id) {
        estado.conversacion = null;
        el.conversacion.innerHTML = '';
        el.conversacion.append(el.bienvenida);
        el.bienvenida.hidden = false;
      }
      pintarConversaciones(r.conversaciones);
      pintarInvestigacion(r.investigacion);
    });

    el.listaConv.append(li);
  }
}

async function abrirConversacion(id) {
  if (estado.ocupado) return;
  const conv = await api(`/api/conversaciones/${id}`);
  estado.conversacion = conv.id;
  el.conversacion.innerHTML = '';
  for (const m of conv.mensajes) {
    const { art } = nodoMensaje(m);
    el.conversacion.append(art);
  }
  abajo(true);
  marcarActiva();
  irA('consulta');
  el.entrada.focus();
}

function marcarActiva() {
  if (estado.listaConv) pintarConversaciones(estado.listaConv);
}

function nuevaConsulta() {
  estado.conversacion = null;
  el.conversacion.innerHTML = '';
  el.conversacion.append(el.bienvenida);
  el.bienvenida.hidden = false;
  for (const li of el.listaConv.querySelectorAll('.conv')) li.classList.remove('is-activa');
  irA('consulta');
  el.entrada.focus();
}

// ──────────────────────── investigación ────────────────────────

function pintarInvestigacion(inv) {
  estado.investigacion = inv;

  el.etapaContador.textContent = inv.abierta ? `${inv.etapa} / ${inv.etapasTotales}` : '— / 5';

  if (!inv.abierta) {
    el.investigacionCerrada.hidden = false;
    el.etapas.hidden = true;
    el.codiceBloque.hidden = true;
    return;
  }

  el.investigacionCerrada.hidden = true;
  el.etapas.hidden = false;
  el.etapas.innerHTML = '';

  for (const etapa of inv.etapas) {
    // Una etapa sellada solo se muestra si la anterior ya está desbloqueada
    const anterior = inv.etapas[etapa.id - 2];
    if (!etapa.desbloqueada && anterior && !anterior.desbloqueada) continue;

    // Las etapas agotadas se repliegan para no tapar la investigación en curso
    const agotada = etapa.desbloqueada && etapa.completadas === etapa.total;
    const plegada = agotada && !estado.etapasAbiertas.has(etapa.id);

    const div = document.createElement('section');
    div.className = 'etapa' + (etapa.desbloqueada ? '' : ' etapa--sellada') + (plegada ? ' etapa--plegada' : '');

    const cabeza = document.createElement(agotada ? 'button' : 'div');
    cabeza.className = 'etapa__cabeza';
    if (agotada) {
      cabeza.type = 'button';
      cabeza.addEventListener('click', () => {
        if (estado.etapasAbiertas.has(etapa.id)) estado.etapasAbiertas.delete(etapa.id);
        else estado.etapasAbiertas.add(etapa.id);
        pintarInvestigacion(inv);
      });
    }
    cabeza.innerHTML = `<span class="etapa__num">${String(etapa.id).padStart(2, '0')}</span>`;
    const nombre = document.createElement('span');
    nombre.className = 'etapa__nombre';
    nombre.textContent = etapa.nombre || '· · · · · ·';
    cabeza.append(nombre);
    if (agotada) {
      const marca = document.createElement('span');
      marca.className = 'etapa__cerrada';
      marca.textContent = plegada ? `${etapa.total}/${etapa.total} ▸` : '▾';
      cabeza.append(marca);
    }
    div.append(cabeza);

    if (plegada) {
      el.etapas.append(div);
      continue;
    }

    if (etapa.desbloqueada) {
      const sub = document.createElement('p');
      sub.className = 'etapa__titulo';
      sub.textContent = `${etapa.titulo} — ${etapa.completadas}/${etapa.total}`;
      div.append(sub);

      const desc = document.createElement('p');
      desc.className = 'etapa__desc';
      desc.textContent = etapa.descripcion;
      div.append(desc);
    }

    const ul = document.createElement('ul');
    ul.className = 'preguntas';

    for (const p of etapa.preguntas) {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'preg';

      const rotulo = document.createElement('span');
      rotulo.className = 'preg__rotulo';
      const texto = document.createElement('span');
      texto.className = 'preg__texto';

      if (p.estado === 'respondida') {
        b.classList.add('preg--respondida');
        b.disabled = true;
        rotulo.textContent = p.titulo;
        texto.textContent = p.pregunta;
      } else if (p.estado === 'disponible') {
        rotulo.textContent = p.titulo;
        texto.textContent = p.pregunta;
        b.addEventListener('click', () => {
          if (estado.ocupado) return;
          irA('consulta');
          consultar({ pregunta: p.id });
        });
      } else {
        b.classList.add('preg--sellada');
        b.disabled = true;
        rotulo.textContent = 'sellado';
        texto.textContent = 'Lorem damnatio memoriae imperii arcanum nondum revelatum est';
        b.title = 'Sello activo.';
      }

      b.append(rotulo, texto);
      li.append(b);
      ul.append(li);
    }

    div.append(ul);
    el.etapas.append(div);
  }

  // Códice
  if (inv.codice.length) {
    // Solo se desplaza al final cuando entra un descubrimiento nuevo durante la
    // sesión; en el primer pintado se deja arriba, para poder leer el códice entero.
    const hayNuevos =
      estado.codicePintado && inv.codice.some((c) => !estado.codiceVistos.has(c.id));
    estado.codicePintado = true;
    el.codiceBloque.hidden = false;
    el.codiceLista.innerHTML = '';
    for (const c of inv.codice) {
      const li = document.createElement('li');
      if (c.final) li.classList.add('es-final');
      const t = document.createElement('span');
      t.className = 'codice__titulo';
      t.textContent = c.titulo;
      const x = document.createElement('span');
      x.className = 'codice__texto';
      x.textContent = c.texto;
      li.append(t, x);
      el.codiceLista.append(li);
      estado.codiceVistos.add(c.id);
    }
    if (hayNuevos) el.codiceLista.scrollTop = el.codiceLista.scrollHeight;
  } else {
    el.codiceBloque.hidden = true;
  }

  // Punto de aviso en la pestaña móvil
  const hayDisponibles = inv.etapas.some((e) =>
    e.preguntas.some((p) => p.estado === 'disponible')
  );
  el.puntoInvestigacion.hidden = !hayDisponibles;
}

function mostrarRevelacion(etapa) {
  el.revelacionTitulo.textContent = etapa.nombre;
  el.revelacionTexto.textContent = etapa.descripcion;
  el.revelacion.hidden = false;
  el.revelacionCerrar.focus();
}

el.revelacionCerrar.addEventListener('click', () => {
  el.revelacion.hidden = true;
  el.entrada.focus();
});
el.revelacion.addEventListener('click', (e) => {
  if (e.target === el.revelacion) el.revelacion.hidden = true;
});

// ──────────────────────── pestañas (móvil) ────────────────────────

function irA(panel) {
  for (const b of document.querySelectorAll('.pestanas__b')) {
    const activa = b.dataset.panel === panel;
    b.classList.toggle('is-activa', activa);
    b.setAttribute('aria-selected', String(activa));
  }
  for (const p of document.querySelectorAll('.panel')) {
    p.classList.toggle('is-visible', p.id === `panel-${panel}`);
  }
}

for (const b of document.querySelectorAll('.pestanas__b')) {
  b.addEventListener('click', () => irA(b.dataset.panel));
}
irA('consulta');

// ──────────────────────── redactor ────────────────────────

function ajustarAltura() {
  el.entrada.style.height = 'auto';
  el.entrada.style.height = `${Math.min(el.entrada.scrollHeight, 180)}px`;
}

el.entrada.addEventListener('input', ajustarAltura);
el.entrada.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    el.redactor.requestSubmit();
  }
});

el.redactor.addEventListener('submit', (e) => {
  e.preventDefault();
  const texto = el.entrada.value.trim();
  if (!texto || estado.ocupado) return;
  el.entrada.value = '';
  ajustarAltura();
  consultar({ mensaje: texto });
});

el.sugerencias?.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-q]');
  if (!b) return;
  consultar({ mensaje: b.dataset.q });
});

el.btnNueva.addEventListener('click', nuevaConsulta);

// ──────────────────────── arranque ────────────────────────

(async function iniciar() {
  try {
    const r = await fetch('/api/estado', { headers: cabeceras() });
    const datos = await r.json();
    recordarSesion(datos.sesion);
    pintarConversaciones(datos.conversaciones);
    pintarInvestigacion(datos.investigacion);

    const oraculo = datos.motor === 'oraculo';
    el.estadoMotor.innerHTML = `<i class="pulso${oraculo ? ' is-oraculo' : ''}"></i>${
      oraculo ? 'modo oráculo' : 'activo'
    }`;
    el.estadoMotor.title = oraculo
      ? 'Sin ANTHROPIC_API_KEY: respuestas canónicas pregrabadas.'
      : 'Núcleo enlazado.';
  } catch {
    el.estadoMotor.innerHTML = '<i class="pulso is-caido"></i>sin enlace';
  }
  ajustarAltura();
  el.entrada.focus();
})();
