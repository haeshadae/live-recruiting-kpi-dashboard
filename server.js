const express = require("express");
const cors = require("cors");
const sqlite3 = require("sqlite3").verbose();
const path = require("path");

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());




// Create / connect to database
const db = new sqlite3.Database("./recruiting.db");

const sseClients = new Set();
function broadcastUpdate(payload = {}) {
  const msg = `data: ${JSON.stringify({ type: "updated", ...payload, at: new Date().toISOString() })}\n\n`;
  for (const res of sseClients) {
    res.write(msg);
  }
}

// Create candidates table if it doesn't exist
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS candidates (
      candidate_id TEXT PRIMARY KEY,
      full_name TEXT,
      email TEXT,
      source TEXT,
      event_name TEXT,
      role TEXT,
      outreach_date TEXT,
      interview_stage TEXT,
      touchpoints INTEGER,
      hire_date TEXT,
      notes TEXT
    )
  `);
});

// Test route
app.get("/", (req, res) => {
  res.send("Sapien Recruiting Dashboard is running 🚀");
});
app.post("/sync-row", (req, res) => {
  const row = req.body;

  // Basic validation: we must have candidate_id
  if (!row.candidate_id) {
    return res.status(400).json({ error: "candidate_id is required" });
  }

  const sql = `
    INSERT INTO candidates (
      candidate_id, full_name, email, source, event_name, role,
      outreach_date, interview_stage, touchpoints, hire_date, notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(candidate_id) DO UPDATE SET
      full_name=excluded.full_name,
      email=excluded.email,
      source=excluded.source,
      event_name=excluded.event_name,
      role=excluded.role,
      outreach_date=excluded.outreach_date,
      interview_stage=excluded.interview_stage,
      touchpoints=excluded.touchpoints,
      hire_date=excluded.hire_date,
      notes=excluded.notes
  `;

  const values = [
    row.candidate_id,
    row.full_name || null,
    row.email || null,
    row.source || null,
    row.event_name || null,
    row.role || null,
    row.outreach_date || null,
    row.interview_stage || null,
    row.touchpoints !== undefined && row.touchpoints !== "" ? Number(row.touchpoints) : null,
    row.hire_date || null,
    row.notes || null
  ];

  db.run(sql, values, function (err) {
    if (err) {
      console.error("DB upsert error:", err);
      return res.status(500).json({ error: "Database error" });
    }
    broadcastUpdate({ candidate_id: row.candidate_id });
    return res.json({ ok: true, upserted_candidate_id: row.candidate_id });
  });
});
app.get("/metrics", (req, res) => {
  // Helper: stage counts as "interviewed" if at Interview/Offer/Hired
  const interviewedStages = ["Interview", "Offer", "Hired"];

  // 1) Event -> Interview conversion
  const eventSql = `
    SELECT
      event_name,
      COUNT(*) as leads,
      SUM(CASE WHEN interview_stage IN ('Interview','Offer','Hired') THEN 1 ELSE 0 END) as interviews
    FROM candidates
    WHERE event_name IS NOT NULL AND event_name != ''
    GROUP BY event_name
    ORDER BY leads DESC
  `;

  // 2) Touchpoints -> Hire (for hired only)
  // We'll compute avg in SQL and median in JS.
  const touchSql = `
    SELECT touchpoints
    FROM candidates
    WHERE hire_date IS NOT NULL AND hire_date != ''
      AND touchpoints IS NOT NULL
    ORDER BY touchpoints ASC
  `;

  // 3) Channel performance (source)
  const channelSql = `
    SELECT
      source,
      COUNT(*) as leads,
      SUM(CASE WHEN interview_stage IN ('Interview','Offer','Hired') THEN 1 ELSE 0 END) as interviews,
      SUM(CASE WHEN hire_date IS NOT NULL AND hire_date != '' THEN 1 ELSE 0 END) as hires
    FROM candidates
    WHERE source IS NOT NULL AND source != ''
    GROUP BY source
    ORDER BY leads DESC
  `;

  db.all(eventSql, [], (err, eventRows) => {
    if (err) return res.status(500).json({ error: "Database error (events)" });

    db.all(touchSql, [], (err2, touchRows) => {
      if (err2) return res.status(500).json({ error: "Database error (touchpoints)" });

      db.all(channelSql, [], (err3, channelRows) => {
        if (err3) return res.status(500).json({ error: "Database error (channels)" });

        // Compute event conversion rates
        const eventConversion = eventRows.map(r => ({
          event_name: r.event_name,
          leads: r.leads,
          interviews: r.interviews,
          interview_rate: r.leads ? +(r.interviews / r.leads).toFixed(3) : 0
        }));

        // Compute avg + median touchpoints to hire
        const touches = touchRows.map(r => Number(r.touchpoints)).filter(n => !Number.isNaN(n));
        let avg = null;
        let median = null;

        if (touches.length > 0) {
          const sum = touches.reduce((a, b) => a + b, 0);
          avg = +(sum / touches.length).toFixed(2);

          const mid = Math.floor(touches.length / 2);
          if (touches.length % 2 === 0) {
            median = (touches[mid - 1] + touches[mid]) / 2;
          } else {
            median = touches[mid];
          }
        }

        // Compute channel rates
        const channelPerformance = channelRows.map(r => {
          const leads = r.leads || 0;
          const interviews = r.interviews || 0;
          const hires = r.hires || 0;

          return {
            source: r.source,
            leads,
            interviews,
            hires,
            interview_rate: leads ? +(interviews / leads).toFixed(3) : 0,
            hire_rate: leads ? +(hires / leads).toFixed(3) : 0,
            hire_from_interview_rate: interviews ? +(hires / interviews).toFixed(3) : 0
          };
        });

        res.json({
          updated_at: new Date().toISOString(),
          event_conversion: eventConversion,
          touchpoints_to_hire: {
            hired_count: touches.length,
            avg_touchpoints: avg,
            median_touchpoints: median
          },
          channel_performance: channelPerformance
        });
      });
    });
  });
});
app.get("/dashboard", (req, res) => {
  res.send(`
<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Live Recruiting KPI Dashboard</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica, Arial, sans-serif; margin: 0; background: #f6f7fb; color: #111; }
    .container { max-width: 1100px; margin: 32px auto; padding: 0 16px; }
    .header { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; }
    h1 { font-size: 26px; margin: 0; }
    .sub { color: #555; font-size: 13px; }
    .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin: 16px 0 20px; }
    .card { background: white; border-radius: 14px; padding: 14px 16px; box-shadow: 0 1px 8px rgba(0,0,0,0.06); }
    .kpi { font-size: 22px; font-weight: 700; margin-top: 6px; }
    .label { font-size: 12px; color: #666; text-transform: uppercase; letter-spacing: .04em; }
    .section { margin-top: 14px; }
    .section h2 { font-size: 16px; margin: 0 0 10px; }
    table { width: 100%; border-collapse: collapse; background: white; border-radius: 14px; overflow: hidden; box-shadow: 0 1px 8px rgba(0,0,0,0.06); }
    th, td { padding: 10px 12px; border-bottom: 1px solid #eee; text-align: left; font-size: 13px; }
    th { background: #fafafa; color: #444; font-weight: 600; }
    tr:last-child td { border-bottom: none; }
    .pill { display:inline-block; padding: 2px 8px; border-radius: 999px; background:#eef2ff; color:#3730a3; font-size:12px; }
    .muted { color:#666; }
    .right { text-align:right; }
    @media (max-width: 900px) { .grid { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div>
        <h1>Live Recruiting KPI Dashboard</h1>
        <div class="sub">Source of truth: Google Sheets → Zapier → SQLite → Metrics</div>
      </div>
      <div class="sub">Last updated: <span id="updatedAt">—</span></div>
    </div>

    <div class="grid">
      <div class="card">
        <div class="label">Hires in DB</div>
        <div class="kpi" id="hireCount">—</div>
        <div class="sub muted">Rows with hire_date filled</div>
      </div>
      <div class="card">
        <div class="label">Avg Touchpoints to Hire</div>
        <div class="kpi" id="avgTouches">—</div>
        <div class="sub muted">Hired only</div>
      </div>
      <div class="card">
        <div class="label">Median Touchpoints to Hire</div>
        <div class="kpi" id="medianTouches">—</div>
        <div class="sub muted">Hired only</div>
      </div>
    </div>

    <div class="section">
      <h2>1) Event → Interview Conversion</h2>
      <table>
        <thead>
          <tr>
            <th>Event</th>
            <th class="right">Leads</th>
            <th class="right">Interviews+</th>
            <th class="right">Interview Rate</th>
          </tr>
        </thead>
        <tbody id="eventRows"></tbody>
      </table>
    </div>

    <div class="section">
      <h2>3) Channel Performance</h2>
      <table>
        <thead>
          <tr>
            <th>Source</th>
            <th class="right">Leads</th>
            <th class="right">Interviews+</th>
            <th class="right">Hires</th>
            <th class="right">Interview Rate</th>
            <th class="right">Hire Rate</th>
          </tr>
        </thead>
        <tbody id="channelRows"></tbody>
      </table>
    </div>

    <div class="section sub muted">
      Auto refreshes every ~3 minutes. (Once Zapier is connected, editing a row in Sheets will update these metrics.)
    </div>
  </div>

<script>
  function pct(x) {
    if (x === null || x === undefined) return "—";
    return (x * 100).toFixed(1) + "%";
  }

  async function load() {
    const res = await fetch("/metrics");
    const data = await res.json();

    document.getElementById("updatedAt").textContent = new Date(data.updated_at).toLocaleString();

    const hiredCount = data.touchpoints_to_hire?.hired_count ?? 0;
    document.getElementById("hireCount").textContent = hiredCount;

    document.getElementById("avgTouches").textContent =
      data.touchpoints_to_hire.avg_touchpoints === null ? "—" : data.touchpoints_to_hire.avg_touchpoints;

    document.getElementById("medianTouches").textContent =
      data.touchpoints_to_hire.median_touchpoints === null ? "—" : data.touchpoints_to_hire.median_touchpoints;

    const eventTbody = document.getElementById("eventRows");
    eventTbody.innerHTML = "";
    const events = data.event_conversion || [];
    if (events.length === 0) {
      eventTbody.innerHTML = '<tr><td colspan="4" class="muted">No event rows yet.</td></tr>';
    } else {
      for (const r of events) {
        const tr = document.createElement("tr");
        tr.innerHTML = \`
          <td><span class="pill">\${r.event_name}</span></td>
          <td class="right">\${r.leads}</td>
          <td class="right">\${r.interviews}</td>
          <td class="right">\${pct(r.interview_rate)}</td>
        \`;
        eventTbody.appendChild(tr);
      }
    }

    const channelTbody = document.getElementById("channelRows");
    channelTbody.innerHTML = "";
    const channels = data.channel_performance || [];
    if (channels.length === 0) {
      channelTbody.innerHTML = '<tr><td colspan="6" class="muted">No channel rows yet.</td></tr>';
    } else {
      for (const r of channels) {
        const tr = document.createElement("tr");
        tr.innerHTML = \`
          <td><span class="pill">\${r.source}</span></td>
          <td class="right">\${r.leads}</td>
          <td class="right">\${r.interviews}</td>
          <td class="right">\${r.hires}</td>
          <td class="right">\${pct(r.interview_rate)}</td>
          <td class="right">\${pct(r.hire_rate)}</td>
        \`;
        channelTbody.appendChild(tr);
      }
    }
  }

  load();
  const es = new EventSource("/events");
es.onmessage = () => {
  load();
};

  setInterval(load, 30000);
</script>
</body>
</html>
  `);
});

app.get("/debug/hires", (req, res) => {
  db.all(
    `SELECT candidate_id, full_name, hire_date
     FROM candidates
     WHERE hire_date IS NOT NULL AND hire_date != ''
     ORDER BY hire_date DESC`,
    [],
    (err, rows) => {
      if (err) return res.status(500).json({ error: "db error" });
      res.json({ count: rows.length, hires: rows });
    }
  );
});
app.get("/events", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  // send a hello immediately so the browser knows it's connected
  res.write(`data: ${JSON.stringify({ type: "connected", at: new Date().toISOString() })}\n\n`);

  sseClients.add(res);

  req.on("close", () => {
    sseClients.delete(res);
  });
});
// Start server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});