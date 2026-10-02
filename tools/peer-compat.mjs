#!/usr/bin/env node
/**
 * tools/peer-compat.mjs — host-compatibility drift guard for dsh-turn-cost.
 *
 * ## Why this exists
 *
 * dsh ≥ 0.2.0 judges a plugin by its `@deepseek-ai/dsh*` `peerDependencies` and
 * **refuses to load the whole profile bundle** when one does not satisfy the
 * running runtime, demanding an exact-version exemption. A plugin that pins a
 * superseded line therefore installs but never starts — which is exactly what
 * happened to this project at 0.5.2 (`^0.1.0-rc.6` rejected by dsh 0.2.0-rc.2).
 *
 * ## The model this project now uses
 *
 * The officially-installable reference plugin in this workspace (`dsh-notion`)
 * declares its host packages as `"*"` in `peerDependencies` and pins the exact
 * runtime version in `devDependencies`. That is the shape recommended for
 * harness packages: `"*"` always satisfies dsh's gate, so nothing about plugin
 * loading depends on a version the author guessed, while the pinned dev
 * dependency is what the author actually built and tested against.
 *
 * So this guard does NOT invent a supported version window. It checks that the
 * project keeps the wildcard-peer + pinned-dev-dependency discipline, and — when
 * a runtime version is known — that it is one the pinned graph was reviewed
 * against. Range math is delegated to the standard `semver` package with the
 * **same options dsh uses** (`{ includePrerelease: true }`); nothing here
 * reimplements semver.
 *
 * Usage:  node tools/peer-compat.mjs [--json] [--runtime <version>]...
 *         `--runtime` adds the version the *running* host reports
 *         (`dsh --version`), which cannot be discovered from disk for the
 *         desktop app because its runtime lives inside `app.asar`.
 * Exit:   0 the declared model is intact; 1 it drifted, or a supplied runtime
 *         version is not the reviewed one.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import semver from "semver";

const REPO = resolve(import.meta.dirname, "..");

/** dsh evaluates plugin peer ranges with this exact option set. */
export const SATISFIES_OPTIONS = { includePrerelease: true };

/**
 * The `@deepseek-ai` packages this plugin needs from the host at runtime, and
 * the spec each must declare in `peerDependencies` / `devDependencies`.
 *
 * `"*"` is the peer spec: it is what keeps dsh's compatibility gate from ever
 * being the reason the plugin will not load. The dev dependency is the exact
 * version the implementation was reviewed against; bump it deliberately, after
 * re-reading that release's API surface.
 */
export const HOST_PACKAGES = {
  "@deepseek-ai/cordis": { peer: "*", reviewed: "4.0.4" },
  "@deepseek-ai/dsh-home-paths": { peer: "*", reviewed: "0.2.0-rc.2" },
  "@deepseek-ai/dsh-typert-protocol": { peer: "*", reviewed: "0.2.0-rc.2" },
};

/** The exact runtime version this plugin's host graph was reviewed against. */
export const REVIEWED_RUNTIME = "0.2.0-rc.2";

/** Version of the `semver` package doing the range math (reported, never guessed). */
const SEMVER_VERSION = (() => {
  try {
    const scope = dirname(fileURLToPath(import.meta.resolve("semver/package.json")));
    return JSON.parse(readFileSync(join(scope, "package.json"), "utf8")).version;
  } catch {
    return "unknown";
  }
})();

/** True when dsh's evaluator would accept `range` on `runtimeVersion`. */
export function satisfies(runtimeVersion, range) {
  const version = semver.valid(runtimeVersion);
  if (version === null) return { ok: false, reason: `runtime version not a semantic version: ${JSON.stringify(runtimeVersion)}` };
  if (typeof range !== "string" || semver.validRange(range, SATISFIES_OPTIONS) === null) {
    return { ok: false, reason: `peer range not a valid range: ${JSON.stringify(range)}` };
  }
  return semver.satisfies(version, range, SATISFIES_OPTIONS)
    ? { ok: true }
    : { ok: false, reason: `outside ${range}` };
}

/** Every `@deepseek-ai/dsh`/`@deepseek-ai/dsh-*` peer dsh actually judges. */
export function dshPeers(manifest) {
  return Object.entries(manifest.peerDependencies ?? {})
    .filter(([name]) => name === "@deepseek-ai/dsh" || name.startsWith("@deepseek-ai/dsh-"));
}

/**
 * Check one manifest against the declared model.
 *
 * @param manifest - the parsed `package.json`.
 * @param runtimes - `runtimeVersion -> source` for every runtime we know about.
 * @returns the peer findings plus a `problems` list (empty means intact).
 */
export function evaluateManifest(manifest, runtimes = new Map()) {
  const problems = [];
  const peers = manifest.peerDependencies ?? {};
  const dev = manifest.devDependencies ?? {};

  for (const [name, spec] of Object.entries(HOST_PACKAGES)) {
    if (peers[name] !== spec.peer) {
      problems.push(`peerDependencies[${name}] must be ${JSON.stringify(spec.peer)} so dsh's compatibility gate can never reject this plugin (found ${JSON.stringify(peers[name])})`);
    }
    const pinned = dev[name];
    if (typeof pinned !== "string") {
      problems.push(`devDependencies[${name}] must pin the reviewed version ${spec.reviewed} (found ${JSON.stringify(pinned)})`);
    } else if (semver.valid(pinned) === null) {
      problems.push(`devDependencies[${name}] must be an exact version, not a range (found ${JSON.stringify(pinned)})`);
    } else if (pinned !== spec.reviewed) {
      problems.push(`devDependencies[${name}] is ${pinned} but REVIEWED says ${spec.reviewed}; re-review the host API surface before changing this`);
    }
  }

  for (const [version, source] of runtimes) {
    if (semver.valid(version) === null) {
      problems.push(`runtime version from ${source} is not a semantic version: ${JSON.stringify(version)}`);
      continue;
    }
    for (const [name, range] of dshPeers(manifest)) {
      const result = satisfies(version, range);
      if (!result.ok) problems.push(`dsh ${version} (${source}) rejects ${name}@${range}: ${result.reason}`);
    }
  }
  return { peers, problems };
}

/** Runtime versions discoverable from local profiles (the installer pin is gone). */
function discoverRuntimes() {
  const candidates = new Map();
  const add = (version, source) => {
    const text = typeof version === "string" ? version.trim() : "";
    if (semver.valid(text) === null) return;
    if (!candidates.has(text)) candidates.set(text, source);
  };
  const dshHome = process.env.DSH_HOME?.trim().length > 0 ? process.env.DSH_HOME.trim() : join(homedir(), ".dsh");
  const profilesDir = join(dshHome, "profiles");
  if (!existsSync(profilesDir)) return candidates;
  for (const profile of readdirSync(profilesDir, { withFileTypes: true })) {
    if (!profile.isDirectory()) continue;
    for (const rel of [
      join("node_modules", "@deepseek-ai", "dsh", "package.json"),
      join("node_modules", "@deepseek-ai", "dsh-desktop-runtime", "package.json"),
    ]) {
      const manifestPath = join(profilesDir, profile.name, rel);
      if (!existsSync(manifestPath)) continue;
      try {
        add(JSON.parse(readFileSync(manifestPath, "utf8")).version, `profile ${profile.name}`);
      } catch { /* unreadable manifest — skip this candidate */ }
    }
  }
  return candidates;
}

/** `--runtime <version>` candidates, in order. */
function explicitRuntimes(argv) {
  const found = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] !== "--runtime") continue;
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) throw new Error("--runtime needs a version argument, e.g. --runtime 0.2.0-rc.2");
    found.push([value.trim(), "explicit --runtime"]);
    i++;
  }
  return found;
}

const isMain = process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(import.meta.filename);

if (isMain) {
  const asJson = process.argv.includes("--json");
  const manifest = JSON.parse(readFileSync(join(REPO, "package.json"), "utf8"));
  const runtimes = discoverRuntimes();
  let invalid = null;
  try {
    for (const [version, source] of explicitRuntimes(process.argv)) {
      if (semver.valid(version) === null) { invalid = version; break; }
      if (!runtimes.has(version)) runtimes.set(version, source);
    }
  } catch (error) {
    process.stdout.write(`RUNTIME_ARGUMENT_INVALID: ${error.message}\n`);
    process.exit(1);
  }
  if (invalid !== null) {
    process.stdout.write(`RUNTIME_VERSION_INVALID: ${invalid}\n`);
    process.exit(1);
  }

  const { problems } = evaluateManifest(manifest, runtimes);

  if (asJson) {
    process.stdout.write(`${JSON.stringify({
      plugin: `${manifest.name}@${manifest.version}`,
      hostPackages: Object.entries(HOST_PACKAGES).map(([name, spec]) => `${name}: peer ${spec.peer}, dev ${spec.reviewed}`),
      reviewedRuntime: REVIEWED_RUNTIME,
      runtimes: [...runtimes.entries()].map(([version, source]) => `${version} (${source})`),
      semver: SEMVER_VERSION,
      problems,
    }, null, 2)}\n`);
  } else if (problems.length > 0) {
    process.stdout.write(`PEER_MODEL_DRIFT: ${problems.join("; ")}\n`);
  } else {
    const known = [...runtimes.keys()];
    process.stdout.write(`wildcard peers intact; reviewed against dsh ${REVIEWED_RUNTIME}${known.length > 0 ? `; local runtimes: ${known.join(", ")}` : "; no local runtime discovered (pass --runtime <version> to check one)"}\n`);
  }
  process.exit(problems.length > 0 ? 1 : 0);
}
