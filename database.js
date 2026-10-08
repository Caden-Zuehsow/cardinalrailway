const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

async function initializeDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS attributions (
      id SERIAL PRIMARY KEY,
      visitor_id TEXT,
      gclid TEXT,
      utm_source TEXT,
      utm_medium TEXT,
      utm_campaign TEXT,
      utm_term TEXT,
      utm_content TEXT,
      landing_page TEXT,
      referrer TEXT,
      traffic_source TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  const columns = [
    ["visitor_id", "TEXT"],
    ["referrer", "TEXT"],
    ["traffic_source", "TEXT"]
  ];

  for (const [column, type] of columns) {
    await pool.query(`
      ALTER TABLE attributions
      ADD COLUMN IF NOT EXISTS ${column} ${type};
    `);
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS jobber_tokens (
      id INTEGER PRIMARY KEY DEFAULT 1,
      account_id TEXT,
      account_name TEXT,
      access_token TEXT NOT NULL,
      refresh_token TEXT NOT NULL,
      expires_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS jobber_oauth_states (
      state TEXT PRIMARY KEY,
      code_verifier TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  // Stores incoming Jobber webhook events
  await pool.query(`
    CREATE TABLE IF NOT EXISTS jobber_webhook_events (
      id SERIAL PRIMARY KEY,
      topic TEXT,
      account_id TEXT,
      item_id TEXT,
      occurred_at TIMESTAMPTZ,
      received_at TIMESTAMPTZ DEFAULT NOW(),
      payload JSONB
    );
  `);

  console.log("Database initialized");
}

module.exports = {
  pool,
  initializeDatabase
};
