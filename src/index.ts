/** Canonical serialized language version targeted by this implementation. */
export const RSL_VERSION = "0.1" as const;

/** Package status remains pre-release until the v0.1 conformance matrix passes. */
export const IMPLEMENTATION_STATUS = "normalized-model" as const;

export type * from "./model/index.js";
