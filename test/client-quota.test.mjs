import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../lib/client.js", import.meta.url), "utf8");

function loadAssistantBadge() {
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
  };
  const jsxRuntime = {
    jsx(type, props) {
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
  const badge = registrations.find(({ descriptor }) => descriptor.id === "turn-cost")?.component;
  assert.equal(typeof badge, "function", "the client must register its actual assistant badge component");
  return { badge, react };
}

function renderBadge(result, quota) {
  const { badge, react } = loadAssistantBadge();
  react.states = [result, quota];
  return badge({
    messageId: "redacted-message",
    sessionId: "redacted-session",
    useSession: () => 1,
    t: (key, values) => `${key} ${JSON.stringify(values)}`,
    queryCost: async () => null,
    queryQuota: async () => quota,
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

test("real client badge selects Kimi 5h data for kimi-coding", () => {
  const view = renderBadge(
    { ...baseResult, provider: "kimi-coding" },
    { routes: { "kimi-coding": { ok: true, windows: [{ name: "5h", limit: 100, used: 20, remaining: 80 }] } } },
  );
  assert.match(view.props.title, /^badge\.quotaTitle/);
  assert.match(view.props.children, /^badge\.quota /);
  assert.match(view.props.children, /"used":"20%"/);
  assert.match(view.props.children, /"remaining":"80%"/);
});

for (const provider of ["qwen-token-plan-cn", "qwen-token-plan"]) {
  test(`real client badge selects Qwen remaining data for ${provider}`, () => {
    const view = renderBadge(
      { ...baseResult, provider },
      { routes: { "qwen-token-plan-cn": { ok: true, remainingPercent: 0.625 } } },
    );
    assert.match(view.props.title, /^badge\.qwenTitle/);
    assert.match(view.props.children, /^badge\.qwen /);
    assert.match(view.props.children, /"remaining":"63%"/);
  });
}
