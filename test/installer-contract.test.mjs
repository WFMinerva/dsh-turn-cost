import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const json = async (path) => JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));

test("installer private CLI manifest and lock pin the approved official packages", async () => {
  const manifest = await json("../installer/tools-package.json");
  const lock = await json("../installer/tools-package-lock.json");
  assert.deepEqual(manifest.dependencies, {
    "@moonshot-ai/kimi-code": "0.38.0",
    "bailian-cli": "1.17.0",
  });
  assert.deepEqual(lock.packages[""].dependencies, manifest.dependencies);
  assert.equal(lock.packages["node_modules/@moonshot-ai/kimi-code"].version, "0.38.0");
  assert.equal(lock.packages["node_modules/bailian-cli"].version, "1.17.0");
});

test("installer pins the DSH launcher and its full pnpm graph", async () => {
  const dsh = await json("../installer/dsh-package.json");
  const lock = await readFile(new URL("../installer/dsh-package-lock.yaml", import.meta.url), "utf8");
  const workspace = await readFile(new URL("../installer/dsh-pnpm-workspace.yaml", import.meta.url), "utf8");
  assert.equal(dsh.dependencies["@deepseek-ai/dsh"], "0.1.1-rc.2");
  assert.match(lock, /specifier: 0\.1\.1-rc\.2/);
  for (const name of ["@deepseek-ai/dsh-subprocess-local", "@google/genai", "koffi", "node-pty", "protobufjs"]) {
    assert.match(workspace, new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("installer never reads the DSH credential store or bypasses Kimi server auth", async () => {
  const install = await readFile(new URL("../installer/Install.ps1", import.meta.url), "utf8");
  const launch = await readFile(new URL("../installer/Launch.ps1", import.meta.url), "utf8");
  assert.doesNotMatch(install, /\.credentials\.yaml/i);
  assert.doesNotMatch(`${install}\n${launch}`, /dangerous-bypass-auth/i);
  assert.doesNotMatch(install, /@deepseek-ai\/dsh['"@, ]+--version/);
  assert.match(install, /Kind = 'isolated-pnpm'/);
  assert.match(install, /install', '--frozen-lockfile/);
  assert.match(launch, /Authorization\s*=\s*"Bearer \$Token"/);
  assert.match(launch, /\/api\/v1\/shutdown/);
  assert.match(launch, /ContentType 'application\/json' -Body '\{\}'/);
});

test("Windows entry scripts stay process-scoped and do not create persistence", async () => {
  const install = await readFile(new URL("../installer/Install.ps1", import.meta.url), "utf8");
  const launch = await readFile(new URL("../installer/Launch.ps1", import.meta.url), "utf8");
  const combined = `${install}\n${launch}`;
  assert.doesNotMatch(combined, /Register-ScheduledTask|schtasks|New-Service|Set-ExecutionPolicy/i);
  assert.doesNotMatch(combined, /New-NetFirewallRule|netsh\s+advfirewall/i);
  assert.match(launch, /127\.0\.0\.1:58627/);
});
