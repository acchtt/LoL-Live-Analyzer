# LoL Live Analyzer

A lightweight live League of Legends esports dashboard built around Riot's public-facing LoL Esports web feeds.

## Features

- Lists live and upcoming professional LoL matches.
- Resolves event and game IDs.
- Loads live game frames from Riot's LoL Esports feed.
- Shows kills, gold, towers, dragons, Barons and player statistics.
- Exposes a compact, stable JSON representation designed for ChatGPT and other assistants.
- Pauses browser polling when the tab is hidden.

## Architecture

```text
Riot LoL Esports endpoints
          ↓
Cloudflare Worker proxy and normalizer
          ↓
GitHub Pages dashboard + /api/chatgpt JSON
```

The dashboard is static and can be hosted on GitHub Pages. The Worker is required because Riot's browser-facing endpoints can change CORS behavior and should not be polled independently by every UI component.

## Worker endpoints

- `GET /api/schedule`
- `GET /api/event?id=EVENT_ID`
- `GET /api/window?gameId=GAME_ID`
- `GET /api/details?gameId=GAME_ID`
- `GET /api/chatgpt?gameId=GAME_ID`
- `GET /health`

The ChatGPT endpoint returns a compact schema with team totals, differences, players, objectives and a plain-English state summary.

## Deploy the Worker

1. Open Cloudflare Dashboard → Workers & Pages.
2. Create a Worker named `lol-live-analyzer-api`.
3. Paste the contents of `worker.js` into the editor.
4. Deploy it.
5. Copy the Worker URL.
6. Edit `assets/app.js` and replace `WORKER_BASE` with that URL.

No secret API key is required. The `x-api-key` used by the LoL Esports website is a public client identifier, not a private Riot developer key.

## Deploy the dashboard

Enable GitHub Pages for the repository:

- Settings → Pages
- Source: Deploy from branch
- Branch: `main`
- Folder: `/ (root)`

The site will appear at:

`https://acchtt.github.io/LoL-Live-Analyzer/`

## ChatGPT usage

Once the Worker is deployed, give ChatGPT a URL like:

```text
https://YOUR-WORKER.workers.dev/api/chatgpt?gameId=GAME_ID
```

Then ask it to read the current game state and explain the teams' advantages. The endpoint includes `schemaVersion`, `updatedAt`, source information and explicit field names to make ingestion reliable.

## Important notes

- Riot does not document these LoL Esports web endpoints as a guaranteed public developer API.
- Endpoint formats may change.
- Poll responsibly. The dashboard uses a 15-second interval only for an actively selected live game and stops while hidden.
- This project is for esports viewing and analysis. It intentionally contains no gambling or wagering features.
