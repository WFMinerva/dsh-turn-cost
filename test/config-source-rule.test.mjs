import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const forbiddenMethods = /\.(optional|nullable|parse|safeParse)\s*\(/g;

function matchingParen(source, open) {
  let depth = 0;
  let quote = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let i = open; i < source.length; i += 1) {
    const ch = source[i];
    const next = source[i + 1];
    if (lineComment) {
      if (ch === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (ch === "*" && next === "/") {
        blockComment = false;
        i += 1;
      }
      continue;
    }
    if (quote !== null) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === quote) quote = null;
      continue;
    }
    if ((ch === "'" || ch === '"' || ch === "`") && !lineComment && !blockComment) {
      quote = ch;
      continue;
    }
    if (ch === "/" && next === "/") {
      lineComment = true;
      i += 1;
      continue;
    }
    if (ch === "/" && next === "*") {
      blockComment = true;
      i += 1;
      continue;
    }
    if (ch === "(") depth += 1;
    else if (ch === ")") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  throw new Error("Config schema call has unbalanced parentheses");
}

function configRegion(source) {
  if (!source.includes("@deepseek-ai/schemastery")) return null;
  const matches = [...source.matchAll(/\bstatic\s+Config\s*=\s*z\.object\s*\(/g)];
  if (matches.length !== 1) {
    throw new Error(`Schemastery source must contain exactly one static Config = z.object(...) declaration; found ${matches.length}`);
  }
  const match = matches[0];
  const open = source.indexOf("(", match.index);
  let end = matchingParen(source, open) + 1;
  // Include object-level chains such as `z.object({...}).optional()`; the
  // closing parenthesis of z.object alone is not the end of the assignment.
  for (;;) {
    const chain = /^\s*\.\s*[A-Za-z_$][\w$]*\s*\(/.exec(source.slice(end));
    if (chain === null) break;
    const chainOpen = end + chain[0].lastIndexOf("(");
    end = matchingParen(source, chainOpen) + 1;
  }
  return source.slice(match.index, end);
}

function findForbiddenConfigApis(source) {
  const region = configRegion(source);
  if (region === null) return [];
  return [...region.matchAll(forbiddenMethods)].map((match) => match[1]);
}

function assertConfigSourceSafe(source, label) {
  const violations = findForbiddenConfigApis(source);
  if (violations.length > 0) {
    throw new Error(`${label}: forbidden Schemastery Config API(s): ${violations.join(", ")}`);
  }
}

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("production host Config passes without flagging Date.parse outside Config", () => {
  assertConfigSourceSafe(read("../lib/index.js"), "lib/index.js");
});

test("positive fixture permits valid Config and unrelated Date.parse", () => {
  assert.deepEqual(findForbiddenConfigApis(read("./fixtures/config-api-good.txt")), []);
});

test("Schemastery source without an unambiguous Config declaration fails closed", () => {
  assert.throws(
    () => findForbiddenConfigApis(read("./fixtures/config-api-unlocated.txt")),
    /exactly one static Config/,
  );
});

test("negative fixture rejects each forbidden zod-style chain inside Config", () => {
  const source = read("./fixtures/config-api-bad.txt");
  assert.deepEqual(findForbiddenConfigApis(source), ["optional", "nullable", "parse", "safeParse"]);
  assert.throws(
    () => assertConfigSourceSafe(source, "config-api-bad.txt"),
    /optional, nullable, parse, safeParse/,
  );
});

test("negative fixture rejects a forbidden chain after the object schema call", () => {
  const source = read("./fixtures/config-api-chained-bad.txt");
  assert.deepEqual(findForbiddenConfigApis(source), ["optional"]);
  assert.throws(
    () => assertConfigSourceSafe(source, "config-api-chained-bad.txt"),
    /optional/,
  );
});
