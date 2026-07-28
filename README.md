# Agente de Voz

Hablas, el navegador transcribe (STT), Gemini genera la respuesta con el rol
que elijas (persona), y el navegador la lee en voz alta (TTS). Frontend en
React (Vite), backend en Express.

## Arquitectura

```
client/  (React + Vite)              server/  (Express)
────────────────────────             ──────────────────
Orbe animado + micrófono   ──POST──► /api/session
(Web Speech API: STT/TTS)             crea un chat de Gemini con tu
                                       "rol" como systemInstruction
        │
        ▼
   fetch('/api/message') ──────────► /api/message
                                       chat.sendMessage(texto)
        │                             (el chat ya recuerda todo el
        ▼                              historial anterior)
🔊 responde en voz  ◄──────────────  { text }
```

La API key de Gemini vive solo en `server/` (`.env`), nunca en el código del navegador.

## Requisitos

- [Node.js](https://nodejs.org) 18+
- Una API key gratuita de Gemini: [Google AI Studio](https://aistudio.google.com) → sección de API keys
- Chrome o Edge de escritorio (mejor soporte de reconocimiento de voz; Firefox no lo soporta, Safari es limitado)

## Instalación

```bash
npm run install:all
cp server/.env.example server/.env
# abre server/.env y pega tu API key en GEMINI_API_KEY
```

### Modo desarrollo (recomendado mientras programas)

```bash
npm run dev
```

Esto levanta el servidor Express (puerto 3000) y Vite (puerto 5173) al mismo
tiempo. Abre **http://localhost:5173** — Vite le hace proxy a `/api` hacia el
servidor automáticamente (ver `client/vite.config.js`), así que no hay que
configurar nada más. Los cambios en React se recargan solos (HMR).

### Modo producción (un solo servidor)

```bash
npm run build   # compila client/ hacia client/dist
npm start       # Express sirve la API y el sitio compilado juntos
```

Abre **http://localhost:3000**.

## Qué cambió en esta versión

- **React de verdad** (Vite), no HTML/JS inyectado: componentes separados en
  `client/src/components` (`Orb`, `PersonaSetup`, `Transcript`) y la lógica de
  voz en hooks reutilizables (`client/src/hooks`).
- **Orbe animado en vez de ícono de micrófono**: `Orb.jsx` + `Orb.css`. Cambia
  de color y "energía" según el estado (escuchando/pensando/hablando) usando
  gradientes en capas y animaciones CSS — nada de imágenes ni librerías extra.
- **Ya no corta al respirar**: antes `continuous = false` hacía que el
  navegador cortara la grabación apenas detectaba una pausa corta. Ahora
  `client/src/hooks/useSpeechRecognition.js` usa `continuous = true`: el
  micrófono se queda escuchando pase lo que pase, y transcribe en vivo (lo ves
  bajo el orbe mientras hablas). **Tú decides cuándo terminaste tocando el
  orbe de nuevo** — recién ahí se envía el texto a Gemini.
- El servidor (`server/`) casi no cambió: sigue siendo el único que toca la
  API key y sigue usando `ai.chats.create()` con `systemInstruction` para que
  el rol se mantenga durante toda la conversación.

## De dónde salen las vacantes

Las vacantes no se escriben a mano: se leen de la colección `vacantes` en
Mongo (`agente_voz.vacantes`), la misma base que usa el dashboard de RRHH del
otro microservicio para publicarlas. `GET /api/vacantes` solo trae las que
tienen `estado: "abierta"`; al elegir una, `POST /api/session` recupera el
documento completo (`titulo`, `descripcion`, `requisitos`, `ubicacion`,
`modalidad`, etc.) y con eso arma el plan de preguntas y el `systemInstruction`
del entrevistador (ver `generarPlanEntrevista`/`crearChatEntrevista` en
`server/gemini.js`). Si esa colección está vacía, el selector del cliente
simplemente no muestra vacantes.

## Notas y próximos pasos

- **Idioma de voz**: constante `SPEECH_LANG` en `client/src/constants.js`
  (`es-ES`, `es-CO`, `es-MX`, `es-US`...).
- **Sesiones en memoria**: si reinicias el servidor, las conversaciones
  activas se pierden. Para algo persistente, reemplaza el `Map` en
  `server/server.js` por Redis o una base de datos.
- **Voces más naturales**: la voz del navegador (SpeechSynthesis) es gratis
  pero suena algo robótica. El siguiente paso natural es cambiar esa parte por
  ElevenLabs o Google Cloud Text-to-Speech.
- **Conversación 100% por voz sin backend propio**: Gemini también tiene una
  "Live API" (audio de entrada y salida por WebSocket) que junta STT +
  generación + TTS en una sola conexión. Más compleja de integrar, pero vale
  la pena explorarla si el proyecto crece.
- **Despliegue**: cualquier hosting de Node (Render, Railway, Fly.io...) sirve
  para `npm run build && npm start` — solo recuerda configurar
  `GEMINI_API_KEY` como variable de entorno ahí también, nunca en el código.
