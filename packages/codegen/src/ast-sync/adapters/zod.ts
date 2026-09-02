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

/**
 * Extracts clean comment text from leading comments of a node.
 */
function extractLeadingComment(sourceText: string, node: ts.Node): string | undefined {
  const fullText = sourceText;
  const comments = ts.getLeadingCommentRanges(fullText, node.getFullStart());
  if (!comments || comments.length === 0) return undefined;

  const commentTexts: string[] = [];
  for (const c of comments) {
    const raw = fullText.slice(c.pos, c.end).trim();
    if (raw.startsWith('/**')) {
      // JSDoc
      const cleaned = raw
        .replace(/^\/\*\*|\*\/$/g, '')
        .split('\n')
        .map(l => l.replace(/^\s*\*\s?/, '').trim())
        .filter(Boolean)
        .join(' ');
      if (cleaned) commentTexts.push(cleaned);
    } else if (raw.startsWith('//')) {
      const cleaned = raw.replace(/^\/\/\s?/, '').trim();
      if (cleaned) commentTexts.push(cleaned);
    }
  }
  return commentTexts.length > 0 ? commentTexts.join('\n') : undefined;
}

/**
 * Parse an expression argument to its literal value if possible.
 */
function parseLiteralValue(arg: ts.Expression | undefined): unknown {
  if (!arg) return undefined;
  if (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) {
    return arg.text;
  }
  if (ts.isNumericLiteral(arg)) {
    return Number(arg.text);
  }
  if (arg.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (arg.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (arg.kind === ts.SyntaxKind.NullKeyword) return null;
  return arg.getText();
}

const ZOD_BASE_CREATORS = new Set([
  'string',
  'number',
  'boolean',
  'date',
  'bigint',
  'any',
  'unknown',
  'null',
  'undefined',
  'void',
  'never',
  'array',
  'record',
  'enum',
  'literal',
  'object',
  'union',
  'discriminatedUnion',
  'intersection',
  'tuple',
  'custom',
]);

/**
 * Unwraps chained method calls on a Zod property expression.
 */
function unwrapZodExpression(
  expr: ts.Expression,
  sourceFile: ts.SourceFile
): {
  coreType: string;
  optional?: boolean | undefined;
  nullable?: boolean | undefined;
  docComment?: string | undefined;
  defaultValue?: unknown;
  constraints?: PropertyConstraint | undefined;
} {
  let current: ts.Expression = expr;
  let optional: boolean | undefined;
  let nullable: boolean | undefined;
  let docComment: string | undefined;
  let defaultValue: unknown;
  const constraints: PropertyConstraint = {};
  let coreType = 'unknown';

  while (ts.isCallExpression(current)) {
    const callExpr = current;
    if (ts.isPropertyAccessExpression(callExpr.expression)) {
      const methodName = callExpr.expression.name.text;
      const args = callExpr.arguments;
      const firstArg = args[0];
      const caller = callExpr.expression.expression;

      // If caller is `z`, this is the base type constructor!
      if (ts.isIdentifier(caller) && caller.text === 'z' && ZOD_BASE_CREATORS.has(methodName)) {
        if (methodName === 'string') {
          coreType = 'string';
        } else if (methodName === 'number') {
          coreType = 'number';
        } else if (methodName === 'boolean') {
          coreType = 'boolean';
        } else if (methodName === 'date') {
          coreType = 'Date';
        } else if (methodName === 'bigint') {
          coreType = 'bigint';
        } else if (methodName === 'any') {
          coreType = 'any';
        } else if (methodName === 'unknown') {
          coreType = 'unknown';
        } else if (methodName === 'null') {
          coreType = 'null';
        } else if (methodName === 'undefined') {
          coreType = 'undefined';
        } else if (methodName === 'array') {
          if (firstArg) {
            const inner = unwrapZodExpression(firstArg, sourceFile);
            coreType = `${inner.coreType}[]`;
          } else {
            coreType = 'unknown[]';
          }
        } else if (methodName === 'record') {
          coreType = 'Record<string, unknown>';
        } else if (methodName === 'enum') {
          coreType = 'enum';
          if (firstArg && ts.isArrayLiteralExpression(firstArg)) {
            constraints.enum = firstArg.elements.map(e => parseLiteralValue(e) as string);
          }
        } else if (methodName === 'literal') {
          coreType = 'literal';
          if (firstArg) {
            const val = parseLiteralValue(firstArg);
            constraints.enum = [val as string | number | boolean];
          }
        } else if (methodName === 'object') {
          coreType = 'object';
        } else if (methodName === 'custom') {
          if (callExpr.typeArguments && callExpr.typeArguments.length > 0 && callExpr.typeArguments[0]) {
            coreType = callExpr.typeArguments[0].getText(sourceFile);
          } else {
            coreType = 'unknown';
          }
        }
        break;
      }

      if (methodName === 'optional') {
        optional = true;
      } else if (methodName === 'nullable') {
        nullable = true;
      } else if (methodName === 'nullish') {
        optional = true;
        nullable = true;
      } else if (methodName === 'describe' && firstArg) {
        docComment = parseLiteralValue(firstArg) as string;
      } else if (methodName === 'default' && firstArg) {
        defaultValue = parseLiteralValue(firstArg);
        constraints.default = defaultValue;
      } else if ((methodName === 'min' || methodName === 'minimum') && firstArg) {
        const val = Number(parseLiteralValue(firstArg));
        constraints.min = val;
        constraints.minimum = val;
      } else if ((methodName === 'max' || methodName === 'maximum') && firstArg) {
        const val = Number(parseLiteralValue(firstArg));
        constraints.max = val;
        constraints.maximum = val;
      } else if (methodName === 'minLength' && firstArg) {
        constraints.minLength = Number(parseLiteralValue(firstArg));
      } else if (methodName === 'maxLength' && firstArg) {
        constraints.maxLength = Number(parseLiteralValue(firstArg));
      } else if ((methodName === 'regex' || methodName === 'pattern') && firstArg) {
        constraints.pattern = firstArg.getText(sourceFile);
      } else if (methodName === 'email') {
        constraints.email = true;
        constraints.format = 'email';
      } else if (methodName === 'url') {
        constraints.url = true;
        constraints.format = 'uri';
      } else if (methodName === 'uuid') {
        constraints.uuid = true;
        constraints.format = 'uuid';
      } else if (methodName === 'cuid') {
        constraints.cuid = true;
      } else if (methodName === 'datetime') {
        constraints.datetime = true;
        constraints.format = 'date-time';
      } else if (methodName === 'int') {
        constraints.int = true;
      } else if (methodName === 'positive') {
        constraints.positive = true;
      } else if (methodName === 'nonnegative') {
        constraints.nonnegative = true;
      } else if (methodName === 'negative') {
        constraints.negative = true;
      } else if (methodName === 'nonpositive') {
        constraints.nonpositive = true;
      } else if (methodName === 'multipleOf' && firstArg) {
        constraints.multipleOf = Number(parseLiteralValue(firstArg));
      }

      current = caller;
    } else {
      break;
    }
  }

  if (coreType === 'unknown') {
    const baseText = current.getText(sourceFile).trim();
    if (baseText.startsWith('z.string')) {
      coreType = 'string';
    } else if (baseText.startsWith('z.number')) {
      coreType = 'number';
    } else if (baseText.startsWith('z.boolean')) {
      coreType = 'boolean';
    } else if (baseText.startsWith('z.date')) {
      coreType = 'Date';
    } else if (baseText.startsWith('z.bigint')) {
      coreType = 'bigint';
    } else if (baseText.startsWith('z.any')) {
      coreType = 'any';
    } else if (baseText.startsWith('z.null')) {
      coreType = 'null';
    } else if (baseText.startsWith('z.undefined')) {
      coreType = 'undefined';
    } else if (baseText.startsWith('z.object')) {
      coreType = 'object';
    }
  }

  return {
    coreType,
    optional,
    nullable,
    docComment,
    defaultValue,
    constraints: Object.keys(constraints).length > 0 ? constraints : undefined,
  };
}

/**
 * ZodTypeAdapter: Bidirectional adapter between z.object AST and EntitySpec.
 */
export class ZodTypeAdapter implements TypeAdapter<string, string> {
  public readonly name = 'zod';
  public readonly supportedDialects = ['zod', 'zod/v3', 'zod/v4', 'zod-master'];

  /**
   * Parse TypeScript source code containing z.object({...}) into normalized EntitySpec.
   */
  public read(source: string): EntitySpec {
    const sourceFile = ts.createSourceFile('zod-temp.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

    let entityName = 'AnonymousSchema';
    let entityDocComment: string | undefined;
    let objectLiteralNode: ts.ObjectLiteralExpression | undefined;
    let targetNode: ts.Node | undefined;
    let discriminatorInfo: { propertyName: string; mapping?: Record<string, string> | undefined } | undefined;

    const visit = (node: ts.Node) => {
      // Check variable declaration (e.g. export const UserSchema = z.object({...}))
      if (ts.isVariableDeclaration(node) && node.initializer) {
        const varName = node.name.getText(sourceFile);
        const leadingComment = extractLeadingComment(source, node.parent.parent); // VariableStatement
        if (leadingComment) entityDocComment = leadingComment;

        // Check if initializer is z.object or has z.object inside
        let init: ts.Expression = node.initializer;
        while (ts.isCallExpression(init) && ts.isPropertyAccessExpression(init.expression) && init.expression.name.text !== 'object') {
          init = init.expression.expression;
        }

        if (ts.isCallExpression(init) && init.expression.getText(sourceFile).includes('object') && init.arguments.length > 0) {
          const firstArg = init.arguments[0];
          if (firstArg && ts.isObjectLiteralExpression(firstArg)) {
            entityName = varName;
            objectLiteralNode = firstArg;
            targetNode = node.parent.parent;
          }
        } else if (ts.isCallExpression(init) && init.expression.getText(sourceFile).includes('discriminatedUnion') && init.arguments.length >= 2) {
          entityName = varName;
          const propNameArg = init.arguments[0];
          if (propNameArg && ts.isStringLiteral(propNameArg)) {
            discriminatorInfo = { propertyName: propNameArg.text };
          }
          targetNode = node.parent.parent;
        }
      }

      // Check standalone z.object call
      if (!objectLiteralNode && ts.isCallExpression(node)) {
        const exprText = node.expression.getText(sourceFile);
        if (exprText === 'z.object' && node.arguments.length > 0) {
          const firstArg = node.arguments[0];
          if (firstArg && ts.isObjectLiteralExpression(firstArg)) {
            objectLiteralNode = firstArg;
            targetNode = node;
            const leadingComment = extractLeadingComment(source, node);
            if (leadingComment && !entityDocComment) entityDocComment = leadingComment;
          }
        }
      }

      ts.forEachChild(node, visit);
    };

    visit(sourceFile);

    const properties: Record<string, EntityPropertySpec> = {};

    if (objectLiteralNode) {
      for (const prop of objectLiteralNode.properties) {
        if (ts.isPropertyAssignment(prop)) {
          const propName = prop.name.getText(sourceFile).replace(/^['"]|['"]$/g, '');
          const propComment = extractLeadingComment(source, prop);
          const unwrapped = unwrapZodExpression(prop.initializer, sourceFile);

          properties[propName] = {
            name: propName,
            type: unwrapped.coreType,
            optional: unwrapped.optional,
            nullable: unwrapped.nullable,
            docComment: unwrapped.docComment || propComment,
            defaultValue: unwrapped.defaultValue,
            constraints: unwrapped.constraints,
            sourceSpan: {
              start: prop.getStart(sourceFile),
              end: prop.getEnd(),
            },
          };
        }
      }
    }

    return {
      id: entityName.toLowerCase().replace(/schema$/, ''),
      name: entityName,
      kind: 'schema',
      docComment: entityDocComment,
      properties,
      discriminator: discriminatorInfo,
      sourceSpan: targetNode
        ? { start: targetNode.getStart(sourceFile), end: targetNode.getEnd() }
        : undefined,
    };
  }

  public parse(source: string): EntitySpec {
    return this.read(source);
  }

  /**
   * Emits property Zod expression from EntityPropertySpec.
   */
  public emitPropertyCode(prop: EntityPropertySpec): string {
    let base = 'z.unknown()';
    const t = prop.type.trim();

    if (t === 'string') {
      base = 'z.string()';
    } else if (t === 'number') {
      base = 'z.number()';
    } else if (t === 'boolean') {
      base = 'z.boolean()';
    } else if (t === 'Date' || t === 'date') {
      base = 'z.date()';
    } else if (t === 'bigint') {
      base = 'z.bigint()';
    } else if (t === 'any') {
      base = 'z.any()';
    } else if (t === 'unknown') {
      base = 'z.unknown()';
    } else if (t === 'null') {
      base = 'z.null()';
    } else if (t === 'undefined') {
      base = 'z.undefined()';
    } else if (t.endsWith('[]')) {
      const elemType = t.slice(0, -2);
      const elemProp: EntityPropertySpec = { name: '', type: elemType };
      base = `z.array(${this.emitPropertyCode(elemProp)})`;
    } else if (t === 'enum' && prop.constraints?.enum) {
      const values = prop.constraints.enum.map(v => JSON.stringify(v)).join(', ');
      base = `z.enum([${values}])`;
    } else if (t === 'literal' && prop.constraints?.enum && prop.constraints.enum.length > 0) {
      base = `z.literal(${JSON.stringify(prop.constraints.enum[0])})`;
    } else if (t.startsWith('Record<')) {
      base = 'z.record(z.string(), z.unknown())';
    } else {
      base = `z.custom<${t}>()`;
    }

    const c = prop.constraints || {};

    if (c.email) base += '.email()';
    if (c.url) base += '.url()';
    if (c.uuid) base += '.uuid()';
    if (c.cuid) base += '.cuid()';
    if (c.datetime) base += '.datetime()';
    if (c.int) base += '.int()';
    if (c.positive) base += '.positive()';
    if (c.nonnegative) base += '.nonnegative()';
    if (c.negative) base += '.negative()';
    if (c.nonpositive) base += '.nonpositive()';
    if (c.multipleOf !== undefined) base += `.multipleOf(${c.multipleOf})`;

    if (c.min !== undefined && !c.positive && !c.nonnegative) {
      base += `.min(${c.min})`;
    } else if (c.minimum !== undefined && c.min === undefined) {
      base += `.min(${c.minimum})`;
    }

    if (c.max !== undefined) {
      base += `.max(${c.max})`;
    } else if (c.maximum !== undefined) {
      base += `.max(${c.maximum})`;
    }

    if (c.minLength !== undefined && c.min === undefined) {
      base += `.min(${c.minLength})`;
    }
    if (c.maxLength !== undefined && c.max === undefined) {
      base += `.max(${c.maxLength})`;
    }

    if (c.pattern) {
      base += `.regex(${c.pattern.startsWith('/') ? c.pattern : `/${c.pattern}/`})`;
    }

    if (prop.defaultValue !== undefined) {
      base += `.default(${JSON.stringify(prop.defaultValue)})`;
    }

    if (prop.docComment) {
      base += `.describe(${JSON.stringify(prop.docComment)})`;
    }

    if (prop.nullable) {
      base += '.nullable()';
    }

    if (prop.optional) {
      base += '.optional()';
    }

    return base;
  }

  /**
   * Emits full Zod schema source code from EntitySpec.
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

    const schemaName = spec.name;
    lines.push(`export const ${schemaName} = z.object({`);

    const propEntries = Object.entries(spec.properties || {});
    for (const [propName, propSpec] of propEntries) {
      const propCode = this.emitPropertyCode(propSpec);
      lines.push(`  ${propName}: ${propCode},`);
    }

    lines.push('});');
    return lines.join('\n');
  }

  public emit(spec: EntitySpec, originalSource?: string): string {
    return this.write(spec, originalSource);
  }

  public diff(a: EntitySpec, b: EntitySpec): ASTDiff[] {
    return computeEntitySpecDiff(a, b);
  }

  /**
   * Surgically patches original Zod code with updated EntitySpec using TextEdits.
   */
  public patch(originalSource: string, targetSpec: EntitySpec, customDiffs?: ASTDiff[]): string {
    const currentSpec = this.read(originalSource);
    const diffs = customDiffs || this.diff(currentSpec, targetSpec);

    if (diffs.length === 0) {
      return originalSource;
    }

    const sourceFile = ts.createSourceFile('zod-patch.ts', originalSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const edits: TextEdit[] = [];

    // Find the object literal node inside z.object({...})
    let objectLiteralNode: ts.ObjectLiteralExpression | undefined;
    const findObjLiteral = (node: ts.Node) => {
      if (ts.isCallExpression(node)) {
        const text = node.expression.getText(sourceFile);
        if (text.includes('object') && node.arguments.length > 0) {
          const firstArg = node.arguments[0];
          if (firstArg && ts.isObjectLiteralExpression(firstArg)) {
            objectLiteralNode = firstArg;
            return;
          }
        }
      }
      ts.forEachChild(node, findObjLiteral);
    };
    findObjLiteral(sourceFile);

    if (!objectLiteralNode) {
      // Cannot locate object literal node AST, regenerate full schema
      return this.write(targetSpec);
    }

    // Map existing property nodes
    const existingPropNodes = new Map<string, ts.PropertyAssignment>();
    for (const prop of objectLiteralNode.properties) {
      if (ts.isPropertyAssignment(prop)) {
        const name = prop.name.getText(sourceFile).replace(/^['"]|['"]$/g, '');
        existingPropNodes.set(name, prop);
      }
    }

    for (const d of diffs) {
      if (d.kind === 'add-property' && d.propertyName && d.newValue) {
        const newPropSpec = d.newValue as EntityPropertySpec;
        const newPropCode = this.emitPropertyCode(newPropSpec);
        // Find closing brace of object literal
        const closeBracePos = objectLiteralNode.getEnd() - 1; // position before '}'
        // Determine indentation
        const insertText = `  ${d.propertyName}: ${newPropCode},\n`;
        edits.push(createInsertEdit(closeBracePos, insertText));
      } else if (d.kind === 'remove-property' && d.propertyName) {
        const propNode = existingPropNodes.get(d.propertyName);
        if (propNode) {
          // Include trailing comma / newline if present
          let endPos = propNode.getEnd();
          const rest = originalSource.slice(endPos);
          const commaMatch = rest.match(/^\s*,/);
          if (commaMatch) {
            endPos += commaMatch[0]?.length ?? 0;
          }
          const newlineMatch = originalSource.slice(endPos).match(/^\r?\n\s*/);
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
          const newPropCode = this.emitPropertyCode(newPropSpec);
          const replaceText = `${d.propertyName}: ${newPropCode}`;
          edits.push(createReplaceEdit(propNode.getStart(sourceFile), propNode.getEnd(), replaceText));
        }
      }
    }

    return applyTextEdits(originalSource, edits);
  }
}
