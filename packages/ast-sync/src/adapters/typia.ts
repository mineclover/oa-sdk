import ts from 'typescript';
import type { TypeAdapter } from '../adapter-interface.js';
import type {
  EntitySpec,
  EntityPropertySpec,
  PropertyConstraint,
  ASTDiff,
  TextEdit,
} from '../entity-spec.js';
import { computeEntitySpecDiff } from '../diff-engine.js';
import { applyTextEdits, createInsertEdit, createReplaceEdit, createDeleteEdit } from '../text-edit.js';

export interface TypiaAdapterOptions {
  tagStyle?: 'jsdoc' | 'type-level' | 'hybrid';
  tagNamespace?: string;
}

interface ParsedJSDoc {
  description?: string | undefined;
  nonTypiaTags: string[];
  constraints: PropertyConstraint;
  defaultValue?: unknown;
}

interface ParsedTypiaType {
  baseType: string;
  nullable: boolean;
  constraints: PropertyConstraint;
  hasTypeTags: boolean;
  tagNamespace: string;
}

export const TYPIA_TAG_NAMES = new Set([
  'minimum',
  'min',
  'maximum',
  'max',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'minLength',
  'maxLength',
  'format',
  'pattern',
  'multipleOf',
  'default',
  'type',
]);

export const TYPIA_TYPE_TAG_NAMES = new Set([
  'Type',
  'Minimum',
  'Maximum',
  'ExclusiveMinimum',
  'ExclusiveMaximum',
  'MinLength',
  'MaxLength',
  'Format',
  'Pattern',
  'MultipleOf',
  'Default',
]);

/**
 * Parses JSDoc comment blocks to extract Typia validation tags and preserve non-Typia documentation.
 */
function parseTypiaJSDoc(rawComment: string | undefined): ParsedJSDoc {
  if (!rawComment) {
    return { nonTypiaTags: [], constraints: {} };
  }

  const lines = rawComment.split('\n');
  const descriptionLines: string[] = [];
  const nonTypiaTags: string[] = [];
  const constraints: PropertyConstraint = {};
  let defaultValue: unknown;
  let activeNonTypiaIndex = -1;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('@')) {
      const match = trimmed.match(/^@([a-zA-Z0-9_-]+)(?:\s+(.*))?$/);
      if (match && match[1]) {
        const tagName = match[1];
        const tagValue = (match[2] || '').trim();

        if (tagName === 'minimum' || tagName === 'min') {
          activeNonTypiaIndex = -1;
          const num = Number(tagValue);
          if (!isNaN(num)) {
            constraints.minimum = num;
            constraints.min = num;
          }
        } else if (tagName === 'maximum' || tagName === 'max') {
          activeNonTypiaIndex = -1;
          const num = Number(tagValue);
          if (!isNaN(num)) {
            constraints.maximum = num;
            constraints.max = num;
          }
        } else if (tagName === 'exclusiveMinimum') {
          activeNonTypiaIndex = -1;
          const num = Number(tagValue);
          if (!isNaN(num)) constraints.exclusiveMinimum = num;
        } else if (tagName === 'exclusiveMaximum') {
          activeNonTypiaIndex = -1;
          const num = Number(tagValue);
          if (!isNaN(num)) constraints.exclusiveMaximum = num;
        } else if (tagName === 'minLength') {
          activeNonTypiaIndex = -1;
          const num = Number(tagValue);
          if (!isNaN(num)) constraints.minLength = num;
        } else if (tagName === 'maxLength') {
          activeNonTypiaIndex = -1;
          const num = Number(tagValue);
          if (!isNaN(num)) constraints.maxLength = num;
        } else if (tagName === 'multipleOf') {
          activeNonTypiaIndex = -1;
          const num = Number(tagValue);
          if (!isNaN(num)) constraints.multipleOf = num;
        } else if (tagName === 'format') {
          activeNonTypiaIndex = -1;
          constraints.format = tagValue;
          if (tagValue === 'email') constraints.email = true;
          if (tagValue === 'uri' || tagValue === 'url') constraints.url = true;
          if (tagValue === 'uuid') constraints.uuid = true;
          if (tagValue === 'date-time') constraints.datetime = true;
        } else if (tagName === 'pattern') {
          activeNonTypiaIndex = -1;
          constraints.pattern = tagValue;
        } else if (tagName === 'default') {
          activeNonTypiaIndex = -1;
          try {
            defaultValue = JSON.parse(tagValue);
          } catch {
            defaultValue = tagValue;
          }
          constraints.default = defaultValue;
        } else if (TYPIA_TAG_NAMES.has(tagName)) {
          activeNonTypiaIndex = -1;
          constraints[tagName] = tagValue;
        } else {
          if (tagName === 'description') {
            activeNonTypiaIndex = -1;
            if (tagValue) descriptionLines.push(tagValue);
          } else {
            nonTypiaTags.push(trimmed);
            activeNonTypiaIndex = nonTypiaTags.length - 1;
          }
        }
      } else {
        activeNonTypiaIndex = -1;
        descriptionLines.push(trimmed);
      }
    } else if (trimmed.length > 0) {
      if (activeNonTypiaIndex >= 0) {
        nonTypiaTags[activeNonTypiaIndex] += '\n' + trimmed;
      } else {
        descriptionLines.push(trimmed);
      }
    }
  }

  return {
    description: descriptionLines.length > 0 ? descriptionLines.join('\n') : undefined,
    nonTypiaTags,
    constraints,
    defaultValue,
  };
}

/**
 * Extracts raw leading comment text from AST node.
 */
function extractLeadingCommentRaw(sourceText: string, node: ts.Node): string | undefined {
  const comments = ts.getLeadingCommentRanges(sourceText, node.getFullStart());
  if (!comments || comments.length === 0) return undefined;

  const result: string[] = [];
  for (const c of comments) {
    const raw = sourceText.slice(c.pos, c.end).trim();
    if (raw.startsWith('/**')) {
      const cleaned = raw
        .replace(/^\/\*\*|\*\/$/g, '')
        .split('\n')
        .map(l => l.replace(/^\s*\*\s?/, '').trim())
        .filter(Boolean)
        .join('\n');
      if (cleaned) result.push(cleaned);
    } else if (raw.startsWith('//')) {
      const cleaned = raw.replace(/^\/\/\s?/, '').trim();
      if (cleaned) result.push(cleaned);
    }
  }
  return result.length > 0 ? result.join('\n') : undefined;
}

/**
 * Parses a TypeScript type reference node to identify Typia type-level tags (e.g. tags.Minimum<10>).
 */
function parseTagReference(
  node: ts.TypeNode,
  sourceFile: ts.SourceFile
): { tagName: string; namespace: string } | undefined {
  if (!ts.isTypeReferenceNode(node) || !node.typeArguments || node.typeArguments.length === 0) {
    return undefined;
  }

  const typeName = node.typeName.getText(sourceFile).trim();
  const match = typeName.match(/^(?:([a-zA-Z0-9_$.]+)\.)?([a-zA-Z0-9_]+)$/);
  if (!match) return undefined;

  const prefix = match[1];
  const name = match[2];
  if (!name) return undefined;

  if (prefix && prefix !== 'tags' && !prefix.endsWith('.tags')) {
    return undefined;
  }

  const canonicalName = Array.from(TYPIA_TYPE_TAG_NAMES).find(
    t => t.toLowerCase() === name.toLowerCase()
  );
  if (!canonicalName) return undefined;

  return { tagName: canonicalName, namespace: prefix || 'tags' };
}

/**
 * Extracts literal value from Typia type tag argument, supporting negative numbers and string literals.
 */
function parseTagArgument(arg: ts.TypeNode, sourceFile: ts.SourceFile): unknown {
  if (!arg) return undefined;

  if (ts.isLiteralTypeNode(arg)) {
    const lit = arg.literal;
    if (ts.isStringLiteral(lit) || ts.isNoSubstitutionTemplateLiteral(lit)) {
      return lit.text;
    }
    if (ts.isNumericLiteral(lit)) {
      return Number(lit.text);
    }
    if (lit.kind === ts.SyntaxKind.TrueKeyword) return true;
    if (lit.kind === ts.SyntaxKind.FalseKeyword) return false;
    if (lit.kind === ts.SyntaxKind.NullKeyword) return null;
    if (ts.isPrefixUnaryExpression(lit)) {
      if (lit.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(lit.operand)) {
        return -Number(lit.operand.text);
      }
      if (lit.operator === ts.SyntaxKind.PlusToken && ts.isNumericLiteral(lit.operand)) {
        return Number(lit.operand.text);
      }
    }
  }

  const rawText = arg.getText(sourceFile).trim();
  const num = Number(rawText);
  if (!isNaN(num)) return num;
  return rawText.replace(/^['"`]|['"`]$/g, '');
}

/**
 * Decomposes a ts.TypeNode to extract base types and normalized Typia validation constraints.
 * Supports unions, parenthesized nullable unions, and intersection type tags.
 */
function parseTypiaTypeNode(
  typeNode: ts.TypeNode | undefined,
  sourceFile: ts.SourceFile
): ParsedTypiaType {
  if (!typeNode) {
    return {
      baseType: 'unknown',
      nullable: false,
      constraints: {},
      hasTypeTags: false,
      tagNamespace: 'tags',
    };
  }

  let nullable = false;
  const constraints: PropertyConstraint = {};
  let hasTypeTags = false;
  let tagNamespace = 'tags';

  function applyTag(tagRef: { tagName: string; namespace: string }, argNode: ts.TypeNode): string {
    hasTypeTags = true;
    tagNamespace = tagRef.namespace;
    const val = parseTagArgument(argNode, sourceFile);

    switch (tagRef.tagName) {
      case 'Type': {
        const strVal = String(val);
        constraints.type = strVal;
        if (strVal.startsWith('int') || strVal.startsWith('uint')) {
          constraints.int = true;
        }
        return 'number';
      }
      case 'Minimum': {
        const numVal = typeof val === 'number' ? val : Number(val);
        if (!isNaN(numVal)) {
          constraints.minimum = numVal;
          constraints.min = numVal;
        }
        return 'number';
      }
      case 'Maximum': {
        const numVal = typeof val === 'number' ? val : Number(val);
        if (!isNaN(numVal)) {
          constraints.maximum = numVal;
          constraints.max = numVal;
        }
        return 'number';
      }
      case 'ExclusiveMinimum': {
        const numVal = typeof val === 'number' ? val : Number(val);
        if (!isNaN(numVal)) {
          constraints.exclusiveMinimum = numVal;
        }
        return 'number';
      }
      case 'ExclusiveMaximum': {
        const numVal = typeof val === 'number' ? val : Number(val);
        if (!isNaN(numVal)) {
          constraints.exclusiveMaximum = numVal;
        }
        return 'number';
      }
      case 'Format': {
        const strVal = String(val);
        constraints.format = strVal;
        if (strVal === 'uuid') constraints.uuid = true;
        if (strVal === 'email') constraints.email = true;
        if (strVal === 'uri' || strVal === 'url') constraints.url = true;
        if (strVal === 'date-time') constraints.datetime = true;
        return 'string';
      }
      case 'Pattern': {
        constraints.pattern = String(val);
        return 'string';
      }
      case 'MinLength': {
        const numVal = typeof val === 'number' ? val : Number(val);
        if (!isNaN(numVal)) {
          constraints.minLength = numVal;
        }
        return 'string';
      }
      case 'MaxLength': {
        const numVal = typeof val === 'number' ? val : Number(val);
        if (!isNaN(numVal)) {
          constraints.maxLength = numVal;
        }
        return 'string';
      }
      case 'MultipleOf': {
        const numVal = typeof val === 'number' ? val : Number(val);
        if (!isNaN(numVal)) {
          constraints.multipleOf = numVal;
        }
        return 'number';
      }
      case 'Default': {
        constraints.default = val;
        return 'unknown';
      }
      default:
        return 'unknown';
    }
  }

  function processNode(node: ts.TypeNode): string {
    if (ts.isParenthesizedTypeNode(node)) {
      return processNode(node.type);
    }

    if (ts.isUnionTypeNode(node)) {
      const nonNullTypes: string[] = [];
      for (const elem of node.types) {
        if (
          elem.kind === ts.SyntaxKind.NullKeyword ||
          (ts.isLiteralTypeNode(elem) && elem.literal.kind === ts.SyntaxKind.NullKeyword)
        ) {
          nullable = true;
        } else if (
          elem.kind === ts.SyntaxKind.UndefinedKeyword ||
          (ts.isLiteralTypeNode(elem) && elem.literal.kind === ts.SyntaxKind.UndefinedKeyword)
        ) {
          // ignore undefined in base types
        } else {
          const res = processNode(elem);
          if (res) nonNullTypes.push(res);
        }
      }
      return nonNullTypes.filter(Boolean).join(' | ') || 'unknown';
    }

    if (ts.isIntersectionTypeNode(node)) {
      const baseParts: string[] = [];
      for (const member of node.types) {
        const unwrapped = ts.isParenthesizedTypeNode(member) ? member.type : member;
        const tagRef = parseTagReference(unwrapped, sourceFile);
        if (
          tagRef &&
          ts.isTypeReferenceNode(unwrapped) &&
          unwrapped.typeArguments &&
          unwrapped.typeArguments.length > 0
        ) {
          applyTag(tagRef, unwrapped.typeArguments[0]!);
        } else {
          baseParts.push(processNode(member));
        }
      }
      return baseParts.join(' & ') || 'unknown';
    }

    const standaloneTagRef = parseTagReference(node, sourceFile);
    if (
      standaloneTagRef &&
      ts.isTypeReferenceNode(node) &&
      node.typeArguments &&
      node.typeArguments.length > 0
    ) {
      return applyTag(standaloneTagRef, node.typeArguments[0]!);
    }

    return node.getText(sourceFile).trim();
  }

  const baseType = processNode(typeNode);
  return { baseType, nullable, constraints, hasTypeTags, tagNamespace };
}

/**
 * Formats PropertyConstraint records into TypeScript 5.x intersection type tags (e.g. number & tags.Minimum<10>).
 */
function formatTypeLevelTags(
  baseType: string,
  constraints?: PropertyConstraint,
  namespace = 'tags'
): string {
  if (!constraints) return baseType;

  // Array properties should not attach scalar string/numeric tags (e.g. minLength, minimum).
  const isArray =
    Boolean(baseType) &&
    (baseType.endsWith('[]') ||
      baseType.startsWith('Array<') ||
      baseType.startsWith('ReadonlyArray<'));
  if (isArray) {
    return baseType;
  }

  const tagParts: string[] = [];

  if (constraints.type) {
    tagParts.push(`${namespace}.Type<'${constraints.type}'>`);
  } else if (constraints.int) {
    tagParts.push(`${namespace}.Type<'int32'>`);
  }

  if (constraints.minimum !== undefined) {
    tagParts.push(`${namespace}.Minimum<${constraints.minimum}>`);
  } else if (constraints.min !== undefined) {
    tagParts.push(`${namespace}.Minimum<${constraints.min}>`);
  }

  if (constraints.exclusiveMinimum !== undefined) {
    tagParts.push(`${namespace}.ExclusiveMinimum<${constraints.exclusiveMinimum}>`);
  }

  if (constraints.maximum !== undefined) {
    tagParts.push(`${namespace}.Maximum<${constraints.maximum}>`);
  } else if (constraints.max !== undefined) {
    tagParts.push(`${namespace}.Maximum<${constraints.max}>`);
  }

  if (constraints.exclusiveMaximum !== undefined) {
    tagParts.push(`${namespace}.ExclusiveMaximum<${constraints.exclusiveMaximum}>`);
  }

  if (constraints.format) {
    tagParts.push(`${namespace}.Format<'${constraints.format}'>`);
  } else if (constraints.uuid) {
    tagParts.push(`${namespace}.Format<'uuid'>`);
  } else if (constraints.email) {
    tagParts.push(`${namespace}.Format<'email'>`);
  } else if (constraints.url) {
    tagParts.push(`${namespace}.Format<'uri'>`);
  } else if (constraints.datetime) {
    tagParts.push(`${namespace}.Format<'date-time'>`);
  }

  if (constraints.pattern) {
    const escaped = constraints.pattern.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    tagParts.push(`${namespace}.Pattern<'${escaped}'>`);
  }

  if (constraints.minLength !== undefined) {
    tagParts.push(`${namespace}.MinLength<${constraints.minLength}>`);
  }

  if (constraints.maxLength !== undefined) {
    tagParts.push(`${namespace}.MaxLength<${constraints.maxLength}>`);
  }

  if (constraints.multipleOf !== undefined) {
    tagParts.push(`${namespace}.MultipleOf<${constraints.multipleOf}>`);
  }

  if (constraints.default !== undefined) {
    const defVal = typeof constraints.default === 'string' ? `'${constraints.default}'` : constraints.default;
    tagParts.push(`${namespace}.Default<${defVal}>`);
  }

  if (tagParts.length === 0) return baseType;

  // Wrap union base types in parentheses: (User | Admin) & tags.Format<'uuid'>
  const isUnion = Boolean(baseType && baseType.includes('|'));
  const isAlreadyWrapped = Boolean(baseType && baseType.startsWith('(') && baseType.endsWith(')'));
  const wrappedBase = isUnion && !isAlreadyWrapped ? `(${baseType})` : (baseType || 'unknown');

  return `${wrappedBase} & ${tagParts.join(' & ')}`;
}

/**
 * TypiaTypeAdapter: Bidirectional adapter for TypeScript interfaces with JSDoc validation tags.
 * Preserves non-Typia JSDoc comments and formatting.
 */
export class TypiaTypeAdapter implements TypeAdapter<string, string> {
  public readonly name = 'typia';
  public readonly supportedDialects = ['typia', 'typescript-jsdoc', 'typescript', 'typia-type-level'];
  private options: TypiaAdapterOptions;

  constructor(options: TypiaAdapterOptions = {}) {
    this.options = options;
  }

  /**
   * Parse TypeScript interface containing Typia JSDoc tags or type-level tags into normalized EntitySpec.
   */
  public read(source: string): EntitySpec {
    const sourceFile = ts.createSourceFile('typia.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

    let targetDeclaration: ts.InterfaceDeclaration | ts.TypeAliasDeclaration | undefined;
    let entityName = 'AnonymousEntity';
    let docComment: string | undefined;
    const extendsList: string[] = [];

    const visit = (node: ts.Node) => {
      if (!targetDeclaration) {
        if (ts.isInterfaceDeclaration(node)) {
          targetDeclaration = node;
          entityName = node.name.text;
          docComment = extractLeadingCommentRaw(source, node);

          if (node.heritageClauses) {
            for (const clause of node.heritageClauses) {
              if (clause.token === ts.SyntaxKind.ExtendsKeyword) {
                for (const t of clause.types) {
                  extendsList.push(t.getText(sourceFile).trim());
                }
              }
            }
          }
        } else if (ts.isTypeAliasDeclaration(node)) {
          targetDeclaration = node;
          entityName = node.name.text;
          docComment = extractLeadingCommentRaw(source, node);
        }
      }
      ts.forEachChild(node, visit);
    };

    visit(sourceFile);

    const properties: Record<string, EntityPropertySpec> = {};
    let hasAnyTypeTags = false;

    if (targetDeclaration) {
      let members: ts.NodeArray<ts.TypeElement> | undefined;

      if (ts.isInterfaceDeclaration(targetDeclaration)) {
        members = targetDeclaration.members;
      } else if (ts.isTypeAliasDeclaration(targetDeclaration) && ts.isTypeLiteralNode(targetDeclaration.type)) {
        members = targetDeclaration.type.members;
      }

      if (members) {
        for (const member of members) {
          if (ts.isPropertySignature(member) && member.name) {
            const propName = member.name.getText(sourceFile).replace(/^['"]|['"]$/g, '');
            const rawComment = extractLeadingCommentRaw(source, member);
            const parsedJSDoc = parseTypiaJSDoc(rawComment);
            const isOptional = member.questionToken !== undefined;

            const parsedType = parseTypiaTypeNode(member.type, sourceFile);
            const typeStr = parsedType.baseType;
            const nullable = parsedType.nullable;

            if (parsedType.hasTypeTags) {
              hasAnyTypeTags = true;
            }

            const mergedConstraints: PropertyConstraint = {
              ...parsedJSDoc.constraints,
              ...parsedType.constraints,
            };

            const metadata: Record<string, unknown> = {};
            if (parsedJSDoc.nonTypiaTags.length > 0) {
              metadata.nonTypiaTags = parsedJSDoc.nonTypiaTags;
            }
            if (parsedType.hasTypeTags) {
              metadata.typiaTagStyle = 'type-level';
              metadata.tagNamespace = parsedType.tagNamespace;
            } else if (Object.keys(parsedJSDoc.constraints).length > 0) {
              metadata.typiaTagStyle = 'jsdoc';
            }

            properties[propName] = {
              name: propName,
              type: typeStr,
              optional: isOptional ? true : undefined,
              nullable: nullable ? true : undefined,
              docComment: parsedJSDoc.description,
              defaultValue: parsedJSDoc.defaultValue ?? parsedType.constraints.default,
              constraints: Object.keys(mergedConstraints).length > 0 ? mergedConstraints : undefined,
              metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
              sourceSpan: {
                start: member.getStart(sourceFile),
                end: member.getEnd(),
              },
            };
          }
        }
      }
    }

    const hasAnyJSDocTags = Object.values(properties).some(
      (p) => p.metadata?.typiaTagStyle === 'jsdoc'
    );
    const overallStyle = hasAnyTypeTags
      ? 'type-level'
      : hasAnyJSDocTags
      ? 'jsdoc'
      : undefined;

    return {
      id: entityName.toLowerCase(),
      name: entityName,
      kind: 'interface',
      docComment,
      extends: extendsList.length > 0 ? extendsList : undefined,
      properties,
      metadata: overallStyle ? { typiaTagStyle: overallStyle } : undefined,
      sourceSpan: targetDeclaration
        ? { start: targetDeclaration.getStart(sourceFile), end: targetDeclaration.getEnd() }
        : undefined,
    };
  }

  public parse(source: string): EntitySpec {
    return this.read(source);
  }

  /**
   * Formats JSDoc comment for a property including non-Typia comments and Typia validation tags.
   */
  public formatPropertyJSDoc(
    prop: EntityPropertySpec,
    indent = '  ',
    tagStyle?: 'jsdoc' | 'type-level' | 'hybrid'
  ): string[] {
    const effectiveTagStyle =
      tagStyle ||
      (prop.metadata?.typiaTagStyle as 'jsdoc' | 'type-level' | 'hybrid') ||
      this.options.tagStyle ||
      'hybrid';

    const tagLines: string[] = [];

    // Add description lines
    if (prop.docComment) {
      for (const line of prop.docComment.split('\n')) {
        tagLines.push(line);
      }
    }

    // Add preserved non-Typia tags
    if (prop.metadata?.nonTypiaTags && Array.isArray(prop.metadata.nonTypiaTags)) {
      for (const tag of prop.metadata.nonTypiaTags) {
        for (const subLine of String(tag).split('\n')) {
          tagLines.push(subLine);
        }
      }
    }

    if (effectiveTagStyle === 'type-level') {
      if (tagLines.length === 0) {
        return [];
      }
      const lines: string[] = [`${indent}/**`];
      for (const tag of tagLines) {
        lines.push(`${indent} * ${tag}`);
      }
      lines.push(`${indent} */`);
      return lines;
    }

    // Add Typia validation tags
    const c = prop.constraints || {};
    if (c.minimum !== undefined) {
      tagLines.push(`@minimum ${c.minimum}`);
    } else if (c.min !== undefined) {
      tagLines.push(`@minimum ${c.min}`);
    }

    if (c.maximum !== undefined) {
      tagLines.push(`@maximum ${c.maximum}`);
    } else if (c.max !== undefined) {
      tagLines.push(`@maximum ${c.max}`);
    }

    if (c.exclusiveMinimum !== undefined) {
      tagLines.push(`@exclusiveMinimum ${c.exclusiveMinimum}`);
    }
    if (c.exclusiveMaximum !== undefined) {
      tagLines.push(`@exclusiveMaximum ${c.exclusiveMaximum}`);
    }
    if (c.minLength !== undefined) {
      tagLines.push(`@minLength ${c.minLength}`);
    }
    if (c.maxLength !== undefined) {
      tagLines.push(`@maxLength ${c.maxLength}`);
    }
    if (c.format) {
      tagLines.push(`@format ${c.format}`);
    } else if (c.email) {
      tagLines.push('@format email');
    } else if (c.url) {
      tagLines.push('@format uri');
    } else if (c.uuid) {
      tagLines.push('@format uuid');
    } else if (c.datetime) {
      tagLines.push('@format date-time');
    }

    if (c.pattern) {
      tagLines.push(`@pattern ${c.pattern}`);
    }
    if (c.multipleOf !== undefined) {
      tagLines.push(`@multipleOf ${c.multipleOf}`);
    }

    if (prop.defaultValue !== undefined) {
      tagLines.push(`@default ${JSON.stringify(prop.defaultValue)}`);
    } else if (c.default !== undefined) {
      tagLines.push(`@default ${JSON.stringify(c.default)}`);
    }

    if (tagLines.length === 0) {
      return [];
    }

    const lines: string[] = [`${indent}/**`];
    for (const tag of tagLines) {
      lines.push(`${indent} * ${tag}`);
    }
    lines.push(`${indent} */`);
    return lines;
  }

  /**
   * Computes property type string based on constraints and tagStyle.
   */
  public computePropertyTypeString(
    prop: EntityPropertySpec,
    tagStyle?: 'jsdoc' | 'type-level' | 'hybrid'
  ): string {
    const effectiveTagStyle =
      tagStyle ||
      (prop.metadata?.typiaTagStyle as 'jsdoc' | 'type-level' | 'hybrid') ||
      this.options.tagStyle ||
      'hybrid';

    let typeStr = prop.type;
    if (effectiveTagStyle === 'jsdoc') {
      if (prop.nullable && !typeStr.includes('null')) {
        typeStr = `${typeStr} | null`;
      }
      return typeStr;
    }

    const tagNamespace =
      (prop.metadata?.tagNamespace as string) ||
      this.options.tagNamespace ||
      'tags';
    const taggedType = formatTypeLevelTags(typeStr, prop.constraints, tagNamespace);
    if (prop.nullable && !taggedType.includes('null')) {
      if (taggedType.includes('&')) {
        typeStr = `(${taggedType}) | null`;
      } else {
        typeStr = `${taggedType} | null`;
      }
    } else {
      typeStr = taggedType;
    }
    return typeStr;
  }

  /**
   * Emits property signature declaration line with Typia JSDoc or type-level tags.
   */
  public emitPropertyCode(
    prop: EntityPropertySpec,
    indent = '  ',
    tagStyle?: 'jsdoc' | 'type-level' | 'hybrid'
  ): string {
    const effectiveTagStyle =
      tagStyle ||
      (prop.metadata?.typiaTagStyle as 'jsdoc' | 'type-level' | 'hybrid') ||
      this.options.tagStyle ||
      'hybrid';

    const lines: string[] = this.formatPropertyJSDoc(prop, indent, effectiveTagStyle);
    const typeStr = this.computePropertyTypeString(prop, effectiveTagStyle);
    const optToken = prop.optional ? '?' : '';
    const safePropName =
      /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(prop.name) || /^[0-9]+$/.test(prop.name)
        ? prop.name
        : JSON.stringify(prop.name);
    lines.push(`${indent}${safePropName}${optToken}: ${typeStr};`);

    return lines.join('\n');
  }

  /**
   * Emits full TypeScript interface source code with Typia JSDoc or type-level tags from EntitySpec.
   */
  public write(spec: EntitySpec, originalSource?: string): string {
    if (originalSource) {
      const patched = this.patch(originalSource, spec);
      if (typeof patched === 'string') return patched;
    }

    const lines: string[] = [];

    if (spec.docComment) {
      lines.push('/**');
      for (const line of spec.docComment.split('\n')) {
        lines.push(` * ${line}`);
      }
      lines.push(' */');
    }

    const extendsClause =
      spec.extends && spec.extends.length > 0 ? ` extends ${spec.extends.join(', ')}` : '';

    lines.push(`export interface ${spec.name}${extendsClause} {`);

    const defaultTagStyle =
      (spec.metadata?.typiaTagStyle as 'jsdoc' | 'type-level' | 'hybrid') ||
      this.options.tagStyle ||
      'hybrid';

    const propEntries = Object.entries(spec.properties || {});
    for (const [, propSpec] of propEntries) {
      const propTagStyle =
        (propSpec.metadata?.typiaTagStyle as 'jsdoc' | 'type-level' | 'hybrid') ||
        defaultTagStyle;
      lines.push(this.emitPropertyCode(propSpec, '  ', propTagStyle));
    }

    lines.push('}');
    return lines.join('\n');
  }

  public emit(spec: EntitySpec, originalSource?: string): string {
    return this.write(spec, originalSource);
  }

  public diff(a: EntitySpec, b: EntitySpec): ASTDiff[] {
    return computeEntitySpecDiff(a, b);
  }

  /**
   * Surgically patches original Typia interface code with updated EntitySpec using TextEdits.
   */
  public patch(originalSource: string, targetSpec: EntitySpec, customDiffs?: ASTDiff[]): string {
    const currentSpec = this.read(originalSource);
    const diffs = customDiffs || this.diff(currentSpec, targetSpec);

    if (diffs.length === 0) {
      return originalSource;
    }

    const sourceFile = ts.createSourceFile('typia-patch.ts', originalSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const edits: TextEdit[] = [];

    let targetDecl: ts.InterfaceDeclaration | ts.TypeAliasDeclaration | undefined;
    const findDecl = (node: ts.Node) => {
      if (!targetDecl) {
        if (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) {
          if (!targetSpec.name || node.name.text === targetSpec.name) {
            targetDecl = node;
            return;
          }
        }
      }
      ts.forEachChild(node, findDecl);
    };
    findDecl(sourceFile);

    // Fallback to first declaration if named match was not found
    if (!targetDecl) {
      const fallbackDecl = (node: ts.Node) => {
        if (!targetDecl) {
          if (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) {
            targetDecl = node;
            return;
          }
        }
        ts.forEachChild(node, fallbackDecl);
      };
      fallbackDecl(sourceFile);
    }

    if (!targetDecl) {
      return this.write(targetSpec);
    }

    let members: ts.NodeArray<ts.TypeElement> | undefined;
    let closeBracePos = targetDecl.getEnd() - 1;

    if (ts.isInterfaceDeclaration(targetDecl)) {
      members = targetDecl.members;
      closeBracePos = targetDecl.getEnd() - 1;
    } else if (ts.isTypeAliasDeclaration(targetDecl) && ts.isTypeLiteralNode(targetDecl.type)) {
      members = targetDecl.type.members;
      closeBracePos = targetDecl.type.getEnd() - 1;
    }

    const existingPropNodes = new Map<string, ts.PropertySignature>();
    if (members) {
      for (const member of members) {
        if (ts.isPropertySignature(member) && member.name) {
          const name = member.name.getText(sourceFile).replace(/^['"]|['"]$/g, '');
          existingPropNodes.set(name, member);
        }
      }
    }

    const detectedTagStyle: 'jsdoc' | 'type-level' | 'hybrid' =
      (targetSpec.metadata?.typiaTagStyle as 'jsdoc' | 'type-level' | 'hybrid') ||
      (currentSpec.metadata?.typiaTagStyle as 'jsdoc' | 'type-level' | 'hybrid') ||
      this.options.tagStyle ||
      (originalSource.includes('tags.') ? 'type-level' : 'hybrid');

    for (const d of diffs) {
      if (d.kind === 'add-property' && d.propertyName && d.newValue) {
        const newPropSpec = d.newValue as EntityPropertySpec;
        const propTagStyle =
          (newPropSpec.metadata?.typiaTagStyle as 'jsdoc' | 'type-level' | 'hybrid') ||
          detectedTagStyle;
        const newPropCode = this.emitPropertyCode(newPropSpec, '  ', propTagStyle);
        const insertText = `${newPropCode}\n`;
        edits.push(createInsertEdit(closeBracePos, insertText));
      } else if (d.kind === 'remove-property' && d.propertyName) {
        const propNode = existingPropNodes.get(d.propertyName);
        if (propNode) {
          let endPos = propNode.getEnd();
          const rest = originalSource.slice(endPos);
          const newlineMatch = rest.match(/^\r?\n\s*/);
          if (newlineMatch) {
            endPos += newlineMatch[0]?.length ?? 0;
          }
          const startPos = propNode.getFullStart();
          edits.push(createDeleteEdit(startPos, endPos));
        }
      } else if (d.kind === 'update-property' && d.propertyName && d.newValue) {
        const propNode = existingPropNodes.get(d.propertyName);
        if (propNode) {
          const newPropSpec = d.newValue as EntityPropertySpec;
          const currentPropSpec = currentSpec.properties[d.propertyName];
          const propTagStyle =
            (newPropSpec.metadata?.typiaTagStyle as 'jsdoc' | 'type-level' | 'hybrid') ||
            detectedTagStyle;

          const docCommentChanged = newPropSpec.docComment !== currentPropSpec?.docComment;
          const nonTypiaTagsChanged =
            JSON.stringify(newPropSpec.metadata?.nonTypiaTags) !==
            JSON.stringify(currentPropSpec?.metadata?.nonTypiaTags);
          const constraintsChanged =
            JSON.stringify(newPropSpec.constraints) !== JSON.stringify(currentPropSpec?.constraints);
          const defaultValueChanged = newPropSpec.defaultValue !== currentPropSpec?.defaultValue;

          const jsdocChanged =
            docCommentChanged ||
            nonTypiaTagsChanged ||
            (propTagStyle !== 'type-level' && (constraintsChanged || defaultValueChanged));

          if (!jsdocChanged && propNode.getStart(sourceFile) > propNode.getFullStart()) {
            const optToken = newPropSpec.optional ? '?' : '';
            const typeStr = this.computePropertyTypeString(newPropSpec, propTagStyle);
            const sigCode = `${newPropSpec.name}${optToken}: ${typeStr};`;
            edits.push(createReplaceEdit(propNode.getStart(sourceFile), propNode.getEnd(), sigCode));
          } else {
            const newPropCode = this.emitPropertyCode(newPropSpec, '  ', propTagStyle);
            const fullStart = propNode.getFullStart();
            const leadingText = originalSource.slice(fullStart, propNode.getStart(sourceFile));
            const leadingNewlinesMatch = leadingText.match(/^(\r?\n)+/);
            const leadingNewlines = leadingNewlinesMatch ? leadingNewlinesMatch[0] : '\n';
            edits.push(createReplaceEdit(fullStart, propNode.getEnd(), `${leadingNewlines}${newPropCode}`));
          }
        }
      }
    }

    return applyTextEdits(originalSource, edits);
  }
}
