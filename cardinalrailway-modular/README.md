# Cardinal Railway modular structure

- `server.js` — app, middleware, health, startup, module registration.
- `database.js` — PostgreSQL pool and table initialization.
- `attribution/attribution.js` — attribution endpoint.
- `jobber/api.js` — Jobber API constants and token refresh/access logic.
- `jobber/oauth.js` — Jobber OAuth connect/callback.
- `jobber-connection.js` — `/jobber/test`.

The Jobber raw-body middleware remains in `server.js` for the webhook handler to be added later.
