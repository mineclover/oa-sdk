import type { TypeAdapter } from '../adapter-interface.js';
import type {
  EntitySpec,
  EntityPropertySpec,
  PropertyConstraint,
  ASTDiff,
} from '../entity-spec.js';
import { computeEntitySpecDiff } from '../diff-engine.js';

export interface JsonSchemaObject {
  $schema?: string | undefined;
  $id?: string | undefined;
  $defs?: Record<string, JsonSchemaObject> | undefined;
  title?: string | undefined;
  description?: string | undefined;
  type?: string | string[] | undefined;
  properties?: Record<string, JsonSchemaObject> | undefined;
  required?: string[] | undefined;
  additionalProperties?: boolean | JsonSchemaObject | undefined;
  items?: JsonSchemaObject | undefined;
  prefixItems?: JsonSchemaObject[] | undefined;
  anyOf?: JsonSchemaObject[] | undefined;
  oneOf?: JsonSchemaObject[] | undefined;
  allOf?: JsonSchemaObject[] | undefined;
  enum?: (string | number | boolean | null)[] | undefined;
  const?: unknown;
  default?: unknown;
  minimum?: number | undefined;
  maximum?: number | undefined;
  exclusiveMinimum?: number | undefined;
  exclusiveMaximum?: number | undefined;
  minLength?: number | undefined;
  maxLength?: number | undefined;
  pattern?: string | undefined;
  format?: string | undefined;
  multipleOf?: number | undefined;
  discriminator?: { propertyName: string; mapping?: Record<string, string> | undefined } | undefined;
  [key: string]: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertStringMember(value: Record<string, unknown>, key: string): void {
  if (value[key] !== undefined && typeof value[key] !== 'string') {
    throw new TypeError(`JSON Schema member "${key}" must be a string`);
  }
}

function assertNumberMember(value: Record<string, unknown>, key: string): void {
  if (value[key] !== undefined && typeof value[key] !== 'number') {
    throw new TypeError(`JSON Schema member "${key}" must be a number`);
  }
}

function assertArrayOfStrings(value: Record<string, unknown>, key: string): void {
  if (value[key] === undefined) return;
  const member = value[key];
  if (!Array.isArray(member) || member.some(item => typeof item !== 'string')) {
    throw new TypeError(`JSON Schema member "${key}" must be an array of strings`);
  }
}

/**
 * Validates the members this adapter reads before returning a parsed JSON Schema.
 * `JSON.parse` returns `unknown`; handing it to the entity parser without checking these
 * shapes would let a malformed document become a lie in `EntitySpec`.
 */
function toJsonSchemaObject(value: Record<string, unknown>): JsonSchemaObject {
  for (const key of ['$schema', '$id', 'title', 'description', 'pattern', 'format']) {
    assertStringMember(value, key);
  }
  for (const key of ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'minLength', 'maxLength', 'multipleOf']) {
    assertNumberMember(value, key);
  }
  assertArrayOfStrings(value, 'required');
  if (
    value.type !== undefined
    && typeof value.type !== 'string'
    && !(Array.isArray(value.type) && value.type.every(item => typeof item === 'string'))
  ) {
    throw new TypeError('JSON Schema member "type" must be a string or an array of strings');
  }
  if (value.properties !== undefined && !isRecord(value.properties)) {
    throw new TypeError('JSON Schema member "properties" must be an object');
  }
  if (value.$defs !== undefined && !isRecord(value.$defs)) {
    throw new TypeError('JSON Schema member "$defs" must be an object');
  }
  return value as JsonSchemaObject;
}

function parseJsonSchemaObject(source: string): JsonSchemaObject {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    throw new TypeError(`JSON Schema is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!isRecord(parsed)) {
    throw new TypeError('JSON Schema must be a JSON object');
  }
  return toJsonSchemaObject(parsed);
}

/**
 * Parses a JSON Schema property definition into EntityPropertySpec.
 */
function parseProperty(
  name: string,
  schema: JsonSchemaObject,
  isRequired: boolean
): EntityPropertySpec {
  let type = 'unknown';
  let nullable = false;
  const constraints: PropertyConstraint = {};

  // Check type or type array (Draft 2020-12)
  if (Array.isArray(schema.type)) {
    const types = schema.type;
    if (types.includes('null')) {
      nullable = true;
    }
    const nonNullTypes = types.filter(t => t !== 'null');
    if (nonNullTypes.length === 1 && nonNullTypes[0]) {
      type = mapJsonType(nonNullTypes[0]);
    } else if (nonNullTypes.length > 1) {
      type = nonNullTypes.map(mapJsonType).join(' | ');
    }
  } else if (typeof schema.type === 'string') {
    type = mapJsonType(schema.type);
  }

  // Check anyOf / oneOf for nullability
  if (schema.anyOf && Array.isArray(schema.anyOf)) {
    const hasNull = schema.anyOf.some(b => b.type === 'null');
    if (hasNull) {
      nullable = true;
      const nonNullBranches = schema.anyOf.filter(b => b.type !== 'null');
      if (nonNullBranches.length === 1 && nonNullBranches[0]) {
        const inner = parseProperty(name, nonNullBranches[0], true);
        type = inner.type;
        Object.assign(constraints, inner.constraints);
      }
    }
  }

  // $ref resolution
  if (schema.$ref && typeof schema.$ref === 'string') {
    const refMatch = schema.$ref.match(/(?:#\/(?:\$defs|components\/schemas)\/)([^/]+)$/);
    if (refMatch && refMatch[1]) {
      type = refMatch[1];
    }
  }

  // Array items
  if (type === 'array') {
    if (schema.items) {
      const inner = parseProperty('', schema.items, true);
      type = `${inner.type}[]`;
    } else {
      type = 'unknown[]';
    }
  }

  // Enum and Const
  if (schema.enum && Array.isArray(schema.enum)) {
    constraints.enum = schema.enum.filter((v): v is string | number | boolean => v !== null);
    if (schema.enum.includes(null)) {
      nullable = true;
    }
    type = 'enum';
  } else if (schema.const !== undefined) {
    if (schema.const === null) {
      nullable = true;
      type = 'null';
    } else {
      constraints.enum = [schema.const as string | number | boolean];
      type = 'literal';
    }
  }

  // Constraints
  if (schema.minimum !== undefined) constraints.minimum = schema.minimum;
  if (schema.maximum !== undefined) constraints.maximum = schema.maximum;
  if (schema.exclusiveMinimum !== undefined) constraints.min = schema.exclusiveMinimum;
  if (schema.exclusiveMaximum !== undefined) constraints.max = schema.exclusiveMaximum;
  if (schema.minLength !== undefined) constraints.minLength = schema.minLength;
  if (schema.maxLength !== undefined) constraints.maxLength = schema.maxLength;
  if (schema.pattern !== undefined) constraints.pattern = schema.pattern;
  if (schema.format !== undefined) {
    constraints.format = schema.format;
    if (schema.format === 'email') constraints.email = true;
    if (schema.format === 'uri') constraints.url = true;
    if (schema.format === 'uuid') constraints.uuid = true;
    if (schema.format === 'date-time') constraints.datetime = true;
  }
  if (schema.multipleOf !== undefined) constraints.multipleOf = schema.multipleOf;
  if (schema.default !== undefined) constraints.default = schema.default;

  return {
    name,
    type,
    optional: !isRequired,
    nullable: nullable || undefined,
    docComment: schema.description,
    defaultValue: schema.default,
    constraints: Object.keys(constraints).length > 0 ? constraints : undefined,
  };
}

function mapJsonType(jt: string): string {
  switch (jt) {
    case 'string':
      return 'string';
    case 'number':
      return 'number';
    case 'integer':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'object':
      return 'object';
    case 'array':
      return 'array';
    case 'null':
      return 'null';
    default:
      return 'unknown';
  }
}

/**
 * Converts an EntityPropertySpec back to a JSON Schema Draft 2020-12 property definition.
 */
function emitPropertySchema(prop: EntityPropertySpec): JsonSchemaObject {
  const schema: JsonSchemaObject = {};
  const t = prop.type.trim();

  if (prop.docComment) {
    schema.description = prop.docComment;
  }

  if (prop.defaultValue !== undefined) {
    schema.default = prop.defaultValue;
  }

  // Type mapping
  if (t === 'string') {
    schema.type = prop.nullable ? ['string', 'null'] : 'string';
  } else if (t === 'number') {
    schema.type = prop.nullable ? ['number', 'null'] : (prop.constraints?.int ? 'integer' : 'number');
  } else if (t === 'boolean') {
    schema.type = prop.nullable ? ['boolean', 'null'] : 'boolean';
  } else if (t === 'Date' || t === 'date') {
    schema.type = prop.nullable ? ['string', 'null'] : 'string';
    schema.format = 'date-time';
  } else if (t === 'null') {
    schema.type = 'null';
  } else if (t.endsWith('[]')) {
    const elemType = t.slice(0, -2);
    schema.type = prop.nullable ? ['array', 'null'] : 'array';
    schema.items = emitPropertySchema({ name: '', type: elemType });
  } else if (t === 'enum' && prop.constraints?.enum) {
    schema.enum = [...prop.constraints.enum];
    if (prop.nullable) schema.enum.push(null);
    const hasString = schema.enum.some(e => typeof e === 'string');
    const hasNum = schema.enum.some(e => typeof e === 'number');
    schema.type = hasString && hasNum ? 'string' : (hasNum ? 'number' : 'string');
  } else if (t === 'literal' && prop.constraints?.enum && prop.constraints.enum.length > 0) {
    schema.const = prop.constraints.enum[0];
  } else if (t.startsWith('Record<')) {
    schema.type = prop.nullable ? ['object', 'null'] : 'object';
  } else {
    // Reference or custom type
    schema.$ref = `#/$defs/${t}`;
  }

  // Apply constraints
  const c = prop.constraints;
  if (c) {
    if (c.minimum !== undefined) schema.minimum = c.minimum;
    if (c.maximum !== undefined) schema.maximum = c.maximum;
    if (c.min !== undefined && schema.minimum === undefined) schema.minimum = c.min;
    if (c.max !== undefined && schema.maximum === undefined) schema.maximum = c.max;
    if (c.minLength !== undefined) schema.minLength = c.minLength;
    if (c.maxLength !== undefined) schema.maxLength = c.maxLength;
    if (c.pattern !== undefined) schema.pattern = c.pattern.replace(/^\/|\/$/g, '');
    if (c.format !== undefined) schema.format = c.format;
    if (c.multipleOf !== undefined) schema.multipleOf = c.multipleOf;
    if (c.email) schema.format = 'email';
    if (c.url) schema.format = 'uri';
    if (c.uuid) schema.format = 'uuid';
    if (c.datetime) schema.format = 'date-time';
    if (c.int && schema.type === 'number') schema.type = 'integer';
  }

  return schema;
}

/**
 * JsonSchemaTypeAdapter: Pluggable TypeAdapter for JSON Schema Draft 2020-12
 * (V3 Unified Architecture)
 */
export class JsonSchemaTypeAdapter implements TypeAdapter<string | Record<string, unknown>, string> {
  public readonly name = 'json-schema';
  public readonly supportedDialects = [
    'draft-2020-12',
    'json-schema',
    'openapi-3.1',
    '2020-12',
    'json-schema-2020-12',
  ];

  /**
   * Parses JSON Schema Draft 2020-12 into normalized EntitySpec.
   */
  public read(source: string | Record<string, unknown>): EntitySpec {
    const raw: JsonSchemaObject = typeof source === 'string'
      ? parseJsonSchemaObject(source)
      : toJsonSchemaObject(source);

    const schemaName = raw.title || raw.$id?.split('/').pop()?.replace(/\.json$/, '') || 'AnonymousSchema';
    const requiredSet = new Set(Array.isArray(raw.required) ? raw.required : []);

    const properties: Record<string, EntityPropertySpec> = {};
    if (raw.properties && typeof raw.properties === 'object') {
      for (const [propName, propDef] of Object.entries(raw.properties)) {
        properties[propName] = parseProperty(propName, propDef, requiredSet.has(propName));
      }
    }

    return {
      id: schemaName.toLowerCase().replace(/schema$/, ''),
      name: schemaName,
      kind: 'schema',
      docComment: raw.description,
      properties,
      discriminator: raw.discriminator,
    };
  }

  public parse(source: string | Record<string, unknown>): EntitySpec {
    return this.read(source);
  }

  /**
   * Emits normalized EntitySpec into canonical JSON Schema Draft 2020-12 representation.
   */
  public write(spec: EntitySpec, originalSource?: string | Record<string, unknown>): string {
    if (originalSource) {
      const patched = this.patch(originalSource, spec);
      if (typeof patched === 'string') return patched;
    }

    const properties: Record<string, JsonSchemaObject> = {};
    const required: string[] = [];

    for (const [propName, propSpec] of Object.entries(spec.properties || {})) {
      properties[propName] = emitPropertySchema(propSpec);
      if (!propSpec.optional) {
        required.push(propName);
      }
    }

    const doc: JsonSchemaObject = {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      title: spec.name,
      type: 'object',
    };

    if (spec.docComment) {
      doc.description = spec.docComment;
    }

    if (Object.keys(properties).length > 0) {
      doc.properties = properties;
    }

    if (required.length > 0) {
      doc.required = required;
    }

    if (spec.discriminator) {
      doc.discriminator = spec.discriminator;
    }

    return JSON.stringify(doc, null, 2) + '\n';
  }

  public emit(spec: EntitySpec, originalSource?: string | Record<string, unknown>): string {
    return this.write(spec, originalSource);
  }

  public diff(a: EntitySpec, b: EntitySpec): ASTDiff[] {
    return computeEntitySpecDiff(a, b);
  }

  /**
   * Surgically patches JSON Schema representation based on EntitySpec diffs.
   */
  public patch(
    originalSource: string | Record<string, unknown>,
    targetSpec: EntitySpec,
    customDiffs?: ASTDiff[]
  ): string {
    let raw: JsonSchemaObject;
    try {
      raw = typeof originalSource === 'string'
        ? parseJsonSchemaObject(originalSource)
        : toJsonSchemaObject({ ...originalSource });
    } catch {
      return this.write(targetSpec);
    }

    const currentSpec = this.read(raw);
    const diffs = customDiffs || this.diff(currentSpec, targetSpec);

    if (diffs.length === 0) {
      return typeof originalSource === 'string' ? originalSource : JSON.stringify(raw, null, 2) + '\n';
    }

    if (!raw.properties) {
      raw.properties = {};
    }
    const requiredSet = new Set(Array.isArray(raw.required) ? raw.required : []);

    for (const d of diffs) {
      if (d.kind === 'add-property' && d.propertyName && d.newValue) {
        const propSpec = d.newValue as EntityPropertySpec;
        raw.properties[d.propertyName] = emitPropertySchema(propSpec);
        if (!propSpec.optional) {
          requiredSet.add(d.propertyName);
        } else {
          requiredSet.delete(d.propertyName);
        }
      } else if (d.kind === 'remove-property' && d.propertyName) {
        delete raw.properties[d.propertyName];
        requiredSet.delete(d.propertyName);
      } else if (d.kind === 'update-property' && d.propertyName && d.newValue) {
        const propSpec = d.newValue as EntityPropertySpec;
        raw.properties[d.propertyName] = emitPropertySchema(propSpec);
        if (!propSpec.optional) {
          requiredSet.add(d.propertyName);
        } else {
          requiredSet.delete(d.propertyName);
        }
      } else if (d.kind === 'update-doc-comment') {
        if (targetSpec.docComment) {
          raw.description = targetSpec.docComment;
        } else {
          delete raw.description;
        }
      }
    }

    if (requiredSet.size > 0) {
      raw.required = Array.from(requiredSet);
    } else {
      delete raw.required;
    }

    return JSON.stringify(raw, null, 2) + '\n';
  }
}
