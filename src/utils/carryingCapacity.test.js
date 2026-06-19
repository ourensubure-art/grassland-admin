import assert from "node:assert/strict";
import { ndviToAGB, evaluateOverstocking } from "./carryingCapacity.js";

assert.equal(Math.round(ndviToAGB(0.3)), 452);
assert.equal(ndviToAGB(0.05), 0);
assert.equal(evaluateOverstocking(1.5, 1.0).status, "warning");
assert.equal(evaluateOverstocking(2.5, 1.0).status, "critical");

console.log("carryingCapacity tests passed");
