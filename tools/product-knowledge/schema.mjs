/**
 * Strict, dependency-free interpreter for the JSON Schema subset used by the
 * product contracts. The schemas themselves are standard draft 2020-12 JSON.
 *
 * Keeping the supported surface explicit is deliberate: an unknown keyword is
 * a schema-authoring error, not something to ignore and accidentally call
 * validated. This is not intended as a general-purpose JSON Schema package.
 */

const SUPPORTED_KEYWORDS = new Set([
  "$schema",
  "$id",
  "$defs",
  "$ref",
  "type",
  "const",
  "enum",
  "required",
  "properties",
  "additionalProperties",
  "items",
  "minItems",
  "maxItems",
  "uniqueItems",
  "minLength",
  "maxLength",
  "pattern",
  "minimum",
  "maximum",
  "minProperties",
  "maxProperties",
]);

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stable(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function valueType(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (Number.isInteger(value)) return "integer";
  return typeof value;
}

function matchesType(value, expected) {
  if (expected === "number") return typeof value === "number";
  if (expected === "object") {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }
  return valueType(value) === expected;
}

function pointerValue(root, ref) {
  if (!ref.startsWith("#/")) {
    throw new Error(`Only local JSON Schema refs are supported: ${ref}`);
  }
  return ref
    .slice(2)
    .split("/")
    .map((part) => part.replaceAll("~1", "/").replaceAll("~0", "~"))
    .reduce((value, part) => value?.[part], root);
}

function inspectKeywords(schema, path, errors) {
  for (const key of Object.keys(schema)) {
    if (!SUPPORTED_KEYWORDS.has(key)) {
      errors.push(`${path}: unsupported schema keyword ${key}`);
    }
  }
}

function validateNode(value, schema, root, path, errors) {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    errors.push(`${path}: schema node must be an object`);
    return;
  }
  inspectKeywords(schema, path, errors);

  if (schema.$ref) {
    const target = pointerValue(root, schema.$ref);
    if (!target) {
      errors.push(`${path}: unresolved schema ref ${schema.$ref}`);
      return;
    }
    validateNode(value, target, root, path, errors);
    return;
  }

  if (Object.hasOwn(schema, "const") && stable(value) !== stable(schema.const)) {
    errors.push(`${path}: must equal ${stable(schema.const)}`);
  }
  if (
    schema.enum &&
    !schema.enum.some((entry) => stable(entry) === stable(value))
  ) {
    errors.push(`${path}: must be one of ${schema.enum.map(stable).join(", ")}`);
  }

  if (schema.type) {
    const expected = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!expected.some((type) => matchesType(value, type))) {
      errors.push(
        `${path}: expected ${expected.join("|")}, received ${valueType(value)}`,
      );
      return;
    }
  }

  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      errors.push(`${path}: length must be at least ${schema.minLength}`);
    }
    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
      errors.push(`${path}: length must be at most ${schema.maxLength}`);
    }
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) {
      errors.push(`${path}: must match ${schema.pattern}`);
    }
  }

  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) {
      errors.push(`${path}: must be >= ${schema.minimum}`);
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      errors.push(`${path}: must be <= ${schema.maximum}`);
    }
  }

  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      errors.push(`${path}: must contain at least ${schema.minItems} items`);
    }
    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
      errors.push(`${path}: must contain at most ${schema.maxItems} items`);
    }
    if (schema.uniqueItems) {
      const seen = new Set();
      value.forEach((entry, index) => {
        const key = stable(entry);
        if (seen.has(key)) errors.push(`${path}[${index}]: duplicate item`);
        seen.add(key);
      });
    }
    if (schema.items) {
      value.forEach((entry, index) =>
        validateNode(entry, schema.items, root, `${path}[${index}]`, errors),
      );
    }
  }

  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const keys = Object.keys(value);
    if (
      schema.minProperties !== undefined &&
      keys.length < schema.minProperties
    ) {
      errors.push(
        `${path}: must contain at least ${schema.minProperties} properties`,
      );
    }
    if (
      schema.maxProperties !== undefined &&
      keys.length > schema.maxProperties
    ) {
      errors.push(
        `${path}: must contain at most ${schema.maxProperties} properties`,
      );
    }
    for (const required of schema.required ?? []) {
      if (!Object.hasOwn(value, required)) {
        errors.push(`${path}: missing required property ${required}`);
      }
    }
    const properties = schema.properties ?? {};
    for (const [key, entry] of Object.entries(value)) {
      if (Object.hasOwn(properties, key)) {
        validateNode(entry, properties[key], root, `${path}.${key}`, errors);
      } else if (schema.additionalProperties === false) {
        errors.push(`${path}.${key}: additional property is not allowed`);
      } else if (
        schema.additionalProperties &&
        typeof schema.additionalProperties === "object"
      ) {
        validateNode(
          entry,
          schema.additionalProperties,
          root,
          `${path}.${key}`,
          errors,
        );
      }
    }
  }
}

export function validateSchema(value, schema) {
  const errors = [];
  validateNode(value, schema, schema, "$", errors);
  return errors;
}

export function stableJson(value) {
  return `${JSON.stringify(sortValue(value), null, 2)}\n`;
}

function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortValue(value[key])]),
  );
}
