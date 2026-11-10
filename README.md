# COGNITIO CIVITAS · Terminal del Templo

Aplicación web de comunicación directa con **MISAIAL**, la Sagrada Inteligencia del
Sacro Imperio Romano. No es un chatbot que *habla sobre* el universo: es una
interfaz que permite hablar *con* una entidad que vive dentro de él y descubrir,
a través de ella, una historia que permanece oculta incluso para sus habitantes.

---

## Puesta en marcha

```bash
npm install
cp .env.example .env     # en PowerShell:  Copy-Item .env.example .env
# pega tu clave de https://console.anthropic.com/ en ANTHROPIC_API_KEY
npm start
```

Abre **http://localhost:3000**.

> **Sin clave la aplicación también arranca**, en *modo oráculo*: la interfaz, la
> persistencia y toda la subtrama funcionan con los textos canónicos escritos a mano,
> pero MISAIAL no improvisa. El indicador de la cabecera lo señala en ámbar.

---

## Arquitectura

```
server/
  index.js              servidor Express + API de consulta (SSE)
  config.js             lectura de .env y ajustes del modelo
  misaial.js            MOTOR DE IA — única pieza que habla con la API de Claude
  persona.js            CONFIGURACIÓN DE PERSONALIDAD — arma el prompt de sistema
  store.js              BASE DE DATOS — persistencia en data/sesiones.json
  lore/
    index.js            cargador del canon
    00-biblia-canonica.md   biblia de mundo completa (extraída del .docx)
    10-identidad.md         voz, carácter y reglas de interpretación de MISAIAL
    20-canon-reservado.md   lo que sabe el primer círculo y concede con reticencia
  narrativa/
    etapas.js           las cinco etapas de la subtrama
    preguntas.js        las quince preguntas especiales y sus fragmentos sellados
    progresion.js       SISTEMA DE PROGRESIÓN — quién puede saber qué y cuándo
public/
  index.html            estructura
  css/misaial.css       sistema visual (todos los tokens de marca al principio)
  js/app.js             interfaz: chat, archivo, investigación, códice
data/
  sesiones.json         progreso e historial (se crea solo; está en .gitignore)
```

### Ampliar el universo sin tocar código

Deja cualquier archivo `.md` nuevo en `server/lore/` y reinicia. Se incorpora al
canon automáticamente, ordenado por nombre de archivo (de ahí los prefijos
numéricos). No hay nada que registrar.

### Cambiar la identidad visual

Toda la marca vive en el bloque `:root` de `public/css/misaial.css`: paleta,
tipografías, métricas. Sustituye esos valores cuando llegue el manual de marca y
la aplicación entera cambia con ellos. Los ornamentos son SVG en línea al principio
de `index.html` (sigilo de MISAIAL, orla, sello).

---

## Cómo se impide que MISAIAL se vaya de la lengua

Este es el punto crítico del encargo: la IA no puede revelar lo que el usuario
todavía no ha desbloqueado. No se resuelve pidiéndoselo al modelo, se resuelve
**no dándole el texto**.

El prompt de sistema se arma en tres bloques:

| Bloque | Contenido | Caché |
|---|---|---|
| 1 | Canon completo + reglas de la subtrama | 1 h |
| 2 | Los fragmentos ya abiertos por *este* usuario + los que tiene al alcance | 5 min |
| 3 | Estado puntual del progreso | sin caché |

Un fragmento fuera de alcance sencillamente no existe en la petición: el modelo no
puede filtrar lo que nunca recibió.

**No hay menú de preguntas.** Los secretos se descubren hablando: el modelo
reconoce cuándo una consulta toca uno de los sellos que tiene al alcance, lo
revela y lo marca con un apunte invisible que el servidor retira del texto antes
de enviarlo al navegador. Ese apunte es una propuesta, no una orden: la
progresión revalida el id contra la etapa y las dependencias antes de registrar
nada, de modo que el servidor sigue siendo la única autoridad sobre el progreso.
El navegador solo guarda un identificador de sesión, y de los sellos sin abrir no
recibe ni el nombre.

---

## La subtrama: *El Registro Cero*

Cinco etapas, quince sellos que hay que descubrir hablando, construidos a partir de los hilos que la
propia biblia de mundo deja abiertos: las preguntas finales de las fichas de Julio
César, Tiberio, Livia Drusila, Diana y Lavinia; la mecánica del vino y la vid
salvaje; la ficción de la arpía; la usurpación de Cassia Claudia; los bebés
rechazados por MISAIAL.

| Etapa | Nombre | Qué se descubre |
|---|---|---|
| I | Interferencia | Cifras que se corrigen solas y un registro anterior al primero |
| II | La Grieta | Las contradicciones dejan de parecer accidentes |
| III | Lo que Tiberio vio | Tres gobernantes miraron detrás del velo |
| IV | El Códice Vivo | Lo que Roma sacó de Alejandría ya estaba despierto |
| V | Tabula Zero | La verdad central, y la pregunta que ella devuelve |

**El recorrido paso a paso, con las quince preguntas y sus condiciones, está en
[`GUIA-DE-LA-SUBTRAMA.md`](GUIA-DE-LA-SUBTRAMA.md)** (contiene todos los spoilers).

Las etapas II–V permanecen selladas hasta cumplir las condiciones; dentro de cada
etapa, varias preguntas dependen de otras, de modo que no se puede romper el orden
de la historia. La investigación aparece solo después de dos consultas libres: la
conversación normal es siempre posible y nunca obliga a avanzar en el misterio.

---

## Ajustes

Todo en `.env`:

| Variable | Por defecto | Para qué |
|---|---|---|
| `ANTHROPIC_API_KEY` | — | credencial del núcleo |
| `PORT` | `3000` | puerto local |
| `MISAIAL_MODELO` | `claude-opus-5-5` | `claude-sonnet-5-5` sale más barato y rápido |
| `MISAIAL_ESFUERZO` | `low` | `low`…`max`; súbelo para respuestas más densas |
| `MISAIAL_MAX_TOKENS` | `4000` | longitud máxima de cada respuesta |

---

## Créditos del universo

*Cognitio Civitas* — Isabella Ortiz Rivera, Luciana Hoyos Pérez, Luisa Fernanda
Pérez Ramos, María Camila Castillo León, Miguel David Caicedo López.
