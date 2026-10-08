const crypto = require("crypto");
const { JOBBER_API, JOBBER_OAUTH, JOBBER_GRAPHQL_VERSION } = require("./api");

function base64UrlEncode(buffer) { return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, ""); }
function createCodeVerifier() { return base64UrlEncode(crypto.randomBytes(32)); }
function createCodeChallenge(codeVerifier) { return base64UrlEncode(crypto.createHash("sha256").update(codeVerifier).digest()); }
function createState() { return base64UrlEncode(crypto.randomBytes(32)); }

function registerJobberOAuth(app, pool) {
  app.get("/jobber/connect", async (req, res) => {
    try {
      const clientId = process.env.JOBBER_CLIENT_ID;
      const redirectUri = process.env.JOBBER_REDIRECT_URI;
      if (!clientId || !redirectUri) return res.status(500).send("Missing JOBBER_CLIENT_ID or JOBBER_REDIRECT_URI.");
      const state = createState();
      const codeVerifier = createCodeVerifier();
      const codeChallenge = createCodeChallenge(codeVerifier);
      await pool.query(`INSERT INTO jobber_oauth_states (state, code_verifier) VALUES ($1, $2)`, [state, codeVerifier]);
      const params = new URLSearchParams({ response_type:"code", client_id:clientId, redirect_uri:redirectUri, state, code_challenge:codeChallenge, code_challenge_method:"S256" });
      res.redirect(`${JOBBER_OAUTH}/authorize?${params.toString()}`);
    } catch (error) { console.error("Jobber connect error:", error); res.status(500).send("Could not start Jobber authorization."); }
  });

  app.get("/jobber/callback", async (req, res) => {
    try {
      const { code, state, error, error_description } = req.query;
      if (error) return res.status(400).send(`Jobber authorization failed: ${error_description || error}`);
      if (!code || !state) return res.status(400).send("Missing authorization code or state.");
      const stateResult = await pool.query(`SELECT code_verifier FROM jobber_oauth_states WHERE state = $1`, [state]);
      if (stateResult.rows.length === 0) return res.status(400).send("Invalid or expired OAuth state.");
      const codeVerifier = stateResult.rows[0].code_verifier;
      await pool.query(`DELETE FROM jobber_oauth_states WHERE state = $1`, [state]);
      const tokenResponse = await fetch(`${JOBBER_OAUTH}/token`, { method:"POST", headers:{"Content-Type":"application/x-www-form-urlencoded"}, body:new URLSearchParams({client_id:process.env.JOBBER_CLIENT_ID, client_secret:process.env.JOBBER_CLIENT_SECRET, grant_type:"authorization_code", code, redirect_uri:process.env.JOBBER_REDIRECT_URI, code_verifier:codeVerifier}) });
      const tokenData = await tokenResponse.json();
      if (!tokenResponse.ok) { console.error("Jobber token exchange failed:", tokenData); return res.status(500).send("Jobber token exchange failed. Check Railway logs."); }
      const { access_token, refresh_token, expires_in } = tokenData;
      if (!access_token || !refresh_token) return res.status(500).send("Jobber did not return the expected tokens.");
      const accountResult = await fetch(JOBBER_API, { method:"POST", headers:{Authorization:`Bearer ${access_token}`, "X-JOBBER-GRAPHQL-VERSION":JOBBER_GRAPHQL_VERSION, "Content-Type":"application/json"}, body:JSON.stringify({query:`query GetAccount { account { id name } }`}) });
      const accountData = await accountResult.json();
      if (!accountResult.ok || accountData.errors) { console.error("Jobber account query failed:", accountData); return res.status(500).send("Connected to Jobber, but could not read the account."); }
      const account = accountData.data.account;
      const expiresAt = new Date(Date.now() + (expires_in || 3600) * 1000);
      await pool.query(`
        INSERT INTO jobber_tokens (id,account_id,account_name,access_token,refresh_token,expires_at,updated_at)
        VALUES (1,$1,$2,$3,$4,$5,NOW())
        ON CONFLICT (id) DO UPDATE SET account_id=EXCLUDED.account_id, account_name=EXCLUDED.account_name, access_token=EXCLUDED.access_token, refresh_token=EXCLUDED.refresh_token, expires_at=EXCLUDED.expires_at, updated_at=NOW()
      `, [account.id,account.name,access_token,refresh_token,expiresAt]);
      res.send(`<!DOCTYPE html><html><head><title>Jobber Connected</title><style>body{font-family:Arial,sans-serif;max-width:700px;margin:80px auto;padding:20px;line-height:1.6}.success{font-size:24px;font-weight:bold}</style></head><body><div class="success">Jobber connected successfully.</div><p>Connected account: <strong>${account.name || "Jobber account"}</strong></p><p>You can close this window.</p></body></html>`);
    } catch (error) { console.error("Jobber callback error:", error); res.status(500).send("Jobber callback failed. Check Railway logs."); }
  });
}

module.exports = { registerJobberOAuth };
