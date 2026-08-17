import express from 'express';
import cors from 'cors';
import { db, initSchema } from './db/database.js';
import { router } from './routes/api.js';
import { seedIfEmpty } from './db/seed.js';

initSchema();
seedIfEmpty();

const app = express();

// In production, only allow the deployed frontend's origin. In development
// (no FRONTEND_URL set), allow all origins so localhost/Vite proxy works freely.
const allowedOrigin = process.env.FRONTEND_URL;
app.use(cors(allowedOrigin ? { origin: allowedOrigin } : {}));
app.use(express.json());

app.get('/api/health', (req, res) => res.json({ status: 'ok', service: 'greenmoney-backend' }));
app.use('/api', router);

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Error interno del servidor.' });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Greenmoney API corriendo en http://localhost:${PORT}`);
});
