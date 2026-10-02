import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const has = (section, name) => Object.hasOwn(manifest[section] ?? {}, name);

test("package manifest keeps runtime and host-provided DSH dependencies in separate lanes", () => {
  const schemastery = "@deepseek-ai/schemastery";
  assert.equal(typeof manifest.dependencies?.[schemastery], "string", "Schemastery must be a runtime dependency");
  for (const section of ["peerDependencies", "devDependencies", "optionalDependencies"]) {
    assert.equal(has(section, schemastery), false, `Schemastery must not be duplicated in ${section}`);
  }

  // Host-supplied packages are declared twice on purpose, with different jobs:
  // `peerDependencies` carries the wildcard that keeps dsh's compatibility gate
  // from ever rejecting this plugin, and `devDependencies` pins the exact
  // version the implementation was reviewed against. `tools/peer-compat.mjs`
  // owns the full check; this asserts the lanes themselves do not collapse.
  const hostPeers = [
    "@deepseek-ai/cordis",
    "@deepseek-ai/dsh-home-paths",
    "@deepseek-ai/dsh-typert-protocol",
  ];
  for (const name of hostPeers) {
    assert.equal(manifest.peerDependencies?.[name], "*", `${name} must declare the wildcard host peer`);
    assert.match(
      String(manifest.devDependencies?.[name]),
      /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/,
      `${name} devDependency must pin one exact reviewed version`,
    );
    assert.equal(has("dependencies", name), false, `${name} must not become a runtime dependency`);
    assert.equal(has("optionalDependencies", name), false, `${name} must not become optional`);
  }
});

test("package manifest declares an officially addable dsh bundle", () => {
  // The official "add plugin" route reads exactly these declarations.
  assert.equal(manifest.dsh?.bundle?.patch, "./cordis.patch.yml", "a bundle patch is what activates the plugin layer");
  assert.equal(manifest.dsh?.client?.platform, "web");
  assert.ok(Array.isArray(manifest.dsh?.client?.inject), "dsh.client.inject must be an array of package-name edges");
  assert.equal(manifest.exports?.["./client"]?.default, "./lib/client.js", "dsh.client requires a ./client export");
  assert.equal(manifest.main, "lib/index.js", "the host half is loaded by package name");
  assert.equal(manifest.type, "module", "the loader imports the host half as ESM");
  assert.equal(manifest.types, "lib/index.d.ts", "the hand-maintained declarations are published");
});

test("the published file list carries every entry the loader needs", () => {
  const files = manifest.files ?? [];
  for (const required of ["lib", "cordis.patch.yml", "rates.example.json"]) {
    assert.ok(files.includes(required), `${required} must be published`);
  }
  // A plain-JS host half and a prebuilt client half need no build step, so the
  // shipped bytes must already be the loadable ones.
  const built = ["lib/index.js", "lib/client.js", "lib/fold.js", "lib/quota.js", "lib/index.d.ts"];
  for (const rel of built) {
    assert.doesNotThrow(
      () => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8"),
      `${rel} must exist in the checkout (the official route serves built bytes, not sources)`,
    );
  }
});
