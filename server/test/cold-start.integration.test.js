import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const appPath = fileURLToPath(new URL("../index.js", import.meta.url));

const validSnapshot = () => ({
  generatedAt: new Date().toISOString(),
  ready: true,
  source: { catalog: "live", stock: "live", sales: "live", velocity: "live" },
  totalProducts: 2,
  count: 1,
  skus: [{ sku: "SKU-1", name: "Test product", price: 100, onHand: 4 }],
  sales: { available: true, today: 10, week: 20, month: 30, currency: "INR" },
  topSellers: { available: true, today: [], week: [], month: [], all: [] },
});

async function listen(server) {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return server.address().port;
}

async function unusedPort() {
  const server = http.createServer();
  const port = await listen(server);
  await new Promise((resolve) => server.close(resolve));
  return port;
}

function startApp(env) {
  const child = spawn(process.execPath, [appPath], {
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    env: {
      ...process.env,
      MAGENTO_CONSUMER_KEY: "",
      MAGENTO_CONSUMER_SECRET: "",
      MAGENTO_ACCESS_TOKEN: "",
      MAGENTO_ACCESS_TOKEN_SECRET: "",
      ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  return { child, output: () => output };
}

async function stopApp(child) {
  if (child.exitCode != null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 2000)),
  ]);
  if (child.exitCode == null) child.kill("SIGKILL");
}

async function waitJson(url, expectedStatus, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      const body = await response.json();
      if (response.status === expectedStatus) return body;
      lastError = new Error(`unexpected status ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw lastError || new Error("endpoint timeout");
}

async function waitOutput(app, pattern, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (pattern.test(app.output())) return;
    if (app.child.exitCode != null) throw new Error(`app exited early: ${app.output()}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`missing output ${pattern}: ${app.output()}`);
}

test("a validated snapshot makes readiness healthy", async () => {
  const snapshotServer = http.createServer((_req, res) => {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(validSnapshot()));
  });
  const snapshotPort = await listen(snapshotServer);
  const appPort = await unusedPort();
  const app = startApp({
    PORT: String(appPort),
    SNAPSHOT_URL: `http://127.0.0.1:${snapshotPort}/live.json`,
    SNAPSHOT_FETCH_ATTEMPTS: "2",
    SNAPSHOT_RETRY_BASE_MS: "100",
  });
  try {
    const ready = await waitJson(`http://127.0.0.1:${appPort}/readyz`, 200);
    assert.equal(ready.validated, true);
    assert.equal(ready.count, 1);
  } finally {
    await stopApp(app.child);
    await new Promise((resolve) => snapshotServer.close(resolve));
  }
});

test("snapshot exhaustion stays live but unready and never schedules Magento", async () => {
  let snapshotRequests = 0;
  const snapshotServer = http.createServer((_req, res) => {
    snapshotRequests++;
    res.statusCode = 503;
    res.end("unavailable");
  });
  const snapshotPort = await listen(snapshotServer);
  const appPort = await unusedPort();
  const app = startApp({
    PORT: String(appPort),
    SNAPSHOT_URL: `http://127.0.0.1:${snapshotPort}/live.json`,
    SNAPSHOT_FETCH_ATTEMPTS: "2",
    SNAPSHOT_RETRY_BASE_MS: "100",
    SNAPSHOT_TIMEOUT_MS: "3000",
    SYNC_SECRET: "manual-secret",
  });
  try {
    const live = await waitJson(`http://127.0.0.1:${appPort}/healthz`, 200);
    assert.equal(live.ok, true);
    await waitOutput(app, /automatic Magento sync disabled/);
    const ready = await waitJson(`http://127.0.0.1:${appPort}/readyz`, 503);
    assert.equal(ready.ok, false);
    assert.equal(ready.count, 0);
    assert.equal(snapshotRequests, 2);
    assert.doesNotMatch(app.output(), /next Magento sync/);

    const manual = await fetch(`http://127.0.0.1:${appPort}/api/sync`, {
      method: "POST",
      headers: { "x-sync-secret": "manual-secret" },
    });
    const manualBody = await manual.json();
    assert.equal(manual.status, 503);
    assert.match(manualBody.error, /OAuth creds not set/);
  } finally {
    await stopApp(app.child);
    await new Promise((resolve) => snapshotServer.close(resolve));
  }
});
