/* ============================================================
   Nancy Spains — Monday + Outlook reader
   Writes TWO files:
     • data.json      -> the office TV leaderboard (wall)
     • personal.json  -> your iPad Personal Tracker (pillars, flags,
                         to-dos, and today's calendar)
   Read-only. Needs env: MONDAY_TOKEN, and (optional) ICS_URL for
   the calendar (your published Outlook calendar link).
   ============================================================ */

const TOKEN = process.env.MONDAY_TOKEN;
const ICS_URL = process.env.ICS_URL;   // published Outlook calendar (optional)

/* ---- Goals & Rocks board ---- */
const GOALS_BOARD = 5099940269;
const G_DEPT = "color_mm57e8mc", G_PERIOD = "color_mm5738b3", G_SUBSTATUS = "status";

/* ---- Personal Tracker board ---- */
const PERS_BOARD = 5100315281;
const P_FOR = "color_mm58ee2b", P_PRIO = "color_mm58203f", P_STATE = "color_mm58grkm";
const P_GROUP_TODOS = "topics", P_GROUP_FLAGS = "group_mm58t22c";

const DEPT_ORDER = ["Finance", "Operations", "Marketing", "People"];
const TZ = "Europe/London";

if (!TOKEN) { console.error("Missing MONDAY_TOKEN"); process.exit(1); }

function currentQuarter(d = new Date()) {
  const y = d.getFullYear(), q = Math.floor(d.getMonth() / 3) + 1, sm = (q - 1) * 3;
  const iso = x => x.toISOString().slice(0, 10);
  const mon = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return { label:`Q${q} ${y}`, sub:`${mon[sm]} – ${mon[sm+2]} ${y}`,
    start: iso(new Date(Date.UTC(y, sm, 1))), end: iso(new Date(Date.UTC(y, sm + 3, 0))) };
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
  return new Intl.DateTimeFormat("en-GB", { timeZone: TZ, day:"numeric", month:"short",
    year:"numeric", hour:"2-digit", minute:"2-digit" }).format(new Date());
}
const col = (item, id) => (item.column_values.find(c => c.id === id) || {}).text || "";
function pillarStatus(t){ t=(t||"").trim().toLowerCase();
  return t==="done"?"done":t==="working on it"?"working":t==="stuck"?"stuck":"notstart"; }
function priority(t){ t=(t||"").toLowerCase();
  return t.includes("high")?"High":t.includes("low")?"Low":"Medium"; }

/* ---- calendar helpers ---- */
function tzOffsetMs(date, tz){
  const p = new Intl.DateTimeFormat("en-US",{ timeZone:tz, hour12:false,
    year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit" })
    .formatToParts(date).reduce((a,x)=>(a[x.type]=x.value,a),{});
  const asUTC = Date.UTC(+p.year, +p.month-1, +p.day, +p.hour, +p.minute, +p.second);
  return asUTC - date.getTime();
}
function todayFromICS(icsText){
  const ical = require("node-ical");
  const data = ical.parseICS(icsText);
  const now = new Date();
  const off = tzOffsetMs(now, TZ);
  const ymd = new Intl.DateTimeFormat("en-CA",{ timeZone:TZ }).format(now);
  const dayStart = new Date(new Date(ymd+"T00:00:00Z").getTime() - off);
  const dayEnd = new Date(dayStart.getTime() + 24*3600*1000);
  const fmt = d => new Intl.DateTimeFormat("en-GB",{ timeZone:TZ, hour:"2-digit", minute:"2-digit" }).format(d);
  const out = [];
  const add = (startD, ev) => {
    const durMs = (ev.end && ev.start) ? (new Date(ev.end) - new Date(ev.start)) : 30*60000;
    const endD = new Date(startD.getTime() + durMs);
    if (startD < dayEnd && endD > dayStart) {
      const allDay = ev.datetype === "date";
      out.push({ sort:startD.getTime(), time: allDay ? "All day" : fmt(startD),
        title: (ev.summary || "(no title)").toString().trim() });
    }
  };
  for (const k in data) {
    const ev = data[k];
    if (!ev || ev.type !== "VEVENT") continue;
    if (ev.rrule) {
      const occ = ev.rrule.between(new Date(dayStart.getTime()-36*3600*1000), dayEnd, true);
      occ.forEach(d => {
        const dd = new Date(d);
        if (ev.exdate) {
          const hit = Object.values(ev.exdate).some(x => new Date(x).toDateString() === dd.toDateString());
          if (hit) return;
        }
        if (ev.recurrences) {
          const ov = Object.values(ev.recurrences).find(r => new Date(r.recurrenceid).toDateString() === dd.toDateString());
          if (ov) { add(new Date(ov.start), ov); return; }
        }
        add(dd, ev);
      });
    } else if (ev.start) {
      add(new Date(ev.start), ev);
    }
  }
  out.sort((a,b)=>a.sort-b.sort);
  return out.map(e => ({ time:e.time, title:e.title }));
}

(async () => {
  const quarter = currentQuarter();

  /* ----- Goals & Rocks ----- */
  const g = await monday(`
    query { boards(ids: ${GOALS_BOARD}) { items_page(limit: 200) { items {
      name column_values(ids: ["${G_DEPT}","${G_PERIOD}"]) { id text }
      subitems { name column_values(ids: ["${G_SUBSTATUS}"]) { text } } } } } }`);
  const rocks = g.boards[0].items_page.items.filter(it => col(it, G_PERIOD) === quarter.label);

  const wallDepartments = rocks.map(it => {
    const subs = it.subitems || [];
    const done = subs.filter(s => ((s.column_values[0] || {}).text || "").trim() === "Done").length;
    return { dept: col(it, G_DEPT) || "—", rock: it.name,
      progress: subs.length ? Math.round((done / subs.length) * 100) : 0, subtasks: subs.length };
  });

  /* ----- Personal Tracker ----- */
  const p = await monday(`
    query { boards(ids: ${PERS_BOARD}) { items_page(limit: 200) { items {
      name group { id } column_values(ids: ["${P_FOR}","${P_PRIO}","${P_STATE}"]) { id text } } } } }`);
  const pItems = p.boards[0].items_page.items;
  const isOpen = it => col(it, P_STATE) !== "Done";
  const flagsByDept = {};
  pItems.filter(it => it.group.id === P_GROUP_FLAGS && isOpen(it)).forEach(it => {
    const d = col(it, P_FOR) || "Personal";
    (flagsByDept[d] = flagsByDept[d] || []).push({ text: it.name, priority: priority(col(it, P_PRIO)) });
  });
  const todos = pItems.filter(it => it.group.id === P_GROUP_TODOS && isOpen(it))
    .map(it => ({ text: it.name, priority: priority(col(it, P_PRIO)), state: col(it, P_STATE) || "Open" }));
  const persDepartments = DEPT_ORDER.map(dept => {
    const pillars = [];
    rocks.filter(it => col(it, G_DEPT) === dept)
      .forEach(it => (it.subitems || []).forEach(s =>
        pillars.push({ name: s.name, status: pillarStatus((s.column_values[0] || {}).text) })));
    return { dept, pillars, flags: flagsByDept[dept] || [] };
  });

  /* ----- Today's calendar (optional) ----- */
  let today = [];
  if (ICS_URL) {
    try {
      const ics = await (await fetch(ICS_URL)).text();
      today = todayFromICS(ics);
    } catch (e) { console.error("Calendar read failed:", e.message); }
  }
  const todayLabel = new Intl.DateTimeFormat("en-GB",
    { timeZone: TZ, weekday:"long", day:"numeric", month:"long" }).format(new Date());

  /* ----- write ----- */
  const fs = require("fs");
  fs.writeFileSync("data.json", JSON.stringify(
    { quarter, updated: stamp(), departments: wallDepartments }, null, 2));
  fs.writeFileSync("personal.json", JSON.stringify(
    { quarter, updated: stamp(), departments: persDepartments, todos, today, todayLabel }, null, 2));
  console.log("Wrote data.json and personal.json (today:", today.length, "events)");
})().catch(err => { console.error(err); process.exit(1); });
