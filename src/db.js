import pg from 'pg';
import 'dotenv/config';

const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

export async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS songs (
      id            SERIAL PRIMARY KEY,
      spotify_id    VARCHAR(64) UNIQUE NOT NULL,
      title         TEXT NOT NULL,
      artist        TEXT NOT NULL,
      preview_url   TEXT NOT NULL,
      genre         TEXT,
      energy        FLOAT,
      last_played   TIMESTAMP,
      created_at    TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS game_sessions (
      id                SERIAL PRIMARY KEY,
      room_code         VARCHAR(6) UNIQUE NOT NULL,
      status            VARCHAR(20) NOT NULL DEFAULT 'waiting',
      imposter_count    INT DEFAULT 1,
      imposter_mode     VARCHAR(10) DEFAULT 'song',
      civilian_song_id  INT REFERENCES songs(id),
      imposter_song_id  INT REFERENCES songs(id),
      host_socket_id    TEXT,
      created_at        TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS players (
      id              SERIAL PRIMARY KEY,
      session_id      INT REFERENCES game_sessions(id) ON DELETE CASCADE,
      name            TEXT NOT NULL,
      role            VARCHAR(10),
      socket_id       TEXT,
      is_ready        BOOLEAN DEFAULT FALSE,
      votes_received  INT DEFAULT 0,
      created_at      TIMESTAMP DEFAULT NOW()
    );
  `);
  // Safe migrations — add new columns without dropping existing data
  await pool.query(`
    ALTER TABLE game_sessions ADD COLUMN IF NOT EXISTS total_rounds INT DEFAULT 1;
    ALTER TABLE game_sessions ADD COLUMN IF NOT EXISTS current_round INT DEFAULT 1;
  `);
  console.log('Database initialized');
}
