/** Canonical serialized language version targeted by this implementation. */
export const RSL_VERSION = "0.1" as const;

/** Package status remains pre-release until the v0.1 conformance matrix passes. */
export const IMPLEMENTATION_STATUS = "execution-lifecycle-tracing" as const;

export * from "./compiler/index.js";
export * from "./contracts/index.js";
export type * from "./model/index.js";
export * from "./registry/index.js";
export * from "./validation/index.js";
export * from "./yaml/index.js";
