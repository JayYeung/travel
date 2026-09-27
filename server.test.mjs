import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import net from "node:net";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

async function unusedPort() { const server = net.createServer(); await new Promise(resolve => server.listen(0, "127.0.0.1", resolve)); const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port; }

test("rehearsal creates a protected interview and advances the questions", async () => {
  const port = await unusedPort(); const token = "test-admin-token";
  const sessionDir = await fs.mkdtemp(path.join(os.tmpdir(), "travel-interview-test-"));
  const child = spawn(process.execPath, ["server.mjs"], { cwd: new URL(".", import.meta.url), env: { ...process.env, PORT: String(port), ADMIN_TOKEN: token, OPENAI_API_KEY: "", SESSION_DIR: sessionDir }, stdio: "ignore" });
  try {
    const base = `http://localhost:${port}`;
    let ready = false;
    for (let i = 0; i < 40; i++) { try { const response = await fetch(`${base}/api/config`); if (response.ok) { ready = true; break; } } catch {} await new Promise(resolve => setTimeout(resolve, 50)); }
    assert.equal(ready, true, "server started");
    const bootstrap = await (await fetch(`${base}/api/bootstrap`)).json(); assert.equal(bootstrap.token, token);
    const unauth = await fetch(`${base}/api/sessions`); assert.equal(unauth.status, 401);
    const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
    const config = await (await fetch(`${base}/api/config`)).json(); assert.equal(config.openaiReady, false); assert.equal(JSON.stringify(config).includes("OPENAI_API_KEY"), false);
    const legacyLive = await fetch(`${base}/api/sessions`, { method: "POST", headers, body: JSON.stringify({ live: true }) }); assert.equal(legacyLive.status, 400);
    const noKeyCompanion = await fetch(`${base}/api/sessions`, { method: "POST", headers, body: JSON.stringify({ mode: "companion" }) }); assert.equal(noKeyCompanion.status, 400);
    const create = await fetch(`${base}/api/sessions`, { method: "POST", headers, body: JSON.stringify({ live: false, company: "Example Guesthouse" }) });
    assert.equal(create.status, 201); const session = await create.json();
    const intro = await fetch(`${base}/api/sessions/${session.id}/intro`, { method: "POST", headers }); assert.equal(intro.status, 200); assert.match((await intro.json()).say, /get bookings and new customers/i);
    const turn = await fetch(`${base}/api/sessions/${session.id}/turn`, { method: "POST", headers, body: JSON.stringify({ text: "Yes, I'm the guesthouse owner." }) });
    assert.equal(turn.status, 200); assert.match((await turn.json()).say, /what does your business offer/i);
    const saved = await fetch(`${base}/api/sessions/${session.id}`, { headers }); const data = await saved.json(); assert.equal(data.turns.length, 3); assert.equal(data.turns[1].text, "Yes, I'm the guesthouse owner."); assert.equal(data.botToken, undefined);
  } finally { child.kill(); await fs.rm(sessionDir, { recursive: true, force: true }); }
});
