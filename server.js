const express = require("express");
const { Pool } = require("pg");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

// Create attribution table if it doesn't exist
async function initializeDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS attributions (
      id SERIAL PRIMARY KEY,
      gclid TEXT,
      utm_source TEXT,
      utm_medium TEXT,
      utm_campaign TEXT,
      utm_term TEXT,
      utm_content TEXT,
      landing_page TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  console.log("Database initialized");
}

// Health check
app.get("/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");

    res.json({
      status: "ok",
      database: "connected"
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      status: "error",
      database: "disconnected"
    });
  }
});

// Save attribution data
app.post("/api/attribution", async (req, res) => {
  try {
    const {
      gclid,
      utm_source,
      utm_medium,
      utm_campaign,
      utm_term,
      utm_content,
      landing_page
    } = req.body;

    const result = await pool.query(
      `
      INSERT INTO attributions
      (
        gclid,
        utm_source,
        utm_medium,
        utm_campaign,
        utm_term,
        utm_content,
        landing_page
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id, created_at
      `,
      [
        gclid || null,
        utm_source || null,
        utm_medium || null,
        utm_campaign || null,
        utm_term || null,
        utm_content || null,
        landing_page || null
      ]
    );

    res.status(201).json({
      success: true,
      attribution_id: result.rows[0].id,
      created_at: result.rows[0].created_at
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      success: false,
      error: "Could not save attribution"
    });
  }
});

initializeDatabase()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  })
  .catch((error) => {
    console.error("Database initialization failed:", error);
    process.exit(1);
  });
