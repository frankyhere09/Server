# Guess Character — Render backend

## Render
- Runtime: Node
- Build command: `npm install`
- Start command: `npm start`

Set these Render environment variables:
- `FRONTEND_URL` = your Netlify URL, e.g. `https://mygame.netlify.app`
- `BACKEND_URL` = your Render URL, e.g. `https://mygame-api.onrender.com`
- `DISCORD_CLIENT_ID`
- `DISCORD_CLIENT_SECRET`
- `DISCORD_REDIRECT_URI` = `https://mygame-api.onrender.com/auth/discord/callback`
- `MONGODB_URI` = exact URI copied from MongoDB Atlas Drivers
- `JWT_SECRET` = long random secret

## Discord
In Discord Developer Portal, add this exact redirect URL:
`https://YOUR-RENDER-SERVICE.onrender.com/auth/discord/callback`

## MongoDB
Do not manually invent the Atlas hostname. Copy the current URI from:
Atlas → Database → Connect → Drivers → Node.js.

For Atlas Network Access, allow the Render service to reach the cluster. For initial testing, Atlas can use `0.0.0.0/0`; tighten it later if desired.

## Health check
Open:
`https://YOUR-RENDER-SERVICE.onrender.com/health`

It should return JSON with `ok: true`.

## Architecture
Netlify serves the UI. Render provides:
- Discord OAuth
- JWT authentication
- Socket.IO real-time matchmaking
- public player list
- invites
- PvP rooms
- question/guess validation
- leaderboard/stats
MongoDB stores registered users and competitive statistics.

The backend can start with in-memory fallback if MongoDB is temporarily unavailable, but persistent online statistics require a working MongoDB connection.
