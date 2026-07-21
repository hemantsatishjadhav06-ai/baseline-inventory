import { Buffer } from "node:buffer";

const MAX_SNAPSHOT_BYTES = 10 * 1024 * 1024;
const MIN_AUTOMATIC_SYNC_DELAY_MS = 5 * 60 * 1000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function boundedInteger(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

export function validateAndNormalizeSnapshot(snapshot, nowMs = Date.now()) {
  const source = snapshot?.source || {};
  const skus = snapshot?.skus;
  const declaredCount = Number(snapshot?.count);
  const totalProducts = Number(snapshot?.totalProducts);
  const timestamp = snapshot?.lastSync || snapshot?.generatedAt;
  const timestampMs = typeof timestamp === "string" ? Date.parse(timestamp) : NaN;
  if (!snapshot?.ready || !Array.isArray(skus) || skus.length === 0) throw new Error("snapshot is incomplete");
  if (!Number.isInteger(declaredCount) || declaredCount !== skus.length || declaredCount > 100000) throw new Error("snapshot count is invalid");
  if (!Number.isFinite(totalProducts) || totalProducts < declaredCount || totalProducts > 1000000) throw new Error("snapshot totalProducts is invalid");
  if (!Number.isFinite(timestampMs) || timestampMs > nowMs + 5 * 60 * 1000) throw new Error("snapshot timestamp is invalid");
  if (source.catalog !== "live" || source.stock !== "live" || source.sales !== "live" || source.velocity !== "live") throw new Error("snapshot sources are not fully live");
  if (!snapshot.sales?.available || !["today", "week", "month"].every((key) => Number.isFinite(Number(snapshot.sales[key])))) throw new Error("snapshot sales are invalid");
  if (!snapshot.topSellers?.available || !["today", "week", "month", "all"].every((key) => Array.isArray(snapshot.topSellers[key]))) throw new Error("snapshot top sellers are invalid");
  const invalidSku = skus.find((item) => !item
    || typeof item.sku !== "string" || item.sku.length === 0 || item.sku.length > 160
    || typeof item.name !== "string" || item.name.length === 0
    || !Number.isFinite(Number(item.price)) || !Number.isFinite(Number(item.onHand)));
  if (invalidSku) throw new Error("snapshot contains an invalid SKU");
  const { available: _salesAvailable, ...sales } = snapshot.sales;
  const { available: _topAvailable, ...topSellers } = snapshot.topSellers;
  return { skus, totalProducts, sales, topSellers, lastSync: new Date(timestampMs).toISOString() };
}

async function readBoundedText(response, maxBytes) {
  const declaredBytes = Number(response.headers?.get?.("content-length"));
  if (Number.isFinite(declaredBytes) && declaredBytes > maxBytes) throw new Error("snapshot exceeds 10 MB");
  const reader = response.body?.getReader?.();
  if (!reader) {
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > maxBytes) throw new Error("snapshot exceeds 10 MB");
    return text;
  }
  const chunks = [];
  let receivedBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      receivedBytes += value.byteLength;
      if (receivedBytes > maxBytes) {
        await reader.cancel("snapshot exceeds size limit").catch(() => {});
        throw new Error("snapshot exceeds 10 MB");
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock?.();
  }
  return Buffer.concat(chunks, receivedBytes).toString("utf8");
}

function normalizeAttemptError(error) {
  if (error?.name === "AbortError") return new Error("snapshot timeout");
  return error instanceof Error ? error : new Error(String(error || "snapshot failure"));
}

export async function loadSnapshotWithRetry({
  url, attempts = 4, timeoutMs = 15000, retryBaseMs = 750,
  maxBytes = MAX_SNAPSHOT_BYTES, headers = { Accept: "application/json" },
  fetchImpl = globalThis.fetch, sleepImpl = sleep, random = Math.random,
  now = Date.now, onAttemptFailure = () => {},
}) {
  let lastError = new Error("snapshot failure");
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, { headers, signal: controller.signal });
      if (!response.ok) throw new Error(`snapshot HTTP ${response.status}`);
      const body = await readBoundedText(response, maxBytes);
      const snapshot = validateAndNormalizeSnapshot(JSON.parse(body), now());
      return { snapshot, attempt };
    } catch (error) {
      lastError = normalizeAttemptError(error);
      onAttemptFailure({ attempt, error: lastError });
    } finally {
      clearTimeout(timeout);
    }
    if (attempt < attempts) {
      const backoffMs = Math.min(10000, retryBaseMs * (2 ** (attempt - 1)));
      const jitterMs = Math.floor(random() * Math.min(250, retryBaseMs));
      await sleepImpl(backoffMs + jitterMs);
    }
  }
  const error = new Error(`snapshot unavailable after ${attempts} attempts: ${lastError.message}`);
  error.cause = lastError;
  error.attempts = attempts;
  throw error;
}

export function automaticSyncDelay({
  restored, lastSync, syncMs, nowMs = Date.now(), jitterMs = 0,
  minDelayMs = MIN_AUTOMATIC_SYNC_DELAY_MS,
}) {
  if (!restored) return null;
  const snapshotTime = Date.parse(lastSync || "");
  const snapshotAgeMs = Number.isFinite(snapshotTime) ? Math.max(0, nowMs - snapshotTime) : syncMs;
  const untilDueMs = Math.max(0, syncMs - snapshotAgeMs);
  return Math.max(minDelayMs, untilDueMs) + Math.max(0, jitterMs);
}

export function createSnapshotRecoveryCoordinator({
  intervalMs,
  restore,
  onRestored,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  onError = () => {},
}) {
  let timer = null;
  let running = false;
  let completed = false;

  const schedule = () => {
    if (completed || running || timer) return false;
    timer = setTimer(async () => {
      timer = null;
      if (completed || running) return;
      running = true;
      try {
        const restored = await restore();
        if (restored) {
          completed = true;
          await onRestored();
        }
      } catch (error) {
        onError(error);
      } finally {
        running = false;
      }
      if (!completed) schedule();
    }, intervalMs);
    timer.unref?.();
    return true;
  };

  return {
    start: schedule,
    stop() {
      if (timer) clearTimer(timer);
      timer = null;
    },
    isScheduled: () => Boolean(timer),
    isRunning: () => running,
    isCompleted: () => completed,
  };
}
