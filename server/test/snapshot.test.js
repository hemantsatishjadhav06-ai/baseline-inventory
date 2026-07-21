import test from "node:test";
import assert from "node:assert/strict";
import {
  automaticSyncDelay,
  createSnapshotRecoveryCoordinator,
  loadSnapshotWithRetry,
  validateAndNormalizeSnapshot,
} from "../snapshot.js";

const NOW = Date.parse("2026-07-21T09:00:00.000Z");
const validSnapshot = (overrides = {}) => ({
  generatedAt: "2026-07-21T08:00:00.000Z", ready: true,
  source: { catalog: "live", stock: "live", sales: "live", velocity: "live" },
  totalProducts: 2, count: 1,
  skus: [{ sku: "SKU-1", name: "Test product", price: 100, onHand: 4 }],
  sales: { available: true, today: 10, week: 20, month: 30, currency: "INR" },
  topSellers: { available: true, today: [], week: [], month: [], all: [] },
  ...overrides,
});
const response = (status, payload) => ({
  ok: status >= 200 && status < 300, status,
  headers: { get: () => null },
  text: async () => typeof payload === "string" ? payload : JSON.stringify(payload),
});

test("recovers from transient failures with bounded exponential backoff", async () => {
  let calls = 0; const delays = []; const failures = [];
  const result = await loadSnapshotWithRetry({
    url: "https://snapshot.invalid/live.json", attempts: 4, timeoutMs: 1000, retryBaseMs: 100,
    fetchImpl: async () => { calls++; return calls < 3 ? response(503, "") : response(200, validSnapshot()); },
    sleepImpl: async (ms) => delays.push(ms), random: () => 0, now: () => NOW,
    onAttemptFailure: ({ attempt }) => failures.push(attempt),
  });
  assert.equal(result.attempt, 3);
  assert.equal(result.snapshot.skus.length, 1);
  assert.deepEqual(failures, [1, 2]);
  assert.deepEqual(delays, [100, 200]);
  assert.equal(calls, 3);
});

test("stops at the configured retry bound", async () => {
  let calls = 0; const delays = [];
  await assert.rejects(loadSnapshotWithRetry({
    url: "https://snapshot.invalid/live.json", attempts: 3, timeoutMs: 1000, retryBaseMs: 50,
    fetchImpl: async () => { calls++; return response(404, ""); },
    sleepImpl: async (ms) => delays.push(ms), random: () => 0, now: () => NOW,
  }), /snapshot unavailable after 3 attempts: snapshot HTTP 404/);
  assert.equal(calls, 3);
  assert.deepEqual(delays, [50, 100]);
});

test("retries validation failures instead of accepting corrupt state", async () => {
  let calls = 0;
  const result = await loadSnapshotWithRetry({
    url: "https://snapshot.invalid/live.json", attempts: 2, timeoutMs: 1000, retryBaseMs: 1,
    fetchImpl: async () => { calls++; return response(200, calls === 1 ? validSnapshot({ count: 99 }) : validSnapshot()); },
    sleepImpl: async () => {}, random: () => 0, now: () => NOW,
  });
  assert.equal(result.attempt, 2);
  assert.equal(calls, 2);
});

test("rejects oversized actual response bytes", async () => {
  await assert.rejects(loadSnapshotWithRetry({
    url: "https://snapshot.invalid/live.json", attempts: 1, timeoutMs: 1000, maxBytes: 16,
    fetchImpl: async () => response(200, "x".repeat(17)), now: () => NOW,
  }), /snapshot exceeds 10 MB/);
});

test("validates timestamps and normalizes state", () => {
  const normalized = validateAndNormalizeSnapshot(validSnapshot(), NOW);
  assert.equal(normalized.lastSync, "2026-07-21T08:00:00.000Z");
  assert.equal(normalized.totalProducts, 2);
  assert.throws(() => validateAndNormalizeSnapshot(
    validSnapshot({ generatedAt: "2026-07-21T09:06:00.000Z" }), NOW,
  ), /timestamp is invalid/);
});

test("fail-closed policy never schedules Magento without a restored snapshot", () => {
  assert.equal(automaticSyncDelay({
    restored: false, lastSync: null, syncMs: 6 * 60 * 60 * 1000, nowMs: NOW, jitterMs: 1234,
  }), null);
});

test("stale restored state schedules only after minimum delay and jitter", () => {
  assert.equal(automaticSyncDelay({
    restored: true, lastSync: "2026-07-21T00:00:00.000Z",
    syncMs: 6 * 60 * 60 * 1000, nowMs: NOW, jitterMs: 1234,
  }), 5 * 60 * 1000 + 1234);
});

test("snapshot-only recovery re-arms after failure and completes once", async () => {
  const timers = [];
  let restores = 0;
  let schedulerCalls = 0;
  const coordinator = createSnapshotRecoveryCoordinator({
    intervalMs: 300000,
    restore: async () => ++restores >= 2,
    onRestored: async () => { schedulerCalls++; },
    setTimer: (callback, delay) => {
      const timer = { callback, delay, unref() {} };
      timers.push(timer);
      return timer;
    },
    clearTimer: () => {},
  });

  assert.equal(coordinator.start(), true);
  assert.equal(coordinator.start(), false);
  assert.equal(timers.length, 1);
  assert.equal(timers[0].delay, 300000);

  await timers.shift().callback();
  assert.equal(restores, 1);
  assert.equal(schedulerCalls, 0);
  assert.equal(timers.length, 1);

  await timers.shift().callback();
  assert.equal(restores, 2);
  assert.equal(schedulerCalls, 1);
  assert.equal(coordinator.isCompleted(), true);
  assert.equal(timers.length, 0);
  assert.equal(coordinator.start(), false);
});
