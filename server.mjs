import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { opening, nextFallback, interviewInstructions, summaryInstructions } from "./interview.mjs";

const root = path.dirname(fileURLToPath(import.meta.url));
const directory = process.env.SESSION_DIR || path.join(root, "sessions");
const port = Number(process.env.PORT || 3000);
const adminToken = process.env.ADMIN_TOKEN || crypto.randomBytes(24).toString("hex");
let localDefaults = {};
try { localDefaults = JSON.parse(await fs.readFile(path.join(root, "local-config.json"), "utf8")); } catch { /* optional local defaults */ }
const sessions = new Map();
const locks = new Set();

await fs.mkdir(directory, { recursive: true });
await fs.chmod(directory, 0o700);
for (const file of await fs.readdir(directory)) {
  if (!file.endsWith(".json")) continue;
  try { const item = JSON.parse(await fs.readFile(path.join(directory, file), "utf8")); sessions.set(item.id, item); } catch { /* skip malformed session */ }
}

function send(res, status, data, type = "application/json; charset=utf-8") {
  const body = type.startsWith("application/json") ? JSON.stringify(data) : data;
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
  res.end(body);
}
function error(res, status, message) { send(res, status, { error: message }); }
async function body(req) {
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > 1_000_000) throw new Error("Request too large"); chunks.push(chunk); }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}
function admin(req) { return req.headers.authorization === `Bearer ${adminToken}`; }
function view(session) {
  const { botToken, ...safe } = session;
  return safe;
}
async function save(session) {
  session.updatedAt = new Date().toISOString();
  const file = path.join(directory, `${session.id}.json`);
  await fs.writeFile(`${file}.tmp`, JSON.stringify(session, null, 2), { mode: 0o600 });
  await fs.rename(`${file}.tmp`, file);
}
async function openai(endpoint, payload, binary = false) {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is missing");
  const response = await fetch(`https://api.openai.com/v1/${endpoint}`, {
    method: "POST", headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify(payload)
  });
  if (!response.ok) throw new Error(`OpenAI ${response.status}: ${(await response.text()).slice(0, 300)}`);
  return binary ? Buffer.from(await response.arrayBuffer()) : response.json();
}
function outputText(result) {
  return (result.output || []).flatMap(item => item.content || []).filter(part => part.type === "output_text").map(part => part.text).join("\n");
}
async function generate(session) {
  if (!process.env.OPENAI_API_KEY) return nextFallback(session);
  const result = await openai("responses", {
    model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
    instructions: interviewInstructions(session),
    input: session.turns.map(t => ({ role: t.role === "bot" ? "assistant" : "user", content: t.text })).concat([{ role: "user", content: "Respond to the latest answer with the next interview question. Return JSON only." }]),
    max_output_tokens: 200,
    store: false
  });
  let parsed;
  try { parsed = JSON.parse(outputText(result).replace(/^```(?:json)?\s*|\s*```$/g, "")); } catch { throw new Error("OpenAI did not return valid interview JSON"); }
  if (typeof parsed.say !== "string" || !parsed.say.trim()) throw new Error("OpenAI returned an empty question");
  return { say: parsed.say.trim().slice(0, 700), topic: String(parsed.topic || "other"), done: Boolean(parsed.done) };
}
async function audioFor(text) {
  if (!process.env.OPENAI_API_KEY) return null;
  const audio = await openai("audio/speech", { model: process.env.OPENAI_TTS_MODEL || "gpt-4o-mini-tts", voice: "marin", input: text, response_format: "mp3", instructions: "Warm, clear, conversational interviewer. Speak at a natural pace." }, true);
  return audio.toString("base64");
}
async function audioBody(req) {
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > 10_000_000) throw new Error("Audio clip is too large"); chunks.push(chunk); }
  if (size < 500) throw new Error("Audio clip is empty");
  return Buffer.concat(chunks);
}
async function transcribeAudio(buffer, contentType) {
  const type = contentType?.split(";")[0] || "audio/webm";
  if (!["audio/webm", "audio/mp4", "audio/ogg"].includes(type)) throw new Error("Unsupported audio format");
  const form = new FormData();
  form.append("model", "gpt-4o-mini-transcribe");
  form.append("file", new Blob([buffer], { type }), type === "audio/mp4" ? "answer.mp4" : type === "audio/ogg" ? "answer.ogg" : "answer.webm");
  const response = await fetch("https://api.openai.com/v1/audio/transcriptions", { method: "POST", headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` }, body: form });
  if (!response.ok) throw new Error(`OpenAI transcription ${response.status}: ${(await response.text()).slice(0, 200)}`);
  return (await response.json()).text || "";
}
async function reply(session, text, speaker) {
  if (locks.has(session.id)) throw new Error("The interviewer is still preparing its last question");
  locks.add(session.id);
  try {
    session.turns.push({ role: "human", speaker: String(speaker || "Guest").slice(0, 100), text: text.slice(0, 5000), at: new Date().toISOString() });
    await save(session);
    const next = await generate(session);
    session.turns.push({ role: "bot", topic: next.topic, text: next.say, at: new Date().toISOString() });
    session.done = next.done;
    await save(session);
    let audio = null;
    try { audio = await audioFor(next.say); } catch (err) { session.audioError = err.message; await save(session); }
    return { ...next, audio };
  } finally { locks.delete(session.id); }
}

const server = http.createServer(async (req, res) => {
  try {
    const host = (req.headers.host || "").replace(/:\d+$/, "");
    if (host !== "localhost" && host !== "127.0.0.1") return error(res, 403, "Open this app on localhost");
    const url = new URL(req.url, `http://localhost:${port}`);
    if (req.method === "GET" && ["/", "/index.html", "/app.js", "/style.css"].includes(url.pathname)) {
      const file = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
      const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8" };
      return send(res, 200, await fs.readFile(path.join(root, "public", file)), types[path.extname(file)]);
    }
    if (url.pathname === "/api/bootstrap" && req.method === "GET") return send(res, 200, { token: adminToken, defaults: { meetingUrl: String(localDefaults.meetingUrl || "") } });
    if (url.pathname === "/api/config" && req.method === "GET") return send(res, 200, { openaiReady: Boolean(process.env.OPENAI_API_KEY) });
    if (url.pathname === "/api/sessions" && req.method === "GET") {
      if (!admin(req)) return error(res, 401, "Invalid admin token");
      return send(res, 200, [...sessions.values()].map(view).sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
    }
    if (url.pathname === "/api/sessions" && req.method === "POST") {
      if (!admin(req)) return error(res, 401, "Invalid admin token");
      const input = await body(req);
      if (input.live) return error(res, 400, "A separate Google Meet participant cannot be created with an OpenAI key alone. Use the voice companion instead.");
      const companion = input.mode === "companion";
      if (companion && !process.env.OPENAI_API_KEY) return error(res, 400, "OPENAI_API_KEY is missing from the server environment");
      const session = { id: crypto.randomUUID(), mode: companion ? "companion" : "rehearsal", meetingUrl: String(input.meetingUrl || "").slice(0, 500), company: String(input.company || "").slice(0, 120), role: String(input.role || "").slice(0, 120), context: String(input.context || "").slice(0, 1000), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), turns: [], done: false, summary: "", status: companion ? "ready" : "rehearsal" };
      sessions.set(session.id, session); await save(session);
      return send(res, 201, view(session));
    }
    const match = url.pathname.match(/^\/api\/sessions\/([a-f0-9-]+)(?:\/(.+))?$/);
    if (match) {
      const session = sessions.get(match[1]); if (!session) return error(res, 404, "Session not found");
      const action = match[2] || "";
      if (!admin(req)) return error(res, 401, "Invalid token");
      if (req.method === "GET" && !action) return send(res, 200, view(session));
      if (req.method === "POST" && action === "intro") {
        if (!session.turns.some(t => t.role === "bot")) { session.turns.push({ role: "bot", topic: "opening", text: opening, at: new Date().toISOString() }); await save(session); }
        const say = session.turns.find(t => t.role === "bot").text;
        let audio = null; try { audio = await audioFor(say); } catch (err) { session.audioError = err.message; await save(session); }
        return send(res, 200, { say, audio, done: false });
      }
      if (req.method === "POST" && action === "turn") {
        if (session.done) return error(res, 409, "Interview is finished");
        const input = await body(req); if (typeof input.text !== "string" || !input.text.trim()) return error(res, 400, "Answer is empty");
        const result = await reply(session, input.text.trim(), input.speaker);
        return send(res, 200, result);
      }
      if (req.method === "POST" && action === "transcribe") {
        if (session.mode !== "companion") return error(res, 400, "Audio transcription is only available for voice companion sessions");
        if (!process.env.OPENAI_API_KEY) return error(res, 400, "OPENAI_API_KEY is missing from the server environment");
        return send(res, 200, { text: await transcribeAudio(await audioBody(req), req.headers["content-type"]) });
      }
      if (req.method === "POST" && action === "summary") {
        if (!admin(req)) return error(res, 401, "Admin token required");
        if (session.turns.length === 0) return error(res, 400, "No interview yet");
        if (!process.env.OPENAI_API_KEY) return error(res, 400, "OPENAI_API_KEY is required for the summary");
        const result = await openai("responses", { model: process.env.OPENAI_MODEL || "gpt-4.1-mini", instructions: summaryInstructions(), input: session.turns.map(t => `${t.role === "bot" ? "Interviewer" : t.speaker || "Guest"}: ${t.text}`).join("\n"), max_output_tokens: 1200, store: false });
        session.summary = outputText(result); await save(session); return send(res, 200, view(session));
      }
      if (req.method === "POST" && action === "stop") {
        session.status = "stopped"; await save(session); return send(res, 200, view(session));
      }
    }
    return error(res, 404, "Not found");
  } catch (err) { console.error(err); error(res, err.message === "Request too large" || err.message === "Audio clip is too large" ? 413 : 500, err.message); }
});
server.listen(port, "127.0.0.1", () => { console.log(`Travel interviewer: http://localhost:${port}`); });
