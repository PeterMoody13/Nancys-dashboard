/* ============================================================
   Nancy Spains — Monday + Outlook reader
   Writes THREE files:
     • data.json      -> office TV wall (departments + pillars)
     • personal.json  -> your iPad (pillars, flags, to-dos, calendar)
     • managers.json  -> reporting-staff screen (manager rocks + pillars)
   Read-only. env: MONDAY_TOKEN, and (optional) ICS_URL for calendar.
   ============================================================ */

const TOKEN = process.env.MONDAY_TOKEN;
const ICS_URL = process.env.ICS_URL;

const GOALS_BOARD = 5099940269;
const G_DEPT = "color_mm57e8mc", G_PERIOD = "color_mm5738b3", G_SUBSTATUS = "status";

const PERS_BOARD = 5100315281;
const P_FOR = "color_mm58ee2b", P_PRIO = "color_mm58203f", P_STATE = "color_mm58grkm";
const P_GROUP_TODOS = "topics", P_GROUP_FLAGS = "group_mm58t22c";

const MGR_BOARD = 5100761169;
const M_DEPT = "color_mm5fy9vv", M_ROLE = "text_mm5fvdv5", M_PERIOD = "color_mm5fe93e", M_SUBSTATUS = "status";

const DEPT_ORDER = ["Finance", "Operations", "Marketing", "People"];
const MGR_ORDER = ["People", "Operations", "Marketing"];   /* Training, Ops, Marketing Exec */
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
function pillarsOf(item, statusId){
  return (item.subitems || []).map(s => ({ name: s.name,
    status: pillarStatus((s.column_values.find(c=>c.id===statusId)||s.column_values[0]||{}).text) }));
}
function summarise(pillars){
  const c={done:0,working:0,stuck:0,notstart:0};
  pillars.forEach(p=> c[p.status]!==undefined ? c[p.status]++ : c.notstart++);
  const w={done:"done",working:"in progress",stuck:"stuck",notstart:"to start"};
  return ['done','working','stuck','notstart'].filter(k=>c[k]>0).map(k=>`${c[k]} ${w[k]}`).join('  ·  ');
}

/* ---- calendar ---- */
function tzOffsetMs(date, tz){
  const p = new Intl.DateTimeFormat("en-US",{ timeZone:tz, hour12:false,
    year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit" })
    .formatToParts(date).reduce((a,x)=>(a[x.type]=x.value,a),{});
  return Date.UTC(+p.year, +p.month-1, +p.day, +p.hour, +p.minute, +p.second) - date.getTime();
}
function todayFromICS(icsText){
  const ical = require("node-ical");
  const data = ical.parseICS(icsText);
  const now = new Date(), off = tzOffsetMs(now, TZ);
  const ymd = new Intl.DateTimeFormat("en-CA",{ timeZone:TZ }).format(now);
  const dayStart = new Date(new Date(ymd+"T00:00:00Z").getTime() - off);
  const dayEnd = new Date(dayStart.getTime() + 24*3600*1000);
  const fmt = d => new Intl.DateTimeFormat("en-GB",{ timeZone:TZ, hour:"2-digit", minute:"2-digit" }).format(d);
  const out = [];
  const add = (startD, ev) => {
    const durMs = (ev.end && ev.start) ? (new Date(ev.end) - new Date(ev.start)) : 30*60000;
    const endD = new Date(startD.getTime() + durMs);
    if (startD < dayEnd && endD > dayStart)
      out.push({ sort:startD.getTime(), time: ev.datetype==="date" ? "All day" : fmt(startD),
        title: (ev.summary || "(no title)").toString().trim() });
  };
  for (const k in data) {
    const ev = data[k];
    if (!ev || ev.type !== "VEVENT") continue;
    if (ev.rrule) {
      ev.rrule.between(new Date(dayStart.getTime()-36*3600*1000), dayEnd, true).forEach(d => {
        const dd = new Date(d);
        if (ev.exdate && Object.values(ev.exdate).some(x => new Date(x).toDateString() === dd.toDateString())) return;
        if (ev.recurrences) {
          const ov = Object.values(ev.recurrences).find(r => new Date(r.recurrenceid).toDateString() === dd.toDateString());
          if (ov) { add(new Date(ov.start), ov); return; }
        }
        add(dd, ev);
      });
    } else if (ev.start) add(new Date(ev.start), ev);
  }
  out.sort((a,b)=>a.sort-b.sort);
  return out.map(e => ({ time:e.time, title:e.title }));
}

(async () => {
  const quarter = currentQuarter();

  /* ----- Goals & Rocks (departments) ----- */
  const g = await monday(`
    query { boards(ids: ${GOALS_BOARD}) { items_page(limit: 200) { items {
      name column_values(ids: ["${G_DEPT}","${G_PERIOD}"]) { id text }
      subitems { name column_values(ids: ["${G_SUBSTATUS}"]) { id text } } } } } }`);
  const rocks = g.boards[0].items_page.items.filter(it => col(it, G_PERIOD) === quarter.label);

  const deptRockMap = {};   /* dept -> { name, pillars } */
  const wallDepartments = rocks.map(it => {
    const pillars = pillarsOf(it, G_SUBSTATUS);
    const done = pillars.filter(p => p.status === "done").length;
    deptRockMap[col(it, G_DEPT)] = { name: it.name, pillars };
    return { dept: col(it, G_DEPT) || "—", rock: it.name,
      progress: pillars.length ? Math.round((done / pillars.length) * 100) : 0,
      subtasks: pillars.length, pillars };
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
      .forEach(it => pillarsOf(it, G_SUBSTATUS).forEach(x => pillars.push(x)));
    return { dept, pillars, flags: flagsByDept[dept] || [] };
  });

  /* ----- Manager Rocks (reporting staff) ----- */
  const m = await monday(`
    query { boards(ids: ${MGR_BOARD}) { items_page(limit: 200) { items {
      name column_values(ids: ["${M_DEPT}","${M_ROLE}","${M_PERIOD}"]) { id text }
      subitems { name column_values(ids: ["${M_SUBSTATUS}"]) { id text } } } } } }`);
  const mItems = m.boards[0].items_page.items.filter(it => col(it, M_PERIOD) === quarter.label);
  const managers = mItems.map(it => {
    const dept = col(it, M_DEPT) || "—";
    const pillars = pillarsOf(it, M_SUBSTATUS);
    const dr = deptRockMap[dept];
    return {
      role: col(it, M_ROLE) || dept + " Manager",
      dept, rock: it.name, pillars,
      deptRock: dr ? { name: dr.name, summary: summarise(dr.pillars) } : null
    };
  }).sort((a,b)=> MGR_ORDER.indexOf(a.dept) - MGR_ORDER.indexOf(b.dept));

  /* ----- Today's calendar ----- */
  let today = [];
  if (ICS_URL) {
    try { today = todayFromICS(await (await fetch(ICS_URL)).text()); }
    catch (e) { console.error("Calendar read failed:", e.message); }
  }
  const todayLabel = new Intl.DateTimeFormat("en-GB",
    { timeZone: TZ, weekday:"long", day:"numeric", month:"long" }).format(new Date());

  const fs = require("fs");
  fs.writeFileSync("data.json", JSON.stringify(
    { quarter, updated: stamp(), departments: wallDepartments }, null, 2));
  fs.writeFileSync("personal.json", JSON.stringify(
    { quarter, updated: stamp(), departments: persDepartments, todos, today, todayLabel }, null, 2));
  fs.writeFileSync("managers.json", JSON.stringify(
    { quarter, updated: stamp(), managers }, null, 2));
  console.log("Wrote data.json, personal.json, managers.json (managers:", managers.length, ")");
})().catch(err => { console.error(err); process.exit(1); });
