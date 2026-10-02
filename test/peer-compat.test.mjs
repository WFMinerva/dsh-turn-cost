import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import semver from "semver";
import {
  evaluateManifest,
  satisfies,
  dshPeers,
  HOST_PACKAGES,
  REVIEWED_RUNTIME,
  SATISFIES_OPTIONS,
} from "../tools/peer-compat.mjs";

const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const asMap = (...versions) => new Map(versions.map((v) => [v, "test"]));

test("range math is delegated to the standard semver package with dsh's options", () => {
  assert.deepEqual(SATISFIES_OPTIONS, { includePrerelease: true });
  const table = [
    ["0.2.0-rc.2", "*"],
    ["0.1.1-rc.2", "*"],
    ["0.3.0-rc.1", "*"],
    ["4.0.4", "*"],
    ["4.0.1", "^4.0.1"],
    ["4.0.4", "^4.0.1"],
    ["4.1.0", "^4.0.1"],
    ["5.0.0", "^4.0.1"],
    ["0.2.0-rc.2", "^0.1.0-rc.6"],
  ];
  for (const [version, range] of table) {
    assert.equal(
      satisfies(version, range).ok,
      semver.satisfies(version, range, SATISFIES_OPTIONS),
      `${version} vs ${range} must agree with semver`,
    );
  }
  assert.equal(satisfies("0.2.0-rc.2", "not a range").ok, false, "an unparseable range must not pass open");
  assert.equal(satisfies("nonsense", "*").ok, false, "an unparseable version must not pass open");
});

test("the wildcard peer model cannot be rejected by dsh's compatibility gate", () => {
  // This is the whole point of `"*"`: whatever the host is, every dsh peer
  // satisfies it, so no `allow-version` exemption is ever needed.
  for (const version of ["0.1.0-rc.6", "0.1.1-rc.2", "0.2.0-rc.2", "0.3.0-rc.1", "0.3.0", "1.0.0"]) {
    assert.deepEqual(evaluateManifest(manifest, asMap(version)).problems, [], `dsh ${version} must accept the wildcard peers`);
  }
});

test("a pinned peer range is caught before it can block the host", () => {
  // Regression guard for the 0.5.2 outage: `^0.1.0-rc.6` was rejected outright
  // by dsh 0.2.0-rc.2, leaving the plugin installed but never loaded.
  const pinned = {
    peerDependencies: { "@deepseek-ai/dsh-home-paths": "^0.1.0-rc.6" },
    devDependencies: { "@deepseek-ai/dsh-home-paths": "0.2.0-rc.2" },
  };
  const { problems } = evaluateManifest(pinned, asMap("0.2.0-rc.2"));
  assert.ok(problems.some((p) => p.includes("compatibility gate")), `a pinned peer must be reported, got: ${problems.join(" | ")}`);
  assert.ok(problems.some((p) => p.includes("rejects")), "and the rejecting runtime must be named");
});

test("a floating or drifting dev pin is reported", () => {
  const floating = {
    peerDependencies: Object.fromEntries(Object.keys(HOST_PACKAGES).map((n) => [n, "*"])),
    devDependencies: Object.fromEntries(Object.entries(HOST_PACKAGES).map(([n, s]) => [n, floatingSpec(s)])),
  };
  function floatingSpec(spec) { return `^${spec.reviewed}`; }
  assert.ok(evaluateManifest(floating, new Map()).problems.some((p) => p.includes("exact version")), "a range dev pin must be reported");

  const drifted = {
    peerDependencies: Object.fromEntries(Object.keys(HOST_PACKAGES).map((n) => [n, "*"])),
    devDependencies: Object.fromEntries(Object.entries(HOST_PACKAGES).map(([n, s]) => [n, s.reviewed === "4.0.4" ? "4.0.1" : s.reviewed])),
  };
  assert.ok(evaluateManifest(drifted, new Map()).problems.some((p) => p.includes("re-review")), "a dev pin off the reviewed version must be reported");

  const missing = { peerDependencies: {}, devDependencies: {} };
  assert.ok(evaluateManifest(missing, new Map()).problems.length >= Object.keys(HOST_PACKAGES).length, "every host package must be checked");
});

test("the shipped manifest keeps the reviewed host graph and the wildcard peers", () => {
  assert.equal(REVIEWED_RUNTIME, "0.2.0-rc.2");
  assert.deepEqual(evaluateManifest(manifest, asMap(REVIEWED_RUNTIME)).problems, []);
  for (const [name, spec] of Object.entries(HOST_PACKAGES)) {
    assert.equal(manifest.peerDependencies[name], spec.peer, `${name} peer must stay wildcard`);
    assert.equal(manifest.devDependencies[name], spec.reviewed, `${name} dev pin must stay reviewed`);
  }
  // The moving packages dsh itself supplies must never become runtime deps.
  for (const name of Object.keys(HOST_PACKAGES)) {
    assert.equal(Object.hasOwn(manifest.dependencies ?? {}, name), false, `${name} must not be a runtime dependency`);
  }
  assert.ok(dshPeers(manifest).length > 0, "the plugin must declare dsh peers");
});

test("a runtime with no discoverable version is simply not checked, not assumed compatible", () => {
  // The installer pin is gone, so on a machine with no local profile there is
  // nothing to check against; the model check still runs and still passes.
  assert.deepEqual(evaluateManifest(manifest, new Map()).problems, []);
});
