# Guía de despliegue — Terminal del Templo

Cómo poner *Cognitio Civitas* en un servidor y dejarlo funcionando. La aplicación
es un servidor Node que sirve una interfaz estática y habla con la API de Claude;
no necesita base de datos ni ningún servicio externo más.

---

## 1. Qué necesita para vivir

| Pieza | Detalle |
|---|---|
| **Node** | 20.12 o superior. La imagen trae Node 22. |
| **Puerto** | Uno solo, HTTP. Por defecto 3000, configurable con `PORT`. |
| **Disco** | `/app/data/sesiones.json`. Unos pocos KB por jugadora. **Hay que montarlo**, ver §4. |
| **Red saliente** | HTTPS hacia `api.anthropic.com`. Sin eso, MISAIAL cae en modo oráculo. |
| **Memoria** | ~128 MB bastan. El canon (147 KB de texto) se carga una vez en memoria. |

No hay estado en memoria que haya que compartir entre procesos, pero **tampoco
se puede escalar a varias réplicas**: el progreso narrativo vive en un archivo
JSON local. Una instancia, y suficiente. Si algún día hicieran falta varias,
primero habría que mover `server/store.js` a Redis o Postgres.

---

## 2. Variables de entorno

Las mismas que en local. El servidor lee `.env` si existe y, si no, toma las
variables del entorno — que es justo lo que hace un contenedor.

| Variable | Obligatoria | Por defecto | Para qué |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | **Sí** | — | Clave de la API. Sin ella arranca en MODO ORÁCULO. |
| `PORT` | No | `3000` | Puerto de escucha. |
| `MISAIAL_MODELO` | No | `claude-opus-5-5` | `claude-sonnet-5-5` es más barato y rápido. |
| `MISAIAL_ESFUERZO` | No | `low` | `low` · `medium` · `high` · `xhigh` · `max`. Sube el coste y la densidad de la respuesta. |
| `MISAIAL_MAX_TOKENS` | No | `4000` | Longitud máxima de cada respuesta. |

> **La clave nunca va dentro de la imagen.** `.dockerignore` excluye `.env` a
> propósito. Se inyecta en tiempo de ejecución; si se horneara en una capa,
> cualquiera que descargue la imagen podría extraerla con `docker history`.

---

## 3. Arranque rápido con Compose

Es la vía recomendada. Compose lee el `.env` que ya tienes en la carpeta para
resolver las variables, así que no hay que duplicar nada.

```bash
docker compose up -d --build
docker compose logs -f
```

Deberías ver:

```
  ┌─ COGNITIO CIVITAS ─────────────────────────────────────
  │  Terminal del Templo — Monte Palatino
  │  http://localhost:3000
  │  núcleo activo · modelo claude-opus-5-5 · esfuerzo low
  │  Canon: 3 documentos · 147.289 caracteres
  └────────────────────────────────────────────────────────
```

**Esa cuarta línea es el diagnóstico más útil del proyecto.** Si pone `MODO
ORÁCULO`, la clave no ha llegado al contenedor y MISAIAL responderá con tres
frases pregrabadas en vez de con su voz.

Parar, actualizar, borrar:

```bash
docker compose down                 # para, conserva el progreso
docker compose up -d --build        # redespliega tras cambiar código
docker compose down -v              # ⚠ borra también el progreso de todas las jugadoras
```

### Sin Compose

```bash
docker build -t cognitio-civitas-terminal .

docker run -d --name misaial --init \
  -p 127.0.0.1:3000:3000 \
  -e ANTHROPIC_API_KEY="sk-ant-..." \
  -v misaial-datos:/app/data \
  --restart unless-stopped \
  cognitio-civitas-terminal
```

`--init` importa: sin él, `node` es PID 1 y las señales de parada se ignoran.
(El `ENTRYPOINT` ya incluye `tini`, así que en la práctica está cubierto por
partida doble.)

---

## 4. El progreso narrativo y su volumen

Todo lo que una jugadora ha desbloqueado —etapa, preguntas respondidas,
entradas del códice, historial de conversaciones— vive en un único archivo:
`/app/data/sesiones.json`. El navegador solo guarda el identificador de sesión,
de modo que nadie puede falsificar desbloqueos desde el cliente.

**Si no montas ese directorio, el progreso se borra cada vez que recreas el
contenedor.** El `Dockerfile` declara `VOLUME ["/app/data"]` como red de
seguridad, pero conviene montarlo explícitamente.

Copia de seguridad:

```bash
docker run --rm -v misaial-datos:/data -v "$PWD":/copia alpine \
  tar czf /copia/misaial-$(date +%F).tar.gz -C /data .
```

Restaurar:

```bash
docker run --rm -v misaial-datos:/data -v "$PWD":/copia alpine \
  tar xzf /copia/misaial-2026-11-10.tar.gz -C /data
```

### Si usas un bind mount en vez de un volumen

El contenedor corre como usuario `node` (uid 1000) y no puede escribir en una
carpeta del host que pertenezca a root:

```bash
mkdir -p ./data && sudo chown -R 1000:1000 ./data
docker run ... -v "$PWD/data:/app/data" ...
```

Si te lo saltas verás `[store] no se pudo guardar: EACCES` en los logs y el
progreso se perderá en silencio al reiniciar.

---

## 5. Ponerlo en internet

La aplicación habla HTTP plano. Delante va un proxy que termine TLS.

### Caddy (lo más corto que existe)

```caddyfile
misaial.tudominio.com {
    reverse_proxy localhost:3000
}
```

Caddy saca y renueva el certificado de Let's Encrypt solo. No hay más.

### Nginx

```nginx
server {
    listen 443 ssl http2;
    server_name misaial.tudominio.com;

    ssl_certificate     /etc/letsencrypt/live/misaial.tudominio.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/misaial.tudominio.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;

        # ── Imprescindible: las respuestas van por Server-Sent Events ──
        # Con el búfer activado, nginx retiene la respuesta entera y la suelta
        # de golpe al final. La terminal deja de escribir letra a letra y la
        # ilusión de que MISAIAL piensa se desmorona.
        proxy_buffering off;
        proxy_cache off;

        # Una consulta con esfuerzo alto puede tardar más de un minuto.
        proxy_read_timeout 300s;
    }
}
```

El servidor ya envía `X-Accel-Buffering: no`, que nginx respeta, pero dejarlo
explícito evita sorpresas si alguien toca la configuración global.

**Cloudflare:** el proxy naranja deja pasar SSE, pero si alguna vez ves las
respuestas llegando de golpe, crea una Page Rule con *Cache Level: Bypass* para
`/api/*`.

### Plataformas gestionadas

| Plataforma | Qué tener en cuenta |
|---|---|
| **Fly.io** | Buena opción. Monta un volumen de Fly en `/app/data` y pon `min_machines_running = 1`: si la máquina se duerme, la partida en curso se corta a media respuesta. |
| **Railway / Render** | Detectan el `Dockerfile` solos. Necesitas un *persistent disk* montado en `/app/data`; el plan gratuito de Render no tiene, así que el progreso se borraría en cada redespliegue. |
| **VPS (Hetzner, DigitalOcean…)** | Lo más previsible y barato para esto. Compose + Caddy y listo. |
| **Vercel / Netlify** | **No sirven.** Son serverless: sin disco persistente y con límites de duración que cortan el streaming. |

---

## 6. Qué cuesta esto

Cada consulta envía el canon completo como *system prompt*: del orden de
**40.000 tokens de entrada** por mensaje (147 KB de texto). Es el grueso de la
factura, no la respuesta.

**La caché de prompt ya está puesta, y bien puesta.** `construirSistema()` en
`server/persona.js` parte el prompt en tres bloques por volatilidad: el canon
—estable byte a byte— con `ttl: '1h'`, el bloque sellado con el TTL corto por
defecto, y el estado variable al final sin cachear, que es justo donde debe ir.
Eso convierte la mayor parte de esos 40.000 tokens en lecturas de caché a una
fracción del precio.

Lo que sí conviene vigilar en producción:

1. **Comprobar que la caché acierta de verdad.** `responder()` ya recibe
   `final.usage` pero lo descarta. Registrar `cache_read_input_tokens` en los
   logs cuesta una línea y te dice si algo está invalidando el prefijo. Si sale
   cero de forma repetida, es que el canon dejó de ser estable.
2. **El TTL de una hora cuesta dinero si nadie juega.** Escribir en caché es más
   caro que no usarla; sale rentable cuando hay partidas seguidas. Para una
   terminal con visitas muy espaciadas, el TTL de cinco minutos por defecto
   puede salir más barato.
3. **Modelo y esfuerzo.** `MISAIAL_MODELO=claude-sonnet-5-5` cuesta la mitad por
   token. `MISAIAL_ESFUERZO` ya está en `low`, que es lo correcto para
   conversación.

Si la terminal va a estar abierta al público, pon un límite de gasto en la
[consola de Anthropic](https://console.anthropic.com/) antes de publicar la URL.
La aplicación **no tiene autenticación ni límite de peticiones**: cualquiera con
el enlace puede consultar todo lo que quiera contra tu clave.

---

## 7. Comprobaciones tras desplegar

```bash
# 1. ¿Vive?
curl -s localhost:3000/api/canon | head -c 120
# Debe responder JSON con 3 documentos.

# 2. ¿Está el núcleo activo o en modo oráculo?
docker compose logs | grep -E "núcleo activo|MODO ORÁCULO"

# 3. ¿Fluye el streaming? (gasta una consulta real)
curl -N -X POST localhost:3000/api/consulta \
  -H 'content-type: application/json' \
  -d '{"mensaje":"¿Quién eres?"}'
# Los fragmentos deben ir apareciendo poco a poco, no todos de golpe al final.

# 4. ¿Está sana la sonda?
docker inspect --format '{{.State.Health.Status}}' misaial
```

El contenedor se considera sano consultando `/api/canon`. **No apuntes ninguna
sonda a `/api/estado`**: esa ruta crea una sesión nueva en cada llamada que no
traiga cabecera `x-sesion`, y acabarías con un archivo de sesiones lleno de
fantasmas, uno cada treinta segundos.

---

## 8. Cuando algo va mal

| Síntoma | Causa casi segura |
|---|---|
| Cabecera de la web en `modo oráculo`; respuestas pregrabadas | `ANTHROPIC_API_KEY` no llegó al contenedor. Compruébalo con `docker compose exec misaial sh -c 'test -n "$ANTHROPIC_API_KEY" && echo presente \|\| echo AUSENTE'`. |
| `Credencial del núcleo rechazada` | Clave inválida, revocada o sin saldo. |
| `El núcleo está saturado` | Límite de peticiones (429). Espera o sube el *rate limit* en la consola. |
| La respuesta aparece entera y de golpe | Búfer del proxy. Revisa `proxy_buffering off` (§5). |
| La respuesta se corta tras las primeras palabras | Era un bug del servidor en la detección de abandono del cliente, ya corregido en `server/index.js`. Si reaparece, revisa que `enviar()` mire `res`, nunca `req`. |
| `[store] no se pudo guardar: EACCES` | Permisos del bind mount. Ver §4. |
| El progreso desaparece en cada redespliegue | No hay volumen montado en `/app/data`. |
| MISAIAL responde sin conocer el mundo | Los `.md` de `server/lore/` no están en la imagen. No cambies `/*.md` por `*.md` en `.dockerignore`. |

---

## 9. Detalle conocido

Al parar el contenedor, se puede perder **el último mensaje** de una conversación
que estuviera justo en vuelo. `server/store.js` agrupa las escrituras en una
ventana de 150 ms con un temporizador `unref()`, y el servidor no atiende
`SIGTERM`, así que Node puede salir con esa escritura aún pendiente.

En la práctica apenas se nota —y nunca corrompe el archivo, porque la escritura
es atómica— pero si quieres cerrarlo del todo hacen falta **dos** cambios, no
uno. El `persistir()` que hay hoy no sirve para esto: se limita a llamar a
`guardar()`, que programa el volcado 150 ms más tarde. Si lo invocas y sales
acto seguido, el temporizador nunca llega a dispararse y pierdes exactamente lo
que querías salvar.

Primero, una variante síncrona en `server/store.js`:

```js
/** Vuelca ya, sin esperar la ventana de 150 ms. Para el apagado. */
export function persistirAhora() {
  if (pendiente) {
    clearTimeout(pendiente);
    pendiente = null;
  }
  const tmp = `${ARCHIVO}.tmp`;
  writeFileSync(tmp, JSON.stringify(db, null, 2), 'utf8');
  renameSync(tmp, ARCHIVO);
}
```

Y después, al final de `server/index.js`:

```js
const servidor = app.listen(CONFIG.puerto, () => { /* … */ });

for (const señal of ['SIGTERM', 'SIGINT']) {
  process.on(señal, () => {
    servidor.close(() => {
      store.persistirAhora();
      process.exit(0);
    });
  });
}
```

No está implementado. Lo dejo anotado aquí para que no se pierda.
