import { VoiceCompanion } from "./companion.js";

const $ = id => document.getElementById(id);
let adminToken = "";
let current = null;
let busy = false;
let companion;
const auth = () => ({ Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" });
async function api(url, method = "GET", data) {
  const response = await fetch(url, { method, headers: auth(), body: data ? JSON.stringify(data) : undefined });
  const result = await response.json(); if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`); return result;
}
function setMessage(id, text) { $(id).textContent = text || ""; }
function render(session) {
  if (!session) return;
  current = session; $("empty").hidden = true; $("active").hidden = false;
  $("sessionState").textContent = session.mode === "companion" ? "OpenAI voice companion" : session.mode === "live" ? "Earlier Meet interview" : "Typed rehearsal";
  $("statusPill").textContent = session.done ? "Finished" : session.status.replaceAll("_", " ");
  $("sessionMeta").textContent = [session.company, session.role].filter(Boolean).join(" · ") || new Date(session.createdAt).toLocaleString();
  $("rehearsal").hidden = session.mode !== "rehearsal" || session.done;
  $("voicePanel").hidden = session.mode !== "companion" || session.status === "stopped" || session.done;
  $("beginVoice").disabled = !companion || companion.sessionId !== session.id || !companion.captureStream || companion.started;
  $("processVoice").disabled = !companion || companion.sessionId !== session.id || !companion.started;
  $("stop").hidden = session.status === "stopped";
  const list = $("transcript"); list.replaceChildren();
  for (const turn of session.turns) {
    const block = document.createElement("div"); block.className = `turn ${turn.role}`;
    const who = document.createElement("div"); who.className = "speaker"; who.textContent = turn.role === "bot" ? "Interviewer" : turn.speaker || "Guest";
    const words = document.createElement("p"); words.textContent = turn.text; block.append(who, words); list.append(block);
  }
  list.scrollTop = list.scrollHeight;
  $("summary").hidden = !session.summary; $("summary").textContent = session.summary || "";
}
async function refresh() {
  if (!adminToken) return;
  try {
    const sessions = await api("/api/sessions");
    const list = $("sessions"); list.replaceChildren();
    if (!sessions.length) { const p = document.createElement("p"); p.textContent = "No interviews yet."; list.append(p); }
    for (const session of sessions) {
      const row = document.createElement("div"); row.className = "historyitem";
      const info = document.createElement("div"); const title = document.createElement("strong"); title.textContent = session.company || (session.mode === "companion" ? "Voice companion" : "Rehearsal");
      const sub = document.createElement("small"); sub.textContent = `${new Date(session.createdAt).toLocaleString()} · ${session.mode} · ${session.turns.length} turns`; info.append(title, sub);
      const button = document.createElement("button"); button.className = "secondary"; button.textContent = "Open"; button.onclick = () => render(session); row.append(info, button); list.append(row);
    }
    if (current) { const updated = sessions.find(s => s.id === current.id); if (updated && updated.updatedAt !== current.updatedAt) render(updated); }
  } catch (err) { setMessage("setupMessage", err.message); }
}
async function start() {
  if (busy) return; busy = true; setMessage("setupMessage", "Creating rehearsal…");
  try {
    const session = await api("/api/sessions", "POST", { mode: "rehearsal", meetingUrl: $("meetingUrl").value.trim(), company: $("company").value.trim(), role: $("role").value.trim(), context: $("context").value.trim() });
    render(session); await refresh(); setMessage("setupMessage", "Rehearsal ready. Start with the opening question.");
    await api(`/api/sessions/${session.id}/intro`, "POST"); render(await api(`/api/sessions/${session.id}`));
  } catch (err) { setMessage("setupMessage", err.message); } finally { busy = false; }
}
companion = new VoiceCompanion({ api, render, setState: text => { $("voiceState").textContent = text; }, token: () => adminToken });
$("openMeet").onclick = () => { try { const url = new URL($("meetingUrl").value.trim()); if (url.protocol !== "https:" || url.hostname !== "meet.google.com") throw new Error("Enter a Google Meet link"); window.open(url.href, "_blank", "noopener"); } catch (err) { setMessage("setupMessage", err.message); } };
$("startVoice").onclick = async () => {
  if (busy) return; busy = true; setMessage("setupMessage", "Choose the Meet tab and enable tab audio…");
  try {
    await companion.capture();
    const session = await api("/api/sessions", "POST", { mode: "companion", meetingUrl: $("meetingUrl").value.trim(), company: $("company").value.trim(), role: $("role").value.trim(), context: $("context").value.trim() });
    companion.prepare(session.id); render(session); await refresh(); setMessage("setupMessage", "Meet audio connected. Present this Markout Travel Agency tab with audio, then click Begin interview.");
  } catch (err) { companion.stop(); setMessage("setupMessage", err.message); } finally { busy = false; }
};
$("startDemo").onclick = start;
$("beginVoice").onclick = async () => { try { await companion.begin(); render(await api(`/api/sessions/${companion.sessionId}`)); } catch (err) { setMessage("sessionMessage", err.message); } };
$("processVoice").onclick = () => companion.processAnswerNow();
$("stopVoice").onclick = () => { companion.stop(); $("voiceState").textContent = "Listening stopped."; };
$("sendAnswer").onclick = async () => {
  const text = $("answer").value.trim(); if (!text || !current || busy) return; busy = true; setMessage("sessionMessage", "Thinking…");
  try { await api(`/api/sessions/${current.id}/turn`, "POST", { text, speaker: "Guest" }); $("answer").value = ""; render(await api(`/api/sessions/${current.id}`)); setMessage("sessionMessage", ""); }
  catch (err) { setMessage("sessionMessage", err.message); } finally { busy = false; }
};
$("summarize").onclick = async () => { if (!current) return; setMessage("sessionMessage", "Writing summary…"); try { render(await api(`/api/sessions/${current.id}/summary`, "POST")); setMessage("sessionMessage", ""); } catch (err) { setMessage("sessionMessage", err.message); } };
$("stop").onclick = async () => { if (!current) return; try { companion.stop(); render(await api(`/api/sessions/${current.id}/stop`, "POST")); setMessage("sessionMessage", "Interview ended."); } catch (err) { setMessage("sessionMessage", err.message); } };
$("download").onclick = () => { if (!current) return; const content = [`# Interview: ${current.company || "Local travel business"}`, `Date: ${current.createdAt}`, `Mode: ${current.mode}`, "", ...current.turns.map(t => `**${t.role === "bot" ? "Interviewer" : t.speaker || "Guest"}:** ${t.text}`), "", "## Summary", current.summary || "Not generated yet."].join("\n\n"); const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([content], { type: "text/markdown" })); a.download = `interview-${current.id}.md`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); };
async function bootstrap() {
  try { const response = await fetch("/api/bootstrap"); if (!response.ok) throw new Error("Local setup failed"); const boot = await response.json(); adminToken = boot.token; $("meetingUrl").value = boot.defaults?.meetingUrl || ""; $("startVoice").disabled = false; $("startDemo").disabled = false; await refresh(); }
  catch (err) { setMessage("setupMessage", err.message); }
}
$("startVoice").disabled = true; $("startDemo").disabled = true;
bootstrap(); setInterval(refresh, 2500);
