import type { RslRegistries } from "../registry/index.js";
import { resolveRslReferences } from "../registry/index.js";
import type { SemanticValidationOptions } from "../contracts/index.js";
import { assertValidRslSemantics } from "../contracts/index.js";
import { assertValidRslStructure } from "../validation/index.js";
import { parseRslExpression } from "../yaml/index.js";
import { compileRslGraph } from "./graph-compiler.js";
import type { CompiledRslWorkflow, RslCompileOptions } from "./types.js";

export interface RslDocumentCompileOptions extends RslCompileOptions {
  /** Type-compatibility policy applied after reference resolution. */
  readonly semantics?: SemanticValidationOptions;
}

/**
 * Compile one deterministic RSL YAML document through every normative stage.
 * The returned workflow remains lazy until its definition is subscribed.
 */
export function compileRsl(
  source: string,
  registries: RslRegistries,
  options: RslDocumentCompileOptions = {},
): CompiledRslWorkflow {
  const { semantics, ...compileOptions } = options;
  const expression = parseRslExpression(source);
  assertValidRslStructure(expression);
  const resolved = resolveRslReferences(expression, registries);
  const valid = assertValidRslSemantics(resolved, registries, semantics);
  return compileRslGraph(valid, compileOptions);
}
