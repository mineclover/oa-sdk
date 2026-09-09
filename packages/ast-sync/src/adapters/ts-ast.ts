import ts from 'typescript';
import type { TypeAdapter } from '../adapter-interface.js';
import type {
  EntitySpec,
  EntityPropertySpec,
  ASTDiff,
  TextEdit,
  EntityKind,
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
      const cleaned = raw
        .replace(/^\/\*\*|\*\/$/g, '')
        .split('\n')
        .map(l => l.replace(/^\s*\*\s?/, '').trim())
        .filter(Boolean)
        .join('\n');
      if (cleaned) commentTexts.push(cleaned);
    } else if (raw.startsWith('//')) {
      const cleaned = raw.replace(/^\/\/\s?/, '').trim();
      if (cleaned) commentTexts.push(cleaned);
    }
  }
  return commentTexts.length > 0 ? commentTexts.join('\n') : undefined;
}

function isNullType(node: ts.TypeNode): boolean {
  if (node.kind === ts.SyntaxKind.NullKeyword) return true;
  if (ts.isLiteralTypeNode(node) && node.literal.kind === ts.SyntaxKind.NullKeyword) return true;
  return false;
}

function isUndefinedType(node: ts.TypeNode): boolean {
  if (node.kind === ts.SyntaxKind.UndefinedKeyword) return true;
  if (node.kind === ts.SyntaxKind.VoidKeyword) return true;
  if (ts.isLiteralTypeNode(node) && node.literal.kind === ts.SyntaxKind.UndefinedKeyword) return true;
  return false;
}

/**
 * Decomposes a TypeScript TypeNode into core type, optionality, and nullability.
 */
function parseTypeNode(
  typeNode: ts.TypeNode | undefined,
  sourceFile: ts.SourceFile
): { type: string; nullable?: boolean | undefined } {
  if (!typeNode) {
    return { type: 'unknown' };
  }

  // Handle union types like string | null
  if (ts.isUnionTypeNode(typeNode)) {
    const types: string[] = [];
    let nullable = false;

    for (const member of typeNode.types) {
      if (isNullType(member)) {
        nullable = true;
      } else if (isUndefinedType(member)) {
        // Handled via optional
      } else {
        types.push(member.getText(sourceFile).trim());
      }
    }

    if (types.length === 1 && types[0]) {
      return { type: types[0], nullable: nullable ? true : undefined };
    } else if (types.length > 1) {
      return { type: types.join(' | '), nullable: nullable ? true : undefined };
    } else {
      return { type: 'null', nullable: true };
    }
  }

  return { type: typeNode.getText(sourceFile).trim() };
}

/**
 * TsAstTypeAdapter: Bidirectional adapter between TypeScript AST (interface/type) and EntitySpec.
 */
export class TsAstTypeAdapter implements TypeAdapter<string, string> {
  public readonly name = 'ts-ast';
  public readonly supportedDialects = ['typescript', 'ts-interface', 'ts-type-alias'];

  /**
   * Parse TypeScript interface or type alias AST into normalized EntitySpec.
   */
  public read(source: string): EntitySpec {
    const sourceFile = ts.createSourceFile('source.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

    let targetDeclaration: ts.InterfaceDeclaration | ts.TypeAliasDeclaration | undefined;
    let entityName = 'AnonymousEntity';
    let entityKind: EntityKind = 'interface';
    let docComment: string | undefined;
    const extendsList: string[] = [];

    const visit = (node: ts.Node) => {
      if (!targetDeclaration) {
        if (ts.isInterfaceDeclaration(node)) {
          targetDeclaration = node;
          entityName = node.name.text;
          entityKind = 'interface';
          docComment = extractLeadingComment(source, node);

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
          entityKind = 'type-alias';
          docComment = extractLeadingComment(source, node);
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
            const propComment = extractLeadingComment(source, member);
            const isOptional = member.questionToken !== undefined;
            const parsedType = parseTypeNode(member.type, sourceFile);

            properties[propName] = {
              name: propName,
              type: parsedType.type,
              optional: isOptional ? true : undefined,
              nullable: parsedType.nullable,
              docComment: propComment,
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
      kind: entityKind,
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
   * Emits property signature declaration line.
   */
  public emitPropertyCode(prop: EntityPropertySpec, indent = '  '): string {
    const lines: string[] = [];

    if (prop.docComment) {
      lines.push(`${indent}/**`);
      for (const line of prop.docComment.split('\n')) {
        lines.push(`${indent} * ${line}`);
      }
      lines.push(`${indent} */`);
    }

    let typeStr = prop.type;
    if (prop.nullable && !typeStr.includes('null')) {
      typeStr = `${typeStr} | null`;
    }

    const optToken = prop.optional ? '?' : '';
    lines.push(`${indent}${prop.name}${optToken}: ${typeStr};`);

    return lines.join('\n');
  }

  /**
   * Emits full TypeScript interface or type alias source code from EntitySpec.
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

    if (spec.kind === 'type-alias') {
      lines.push(`export type ${spec.name} = {`);
    } else {
      lines.push(`export interface ${spec.name}${extendsClause} {`);
    }

    const propEntries = Object.entries(spec.properties || {});
    for (const [, propSpec] of propEntries) {
      lines.push(this.emitPropertyCode(propSpec, '  '));
    }

    lines.push(spec.kind === 'type-alias' ? '};' : '}');
    return lines.join('\n');
  }

  public emit(spec: EntitySpec, originalSource?: string): string {
    return this.write(spec, originalSource);
  }

  public diff(a: EntitySpec, b: EntitySpec): ASTDiff[] {
    return computeEntitySpecDiff(a, b);
  }

  /**
   * Surgically patches original TypeScript interface / type code with updated EntitySpec using TextEdits.
   */
  public patch(originalSource: string, targetSpec: EntitySpec, customDiffs?: ASTDiff[]): string {
    const currentSpec = this.read(originalSource);
    const diffs = customDiffs || this.diff(currentSpec, targetSpec);

    if (diffs.length === 0) {
      return originalSource;
    }

    const sourceFile = ts.createSourceFile('patch.ts', originalSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
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
          edits.push(createReplaceEdit(propNode.getStart(sourceFile), propNode.getEnd(), newPropCode.trimStart()));
        }
      }
    }

    return applyTextEdits(originalSource, edits);
  }
}
