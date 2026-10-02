/**
 * Behaviour verification of the host service's session-history paths.
 *
 * These assertions drive a real `TurnCostService` instance through a minimal
 * Cordis-shaped context, and they model the **official** `Session` shape on
 * purpose: a private `log`, a public `snapshotEvents()` accessor, a `seq`
 * getter, and — importantly — **no `events` property at all**. Handing the
 * service a session that carries an ad-hoc `events` array is what a previous
 * version of this suite did, and it hid a defect that broke every cost readout
 * for a session the UI had open.
 *
 * The service extends `TypertRemoteService`, whose constructor registers itself
 * through `ctx.reflect.provide`; `makeCtx` supplies the smallest context that
 * satisfies Cordis plus the members this plugin actually touches. If a future
 * release needs more, the test fails loudly with the missing member rather than
 * silently skipping.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { TurnCostService } from "../lib/index.js";
import { costOfSession, foldEvents, foldSessionEvents, messageTurnsOf, sessionLogSignature } from "../lib/fold.js";

/** Official-shape session events (`{ type, seq, time, data }`), one priced turn. */
function officialLog({ turn = 1, messageId = "m1", input = 1_000_000, output = 1_000_000 } = {}) {
  const base = turn * 100;
  return [
    { type: "session", seq: base + 0, time: 1_700_000_000_000, data: { version: 4, id: "s1" } },
    {
      type: "request/header",
      seq: base + 1,
      time: 1_700_000_001_000,
      data: { header: { config: { provider: "deepseek-official", model: "deepseek-flash" } }, reason: "initial" },
    },
    { type: "turn/start", seq: base + 2, time: 1_700_000_001_100, data: { turn } },
    { type: "step/start", seq: base + 3, time: 1_700_000_001_200, data: { turn, step: 1 } },
    // A streaming usage sample for (turn,1) that the final message must supersede.
    {
      type: "assistant/chunk",
      seq: base + 4,
      time: 1_700_000_001_300,
      data: { turn, step: 1, chunk: { type: "usage", usage: { inputTokens: 1, outputTokens: 1 } } },
    },
    {
      type: "assistant/message",
      seq: base + 5,
      time: 1_700_000_002_000,
      data: {
        turn,
        step: 1,
        message: {
          id: messageId,
          role: "assistant",
          source: { kind: "model", provider: "deepseek-official", model: "deepseek-flash" },
        },
        stream: [],
        usage: { inputTokens: input, outputTokens: output, cacheReadTokens: 0, cacheWriteTokens: 0 },
      },
    },
    { type: "step/end", seq: base + 6, time: 1_700_000_002_100, data: { turn, step: 1 } },
    { type: "turn/end", seq: base + 7, time: 1_700_000_002_200, data: { turn, reason: { kind: "completed" } } },
    { type: "session/title", seq: base + 8, time: 1_700_000_003_000, data: { title: "官方路径会话", messageSeqs: [1], source: { kind: "user" } } },
  ];
}

/**
 * One in-memory session exactly as the official `Session` class exposes it:
 * a private `log`, `snapshotEvents()` for the complete log, `seq` equal to the
 * log length, and no `events` property.
 */
function liveSession(id, events) {
  return {
    id,
    log: events,
    get seq() {
      return events.length;
    },
    snapshotEvents() {
      return Object.freeze([...events]);
    },
  };
}

/**
 * Smallest Cordis-shaped context this plugin runs on.
 *
 * @param options.get - `ctx.get(key)` resolution.
 * @param options.live - in-memory sessions, as the official shape above.
 * @param options.logs - captured logger warnings.
 */
function makeCtx({ get = () => undefined, live = [], logs = [] } = {}) {
  const services = new Map();
  const sessions = new Map(live.map((session) => [session.id, session]));
  const ctx = {
    reflect: {
      provide(name, value) {
        services.set(name, value);
        return () => services.delete(name);
      },
    },
    effect(callback) {
      // Cordis effects return a disposer; the plugin only needs it not to throw.
      return typeof callback === "function" ? () => {} : undefined;
    },
    on() {
      return () => {};
    },
    get,
    logger() {
      return { warn: (line) => logs.push(String(line)), info: () => {}, error: () => {}, debug: () => {} };
    },
    // The official store surface: `get(id)` and `list()` (see the host Service
    // catalog). `list()` is provided so an accidental return to scanning it
    // still works, but nothing here may depend on `Session.events`.
    sessions: { get: (id) => sessions.get(id), list: () => [...sessions.values()] },
  };
  return { ctx, services };
}

/** A `ctx.sessionQuery` stand-in returning one fixed log. */
function officialService(events, { onRead } = {}) {
  return {
    async readSession(sessionId) {
      onRead?.(sessionId);
      return { session: { id: sessionId, version: 4, createdAt: 1, isSeeded: false }, inheritedEventCount: 0, events };
    },
  };
}

test("regression: a live session in the official shape is still priced", async () => {
  // The live session must expose ONLY the official accessors. `Session` keeps
  // its events in a private `log` and offers `snapshotEvents()`; a previous
  // implementation read `session.events`, which does not exist, so every query
  // for a session the UI had open silently priced nothing while the durable
  // path kept working — the exact asymmetry this test pins down.
  const events = officialLog();
  const session = liveSession("s1", events);
  assert.equal("events" in session, false, "the official Session shape has no `events` property");
  let reads = 0;
  const { ctx } = makeCtx({ get: (key) => (key === "sessionQuery" ? officialService(events, { onRead: () => { reads += 1; } }) : undefined), live: [session] });
  const service = new TurnCostService(ctx, {});

  const totals = await service.sessionTotals({ sessionId: "s1" });
  assert.equal(reads, 1, "the complete log must come from the official live-preferred read");
  assert.equal(totals.steps, 1, "a live session must fold its real usage");
  assert.equal(totals.priced, 1);
  assert.ok(totals.cost > 0, "a live session must produce a real figure, not null");
  assert.deepEqual(totals.models, ["deepseek-flash"]);

  const turn = await service.query({ sessionId: "s1", turn: 1 });
  assert.ok(turn.cost > 0, "the per-turn readout must work for a live session too");
});

test("a live session is re-read only when the official seq says its log grew", async () => {
  let events = officialLog();
  let reads = 0;
  const official = officialService(events, { onRead: () => { reads += 1; } });
  const session = liveSession("s1", events);
  // `readSession` must reflect the session's current log, like the real service.
  official.readSession = async (sessionId) => {
    reads += 1;
    return { session: { id: sessionId }, inheritedEventCount: 0, events: session.snapshotEvents() };
  };
  const { ctx } = makeCtx({ get: (key) => (key === "sessionQuery" ? official : undefined), live: [session] });
  const service = new TurnCostService(ctx, {});

  const first = await service.sessionTotals({ sessionId: "s1" });
  assert.equal(reads, 1);
  const cachedFold = service.cache.get("s1");

  // Same seq: the fold is reused and no second read happens.
  const second = await service.sessionTotals({ sessionId: "s1" });
  assert.equal(reads, 1, "an unchanged live log must not trigger another official read");
  assert.equal(service.cache.get("s1"), cachedFold, "the cached fold must be reused");
  assert.equal(second.cost, first.cost);

  // The log grows: the readout must follow the growing spend, not the cache.
  session.log.push(...officialLog({ turn: 2, messageId: "m2" }));
  const third = await service.sessionTotals({ sessionId: "s1" });
  assert.equal(reads, 2, "a grown live log must be re-read");
  assert.equal(third.steps, 2, "a stale fold must never outlive its log");
  assert.ok(third.cost > first.cost);
});

test("a session with no usage yields null instead of a fabricated figure", async () => {
  const { ctx } = makeCtx({ get: (key) => (key === "sessionQuery" ? officialService([]) : undefined) });
  const service = new TurnCostService(ctx, {});
  assert.equal(await service.sessionTotals({ sessionId: "s1" }), null);
  assert.equal(await service.query({ sessionId: "s1", turn: 1 }), null, "a turn with no samples must not invent a cost");
  assert.equal(await service.query({ sessionId: "s1", messageId: "m1" }), null);
});

test("a blank live session (empty log) is not priced", async () => {
  const { ctx } = makeCtx({
    get: (key) => (key === "sessionQuery" ? officialService([]) : undefined),
    live: [liveSession("blank", [])],
  });
  const service = new TurnCostService(ctx, {});
  assert.equal(await service.sessionTotals({ sessionId: "blank" }), null);
});

test("query addresses a turn by the id of an assistant message inside it", async () => {
  const events = [...officialLog({ turn: 1, messageId: "m1" }), ...officialLog({ turn: 2, messageId: "m2", input: 2_000_000 })];
  const { ctx } = makeCtx({ get: (key) => (key === "sessionQuery" ? officialService(events) : undefined) });
  const service = new TurnCostService(ctx, {});

  const first = await service.query({ sessionId: "s1", messageId: "m1" });
  assert.equal(first.turn, 1, "a message id must resolve to its own turn");
  const second = await service.query({ sessionId: "s1", messageId: "m2" });
  assert.equal(second.turn, 2);
  assert.ok(second.cost > first.cost, "the second turn's larger usage must price higher");

  assert.equal(await service.query({ sessionId: "s1", messageId: "nope" }), null, "an unknown message id must price nothing");
  assert.equal(await service.query({ sessionId: "s1" }), null, "neither turn nor message id must price nothing");
});

test("the fold exposes a log signature and the message-to-turn map", () => {
  const events = officialLog();
  const fold = foldSessionEvents(events);
  assert.equal(fold.signature, sessionLogSignature(events));
  assert.equal(fold.signature, `sq:${events.length}:${events.at(-1).seq}`);
  assert.deepEqual(fold.messageTurns, { m1: { turn: 1, step: 1 } });
  assert.deepEqual(messageTurnsOf([{ type: "assistant/message", data: { turn: 3 } }]), {}, "a message without an id is not addressable");
  assert.deepEqual(fold.samples, foldEvents(events), "one fold must serve both sources");
  assert.deepEqual(costOfSession(fold.samples), costOfSession(foldEvents(events)));
});

test("the log scan takes over when the official read refuses", async () => {
  const events = officialLog();
  let reads = 0;
  const official = {
    async readSession() {
      reads += 1;
      throw new Error("persistence hiccup");
    },
  };
  const { ctx } = makeCtx({ get: (key) => (key === "sessionQuery" ? official : undefined), live: [liveSession("s1", events)] });
  const service = new TurnCostService(ctx, {});

  const totals = await service.sessionTotals({ sessionId: "s1" });
  assert.equal(reads, 1, "the official read is attempted first");
  assert.equal(totals.steps, 1, "the fallback must still fold the live snapshot");
  assert.equal(totals.priced, 1);
  assert.ok(totals.cost > 0);
});

test("the log scan prices a live-only session when no sessionQuery is composed", async () => {
  const { ctx } = makeCtx({ get: () => undefined, live: [liveSession("s1", officialLog())] });
  const service = new TurnCostService(ctx, {});
  const totals = await service.sessionTotals({ sessionId: "s1" });
  assert.equal(totals.steps, 1, "without an official service the live-session fold must serve the readout");
  assert.equal(totals.priced, 1);
});

test("an unreadable session degrades to no figure rather than an invented one", async () => {
  const official = {
    async readSession() {
      throw new Error("no such session in the live-preferred corpus");
    },
  };
  const { ctx } = makeCtx({ get: (key) => (key === "sessionQuery" ? official : undefined) });
  const service = new TurnCostService(ctx, {});
  // No durable log under the test DSH home and no live session either.
  assert.equal(await service.sessionTotals({ sessionId: "s1" }), null);
});

test("invalid session ids are rejected before any lookup", async () => {
  let touched = 0;
  const { ctx } = makeCtx({
    get: (key) => (key === "sessionQuery" ? officialService([], { onRead: () => { touched += 1; } }) : undefined),
  });
  const service = new TurnCostService(ctx, {});
  for (const bad of ["../etc/passwd", "a/b", "", undefined, null, 7]) {
    assert.equal(await service.query({ sessionId: bad, turn: 1 }), null, `sessionId ${JSON.stringify(bad)} must be rejected`);
    assert.equal(await service.query({ sessionId: bad, messageId: "m1" }), null);
    assert.equal(await service.sessionTotals({ sessionId: bad }), null);
  }
  assert.equal(touched, 0, "a rejected id must never reach the service");
});

test("the fold cache is dropped when the plugin unloads", async () => {
  const events = officialLog();
  const disposers = [];
  const { ctx } = makeCtx({ get: (key) => (key === "sessionQuery" ? officialService(events) : undefined), live: [liveSession("s1", events)] });
  ctx.effect = (callback) => {
    disposers.push(callback());
    return () => {};
  };
  const service = new TurnCostService(ctx, {});
  const first = await service.sessionTotals({ sessionId: "s1" });
  assert.equal(service.cache.size, 1, "a fold must be cached");
  const cachedFold = service.cache.get("s1");
  for (const dispose of disposers) dispose();
  assert.equal(service.cache.size, 0, "the unload effect must drop the fold cache");
  const after = await service.sessionTotals({ sessionId: "s1" });
  assert.notEqual(service.cache.get("s1"), cachedFold, "the fold must be recomputed after the cache is dropped");
  assert.equal(after.cost, first.cost, "and it must compute the same figure");
});
