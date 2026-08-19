import pg from 'pg';

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error('Falta la variable de entorno DATABASE_URL (connection string de Postgres).');
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

export async function initSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS leagues (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      country TEXT,
      rho REAL DEFAULT -0.08,
      rho_updated_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS teams (
      id SERIAL PRIMARY KEY,
      league_id INTEGER NOT NULL REFERENCES leagues(id),
      name TEXT NOT NULL,
      short_name TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(league_id, name)
    );

    CREATE TABLE IF NOT EXISTS matches (
      id SERIAL PRIMARY KEY,
      league_id INTEGER NOT NULL REFERENCES leagues(id),
      home_team_id INTEGER NOT NULL REFERENCES teams(id),
      away_team_id INTEGER NOT NULL REFERENCES teams(id),
      home_goals INTEGER NOT NULL,
      away_goals INTEGER NOT NULL,
      played_at TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS fixtures (
      id SERIAL PRIMARY KEY,
      league_id INTEGER NOT NULL REFERENCES leagues(id),
      home_team_id INTEGER NOT NULL REFERENCES teams(id),
      away_team_id INTEGER NOT NULL REFERENCES teams(id),
      kickoff_at TEXT NOT NULL,
      home_goals INTEGER,
      away_goals INTEGER,
      status TEXT DEFAULT 'NS',
      external_id TEXT UNIQUE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS lineup_cache (
      id SERIAL PRIMARY KEY,
      fixture_id INTEGER NOT NULL REFERENCES fixtures(id),
      kind TEXT NOT NULL,
      payload TEXT NOT NULL,
      cached_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(fixture_id, kind)
    );

    CREATE TABLE IF NOT EXISTS analyses (
      id SERIAL PRIMARY KEY,
      league_id INTEGER NOT NULL REFERENCES leagues(id),
      home_team_id INTEGER NOT NULL REFERENCES teams(id),
      away_team_id INTEGER NOT NULL REFERENCES teams(id),
      lambda_home REAL NOT NULL,
      lambda_away REAL NOT NULL,
      rho_used REAL NOT NULL,
      result_json TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_matches_league ON matches(league_id);
    CREATE INDEX IF NOT EXISTS idx_matches_home ON matches(home_team_id);
    CREATE INDEX IF NOT EXISTS idx_matches_away ON matches(away_team_id);
    CREATE INDEX IF NOT EXISTS idx_analyses_league ON analyses(league_id);
    CREATE INDEX IF NOT EXISTS idx_fixtures_league ON fixtures(league_id);
    CREATE INDEX IF NOT EXISTS idx_fixtures_kickoff ON fixtures(kickoff_at);
    CREATE INDEX IF NOT EXISTS idx_lineup_cache_fixture ON lineup_cache(fixture_id);
  `);

  // Migration for databases created before fixtures had result columns.
  await pool.query(`
    ALTER TABLE fixtures ADD COLUMN IF NOT EXISTS home_goals INTEGER;
    ALTER TABLE fixtures ADD COLUMN IF NOT EXISTS away_goals INTEGER;
    ALTER TABLE fixtures ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'NS';
  `);
  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fixtures_external_id_key'
      ) THEN
        ALTER TABLE fixtures ADD CONSTRAINT fixtures_external_id_key UNIQUE (external_id);
      END IF;
    END $$;
  `);
}