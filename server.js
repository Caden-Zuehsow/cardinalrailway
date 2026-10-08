const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const { Pool } = require("pg");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());

app.use(
  "/webhooks/jobber",
  express.raw({ type: "application/json" })
);

app.use(express.json());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

const JOBBER_API = "https://api.getjobber.com/api/graphql";
const JOBBER_OAUTH = "https://api.getjobber.com/api/oauth";
const JOBBER_GRAPHQL_VERSION = "2025-04-16";

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

  console.log("Database initialized");
}

function base64UrlEncode(buffer) {
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

function createCodeVerifier() {
  return base64UrlEncode(crypto.randomBytes(32));
}

function createCodeChallenge(codeVerifier) {
  return base64UrlEncode(
    crypto
      .createHash("sha256")
      .update(codeVerifier)
      .digest()
  );
}

function createState() {
  return base64UrlEncode(crypto.randomBytes(32));
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

/*
|--------------------------------------------------------------------------
| ATTRIBUTION
|--------------------------------------------------------------------------
*/

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

/*
|--------------------------------------------------------------------------
| JOBBER OAUTH
|--------------------------------------------------------------------------
*/

app.get("/jobber/connect", async (req, res) => {
  try {
    const clientId = process.env.JOBBER_CLIENT_ID;
    const redirectUri = process.env.JOBBER_REDIRECT_URI;

    if (!clientId || !redirectUri) {
      return res.status(500).send(
        "Missing JOBBER_CLIENT_ID or JOBBER_REDIRECT_URI."
      );
    }

    const state = createState();
    const codeVerifier = createCodeVerifier();
    const codeChallenge = createCodeChallenge(codeVerifier);

    await pool.query(
      `
      INSERT INTO jobber_oauth_states (
        state,
        code_verifier
      )
      VALUES ($1, $2)
      `,
      [state, codeVerifier]
    );

    const params = new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: redirectUri,
      state,
      code_challenge: codeChallenge,
      code_challenge_method: "S256"
    });

    const authorizationUrl =
      `https://api.getjobber.com/api/oauth/authorize?${params.toString()}`;

    res.redirect(authorizationUrl);
  } catch (error) {
    console.error("Jobber connect error:", error);

    res.status(500).send(
      "Could not start Jobber authorization."
    );
  }
});

app.get("/jobber/callback", async (req, res) => {
  try {
    const {
      code,
      state,
      error,
      error_description
    } = req.query;

    if (error) {
      return res.status(400).send(
        `Jobber authorization failed: ${
          error_description || error
        }`
      );
    }

    if (!code || !state) {
      return res.status(400).send(
        "Missing authorization code or state."
      );
    }

    const stateResult = await pool.query(
      `
      SELECT code_verifier
      FROM jobber_oauth_states
      WHERE state = $1
      `,
      [state]
    );

    if (stateResult.rows.length === 0) {
      return res.status(400).send(
        "Invalid or expired OAuth state."
      );
    }

    const codeVerifier =
      stateResult.rows[0].code_verifier;

    await pool.query(
      `
      DELETE FROM jobber_oauth_states
      WHERE state = $1
      `,
      [state]
    );

    const tokenResponse = await fetch(
      `${JOBBER_OAUTH}/token`,
      {
        method: "POST",
        headers: {
          "Content-Type":
            "application/x-www-form-urlencoded"
        },
        body: new URLSearchParams({
          client_id: process.env.JOBBER_CLIENT_ID,
          client_secret:
            process.env.JOBBER_CLIENT_SECRET,
          grant_type: "authorization_code",
          code,
          redirect_uri:
            process.env.JOBBER_REDIRECT_URI,
          code_verifier: codeVerifier
        })
      }
    );

    const tokenData = await tokenResponse.json();

    if (!tokenResponse.ok) {
      console.error(
        "Jobber token exchange failed:",
        tokenData
      );

      return res.status(500).send(
        "Jobber token exchange failed. Check Railway logs."
      );
    }

    const {
      access_token,
      refresh_token,
      expires_in
    } = tokenData;

    if (!access_token || !refresh_token) {
      return res.status(500).send(
        "Jobber did not return the expected tokens."
      );
    }

    const accountResult = await fetch(
      JOBBER_API,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${access_token}`,
          "X-JOBBER-GRAPHQL-VERSION":
            JOBBER_GRAPHQL_VERSION,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          query: `
            query GetAccount {
              account {
                id
                name
              }
            }
          `
        })
      }
    );

    const accountData = await accountResult.json();

    if (!accountResult.ok || accountData.errors) {
      console.error(
        "Jobber account query failed:",
        accountData
      );

      return res.status(500).send(
        "Connected to Jobber, but could not read the account."
      );
    }

    const account =
      accountData.data.account;

    const expiresAt = new Date(
      Date.now() + (expires_in || 3600) * 1000
    );

    await pool.query(
      `
      INSERT INTO jobber_tokens (
        id,
        account_id,
        account_name,
        access_token,
        refresh_token,
        expires_at,
        updated_at
      )
      VALUES (
        1,
        $1,
        $2,
        $3,
        $4,
        $5,
        NOW()
      )
      ON CONFLICT (id)
      DO UPDATE SET
        account_id = EXCLUDED.account_id,
        account_name = EXCLUDED.account_name,
        access_token = EXCLUDED.access_token,
        refresh_token = EXCLUDED.refresh_token,
        expires_at = EXCLUDED.expires_at,
        updated_at = NOW()
      `,
      [
        account.id,
        account.name,
        access_token,
        refresh_token,
        expiresAt
      ]
    );

    res.send(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Jobber Connected</title>
          <style>
            body {
              font-family: Arial, sans-serif;
              max-width: 700px;
              margin: 80px auto;
              padding: 20px;
              line-height: 1.6;
            }
            .success {
              font-size: 24px;
              font-weight: bold;
            }
          </style>
        </head>
        <body>
          <div class="success">
            Jobber connected successfully.
          </div>

          <p>
            Connected account:
            <strong>${account.name || "Jobber account"}</strong>
          </p>

          <p>
            You can close this window.
          </p>
        </body>
      </html>
    `);
  } catch (error) {
    console.error("Jobber callback error:", error);

    res.status(500).send(
      "Jobber callback failed. Check Railway logs."
    );
  }
});

/*
|--------------------------------------------------------------------------
| JOBBER API HELPER
|--------------------------------------------------------------------------
*/

async function refreshJobberToken() {
  const result = await pool.query(
    `
    SELECT *
    FROM jobber_tokens
    WHERE id = 1
    `
  );

  if (result.rows.length === 0) {
    throw new Error("Jobber is not connected.");
  }

  const stored = result.rows[0];

  const tokenResponse = await fetch(
    `${JOBBER_OAUTH}/token`,
    {
      method: "POST",
      headers: {
        "Content-Type":
          "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({
        client_id:
          process.env.JOBBER_CLIENT_ID,
        client_secret:
          process.env.JOBBER_CLIENT_SECRET,
        grant_type: "refresh_token",
        refresh_token:
          stored.refresh_token
      })
    }
  );

  const tokenData =
    await tokenResponse.json();

  if (!tokenResponse.ok) {
    console.error(
      "Jobber refresh failed:",
      tokenData
    );

    throw new Error(
      "Could not refresh Jobber access token."
    );
  }

  const expiresAt = new Date(
    Date.now() +
      (tokenData.expires_in || 3600) * 1000
  );

  await pool.query(
    `
    UPDATE jobber_tokens
    SET
      access_token = $1,
      refresh_token = $2,
      expires_at = $3,
      updated_at = NOW()
    WHERE id = 1
    `,
    [
      tokenData.access_token,
      tokenData.refresh_token,
      expiresAt
    ]
  );

  return tokenData.access_token;
}

async function getJobberAccessToken() {
  const result = await pool.query(
    `
    SELECT *
    FROM jobber_tokens
    WHERE id = 1
    `
  );

  if (result.rows.length === 0) {
    throw new Error("Jobber is not connected.");
  }

  const token = result.rows[0];

  const expiresAt =
    new Date(token.expires_at).getTime();

  const fiveMinutes =
    5 * 60 * 1000;

  if (Date.now() >= expiresAt - fiveMinutes) {
    return await refreshJobberToken();
  }

  return token.access_token;
}

/*
|--------------------------------------------------------------------------
| JOBBER CONNECTION TEST
|--------------------------------------------------------------------------
*/

app.get("/jobber/test", async (req, res) => {
  try {
    const accessToken =
      await getJobberAccessToken();

    const response = await fetch(
      JOBBER_API,
      {
        method: "POST",
        headers: {
          Authorization:
            `Bearer ${accessToken}`,
          "X-JOBBER-GRAPHQL-VERSION":
            JOBBER_GRAPHQL_VERSION,
          "Content-Type":
            "application/json"
        },
        body: JSON.stringify({
          query: `
            query GetAccount {
              account {
                id
                name
              }
            }
          `
        })
      }
    );

    const data = await response.json();

    if (!response.ok || data.errors) {
      console.error(
        "Jobber API test failed:",
        data
      );

      return res.status(500).json({
        success: false,
        error: data.errors || data
      });
    }

    res.json({
      success: true,
      jobber_account: data.data.account
    });
  } catch (error) {
    console.error(
      "Jobber test error:",
      error
    );

    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

initializeDatabase()
  .then(() => {
    app.listen(PORT, () => {
      console.log(
        `Server running on port ${PORT}`
      );
    });
  })
  .catch((error) => {
    console.error(
      "Database initialization failed:",
      error
    );

    process.exit(1);
  });
