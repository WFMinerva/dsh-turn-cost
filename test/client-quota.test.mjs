import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../lib/client.js", import.meta.url), "utf8");

function loadClient() {
  let factory;
  const context = {
    window: {
      __ModuleLoader__: {
        load(definition) {
          factory = definition.factory;
        },
      },
    },
  };
  vm.runInNewContext(source, context, { filename: "lib/client.js" });
  assert.equal(typeof factory, "function", "the real client bundle must register a factory");

  const registrations = [];
  const react = {
    states: [],
    useState() {
      return [this.states.shift(), () => {}];
    },
    useEffect() {},
    useRef() {
      return { current: undefined };
    },
  };
  const jsxRuntime = {
    jsx(type, props) {
      return { type, props };
    },
    jsxs(type, props) {
      return { type, props };
    },
  };
  const exports = factory((name) => {
    if (name === "react") return react;
    if (name === "react/jsx-runtime") return jsxRuntime;
    throw new Error(`unexpected client dependency: ${name}`);
  });
  const ctx = {
    effect() {},
    locale: { register() {} },
    connection: { rpc: { call: async () => ({ ok: false }) } },
    slots: {
      inject(_name, callback) {
        callback();
      },
      register(descriptor, component) {
        registrations.push({ descriptor, component });
        return () => {};
      },
    },
  };
  exports.apply(ctx);
  const component = (id) => {
    const found = registrations.find(({ descriptor }) => descriptor.id === id)?.component;
    assert.equal(typeof found, "function", `the client must register its actual ${id} component`);
    return found;
  };
  return { react, badge: component("turn-cost"), dock: component("turn-cost-dock") };
}

const t = (key, values) => `${key} ${JSON.stringify(values)}`;

/**
 * Render the real assistant badge. `states` are the two `useState` values the
 * component holds: the RPC outcome (`{ ok, value }` / `{ ok: false, code }`)
 * and the quota snapshot.
 */
function renderBadge(outcome, quota) {
  const { badge, react } = loadClient();
  react.states = [outcome, quota];
  return badge({
    messageId: "redacted-message",
    sessionId: "redacted-session",
    t,
    queryCost: async () => outcome,
    queryQuota: async () => ({ ok: true, value: quota }),
  });
}

/** Render the real composer-dock line. `projection` stands in for `tokenUsage`. */
function renderDock(outcome, { projection, quota } = {}) {
  const { dock, react } = loadClient();
  react.states = [outcome, quota ?? null];
  return dock({
    sessionId: "redacted-session",
    useProjection: () => projection,
    t,
    querySessionTotals: async () => outcome,
    queryQuota: async () => ({ ok: true, value: quota ?? null }),
  });
}

const baseResult = {
  inputTokens: 100,
  cacheReadTokens: 20,
  outputTokens: 30,
  cacheHitRate: 0.5,
  requests: 2,
  cost: 0,
};

test("real client badge selects Kimi 7d data for kimi-coding", () => {
  const view = renderBadge(
    { ok: true, value: { ...baseResult, provider: "kimi-coding" } },
    { routes: { "kimi-coding": { ok: true, windows: [{ name: "7d", limit: 100, used: 20, remaining: 80 }] } } },
  );
  assert.match(view.props.title, /^badge\.quotaTitle/);
  assert.match(view.props.children, /^badge\.quotaNoBooster /);
  assert.doesNotMatch(view.props.children, /"used":/);
  assert.match(view.props.children, /"remaining":80/);
});

test("real client badge shows Kimi booster balance when present", () => {
  const view = renderBadge(
    { ok: true, value: { ...baseResult, provider: "kimi-coding" } },
    {
      routes: {
        "kimi-coding": {
          ok: true,
          windows: [{ name: "7d", limit: 100, used: 20, remaining: 80 }],
          booster: { balanceCny: 28.79 },
        },
      },
    },
  );
  assert.match(view.props.title, /^badge\.quotaTitle/);
  assert.match(view.props.children, /^badge\.quota /);
  assert.match(view.props.children, /"remaining":80/);
  assert.match(view.props.children, /"balance":"28\.79"/);
});

for (const provider of ["qwen-token-plan-cn", "qwen-token-plan"]) {
  test(`real client badge selects Qwen remaining data for ${provider}`, () => {
    const view = renderBadge(
      { ok: true, value: { ...baseResult, provider } },
      { routes: { "qwen-token-plan-cn": { ok: true, remainingPercent: 0.625 } } },
    );
    assert.match(view.props.title, /^badge\.qwenTitle/);
    assert.match(view.props.children, /^badge\.qwen /);
    assert.match(view.props.children, /"remaining":"63%"/);
  });
}

test("real client badge renders nothing when the cost query failed", () => {
  // A failed RPC must not be dressed up as a priced row. The console report is
  // the rpc helper's job (asserted separately); here the surface stays quiet.
  const view = renderBadge({ ok: false, code: "gateway/invocation-unavailable", message: "nope" }, null);
  assert.equal(view, null, "a failed cost query must render no badge at all");
});

test("real client badge renders the money line from a successful query", () => {
  const view = renderBadge({ ok: true, value: { ...baseResult, provider: "deepseek-official", cost: 1.25, models: ["deepseek-flash"] } }, null);
  assert.match(view.props.title, /^badge\.title/);
  assert.match(view.props.children, /^badge\.line /);
  assert.match(view.props.children, /"cost":"¥1\.25"/);
});

test("real dock line renders the host figure for a priced session", () => {
  const view = renderDock({
    ok: true,
    value: { cost: 4.97, inputTokens: 578_756, outputTokens: 278_308, cacheReadTokens: 163_934_720, cacheWriteTokens: 0, cacheHitRate: 0.9964820146405514, models: ["deepseek-flash"] },
  });
  assert.match(view.props.children[0].props.title, /^dock\.title/);
  assert.match(view.props.children[0].props.children, /^dock\.line /);
  assert.match(view.props.children[0].props.children, /"cost":"¥4\.97"/);
  assert.match(view.props.children[0].props.children, /"models":"deepseek-flash"/);
  // 99.65% must not be flattened to a flat 100%: the same session's shipped
  // stats bar reads 99.6%, and an approximate share must not claim an extreme.
  assert.match(view.props.children[0].props.children, /"cache":"99\.6%"/);
});

test("real dock line never presents the official token counts as its own figure", () => {
  // The projection is available, so the row can still show tokens — but it must
  // say the cost is missing instead of printing a bare "?" that reads like a
  // successful (zero-cost) query.
  const projection = { uncachedInputTokens: 578_756, outputTokens: 278_308, cacheReadTokens: 163_934_720, cacheWriteTokens: 0 };
  const failed = renderDock({ ok: false, code: "gateway/definition-unavailable", message: "withdrawn" }, { projection });
  assert.match(failed.props.children[0].props.children, /^dock\.failed /);
  assert.match(failed.props.children[0].props.title, /^dock\.failedTitle /);
  assert.match(failed.props.children[0].props.title, /gateway\/definition-unavailable/);
  assert.doesNotMatch(failed.props.children[0].props.children, /^dock\.line /);

  const unpriced = renderDock({ ok: true, value: null }, { projection });
  assert.match(unpriced.props.children[0].props.children, /^dock\.unpriced /);
  assert.match(unpriced.props.children[0].props.title, /^dock\.unpricedTitle/);

  const pending = renderDock(null, { projection });
  assert.match(pending.props.children[0].props.children, /^dock\.pending /);
});
