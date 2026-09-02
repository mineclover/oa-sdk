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

interface ParsedJSDoc {
  description?: string | undefined;
  nonTypiaTags: string[];
  constraints: PropertyConstraint;
  defaultValue?: unknown;
}

const TYPIA_TAG_NAMES = new Set([
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

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('@')) {
      const match = trimmed.match(/^@([a-zA-Z0-9_-]+)(?:\s+(.*))?$/);
      if (match && match[1]) {
        const tagName = match[1];
        const tagValue = (match[2] || '').trim();

        if (tagName === 'minimum' || tagName === 'min') {
          const num = Number(tagValue);
          if (!isNaN(num)) {
            constraints.minimum = num;
            constraints.min = num;
          }
        } else if (tagName === 'maximum' || tagName === 'max') {
          const num = Number(tagValue);
          if (!isNaN(num)) {
            constraints.maximum = num;
            constraints.max = num;
          }
        } else if (tagName === 'exclusiveMinimum') {
          const num = Number(tagValue);
          if (!isNaN(num)) constraints.exclusiveMinimum = num;
        } else if (tagName === 'exclusiveMaximum') {
          const num = Number(tagValue);
          if (!isNaN(num)) constraints.exclusiveMaximum = num;
        } else if (tagName === 'minLength') {
          const num = Number(tagValue);
          if (!isNaN(num)) constraints.minLength = num;
        } else if (tagName === 'maxLength') {
          const num = Number(tagValue);
          if (!isNaN(num)) constraints.maxLength = num;
        } else if (tagName === 'multipleOf') {
          const num = Number(tagValue);
          if (!isNaN(num)) constraints.multipleOf = num;
        } else if (tagName === 'format') {
          constraints.format = tagValue;
          if (tagValue === 'email') constraints.email = true;
          if (tagValue === 'uri' || tagValue === 'url') constraints.url = true;
          if (tagValue === 'uuid') constraints.uuid = true;
          if (tagValue === 'date-time') constraints.datetime = true;
        } else if (tagName === 'pattern') {
          constraints.pattern = tagValue;
        } else if (tagName === 'default') {
          try {
            defaultValue = JSON.parse(tagValue);
          } catch {
            defaultValue = tagValue;
          }
          constraints.default = defaultValue;
        } else if (TYPIA_TAG_NAMES.has(tagName)) {
          // Additional typia tag
          constraints[tagName] = tagValue;
        } else {
          // Non-typia tag (e.g. @deprecated, @example, @see, @description)
          if (tagName === 'description') {
            if (tagValue) descriptionLines.push(tagValue);
          } else {
            nonTypiaTags.push(trimmed);
          }
        }
      } else {
        descriptionLines.push(trimmed);
      }
    } else if (trimmed.length > 0) {
      descriptionLines.push(trimmed);
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
 * TypiaTypeAdapter: Bidirectional adapter for TypeScript interfaces with JSDoc validation tags.
 * Preserves non-Typia JSDoc comments and formatting.
 */
export class TypiaTypeAdapter implements TypeAdapter<string, string> {
  public readonly name = 'typia';
  public readonly supportedDialects = ['typia', 'typescript-jsdoc', 'typescript'];

  /**
   * Parse TypeScript interface containing Typia JSDoc tags into normalized EntitySpec.
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

            let typeStr = member.type ? member.type.getText(sourceFile).trim() : 'unknown';
            let nullable = false;

            if (member.type && ts.isUnionTypeNode(member.type)) {
              const nonNullTypes: string[] = [];
              for (const elem of member.type.types) {
                if (elem.kind === ts.SyntaxKind.NullKeyword) {
                  nullable = true;
                } else if (elem.kind !== ts.SyntaxKind.UndefinedKeyword) {
                  nonNullTypes.push(elem.getText(sourceFile).trim());
                }
              }
              if (nonNullTypes.length > 0) {
                typeStr = nonNullTypes.join(' | ');
              }
            }

            properties[propName] = {
              name: propName,
              type: typeStr,
              optional: isOptional ? true : undefined,
              nullable: nullable ? true : undefined,
              docComment: parsedJSDoc.description,
              defaultValue: parsedJSDoc.defaultValue,
              constraints: Object.keys(parsedJSDoc.constraints).length > 0 ? parsedJSDoc.constraints : undefined,
              metadata: parsedJSDoc.nonTypiaTags.length > 0 ? { nonTypiaTags: parsedJSDoc.nonTypiaTags } : undefined,
              sourceSpan: {
                start: member.getStart(sourceFile),
                end: member.getEnd(),
              },
            };
          }
        }
      }
    }

    return {
      id: entityName.toLowerCase(),
      name: entityName,
      kind: 'interface',
      docComment,
      extends: extendsList.length > 0 ? extendsList : undefined,
      properties,
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
  public formatPropertyJSDoc(prop: EntityPropertySpec, indent = '  '): string[] {
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
        tagLines.push(tag);
      }
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
   * Emits property signature declaration line with Typia JSDoc tags.
   */
  public emitPropertyCode(prop: EntityPropertySpec, indent = '  '): string {
    const lines: string[] = this.formatPropertyJSDoc(prop, indent);

    let typeStr = prop.type;
    if (prop.nullable && !typeStr.includes('null')) {
      typeStr = `${typeStr} | null`;
    }

    const optToken = prop.optional ? '?' : '';
    lines.push(`${indent}${prop.name}${optToken}: ${typeStr};`);

    return lines.join('\n');
  }

  /**
   * Emits full TypeScript interface source code with Typia JSDoc tags from EntitySpec.
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

    const propEntries = Object.entries(spec.properties || {});
    for (const [, propSpec] of propEntries) {
      lines.push(this.emitPropertyCode(propSpec, '  '));
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
          targetDecl = node;
          return;
        }
      }
      ts.forEachChild(node, findDecl);
    };
    findDecl(sourceFile);

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

    for (const d of diffs) {
      if (d.kind === 'add-property' && d.propertyName && d.newValue) {
        const newPropSpec = d.newValue as EntityPropertySpec;
        const newPropCode = this.emitPropertyCode(newPropSpec, '  ');
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
          const newPropCode = this.emitPropertyCode(newPropSpec, '  ');
          edits.push(createReplaceEdit(propNode.getFullStart(), propNode.getEnd(), `\n${newPropCode}`));
        }
      }
    }

    return applyTextEdits(originalSource, edits);
  }
}
