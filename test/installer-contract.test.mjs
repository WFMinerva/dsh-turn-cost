import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const json = async (path) => JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));

test("installer private CLI manifest and lock follow versions.json (single source, no hardcoded duplicates)", async () => {
  const versions = await json("../versions.json");
  const manifest = await json("../installer/tools-package.json");
  const lock = await json("../installer/tools-package-lock.json");
  assert.deepEqual(manifest.dependencies, versions.tools);
  assert.deepEqual(lock.packages[""].dependencies, versions.tools);
  for (const [name, ver] of Object.entries(versions.tools)) {
    assert.equal(lock.packages["node_modules/" + name].version, ver);
  }
});

test("installer pins the DSH launcher per versions.json and keeps the pnpm build allowlist", async () => {
  const versions = await json("../versions.json");
  const dsh = await json("../installer/dsh-package.json");
  const lock = await readFile(new URL("../installer/dsh-package-lock.yaml", import.meta.url), "utf8");
  const workspace = await readFile(new URL("../installer/dsh-pnpm-workspace.yaml", import.meta.url), "utf8");
  assert.equal(dsh.dependencies[versions.dsh.package], versions.dsh.version);
  assert.match(lock, new RegExp("specifier: " + versions.dsh.version.replace(/\./g, "\\.")));
  for (const name of ["@deepseek-ai/dsh-subprocess-local", "@google/genai", "koffi", "node-pty", "protobufjs"]) {
    assert.match(workspace, new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("installer never reads the DSH credential store and launcher owns the Kimi loopback lifecycle", async () => {
  const install = await readFile(new URL("../installer/Install.ps1", import.meta.url), "utf8");
  const launch = await readFile(new URL("../installer/Launch.ps1", import.meta.url), "utf8");
  assert.doesNotMatch(install, /\.credentials\.yaml/i);
  assert.doesNotMatch(`${install}\n${launch}`, /dangerous-bypass-auth/i);
  assert.doesNotMatch(install, /@deepseek-ai\/dsh['"@, ]+--version/);
  assert.match(install, /Kind = 'isolated-pnpm'/);
  assert.match(install, /install', '--frozen-lockfile/);
  assert.match(launch, /server\.token/);
  assert.match(launch, /kimi\.cmd/);
  assert.match(launch, /127\.0\.0\.1:58627/);
  assert.match(launch, /Authorization\s*=\s*"Bearer \$Token"/);
  assert.match(launch, /\/api\/v1\/meta/);
  assert.match(launch, /\/api\/v1\/shutdown/);
  assert.match(launch, /ContentType 'application\/json' -Body '\{\}'/);
  assert.match(launch, /KIMI_CODE_HOME/);
  assert.match(launch, /@\(\$state\.dsh\.prefix\) \+ @\('web'\)/);
});

test("credential helper delegates to official interactive OAuth commands without embedding secrets", async () => {
  const helper = await readFile(new URL("../installer/配置额度登录.ps1", import.meta.url), "utf8");
  const install = await readFile(new URL("../installer/Install.ps1", import.meta.url), "utf8");
  assert.match(helper, /& \$kimi login/);
  assert.match(helper, /& \$bl auth login --console --console-site domestic/);
  assert.match(helper, /& \$bl usage token-plan --output json/);
  assert.doesNotMatch(helper, /--api-key|--access-key-id|--access-key-secret/);
  assert.match(helper, /KIMI_CODE_HOME/);
  assert.match(helper, /IsNullOrWhiteSpace\(\$token\)/);
  assert.match(helper, /AUTH_PENDING/);
  assert.match(install, /'配置额度登录\.ps1'/);
  assert.match(install, /'配置额度登录\.cmd'/);
});

test("Windows entry scripts stay process-scoped and do not create persistence", async () => {
  const install = await readFile(new URL("../installer/Install.ps1", import.meta.url), "utf8");
  const launch = await readFile(new URL("../installer/Launch.ps1", import.meta.url), "utf8");
  const combined = `${install}\n${launch}`;
  assert.doesNotMatch(combined, /Register-ScheduledTask|schtasks|New-Service|Set-ExecutionPolicy/i);
  assert.doesNotMatch(combined, /New-NetFirewallRule|netsh\s+advfirewall/i);
  assert.match(launch, /127\.0\.0\.1:58627/);
});

test("versions.json is the single deployment pin source and every derived file agrees", async () => {
  const versions = await json("../versions.json");
  const dshPkg = await json("../installer/dsh-package.json");
  const toolsPkg = await json("../installer/tools-package.json");
  const toolsLock = await json("../installer/tools-package-lock.json");
  const pkg = await json("../package.json");
  const lock = await json("../package-lock.json");
  const dshLock = await readFile(new URL("../installer/dsh-package-lock.yaml", import.meta.url), "utf8");
  const build = await readFile(new URL("../scripts/build-windows-installer.ps1", import.meta.url), "utf8");
  assert.match(String(dshPkg._generated), /versions\.json/);
  assert.match(String(toolsPkg._generated), /versions\.json/);
  assert.equal(dshPkg.dependencies[versions.dsh.package], versions.dsh.version);
  assert.deepEqual(toolsPkg.dependencies, versions.tools);
  assert.deepEqual(toolsLock.packages[""].dependencies, versions.tools);
  assert.match(dshLock, new RegExp(`specifier: ${versions.dsh.version.replace(/\./g, "\\.")}`));
  assert.equal(pkg.version, lock.version);
  assert.match(build, /versions\.json/);
  assert.match(build, /pluginHash\.Substring\(0, 12\)/);
  assert.match(build, /contentTgzName/);
  assert.doesNotMatch(build, /'deepseek-official'/);
});

test("port check injection point is fixture-only and single-referenced", async () => {
  const install = await readFile(new URL("../installer/Install.ps1", import.meta.url), "utf8");
  assert.equal((install.match(/DTC_PORT_CHECK_OVERRIDE/g) || []).length, 1);
  const fixture = await readFile(new URL("./windows-installer.test.ps1", import.meta.url), "utf8");
  assert.match(fixture, /Remove-Item Env:DTC_PORT_CHECK_OVERRIDE/);
  assert.match(fixture, /\$env:DTC_PORT_CHECK_OVERRIDE = /);
});

test("adapter layer does not redefine generic-layer reserved functions (no core logic copy)", async () => {
  const adapter = await readFile(new URL("../maintenance/adapter.ps1", import.meta.url), "utf8");
  const reserved = [
    "Get-FileSha256", "Get-RelativeFiles", "New-DirManifest", "Test-DirManifest",
    "New-DeterministicZip", "Assert-ChildPath", "Invoke-Redact", "Get-RedactionFragments",
    "Test-RedactionMatchesPython", "Test-PortOpen", "Get-ToolFact", "Get-MachineFingerprint",
    "Get-MachineBlock", "Get-EnvironmentFacts", "Resolve-DshHome", "New-MaintenanceReport",
    "Add-ReportCheck", "Add-ReportSkip", "Add-ReportArtifact", "Set-ReportCleanup",
    "Write-Report", "ConvertTo-RedactedObject", "Publish-VendorCore",
  ];
  for (const name of reserved) {
    // PowerShell 函数名不区分大小写；允许 function:/script:/global: 等作用域前缀
    assert.doesNotMatch(adapter, new RegExp("function\\s+(?:[A-Za-z]+:)?" + name + "\\b", "i"),
      "adapter redefines generic function " + name);
  }
});

test("acceptance recognizes the official Bailian weekly percentage shape", async () => {
  const adapter = await readFile(new URL("../maintenance/adapter.ps1", import.meta.url), "utf8");
  assert.match(adapter, /per1WeekPercentage/);
  assert.match(adapter, /1\.0 - \$used/);
});
