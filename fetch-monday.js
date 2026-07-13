/* ============================================================
   Nancy Spains — Monday reader
   Runs on a schedule (GitHub Actions). Reads the Goals & Rocks
   board, works out each current-quarter rock's progress from its
   subtasks (% marked "Done"), and writes data.json for the TV
   dashboard. Read-only: it never changes anything in Monday.
   ============================================================ */

const TOKEN = process.env.MONDAY_TOKEN;          // set as a GitHub secret
const BOARD_ID = 5099940269;                     // 🎯 Goals & Rocks
const DEPT_COL   = "color_mm57e8mc";             // Department
const PERIOD_COL = "color_mm5738b3";             // Period (Q1..Q4 20xx)
const SUB_STATUS = "status";                     // subtask status column
const DONE_LABEL = "Done";                       // counts toward progress

if (!TOKEN) { console.error("Missing MONDAY_TOKEN"); process.exit(1); }

/* Work out the current calendar quarter from today's date, so the
   board rolls from Q3 -> Q4 -> Q1 automatically with no edits. */
function currentQuarter(d = new Date()) {
  const y = d.getFullYear();
  const q = Math.floor(d.getMonth() / 3) + 1;    // 1..4
  const sm = (q - 1) * 3;                         // start month index
  const iso = x => x.toISOString().slice(0, 10);
  const start = new Date(Date.UTC(y, sm, 1));
  const end   = new Date(Date.UTC(y, sm + 3, 0)); // last day of the quarter
  const mon = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return {
    label: `Q${q} ${y}`,
    sub:   `${mon[sm]} – ${mon[sm + 2]} ${y}`,
    start: iso(start),
    end:   iso(end)
  };
}

async function monday(query) {
  const res = await fetch("https://api.monday.com/v2", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": TOKEN },
    body: JSON.stringify({ query })
  });
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data;
}

function stamp() {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit"
  }).format(new Date());
}

(async () => {
  const quarter = currentQuarter();

  const data = await monday(`
    query {
      boards(ids: ${BOARD_ID}) {
        items_page(limit: 200) {
          items {
            name
            column_values(ids: ["${DEPT_COL}","${PERIOD_COL}"]) { id text }
            subitems { column_values(ids: ["${SUB_STATUS}"]) { text } }
          }
        }
      }
    }
  `);

  const items = data.boards[0].items_page.items;

  const departments = items
    .filter(it => {
      const period = (it.column_values.find(c => c.id === PERIOD_COL) || {}).text;
      return period === quarter.label;              // only this quarter's rocks
    })
    .map(it => {
      const dept = (it.column_values.find(c => c.id === DEPT_COL) || {}).text || "—";
      const subs = it.subitems || [];
      const total = subs.length;
      const done = subs.filter(s =>
        ((s.column_values[0] || {}).text || "").trim() === DONE_LABEL
      ).length;
      const progress = total ? Math.round((done / total) * 100) : 0;
      return { dept, rock: it.name, progress, subtasks: total };
    });

  const out = {
    quarter,
    updated: stamp(),
    departments
  };

  const fs = require("fs");
  fs.writeFileSync("data.json", JSON.stringify(out, null, 2));
  console.log("Wrote data.json:", JSON.stringify(out, null, 2));
})().catch(err => { console.error(err); process.exit(1); });
