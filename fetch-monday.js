/* ============================================================
   Nancy Spains — Monday reader
   Runs on a schedule. Writes TWO files:
     • data.json      -> the office TV leaderboard (wall)
     • personal.json  -> your iPad Personal Tracker
   Read-only: it never changes anything in Monday.
   ============================================================ */

const TOKEN = process.env.MONDAY_TOKEN;

/* ---- Goals & Rocks board (the directors' board) ---- */
const GOALS_BOARD = 5099940269;
const G_DEPT   = "color_mm57e8mc";   // Department
const G_PERIOD = "color_mm5738b3";   // Period (Q1..Q4 20xx)
const G_SUBSTATUS = "status";        // pillar (subtask) status

/* ---- Personal Tracker board (your private board) ---- */
const PERS_BOARD = 5100315281;
const P_FOR   = "color_mm58ee2b";    // which department a flag is for
const P_PRIO  = "color_mm58203f";    // Priority
const P_STATE = "color_mm58grkm";    // State (Open/Doing/Done)
const P_GROUP_TODOS = "topics";              // "My To-Dos" group
const P_GROUP_FLAGS = "group_mm58t22c";      // "Department Flags & Notes" group

const DEPT_ORDER = ["Finance", "Operations", "Marketing", "People"];

if (!TOKEN) { console.error("Missing MONDAY_TOKEN"); process.exit(1); }

function currentQuarter(d = new Date()) {
  const y = d.getFullYear();
  const q = Math.floor(d.getMonth() / 3) + 1;
  const sm = (q - 1) * 3;
  const iso = x => x.toISOString().slice(0, 10);
  const mon = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return {
    label: `Q${q} ${y}`,
    sub:   `${mon[sm]} – ${mon[sm + 2]} ${y}`,
    start: iso(new Date(Date.UTC(y, sm, 1))),
    end:   iso(new Date(Date.UTC(y, sm + 3, 0)))
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
    timeZone: "Europe/London", day: "numeric", month: "short",
    year: "numeric", hour: "2-digit", minute: "2-digit"
  }).format(new Date());
}

const col = (item, id) => (item.column_values.find(c => c.id === id) || {}).text || "";

function pillarStatus(text) {
  const t = (text || "").trim().toLowerCase();
  if (t === "done") return "done";
  if (t === "working on it") return "working";
  if (t === "stuck") return "stuck";
  return "notstart";
}
function priority(text) {
  const t = (text || "").toLowerCase();
  if (t.includes("high")) return "High";
  if (t.includes("low")) return "Low";
  return "Medium";
}

(async () => {
  const quarter = currentQuarter();

  /* ---------- read Goals & Rocks ---------- */
  const g = await monday(`
    query {
      boards(ids: ${GOALS_BOARD}) {
        items_page(limit: 200) {
          items {
            name
            column_values(ids: ["${G_DEPT}","${G_PERIOD}"]) { id text }
            subitems { name column_values(ids: ["${G_SUBSTATUS}"]) { text } }
          }
        }
      }
    }
  `);
  const rocks = g.boards[0].items_page.items
    .filter(it => col(it, G_PERIOD) === quarter.label);

  /* wall (data.json): one line per rock, progress = % pillars done */
  const wallDepartments = rocks.map(it => {
    const subs = it.subitems || [];
    const done = subs.filter(s => ((s.column_values[0] || {}).text || "").trim() === "Done").length;
    return {
      dept: col(it, G_DEPT) || "—",
      rock: it.name,
      progress: subs.length ? Math.round((done / subs.length) * 100) : 0,
      subtasks: subs.length
    };
  });

  /* ---------- read Personal Tracker ---------- */
  const p = await monday(`
    query {
      boards(ids: ${PERS_BOARD}) {
        items_page(limit: 200) {
          items {
            name
            group { id }
            column_values(ids: ["${P_FOR}","${P_PRIO}","${P_STATE}"]) { id text }
          }
        }
      }
    }
  `);
  const pItems = p.boards[0].items_page.items;
  const isOpen = it => col(it, P_STATE) !== "Done";

  const flagsByDept = {};
  pItems.filter(it => it.group.id === P_GROUP_FLAGS && isOpen(it)).forEach(it => {
    const d = col(it, P_FOR) || "Personal";
    (flagsByDept[d] = flagsByDept[d] || []).push({ text: it.name, priority: priority(col(it, P_PRIO)) });
  });

  const todos = pItems
    .filter(it => it.group.id === P_GROUP_TODOS && isOpen(it))
    .map(it => ({ text: it.name, priority: priority(col(it, P_PRIO)), state: col(it, P_STATE) || "Open" }));

  /* personal.json: one slide per department (pillars + flags) + to-dos */
  const persDepartments = DEPT_ORDER.map(dept => {
    const deptRocks = rocks.filter(it => col(it, G_DEPT) === dept);
    const pillars = [];
    deptRocks.forEach(it => (it.subitems || []).forEach(s =>
      pillars.push({ name: s.name, status: pillarStatus((s.column_values[0] || {}).text) })));
    return { dept, pillars, flags: flagsByDept[dept] || [] };
  });

  /* ---------- write both files ---------- */
  const fs = require("fs");
  fs.writeFileSync("data.json", JSON.stringify(
    { quarter, updated: stamp(), departments: wallDepartments }, null, 2));
  fs.writeFileSync("personal.json", JSON.stringify(
    { quarter, updated: stamp(), departments: persDepartments, todos }, null, 2));

  console.log("Wrote data.json and personal.json");
})().catch(err => { console.error(err); process.exit(1); });
