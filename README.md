# Rainbet Leaderboard – v7.5 (PNG snapshots with Puppeteer)

New:
- Auto **PNG** snapshot when countdown hits 0 (and from Admin “Save Snapshot (PNG)”).
- Snapshots saved to `data/snapshots/<id>.json` and `data/snapshots/<id>.png`.
- Browse at `#/past` (shows PNG links). Dedicated `#/snapshot/:id` route renders a clean, screenshot‑friendly view.

Run locally:
```bash
npm install
cp .env.example .env   # set values
npm run dev
```
> On first install, Puppeteer will download Chromium (~100MB). If your site runs on a different port/host, set `SITE_ORIGIN` in `.env`.
