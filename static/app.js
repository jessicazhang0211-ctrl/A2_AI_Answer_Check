// AI Answer Check: front end. Plain JavaScript, no libraries.
const $ = (s) => document.querySelector(s);
const NAMES = {deadline: "Deadline", word_limit: "Word limit", weight: "Weighting",
  late_penalty_per_day: "Late penalty per day", late_max_days: "Late work accepted for",
  extension_max_days: "Maximum extension", feedback_days: "Feedback returned within",
  pass_mark: "Pass mark", exam_duration_hours: "Exam length", resubmission_days: "Resubmission window", other: "Other detail"};
const ICON = {supported: "✓", conflict: "!", outdated: "↻", missing: "?"};
const NEEDS_NUDGE = new Set(["conflict", "outdated"]);
let mode = "visual", run = null, scenarioId = null, decisions = {};
// The student's own feedback, kept in this browser between questions and visits.
// memory: latest decision about each fact (subject + attribute); history: every final decision, for the reliance pattern.
const store = (k, v) => v === undefined ? JSON.parse(localStorage.getItem(k) || "{}") : localStorage.setItem(k, JSON.stringify(v));
let memory = store("aac_memory"), history = store("aac_history");
// Review history is also saved on the server (data/kb.sqlite), so it survives a cleared browser.
const saveReview = () => fetch("/api/review", {method: "POST", headers: {"Content-Type": "application/json"},
  body: JSON.stringify({memory, history})}).catch(() => {});
const factKey = (c) => (run && run.noun && run.noun !== "handbook" ? "mine|" : "") + (c.subject || "Module") + "|" + c.attribute;
const runKey = () => (scenarioId === "free" ? (run && run.question) : scenarioId) || "";
const core = (v) => String(v ?? "").toLowerCase().replace(/[^0-9a-z%]+/g, " ").trim();

// Wording for the source the answer was checked against: the demo handbook or the student's own documents.
const SRC = () => run && run.noun && run.noun !== "handbook"
  ? {cur: "Your documents", the: "your documents", none: "Nothing in your documents covers this", short: "Your documents", ask: "check the original brief or ask the module lead"}
  : {cur: "Current handbook", the: "the current handbook", none: "Nothing in the handbook covers this", short: "Handbook", ask: "ask the module lead"};
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"}[c]));
const title = (c) => (NAMES[c.attribute] || c.attribute) + (c.subject && c.subject !== "Module" ? " · " + c.subject : "");

function log(action, c, extra = {}) {
  fetch("/api/log", {method: "POST", headers: {"Content-Type": "application/json"},
    body: JSON.stringify({client_time: new Date().toISOString(), scenario: scenarioId, question: run && run.question,
      mode, action, claim: c && c.id, attribute: c && c.attribute, status: c && c.status, gold: c && c.gold, ...extra})}).catch(() => {});
}

async function init() {
  const st = await (await fetch("/api/status")).json();
  $("#live").textContent = st.live ? "GPT live: " + st.model : "Offline mode (no API key)";
  $("#live").classList.toggle("on", st.live);
  if (!st.live) $("#ask-note").textContent = "Free questions need an OpenAI API key. The preset answers work offline.";
  const list = await (await fetch("/api/scenarios")).json();
  $("#scenarios").innerHTML = list.map((s, i) => `<li><button data-id="${s.id}">${i + 1}. ${esc(s.question)}</button></li>`).join("");
  $("#scenarios").onclick = (e) => { const b = e.target.closest("button"); if (b) load({scenario_id: b.dataset.id}, b); };
  $("#ask").onsubmit = (e) => { e.preventDefault(); const q = $("#q").value.trim(); if (q) load({question: q, source: source()}); };
  document.querySelectorAll("input[name=source]").forEach((r) => r.onchange = showSource);
  $("#upload").onsubmit = upload;
  $("#docs").addEventListener("click", (e) => {
    const button = e.target.closest("[data-preview]");
    if (button) previewDocument(button);
  });
  $("#document-preview").addEventListener("close", closePreview);
  try {
    const saved = await (await fetch("/api/review")).json();
    if (Object.keys(saved.memory).length || Object.keys(saved.history).length) { memory = saved.memory; history = saved.history; }
  } catch (e) { /* keep the browser copy */ }
  await refreshDocs(); showSource();
  document.querySelectorAll(".mode button").forEach((b) => b.onclick = () => setMode(b.dataset.mode));
  const m = new URLSearchParams(location.search).get("mode"); if (m) setMode(m, true);
}

function setMode(m, quiet) {
  mode = m;
  document.querySelectorAll(".mode button").forEach((b) => b.setAttribute("aria-checked", b.dataset.mode === m));
  if (!quiet) log("mode_change", null, {to: m});
  render();
}

async function load(body, btn) {
  document.querySelectorAll(".scenarios button").forEach((b) => b.classList.toggle("sel", b === btn));
  scenarioId = body.scenario_id || "free";
  $("#empty").hidden = true; $("#result").hidden = false; $("#review").hidden = true;
  $("#question").textContent = body.question || btn.textContent.replace(/^\d+\.\s*/, "");
  $("#answer").textContent = "Checking the answer…"; $("#cards").innerHTML = ""; $("#sources").textContent = "";
  const r = await (await fetch("/api/run", {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(body)})).json();
  run = r; decisions = {};
  log("load", null, {claims: (r.claims || []).length});
  render();
}

function highlight(answer, claims) {
  let html = esc(answer);
  claims.forEach((c) => {
    const t = esc(c.text);
    if (t && html.includes(t)) html = html.replace(t, `<mark class="${c.status}">${t}</mark>`);
  });
  return html;
}

function render() {
  if (!run) return;
  const err = $("#error");
  err.hidden = !run.error; err.textContent = run.error || "";
  if (!run.answer) { $("#answer").textContent = ""; return; }
  $("#question").textContent = run.question;
  $("#result").className = "m-" + mode;
  $("#answer").innerHTML = highlight(run.answer, run.claims || []);
  $("#sources").textContent = `Answer: ${run.answer_source} · Claims: ${run.claims_source} · Status: checked by code against ${SRC().the.replace('the current ', 'the ')}`;
  $("#cards").innerHTML = (run.claims || []).map(card).join("") || `<p class="meta">No date, number or percentage claims were found in this answer.</p>`;
  $("#cards").querySelectorAll("[data-act]").forEach((b) => b.onclick = () => act(b.dataset.id, b.dataset.act));
  renderReview();
}

function card(c) {
  const d = decisions[c.id] || {};
  const showStatus = mode !== "none";
  const showEvidence = mode !== "none" || d.reveal;
  const ev = c.evidence;
  let head = `<div class="card-head"><h3>${esc(title(c))}</h3>`;
  if (mode === "visual") head += `<span class="badge ${c.status}"><span aria-hidden="true">${ICON[c.status]}</span>${esc(c.label)}</span>`;
  head += `</div>`;
  let body = "";
  if (mode === "verbal") body += `<p class="verbal">“${esc(c.verbal)}”</p>`;
  body += `<div class="cmp"><div><div class="lab">AI suggestion</div><div class="val">${esc(c.value)}</div><div class="src">“${esc(c.text)}”</div></div>`;
  if (showEvidence) {
    body += ev ? `<div><div class="lab">${SRC().cur}</div><div class="val">${esc(ev.value)}</div><div class="src">${esc(ev.section)} · ${esc(ev.source)}</div></div>`
               : `<div><div class="lab">${SRC().cur}</div><div class="val">No information</div><div class="src">${SRC().none}</div></div>`;
  } else {
    body += `<div><div class="lab">${SRC().short}</div><button class="link" data-id="${c.id}" data-act="reveal">Check the source</button></div>`;
  }
  body += `</div>`;
  if (showEvidence && (ev || c.older_evidence)) {
    body += d.passage ? passage(c) : "";
    body += `<button class="link" data-id="${c.id}" data-act="passage">${d.passage ? "Hide" : "Show"} the source passage</button>`;
  }
  body += earlier(c);
  if (d.nudge) {
    const hv = ev ? esc(ev.value) : "something different";
    body += `<div class="nudge" role="alert"><b>Before you accept:</b> the AI says \u201c${esc(c.text)}\u201d, but ${run.noun && run.noun !== "handbook" && ev ? esc(ev.source) : SRC().the} (${esc(ev ? ev.section : "")}) says ${hv}.`
         + `<div class="actions"><button data-id="${c.id}" data-act="accept_anyway">Accept anyway</button><button data-id="${c.id}" data-act="revise">Revise instead</button></div></div>`;
  }
  if (d.action === "revising") {
    body += `<div class="actions"><input id="rv-${c.id}" value="${esc(d.draft)}" aria-label="Revised value"><button data-id="${c.id}" data-act="save">Save</button><button data-id="${c.id}" data-act="cancel">Cancel</button></div>`;
  } else if (d.action) {
    const what = {accepted: "Accepted", revised: "Revised to " + esc(d.value), deferred: "Deferred: still to check"}[d.action];
    const extra = d.action === "accepted" && c.status === "missing" && showStatus ? ` (unverified: ${SRC().none.toLowerCase()})` : "";
    body += `<p class="done"><b>${what}</b>${extra} · <button class="undo" data-id="${c.id}" data-act="undo">Undo</button></p>`;
  } else if (!d.nudge) {
    body += `<div class="actions"><button data-id="${c.id}" data-act="accept">Accept</button><button data-id="${c.id}" data-act="revise">Revise</button><button data-id="${c.id}" data-act="defer">Defer</button></div>`;
  }
  return `<article class="card ${d.action && d.action !== "revising" ? "decided" : ""}">${head}${body}</article>`;
}

function passage(c) {
  const show = (e, label) => {
    let t = esc(e.text); const v = esc(e.value); if (v && t.includes(v)) t = t.replace(v, `<strong>${v}</strong>`);
    return `<div class="passage"><div class="src">${label}${esc(e.source)} · ${esc(e.section)} · updated ${esc(e.updated)}</div>${t}</div>`;
  };
  return (c.evidence ? show(c.evidence, "") : "") + (c.older_evidence ? show(c.older_evidence, "Older edition: ") : "");
}

function act(id, a) {
  const c = run.claims.find((x) => x.id === id);
  const d = decisions[id] = decisions[id] || {};
  if (a === "reveal") { d.reveal = true; log("reveal_evidence", c); }
  else if (a === "passage") { d.passage = !d.passage; log(d.passage ? "open_passage" : "close_passage", c); }
  else if (a === "accept") {
    if (mode !== "none" && NEEDS_NUDGE.has(c.status) && !d.nudged) { d.nudge = d.nudged = true; log("reminder_shown", c); }
    else { d.action = "accepted"; d.value = c.value; log("accept", c, {value: c.value}); }
  }
  else if (a === "accept_anyway") { d.nudge = false; d.action = "accepted"; d.value = c.value; log("accept_after_reminder", c, {value: c.value}); }
  else if (a === "revise") { d.nudge = false; d.action = "revising"; d.draft = c.evidence && (mode !== "none" || d.reveal) ? c.evidence.value : c.value; log("revise_open", c); }
  else if (a === "save") { const v = $("#rv-" + id).value.trim() || c.value; d.action = "revised"; d.value = v; log("revise", c, {value: v});
    if (c.status === "supported") log("disagree_with_check", c, {value: v}); }
  else if (a === "cancel") { d.action = null; log("revise_cancel", c); }
  else if (a === "defer") { d.action = "deferred"; d.value = null; log("defer", c); }
  else if (a === "undo") { log("undo", c, {was: d.action}); d.action = null; d.value = null; }
  remember(c, d, a);
  render();
  if (a === "revise") { const i = $("#rv-" + id); if (i) i.focus(); }
}

function renderReview() {
  const cl = run.claims || [];
  $("#review").hidden = cl.length === 0;
  const decided = cl.filter((c) => ["accepted", "revised", "deferred"].includes((decisions[c.id] || {}).action));
  $("#progress").textContent = `${decided.length} of ${cl.length} claims reviewed`;
  $("#reviewed").innerHTML = cl.map((c) => {
    const d = decisions[c.id] || {};
    const st = ["accepted", "revised", "deferred"].includes(d.action) ? d.action : null;
    const val = st === "deferred" ? "Still to check" : st ? esc(d.value) : "Awaiting decision";
    return `<li><div class="k">${esc(title(c))}</div><div class="row"><span>${val}</span>${st ? `<span class="chip ${st}">${st}</span>` : ""}</div>`
         + (st ? `<button class="undo" onclick="act('${c.id}','undo')">Undo</button>` : "") + `</li>`;
  }).join("");
  renderRevised(cl, decided.length);
  renderMemory();
  $("#summary").hidden = decided.length !== cl.length || cl.length === 0;
  if (decided.length === cl.length && cl.length) $("#summary").innerHTML = summary(cl);
}

// Accepted although the evidence did not support it.
function risky(c) { return decisions[c.id].action === "accepted" && c.status !== "supported"; }

// Feedback once every claim has a decision: what the student did and what is left to do.
function summary(cl) {
  const n = (f) => cl.filter(f).length;
  const ok = n((c) => decisions[c.id].action === "accepted" && c.status === "supported");
  const fixed = n((c) => decisions[c.id].action === "revised");
  const risk = cl.filter(risky), later = cl.filter((c) => decisions[c.id].action === "deferred");
  let h = `<h3>Review complete</h3><p>You kept ${ok} supported claim${ok === 1 ? "" : "s"}` + (fixed ? ` and corrected ${fixed}.` : ".");
  if (risk.length) h += ` You kept ${risk.length} that the source does not back up; the revised answer marks ${risk.length === 1 ? "it" : "them"}.`;
  h += `</p>`;
  const todo = later.concat(risk);
  if (todo.length) h += `<p><b>Before you rely on this answer:</b></p><ul>` + todo.map((c) =>
    `<li>${esc(title(c))}: ${c.evidence ? "compare with " + esc(c.evidence.source) + ", " + esc(c.evidence.section) : SRC().none.toLowerCase() + "; " + SRC().ask}</li>`).join("") + `</ul>`;
  else h += `<p>Nothing is left to check.</p>`;
  const key = JSON.stringify([ok, fixed, risk.length, later.length, cl.map((c) => c.id)]);
  if (key !== summary.last) { summary.last = key; log("review_complete", null, {kept_supported: ok, corrected: fixed, kept_unbacked: risk.length, deferred: later.length}); }
  return h;
}

// Put the student's value into the claim's own words: "up to 7 days" + "5 working days" -> "up to 5 working days".
function rewriteClaim(c, nv) {
  const t = c.text, v = String(c.value), i = t.indexOf(v);
  if (i < 0) return `${t} (corrected: ${nv})`;
  let after = t.slice(i + v.length), val = nv;
  if (/^-[a-z]/i.test(after)) val = nv.split(" ")[0];              // "2,500-word" keeps its own unit
  else {
    const unit = nv.split(" ").slice(1);
    for (let k = 0; k < unit.length; k++) {                          // drop words the new value already says
      const tail = " " + unit.slice(k).join(" ");
      if (after.toLowerCase().startsWith(tail.toLowerCase())) { after = after.slice(tail.length); break; }
    }
  }
  return t.slice(0, i) + val + after;
}

// The answer with every decision applied, with the changes marked.
function rewrite(answer, cl) {
  let out = esc(answer);
  cl.forEach((c) => {
    const d = decisions[c.id] || {}, t = esc(c.text);
    if (!t || !out.includes(t)) return;
    let r = t;
    if (d.action === "revised") r = `<span class="rv revised"><del>${t}</del> <ins>${esc(rewriteClaim(c, d.value))}</ins></span>`;
    else if (d.action === "deferred") r = `<span class="rv deferred">${t}<sup>check</sup></span>`;
    else if (d.action === "accepted" && c.status !== "supported") r = `<span class="rv risky">${t}<sup>unconfirmed</sup></span>`;
    else if (!d.action || d.action === "revising") r = `<span class="rv pending">${t}</span>`;
    out = out.replace(t, r);
  });
  return out;
}

function renderRevised(cl, n) {
  $("#revised-box").hidden = !run || !run.answer || cl.length === 0;
  if ($("#revised-box").hidden) return;
  $("#revised").innerHTML = rewrite(run.answer, cl);
  $("#revised-meta").textContent = n === cl.length ? "All claims decided. This is the answer you can rely on, with anything unconfirmed marked."
    : `${n} of ${cl.length} claims decided. The answer updates as you decide.`;
}

// Save each decision as feedback that later answers can use.
function remember(c, d, a) {
  const k = factKey(c), hk = runKey() + "|" + c.id;
  if (["accept", "accept_anyway", "save", "defer"].includes(a) && d.action && d.action !== "revising") {
    if (!d.prevMem) d.prevMem = {had: k in memory, val: memory[k]};
    memory[k] = {action: d.action, value: d.value, ai: c.value, status: c.status, title: title(c),
                 question: run.question, run: runKey(), section: c.evidence ? c.evidence.section : null, time: Date.now()};
    history[hk] = {status: c.status, action: d.action, reminded: !!d.nudged};
  } else if (a === "undo") {
    if (d.prevMem) { if (d.prevMem.had) memory[k] = d.prevMem.val; else delete memory[k]; d.prevMem = null; }
    delete history[hk];
  } else return;
  store("aac_memory", memory); store("aac_history", history); saveReview();
}

// On a new answer, show what the student decided about the same fact before.
function earlier(c) {
  const m = memory[factKey(c)];
  if (!m || m.run === runKey()) return "";
  const what = {accepted: "you accepted " + esc(m.value), revised: "you corrected this to " + esc(m.value), deferred: "you left this to check"}[m.action];
  const differs = m.value && core(m.value).split(" ")[0] !== core(c.value).split(" ")[0];
  const warn = differs && m.action !== "deferred";
  if (warn && !c._seenMem) { c._seenMem = true; log("memory_mismatch", c, {earlier: m.value}); }
  return `<p class="earlier ${warn ? "warn" : ""}"><b>Your earlier review:</b> ${what} (“${esc(m.question)}”).`
       + (warn ? ` This answer says ${esc(c.value)}, which does not match.` : "") + `</p>`;
}

// Reflection on the student's own reliance, from their decisions across all questions.
function renderMemory() {
  const h = Object.values(history);
  const sup = h.filter((x) => x.status === "supported"), flag = h.filter((x) => x.status === "conflict" || x.status === "outdated"),
        un = h.filter((x) => x.status === "missing");
  const keptSup = sup.filter((x) => x.action === "accepted").length, caught = flag.filter((x) => x.action !== "accepted").length,
        anyway = flag.filter((x) => x.action === "accepted").length, unDef = un.filter((x) => x.action !== "accepted").length;
  $("#pattern").innerHTML = h.length === 0 ? `<p class="meta">Your decisions will build up here.</p>` :
    `<p class="meta">${h.length} decision${h.length === 1 ? "" : "s"} so far, compared with the source check:</p><ul class="pattern">`
    + `<li><span>Supported claims kept</span><b>${keptSup} of ${sup.length}</b></li>`
    + `<li><span>Conflicting or outdated claims changed or deferred</span><b>${caught} of ${flag.length}</b></li>`
    + `<li><span>Unresolved claims revised or left to check</span><b>${unDef} of ${un.length}</b></li></ul>`
    + (anyway ? `<p class="note">You kept ${anyway} claim${anyway === 1 ? "" : "s"} the source contradicts. If that was deliberate, fine; if not, look at the source passage first.</p>` : "")
    + (sup.length - keptSup > 0 ? `<p class="note">You changed ${sup.length - keptSup} supported claim${sup.length - keptSup === 1 ? "" : "s"}. If the check was wrong, your change is logged so it can be reviewed.</p>` : "");
  const f = Object.values(memory).sort((a, b) => b.time - a.time);
  $("#facts").innerHTML = f.length ? f.map((m) => `<li><span class="k">${esc(m.title)}</span><span>${m.action === "deferred" ? "still to check" : esc(m.value)}</span><span class="chip ${m.action}">${m.action}</span></li>`).join("")
    : `<li class="meta">None yet.</li>`;
  $("#forget").onclick = () => { memory = {}; history = {}; store("aac_memory", memory); store("aac_history", history); saveReview(); log("clear_history"); render(); };
}

// ---------- the student's own documents ----------
const source = () => (document.querySelector("input[name=source]:checked") || {}).value || "demo";

async function showSource() {
  const kbMode = source() === "kb";
  const hb = await (await fetch(kbMode ? "/api/kb/handbook" : "/api/handbook")).json();
  $("#hb-summary").textContent = kbMode ? "Open my documents" : "Open the demo handbook";
  $("#handbook").innerHTML = hb.passages.length ? hb.passages.map((p) => `<div class="hb-p ${p.superseded ? "old" : ""}"><b>${esc(p.source)} · ${esc(p.section)} · ${kbMode ? "uploaded" : "updated"} ${esc(p.updated)}</b>${esc(p.text)}</div>`).join("")
    : `<p class="meta">No documents yet. Upload one above.</p>`;
}

let docTimer = null;
async function refreshDocs() {
  const r = await (await fetch("/api/kb")).json();
  const label = {ready: "ready", pending: "waiting", failed: "failed"};
  $("#docs").innerHTML = r.documents.length ? r.documents.map((d) => `<li>
      <div class="doc-name">${esc(d.name)}${d.superseded ? ` <span class="chip">older version</span>` : ""}</div>
      <div class="meta">${d.passages} passages · ${d.facts} facts · <span class="st ${d.status}">${label[d.status] || d.status}</span>${d.note && d.status !== "ready" ? " · " + esc(d.note) : ""}</div>
      <div class="doc-actions">
        <button type="button" class="link preview-open" data-preview="${d.id}" data-name="${esc(d.name)}" aria-label="Preview ${esc(d.name)}">Preview</button>
        <button class="link" data-doc="${d.id}" data-op="superseded" data-val="${d.superseded ? 0 : 1}">${d.superseded ? "Mark as current" : "Mark as older version"}</button>
        ${r.live && d.status !== "pending" ? `<button class="link" data-doc="${d.id}" data-op="reindex">Extract facts again</button>` : ""}
        ${r.live && d.status === "pending" && d.facts === 0 && /API key/.test(d.note || "") ? `<button class="link" data-doc="${d.id}" data-op="reindex">Extract facts</button>` : ""}
        <button class="link danger" data-doc="${d.id}" data-op="delete">Delete</button>
      </div></li>`).join("") : `<li class="meta">No documents yet.</li>`;
  $("#docs").querySelectorAll("[data-op]").forEach((b) => b.onclick = () => docOp(b.dataset.op, +b.dataset.doc, b.dataset.val));
  clearTimeout(docTimer);
  if (r.documents.some((d) => d.status === "pending" && !/API key/.test(d.note || ""))) docTimer = setTimeout(refreshDocs, 2500);
  if (source() === "kb") showSource();
}

let previewRequest;
async function previewDocument(button) {
  const dialog = $("#document-preview");
  const status = $("#preview-status");
  const content = $("#preview-content");
  const id = button.dataset.preview;
  previewRequest?.abort();
  const request = new AbortController();
  previewRequest = request;
  dialog.dataset.doc = id;
  $("#preview-title").textContent = button.dataset.name;
  status.textContent = "Loading document…";
  content.replaceChildren();
  dialog.showModal();
  $(".preview-body").scrollTop = 0;
  try {
    const response = await fetch(`/api/kb/documents/${id}/preview`, {signal: request.signal});
    const data = await response.json();
    if (request.signal.aborted || !dialog.open) return;
    if (!response.ok) {
      status.textContent = response.status === 404 && data.error === "not found"
        ? "Open AI Answer Check from the address printed by the current Python server to use Preview."
        : data.error;
      return;
    }
    if (!data.pages.some(({text}) => text.trim())) {
      status.textContent = "No readable text in this document.";
      return;
    }
    for (const {page, text} of data.pages) {
      const section = document.createElement("section");
      if (page !== null) {
        const heading = document.createElement("h3");
        heading.textContent = `Page ${page}`;
        section.append(heading);
      }
      const body = document.createElement("pre");
      body.textContent = text.trim() ? text : "No readable text on this page.";
      section.append(body);
      content.append(section);
    }
    status.textContent = "";
  } catch (e) {
    if (!request.signal.aborted && dialog.open) status.textContent = "Could not load the document preview. Please try again.";
  }
}

function closePreview() {
  const dialog = $("#document-preview");
  if (dialog.open) return;
  previewRequest?.abort();
  $("#preview-content").replaceChildren();
  const button = $(`#docs [data-preview="${dialog.dataset.doc}"]`);
  (button || $("#file")).focus();
}

async function docOp(op, id, val) {
  const res = await (await fetch("/api/kb/" + op, {method: "POST", headers: {"Content-Type": "application/json"},
    body: JSON.stringify({id, superseded: val === "1"})})).json();
  if (res.error) $("#upload-note").textContent = res.error;
  log("document_" + op, null, {doc: id});
  refreshDocs();
}

async function upload(e) {
  e.preventDefault();
  const f = $("#file").files[0];
  if (!f) { $("#upload-note").textContent = "Choose a file first."; return; }
  $("#upload-note").textContent = "Uploading " + f.name + "…";
  const b64 = await new Promise((ok) => { const r = new FileReader(); r.onload = () => ok(r.result.split(",")[1]); r.readAsDataURL(f); });
  const res = await (await fetch("/api/kb/upload", {method: "POST", headers: {"Content-Type": "application/json"},
    body: JSON.stringify({name: f.name, content: b64, superseded: $("#older").checked})})).json();
  $("#upload-note").textContent = res.error ? res.error : f.name + " saved. Choose “My documents” above to ask about it.";
  if (!res.error) { $("#file").value = ""; $("#older").checked = false; log("document_upload", null, {doc: res.id, name: f.name}); }
  refreshDocs();
}

init();
