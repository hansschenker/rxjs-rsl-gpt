/** Canonical serialized language version targeted by this implementation. */
export const RSL_VERSION = "0.1" as const;

/** RSL v0.1 has passed the repository conformance release gate. */
export const IMPLEMENTATION_STATUS = "v0.1-conformant" as const;

export * from "./cli/index.js";
export * from "./compiler/index.js";
export * from "./contracts/index.js";
export type * from "./model/index.js";
export * from "./registry/index.js";
export * from "./validation/index.js";
export * from "./visualization/index.js";
export * from "./yaml/index.js";
