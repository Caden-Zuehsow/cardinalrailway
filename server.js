const express = require("express");
const cors = require("cors");

const { pool, initializeDatabase } = require("./database");
const { registerAttribution } = require("./attribution/attribution");
const { registerJobberOAuth } = require("./jobber/oauth");
const { registerJobberConnection } = require("./jobber-connection");
const { createJobberAccessTokenGetter } = require("./jobber/api");
const { registerJobberWebhook } = require("./jobber/webhook");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());

// Jobber webhook needs the raw request body for HMAC verification.
// This MUST come before express.json().
app.use(
  "/webhooks/jobber",
  express.raw({ type: "application/json" })
);

app.use(express.json());

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

const getJobberAccessToken =
  createJobberAccessTokenGetter(pool);

registerAttribution(app, pool);

registerJobberOAuth(app, pool);

registerJobberConnection(
  app,
  getJobberAccessToken
);

// Jobber webhook endpoint
registerJobberWebhook(app, pool);

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
