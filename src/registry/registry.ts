import type {
  RegistryCategory,
  RegistryDefinition,
  RslRegistries,
  RslRegistry,
} from "./types.js";
import { RslRegistryError, type RegistryDiagnostic } from "./diagnostic.js";

export const REFERENCE_PATTERN =
  /^[A-Za-z_][A-Za-z0-9_-]*(?:\.[A-Za-z_][A-Za-z0-9_-]*)*$/u;

function emptyRegistry<Category extends RegistryCategory>(
  category: Category,
): RslRegistry<Category> {
  return Object.freeze({ category, definitions: Object.freeze([]) });
}

export function createRslRegistry<Category extends RegistryCategory, Value>(
  category: Category,
  definitions: readonly RegistryDefinition<Category, Value>[],
): RslRegistry<Category, Value> {
  const diagnostics: RegistryDiagnostic[] = [];
  const keys = new Set<string>();
  definitions.forEach((definition, index) => {
    const path = `${category}[${String(index)}]`;
    if (
      definition.category !== category ||
      !REFERENCE_PATTERN.test(definition.ref) ||
      definition.version === ""
    ) {
      diagnostics.push({
        code: "REG-001_INVALID_REFERENCE",
        message: `Invalid ${category} definition reference: ${definition.ref}`,
        path,
        expectedCategory: category,
        ref: definition.ref,
        ...(definition.version === undefined
          ? {}
          : { version: definition.version }),
      });
    }
    const key = `${definition.ref}\u0000${definition.version ?? ""}`;
    if (keys.has(key)) {
      diagnostics.push({
        code: "REG-002_DUPLICATE_DEFINITION",
        message: `Duplicate ${category} definition: ${definition.ref}${definition.version === undefined ? "" : `@${definition.version}`}`,
        path,
        expectedCategory: category,
        ref: definition.ref,
        ...(definition.version === undefined
          ? {}
          : { version: definition.version }),
      });
    } else keys.add(key);
  });
  if (diagnostics.length > 0) throw new RslRegistryError(diagnostics);
  return Object.freeze({
    category,
    definitions: Object.freeze(
      definitions.map((definition) => Object.freeze({ ...definition })),
    ),
  });
}

export function createRslRegistries(
  registries: Partial<RslRegistries> = {},
): RslRegistries {
  return Object.freeze({
    sources: registries.sources ?? emptyRegistry("source"),
    operations: registries.operations ?? emptyRegistry("operation"),
    sinks: registries.sinks ?? emptyRegistry("sink"),
    workers: registries.workers ?? emptyRegistry("worker"),
    schedulers: registries.schedulers ?? emptyRegistry("scheduler"),
    types: registries.types ?? emptyRegistry("type"),
  });
}
