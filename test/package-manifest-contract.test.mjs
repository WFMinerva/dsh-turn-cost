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

  const hostPeers = [
    "@deepseek-ai/cordis",
    "@deepseek-ai/dsh-home-paths",
    "@deepseek-ai/dsh-typert-protocol",
  ];
  for (const name of hostPeers) {
    const peerRange = manifest.peerDependencies?.[name];
    assert.equal(typeof peerRange, "string", `${name} must remain a peerDependency`);
    assert.equal(manifest.devDependencies?.[name], peerRange, `${name} devDependency must mirror peer range exactly`);
    assert.equal(has("dependencies", name), false, `${name} must not become a runtime dependency`);
    assert.equal(has("optionalDependencies", name), false, `${name} must not become optional`);
  }
});
