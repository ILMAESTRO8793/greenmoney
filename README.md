# Greenmoney

Plataforma de análisis deportivo con inteligencia artificial. Calcula probabilidades
reales y cuotas matemáticamente justas (sin overround) usando el modelo Dixon-Coles,
a partir del historial de goles de cada equipo.

## Estructura

```
greenmoney-full/
├── backend/     API en Node/Express + SQLite (better-sqlite3)
└── frontend/    React + Vite
```

## Cómo correrlo localmente

### 1. Backend

```bash
cd backend
npm install
npm run seed     # crea y llena la base de datos de ejemplo (3 ligas, ~2400 partidos)
npm start        # http://localhost:4000
```

### 2. Frontend (en otra terminal)

```bash
cd frontend
npm install
npm run dev       # http://localhost:5173
```

Abre http://localhost:5173 — el frontend habla con el backend a través del proxy
configurado en `vite.config.js`.

## Qué incluye

- **Motor Dixon-Coles** (`backend/src/services/dixonColes.js`):
  - Fuerza de ataque/defensa por equipo, local y visitante, relativa al promedio de liga
  - Goles esperados (lambda) por partido
  - Matriz completa de probabilidad de marcadores (Poisson + corrección Dixon-Coles)
  - **Normalización exacta a 1.0** — cero overround, verificable en cada mercado
  - **Estimación automática de rho por máxima verosimilitud (MLE)**, calculada por
    liga a partir de su propio historial de partidos (grid search + refinamiento)
  - Mercados: 1X2, Over/Under 1.5/2.5/3.5, BTTS, marcador exacto

- **Base de datos** (SQLite vía better-sqlite3): ligas, equipos, partidos históricos,
  y análisis guardados (historial persistente)

- **API REST**:
  - `GET  /api/leagues`
  - `GET  /api/leagues/:id/teams`
  - `GET  /api/leagues/:id/stats`
  - `POST /api/analyze` — `{ leagueId, homeTeamId, awayTeamId }`
  - `GET  /api/history`
  - `DELETE /api/history/:id`

- **Frontend React**: selector de liga/equipos, panel de resultados con cuotas
  justas, mapa de calor de marcadores, lectura narrativa automática, historial
  persistente con opción de borrar.

## Siguientes pasos sugeridos

- Reemplazar el seed de datos de ejemplo por un feed real de estadísticas (API
  de fútbol, o carga manual vía un endpoint de importación)
- Autenticación de usuario si vas a lanzarlo públicamente
- Sección de comparación contra cuotas reales de mercado para detectar "valor"
- Desplegar backend (Render/Railway) + frontend (Vercel/Netlify)

## Nota legal

Greenmoney es una herramienta de análisis estadístico y entretenimiento. No opera
apuestas y no garantiza resultados deportivos.
