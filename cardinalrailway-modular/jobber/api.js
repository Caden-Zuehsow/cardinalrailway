const JOBBER_API = "https://api.getjobber.com/api/graphql";
const JOBBER_OAUTH = "https://api.getjobber.com/api/oauth";
const JOBBER_GRAPHQL_VERSION = "2025-04-16";

async function refreshJobberToken(pool) {
  const result = await pool.query(`SELECT * FROM jobber_tokens WHERE id = 1`);
  if (result.rows.length === 0) throw new Error("Jobber is not connected.");
  const stored = result.rows[0];
  const tokenResponse = await fetch(`${JOBBER_OAUTH}/token`, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: process.env.JOBBER_CLIENT_ID, client_secret: process.env.JOBBER_CLIENT_SECRET, grant_type: "refresh_token", refresh_token: stored.refresh_token })
  });
  const tokenData = await tokenResponse.json();
  if (!tokenResponse.ok) { console.error("Jobber refresh failed:", tokenData); throw new Error("Could not refresh Jobber access token."); }
  const expiresAt = new Date(Date.now() + (tokenData.expires_in || 3600) * 1000);
  await pool.query(`UPDATE jobber_tokens SET access_token=$1, refresh_token=$2, expires_at=$3, updated_at=NOW() WHERE id=1`, [tokenData.access_token, tokenData.refresh_token, expiresAt]);
  return tokenData.access_token;
}

function createJobberAccessTokenGetter(pool) {
  return async function getJobberAccessToken() {
    const result = await pool.query(`SELECT * FROM jobber_tokens WHERE id = 1`);
    if (result.rows.length === 0) throw new Error("Jobber is not connected.");
    const token = result.rows[0];
    const expiresAt = new Date(token.expires_at).getTime();
    if (Date.now() >= expiresAt - 5 * 60 * 1000) return refreshJobberToken(pool);
    return token.access_token;
  };
}

module.exports = { JOBBER_API, JOBBER_OAUTH, JOBBER_GRAPHQL_VERSION, refreshJobberToken, createJobberAccessTokenGetter };
