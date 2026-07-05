# Learn Croatian

A personal Croatian reading and sentence-mining app for turning useful sentences into Anki cards.

## Setup

```bash
npm install
cp .env.example .env
npm run dev
```

The client runs with Vite and the local API server stores runtime state under `data/`. Local texts and generated app data are intentionally ignored because they can contain personal study material, generated cards, progress, settings, and audio media.

## Scripts

- `npm run dev` starts the API server and Vite client.
- `npm run build` checks TypeScript and builds the client.
- `npm start` starts the API server.
