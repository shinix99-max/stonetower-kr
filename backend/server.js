import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import sqlite3 from "sqlite3";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

const PORT = process.env.PORT ? Number(process.env.PORT) : 8787;
const DB_PATH = process.env.DB_PATH || path.join(__dirname, "data.sqlite");

const db = new sqlite3.Database(DB_PATH);

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

async function initDb() {
  await run(
    `CREATE TABLE IF NOT EXISTS counters (
      key TEXT PRIMARY KEY,
      value INTEGER NOT NULL
    )`
  );
  await run(
    `CREATE TABLE IF NOT EXISTS scores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nickname TEXT NOT NULL,
      floors INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    )`
  );
  // initialize counter if missing
  await run(
    `INSERT OR IGNORE INTO counters (key, value) VALUES ('base_drops', 0)`
  );
}

const app = express();

app.use(cors({ origin: true }));
app.use(express.json({ limit: "200kb" }));

// ---- API ----
app.get("/api/stats", async (_req, res) => {
  try {
    const row = await get(`SELECT value FROM counters WHERE key = 'base_drops'`);
    res.json({ totalBaseDrops: row?.value ?? 0 });
  } catch (e) {
    res.status(500).json({ error: "failed_to_get_stats" });
  }
});

app.post("/api/tower/start", async (_req, res) => {
  try {
    await run(
      `UPDATE counters SET value = value + 1 WHERE key = 'base_drops'`
    );
    const row = await get(`SELECT value FROM counters WHERE key = 'base_drops'`);
    res.json({ totalBaseDrops: row?.value ?? 0 });
  } catch (e) {
    res.status(500).json({ error: "failed_to_increment" });
  }
});

app.post("/api/score", async (req, res) => {
  try {
    const nickname = String(req.body?.nickname || "").trim();
    const floors = Number(req.body?.floors);
    if (!nickname || !Number.isFinite(floors) || floors <= 0) {
      return res.status(400).json({ error: "invalid_payload" });
    }
    await run(
      `INSERT INTO scores (nickname, floors, created_at) VALUES (?, ?, ?)`,
      [nickname, Math.floor(floors), Date.now()]
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: "failed_to_save_score" });
  }
});

app.get("/api/leaderboard", async (req, res) => {
  try {
    const top = Math.max(1, Math.min(10, Number(req.query?.top ?? 3) || 3));
    // top per nickname (best score), tie-breaker: earliest submission time for that best score
    const rows = await all(
      `
      SELECT nickname, MAX(floors) AS floors, MIN(created_at) AS first_at
      FROM scores
      GROUP BY nickname
      ORDER BY floors DESC, first_at ASC
      LIMIT ?
      `,
      [top]
    );
    res.json({
      top: rows.map((r, idx) => ({
        rank: idx + 1,
        nickname: r.nickname,
        floors: r.floors,
      })),
    });
  } catch (e) {
    res.status(500).json({ error: "failed_to_get_leaderboard" });
  }
});

// ---- Static hosting (optional): serve the existing index.html from project root ----
app.use(express.static(projectRoot));
app.get("/", (_req, res) => res.sendFile(path.join(projectRoot, "index.html")));

initDb()
  .then(() => {
    app.listen(PORT, () => {
      // eslint-disable-next-line no-console
      console.log(`backend listening on http://localhost:${PORT}`);
    });
  })
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error("failed to init db", e);
    process.exit(1);
  });


