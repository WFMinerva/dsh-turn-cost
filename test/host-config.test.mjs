import test from "node:test";
import assert from "node:assert/strict";
import { TurnCostService } from "../lib/index.js";

test("real host entry imports and Schemastery Config validates values", () => {
  assert.equal(typeof TurnCostService, "function");
  assert.equal(typeof TurnCostService.Config, "function");
  assert.deepEqual(TurnCostService.Config({}), {});
  assert.deepEqual(TurnCostService.Config({ ratesPath: "rates.json" }), { ratesPath: "rates.json" });
  assert.throws(
    () => TurnCostService.Config({ ratesPath: 1 }),
    /expected string/,
    "wrong Config value types must be rejected by the real Schemastery schema",
  );
});
