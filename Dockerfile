# syntax=docker/dockerfile:1

# ═════════════════════════════════════════════════════════════════════════════
# COGNITIO CIVITAS — Terminal del Templo
#
# Imagen de dos etapas. La primera resuelve dependencias; la segunda solo
# recibe el resultado, de modo que ni el registro de npm ni la caché de
# compilación acaban en la imagen final.
# ═════════════════════════════════════════════════════════════════════════════

# ───────────────────────── etapa 1 · dependencias ────────────────────────────
FROM node:22-alpine AS deps

WORKDIR /app

# Se copian solo los manifiestos: mientras no cambien, Docker reutiliza esta
# capa y no vuelve a descargar nada.
COPY package.json package-lock.json ./

RUN npm ci --omit=dev && npm cache clean --force


# ───────────────────────── etapa 2 · ejecución ───────────────────────────────
FROM node:22-alpine AS runtime

# tini recoge señales y procesos huérfanos cuando el contenedor arranca sin
# `--init`. Sin él, node es PID 1 y los SIGTERM de un redespliegue se pierden.
RUN apk add --no-cache tini

ENV NODE_ENV=production \
    PORT=3000

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY server ./server
COPY public ./public

# El archivo de sesiones se escribe en /app/data. Se crea aquí, con el dueño
# correcto, para que el usuario `node` (sin privilegios) pueda escribir en él.
RUN mkdir -p /app/data && chown -R node:node /app/data

# Declarado para que el progreso narrativo no muera con el contenedor aunque
# alguien lo arranque sin `-v`. Un bind mount o un volumen con nombre lo
# sustituye sin problema.
VOLUME ["/app/data"]

USER node

EXPOSE 3000

# La sonda pega a /api/canon, que es de solo lectura.
# NO usar /api/estado: esa ruta crea una sesión nueva en cada llamada sin
# cabecera `x-sesion`, así que la convertiría en una fábrica de sesiones
# fantasma, una cada treinta segundos.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/canon').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server/index.js"]
