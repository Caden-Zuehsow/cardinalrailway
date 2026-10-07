const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

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

  console.log("Database initialized");
}

app.get("/", (req, res) => {
  res.json({
    status: "online",
    service: "Cardinal Mechanical Attribution API"
  });
});

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

app.post("/api/attribution", async (req, res) => {
  try {
    const {
      visitor_id,
      gclid,
      utm_source,
      utm_medium,
      utm_campaign,
      utm_term,
      utm_content,
      landing_page,
      referrer,
      traffic_source
    } = req.body;

    const result = await pool.query(
      `
      INSERT INTO attributions (
        visitor_id,
        gclid,
        utm_source,
        utm_medium,
        utm_campaign,
        utm_term,
        utm_content,
        landing_page,
        referrer,
        traffic_source
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      RETURNING id, created_at
      `,
      [
        visitor_id || null,
        gclid || null,
        utm_source || null,
        utm_medium || null,
        utm_campaign || null,
        utm_term || null,
        utm_content || null,
        landing_page || null,
        referrer || null,
        traffic_source || null
      ]
    );

    res.status(201).json({
      success: true,
      attribution_id: result.rows[0].id,
      created_at: result.rows[0].created_at
    });
  } catch (error) {
    console.error("Attribution error:", error);

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
