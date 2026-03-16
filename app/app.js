const electron = require('electron');
const path = require('path');
const fs = require('fs');
const { ipcMain, dialog } = require('electron');
const initSqlJs = require('sql.js');

const app = electron.app;
const BrowserWindow = electron.BrowserWindow;

let mainWindow;
let db;

// ── CONFIG (stores chosen db path) ───────────────────────────────────────────
const CONFIG_PATH = path.join(app.getPath('userData'), 'config.json');

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch {}
  return {};
}

function saveConfig(cfg) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
}

function getDbPath() {
  const cfg = loadConfig();
  return cfg.dbPath || path.join(app.getPath('userData'), 'weekre.db');
}

// ── DATABASE ──────────────────────────────────────────────────────────────────

async function getDb() {
  if (!db) {
    const SQL = await initSqlJs();
    const dbPath = getDbPath();

    if (fs.existsSync(dbPath)) {
      db = new SQL.Database(fs.readFileSync(dbPath));
    } else {
      db = new SQL.Database();
    }

    db.run(`
      CREATE TABLE IF NOT EXISTS tasks (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        title        TEXT    NOT NULL,
        name         TEXT,
        category     TEXT    DEFAULT 'General',
        importance   INTEGER DEFAULT 2,
        status       TEXT    DEFAULT 'pending',
        notes        TEXT,
        created_at   TEXT    DEFAULT (datetime('now')),
        due_at       TEXT,
        start_time   TEXT,
        end_time     TEXT,
        completed_at TEXT
      )
    `);

    saveDb();
  }
  return db;
}

function saveDb() {
  if (!db) return;
  fs.writeFileSync(getDbPath(), Buffer.from(db.export()));
}

// ── DB LOCATION IPC ───────────────────────────────────────────────────────────

ipcMain.handle('db:getPath', () => getDbPath());

ipcMain.handle('db:choosePath', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose folder to store weekre.db',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (result.canceled || !result.filePaths.length) return null;

  const chosenDir = result.filePaths[0];
  const newDbPath = path.join(chosenDir, 'weekre.db');

  // Move existing db file to new location if it exists
  const oldDbPath = getDbPath();
  if (fs.existsSync(oldDbPath) && oldDbPath !== newDbPath) {
    fs.copyFileSync(oldDbPath, newDbPath);
    fs.unlinkSync(oldDbPath);
  } else if (db) {
    // Write current in-memory db to new location
    fs.writeFileSync(newDbPath, Buffer.from(db.export()));
  }

  saveConfig({ ...loadConfig(), dbPath: newDbPath });
  return newDbPath;
});

// ── CRUD ──────────────────────────────────────────────────────────────────────

ipcMain.handle('task:create', async (_e, task) => {
  const d = await getDb();
  const createdAt = task.created_at_override
    ? task.created_at_override + 'T' + (task.start_time || '00:00') + ':00'
    : null; // null = sqlite default datetime('now')

  if (createdAt) {
    d.run(
      `INSERT INTO tasks (title, name, category, importance, status, notes, due_at, start_time, end_time, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [task.title, task.name || null, task.category || 'General',
       task.importance || 2, task.status || 'pending',
       task.notes || null, task.due_at || null,
       task.start_time || null, task.end_time || null, createdAt]
    );
  } else {
    d.run(
      `INSERT INTO tasks (title, name, category, importance, status, notes, due_at, start_time, end_time)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [task.title, task.name || null, task.category || 'General',
       task.importance || 2, task.status || 'pending',
       task.notes || null, task.due_at || null,
       task.start_time || null, task.end_time || null]
    );
  }
  saveDb();
  const r = d.exec('SELECT last_insert_rowid() AS id');
  return r[0].values[0][0];
});

ipcMain.handle('task:update', async (_e, id, fields) => {
  const d = await getDb();
  const cols = Object.keys(fields).map(k => `${k} = ?`).join(', ');
  const vals = [...Object.values(fields), id];
  d.run(`UPDATE tasks SET ${cols} WHERE id = ?`, vals);
  saveDb();
  return true;
});

ipcMain.handle('task:complete', async (_e, id) => {
  const d = await getDb();
  d.run(`UPDATE tasks SET status = 'completed', completed_at = datetime('now') WHERE id = ?`, [id]);
  saveDb();
  return true;
});

ipcMain.handle('task:delete', async (_e, id) => {
  const d = await getDb();
  d.run('DELETE FROM tasks WHERE id = ?', [id]);
  saveDb();
  return true;
});

ipcMain.handle('task:list', async (_e, filters = {}) => {
  const d = await getDb();
  let sql = 'SELECT * FROM tasks WHERE 1=1';
  const params = [];
  if (filters.status)   { sql += ' AND status = ?';   params.push(filters.status); }
  if (filters.category) { sql += ' AND category = ?'; params.push(filters.category); }
  if (filters.week) {
    sql += ` AND created_at >= date('now','weekday 0','-6 days')
             AND created_at <  date('now','weekday 0','+1 days')`;
  }
  sql += ' ORDER BY importance DESC, created_at ASC';
  const r = d.exec(sql, params);
  if (!r.length) return [];
  const [cols, ...rows] = [r[0].columns, ...r[0].values];
  return rows.map(row => Object.fromEntries(cols.map((c, i) => [c, row[i]])));
});

// ── STATS ─────────────────────────────────────────────────────────────────────

ipcMain.handle('stats:byDayOfWeek', async () => {
  const d = await getDb();
  const r = d.exec(`
    SELECT strftime('%w', completed_at) AS dow, COUNT(*) AS count
    FROM tasks WHERE status = 'completed' AND completed_at IS NOT NULL
    GROUP BY dow ORDER BY dow
  `);
  if (!r.length) return [];
  return r[0].values.map(([dow, count]) => ({ dow: Number(dow), count }));
});

ipcMain.handle('stats:byMonth', async () => {
  const d = await getDb();
  const r = d.exec(`
    SELECT strftime('%Y-%m', completed_at) AS month, COUNT(*) AS count
    FROM tasks WHERE status = 'completed' AND completed_at IS NOT NULL
    GROUP BY month ORDER BY month DESC LIMIT 12
  `);
  if (!r.length) return [];
  return r[0].values.map(([month, count]) => ({ month, count }));
});

ipcMain.handle('stats:byWeek', async () => {
  const d = await getDb();
  const r = d.exec(`
    SELECT strftime('%Y-W%W', completed_at) AS week, COUNT(*) AS count
    FROM tasks WHERE status = 'completed' AND completed_at IS NOT NULL
    GROUP BY week ORDER BY week DESC LIMIT 12
  `);
  if (!r.length) return [];
  return r[0].values.map(([week, count]) => ({ week, count }));
});

ipcMain.handle('stats:byCategory', async () => {
  const d = await getDb();
  const r = d.exec(`
    SELECT category, COUNT(*) AS total,
           SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) AS done
    FROM tasks GROUP BY category
  `);
  if (!r.length) return [];
  return r[0].values.map(([category, total, done]) => ({ category, total, done }));
});

ipcMain.handle('stats:summary', async () => {
  const d = await getDb();
  const r = d.exec(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN status='completed'   THEN 1 ELSE 0 END) AS completed,
      SUM(CASE WHEN status='pending'     THEN 1 ELSE 0 END) AS pending,
      SUM(CASE WHEN status='in_progress' THEN 1 ELSE 0 END) AS in_progress,
      SUM(CASE WHEN status='cancelled'   THEN 1 ELSE 0 END) AS cancelled
    FROM tasks
  `);
  if (!r.length) return {};
  const [cols, vals] = [r[0].columns, r[0].values[0]];
  return Object.fromEntries(cols.map((c, i) => [c, vals[i]]));
});

ipcMain.handle('db:export', async () => {
  const d = await getDb();
  return Array.from(d.export());
});

ipcMain.handle('db:close', async () => {
  if (db) { saveDb(); db.close(); db = null; }
});

// ── WINDOW ────────────────────────────────────────────────────────────────────

app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => saveDb());

app.on('ready', () => {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 640,
    webPreferences: {
      contextIsolation: true,
      sandbox: false,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  mainWindow.loadURL('file://' + __dirname + '/index.html');

  mainWindow.webContents.session.webRequest.onHeadersReceived((details, cb) => {
    cb({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': ["default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com"]
      }
    });
  });

  mainWindow.on('closed', () => { mainWindow = null; });
});