import type { TypeRef } from "../model/index.js";
import type { RslRegistry } from "../registry/index.js";
import type { TypeCompatibilityProfile } from "./types.js";

export interface TypeCompatibilityContext {
  readonly profile: TypeCompatibilityProfile;
  readonly types?: RslRegistry<"type">;
}

export function areTypeRefsEqual(left: TypeRef, right: TypeRef): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === "primitive" && right.kind === "primitive")
    return left.name === right.name;
  if (left.kind === "named" && right.kind === "named")
    return left.ref === right.ref;
  if (left.kind === "array" && right.kind === "array")
    return areTypeRefsEqual(left.items, right.items);
  if (left.kind === "tuple" && right.kind === "tuple")
    return (
      left.items.length === right.items.length &&
      left.items.every((item, index) =>
        areTypeRefsEqual(item, right.items[index] as TypeRef),
      )
    );
  if (left.kind === "record" && right.kind === "record") {
    const leftKeys = Object.keys(left.fields).sort();
    const rightKeys = Object.keys(right.fields).sort();
    return (
      leftKeys.length === rightKeys.length &&
      leftKeys.every(
        (key, index) =>
          key === rightKeys[index] &&
          areTypeRefsEqual(
            left.fields[key] as TypeRef,
            right.fields[key] as TypeRef,
          ),
      )
    );
  }
  if (left.kind === "union" && right.kind === "union")
    return (
      left.members.length === right.members.length &&
      left.members.every((member) =>
        right.members.some((candidate) => areTypeRefsEqual(member, candidate)),
      )
    );
  if (left.kind === "generic" && right.kind === "generic")
    return (
      left.ref === right.ref &&
      left.arguments.length === right.arguments.length &&
      left.arguments.every((argument, index) =>
        areTypeRefsEqual(argument, right.arguments[index] as TypeRef),
      )
    );
  if (left.kind === "observable" && right.kind === "observable")
    return areTypeRefsEqual(left.value, right.value);
  return false;
}

function namedAssignable(
  source: string,
  target: string,
  types: RslRegistry<"type"> | undefined,
  visited = new Set<string>(),
): boolean {
  if (source === target) return true;
  if (types === undefined || visited.has(source)) return false;
  visited.add(source);
  const definitions = types.definitions.filter(
    (definition) => definition.ref === source,
  );
  return definitions.some((definition) =>
    (definition.contract?.assignableTo ?? []).some((next) =>
      namedAssignable(next, target, types, visited),
    ),
  );
}

export function isTypeRefAssignable(
  source: TypeRef,
  target: TypeRef,
  context: TypeCompatibilityContext,
): boolean {
  if (context.profile === "exact") return areTypeRefsEqual(source, target);
  if (source.kind === "primitive" && source.name === "never") return true;
  if (target.kind === "primitive" && target.name === "unknown") return true;
  if (source.kind === "union")
    return source.members.every((member) =>
      isTypeRefAssignable(member, target, context),
    );
  if (target.kind === "union")
    return target.members.some((member) =>
      isTypeRefAssignable(source, member, context),
    );
  if (source.kind === "primitive" && target.kind === "primitive")
    return source.name === target.name;
  if (source.kind === "named" && target.kind === "named")
    return namedAssignable(source.ref, target.ref, context.types);
  if (source.kind === "array" && target.kind === "array")
    return isTypeRefAssignable(source.items, target.items, context);
  if (source.kind === "tuple" && target.kind === "tuple")
    return (
      source.items.length === target.items.length &&
      source.items.every((item, index) =>
        isTypeRefAssignable(item, target.items[index] as TypeRef, context),
      )
    );
  if (source.kind === "tuple" && target.kind === "array")
    return source.items.every((item) =>
      isTypeRefAssignable(item, target.items, context),
    );
  if (source.kind === "record" && target.kind === "record")
    return Object.entries(target.fields).every(
      ([key, targetField]) =>
        source.fields[key] !== undefined &&
        isTypeRefAssignable(source.fields[key], targetField, context),
    );
  if (source.kind === "generic" && target.kind === "generic")
    return (
      namedAssignable(source.ref, target.ref, context.types) &&
      source.arguments.length === target.arguments.length &&
      source.arguments.every((argument, index) =>
        isTypeRefAssignable(
          argument,
          target.arguments[index] as TypeRef,
          context,
        ),
      )
    );
  if (source.kind === "observable" && target.kind === "observable")
    return isTypeRefAssignable(source.value, target.value, context);
  return false;
}
