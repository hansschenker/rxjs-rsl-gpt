import assert from "node:assert/strict";
import { test } from "node:test";

import { IMPLEMENTATION_STATUS, RSL_VERSION } from "../src/index.js";

void test("the normalized model targets canonical RSL v0.1", () => {
  assert.equal(RSL_VERSION, "0.1");
  assert.equal(IMPLEMENTATION_STATUS, "error-retry-recovery");
});
