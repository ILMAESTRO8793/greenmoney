import express from 'express';
import cors from 'cors';
import { db, initSchema } from './db/database.js';
import { router } from './routes/api.js';
import { seedIfEmpty } from './db/seed.js';
import { importEuropeanLeagues } from './db/importEuropeanLeagues.js';

initSchema();
seedIfEmpty();

const app = express();

const allowedOrigin = process.env.FRONTEND_URL;
app.use(cors(allowedOrigin ? { origin: allowedOrigin } : {}));
app.use(express.json());

app.get('/api/health', (req, res) => res.json({ status: 'ok', service: 'greenmoney-backend' }));
app.use('/api', router);

app.get('/api/admin/import-leagues', async (req, res) => {
  const adminSecret = process.env.ADMIN_IMPORT_SECRET;
  const footballDataToken = process.env.FOOTBALL_DATA_TOKEN;

  if (!adminSecret) {
    return res.status(503).json({ error: 'ADMIN_IMPORT_SECRET no está configurado en el servidor.' });
  }
  if (req.query.secret !== adminSecret) {
    return res.status(403).json({ error: 'Secreto inválido.' });
  }
  if (!footballDataToken) {
    return res.status(503).json({ error: 'FOOTBALL_DATA_TOKEN no está configurado en el servidor.' });
  }

  try {
    const summary = await importEuropeanLeagues(footballDataToken);
    res.json({ ok: true, summary });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Error interno del servidor.' });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Greenmoney API corriendo en http://localhost:${PORT}`);
});