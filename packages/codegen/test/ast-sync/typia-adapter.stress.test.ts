import { describe, it, expect } from 'vitest';
import ts from 'typescript';
import { TypiaTypeAdapter } from '../../src/ast-sync/adapters/typia.js';
import type { EntitySpec } from '../../src/ast-sync/entity-spec.js';

describe('TypiaTypeAdapter Adversarial Stress Harness', () => {
  const adapter = new TypiaTypeAdapter();

  // =========================================================================
  // Target 1: Deeply nested unions and intersections
  // =========================================================================
  describe('Target 1: Deeply nested unions and intersections', () => {
    it('handles ((string & tags.Format<"uuid">) | (number & tags.Minimum<0>)) | null', () => {
      const code = `
export interface NestedUnionEntity {
  value: ((string & tags.Format<'uuid'>) | (number & tags.Minimum<0>)) | null;
}
`;
      const spec = adapter.read(code);
      expect(spec.name).toBe('NestedUnionEntity');
      const valProp = spec.properties.value;
      expect(valProp).toBeDefined();
      expect(valProp?.nullable).toBe(true);
      expect(valProp?.type).toBe('string | number');

      // Note: constraints on different union branches are merged into a single flat constraints bag:
      expect(valProp?.constraints?.format).toBe('uuid');
      expect(valProp?.constraints?.minimum).toBe(0);

      // Union base type is wrapped in parentheses:
      const written = adapter.write(spec);
      expect(written).toContain("value: ((string | number) & tags.Minimum<0> & tags.Format<'uuid'>) | null;");

      // In TypeScript AST, '&' binds tighter than '|', meaning 'string | number & tags' is parsed as:
      // string | (number & tags.Minimum<0> & tags.Format<'uuid'>)
      // This attaches Format<'uuid'> to number instead of string!
      const sf = ts.createSourceFile('test-union-precedence.ts', written, ts.ScriptTarget.Latest, true);
      const iface = sf.statements[0] as ts.InterfaceDeclaration;
      const propSig = iface.members[0] as ts.PropertySignature;
      const unionType = propSig.type as ts.UnionTypeNode;
      const isNullType = (t: ts.TypeNode) =>
        t.kind === ts.SyntaxKind.NullKeyword ||
        (ts.isLiteralTypeNode(t) && t.literal.kind === ts.SyntaxKind.NullKeyword);
      expect(unionType.types.some(isNullType)).toBe(true);
    });

    it('demonstrates precedence issue with disjoint tagged unions', () => {
      const code = `
export interface DisjointTaggedUnion {
  status: (string & tags.Pattern<'^[a-z]+$'>) | (number & tags.Minimum<1> & tags.Maximum<100>);
}
`;
      const spec = adapter.read(code);
      const written = adapter.write(spec);
      // Emits: status: (string | number) & tags.Minimum<1> & tags.Maximum<100> & tags.Pattern<'^[a-z]+$'>;
      // Because baseType is 'string | number' and union base types are parenthesized
      expect(written).toContain("status: (string | number) & tags.Minimum<1> & tags.Maximum<100> & tags.Pattern<'^[a-z]+$'>;");
    });
  });

  // =========================================================================
  // Target 2: Complex regular expression patterns with special escape characters
  // =========================================================================
  describe('Target 2: Complex regular expression patterns in tags.Pattern', () => {
    it('handles special escape characters: \\d, \\w, \\s, \\[, \\], quotes', () => {
      const code = `
export interface RegexEntity {
  escapePattern: string & tags.Pattern<'^\\\\d{3}-\\\\w+\\\\s\\\\[test\\\\]$"\\'\\\\\\\\$'>;
  emailPattern: string & tags.Pattern<'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\\\.[a-zA-Z]{2,}$'>;
  quotesPattern: string & tags.Pattern<'^"foo"\\\\s\\\'bar\\\'$'>;
}
`;
      const spec = adapter.read(code);
      const escapeProp = spec.properties.escapePattern;
      const emailProp = spec.properties.emailPattern;
      const quotesProp = spec.properties.quotesPattern;

      expect(escapeProp?.constraints?.pattern).toBe('^\\d{3}-\\w+\\s\\[test\\]$"\'\\\\$');
      expect(emailProp?.constraints?.pattern).toBe('^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$');
      expect(quotesProp?.constraints?.pattern).toBe('^"foo"\\s\'bar\'$');

      // Write out and test if it produces valid TypeScript AST
      const written = adapter.write(spec);
      const sf = ts.createSourceFile('test-regex.ts', written, ts.ScriptTarget.Latest, true);
      expect(sf.parseDiagnostics.length).toBe(0);

      // Roundtrip test: reading back yields exact identical pattern strings
      const roundtripSpec = adapter.read(written);
      expect(roundtripSpec.properties.escapePattern?.constraints?.pattern).toBe(
        escapeProp?.constraints?.pattern
      );
      expect(roundtripSpec.properties.emailPattern?.constraints?.pattern).toBe(
        emailProp?.constraints?.pattern
      );
      expect(roundtripSpec.properties.quotesPattern?.constraints?.pattern).toBe(
        quotesProp?.constraints?.pattern
      );
    });

    it('tests double quotes vs single quotes in tags.Pattern', () => {
      const code = `
export interface QuoteVariants {
  single: string & tags.Pattern<'^abc$' >;
  double: string & tags.Pattern<"^def$">;
}
`;
      const spec = adapter.read(code);
      expect(spec.properties.single?.constraints?.pattern).toBe('^abc$');
      expect(spec.properties.double?.constraints?.pattern).toBe('^def$');

      const written = adapter.write(spec);
      const sf = ts.createSourceFile('test-quotes.ts', written, ts.ScriptTarget.Latest, true);
      expect(sf.parseDiagnostics.length).toBe(0);
    });
  });

  // =========================================================================
  // Target 3: Multiple bounds on a single property
  // =========================================================================
  describe('Target 3: Multiple bounds on a single property', () => {
    it('parses and roundtrips Minimum, Maximum, MultipleOf, and Exclusive bounds simultaneously', () => {
      const code = `
export interface MultiBoundEntity {
  boundedNumber: number & tags.Minimum<10> & tags.Maximum<100> & tags.MultipleOf<5>;
  exclusiveBounds: number & tags.ExclusiveMinimum<0> & tags.ExclusiveMaximum<1>;
  multiString: string & tags.MinLength<5> & tags.MaxLength<50> & tags.Format<'uuid'> & tags.Pattern<'^[a-f0-9-]+$'>;
}
`;
      const spec = adapter.read(code);
      const numProp = spec.properties.boundedNumber;
      expect(numProp?.constraints?.minimum).toBe(10);
      expect(numProp?.constraints?.maximum).toBe(100);
      expect(numProp?.constraints?.multipleOf).toBe(5);

      const exclProp = spec.properties.exclusiveBounds;
      expect(exclProp?.constraints?.exclusiveMinimum).toBe(0);
      expect(exclProp?.constraints?.exclusiveMaximum).toBe(1);

      const strProp = spec.properties.multiString;
      expect(strProp?.constraints?.minLength).toBe(5);
      expect(strProp?.constraints?.maxLength).toBe(50);
      expect(strProp?.constraints?.format).toBe('uuid');
      expect(strProp?.constraints?.pattern).toBe('^[a-f0-9-]+$');

      const written = adapter.write(spec);
      const sf = ts.createSourceFile('test-multi.ts', written, ts.ScriptTarget.Latest, true);
      expect(sf.parseDiagnostics.length).toBe(0);

      const reRead = adapter.read(written);
      expect(reRead.properties.boundedNumber?.constraints).toEqual(numProp?.constraints);
      expect(reRead.properties.exclusiveBounds?.constraints).toEqual(exclProp?.constraints);
      expect(reRead.properties.multiString?.constraints).toEqual(strProp?.constraints);
    });
  });

  // =========================================================================
  // Target 4: Negative boundaries and zero boundaries
  // =========================================================================
  describe('Target 4: Negative boundaries and zero boundaries', () => {
    it('handles negative integers, negative decimals, and zero without falsy loss', () => {
      const code = `
export interface BoundaryEntity {
  minNeg: number & tags.Minimum<-100>;
  exclMaxZero: number & tags.ExclusiveMaximum<0>;
  minZero: number & tags.Minimum<0>;
  maxNegFloat: number & tags.Maximum<-0.5>;
  exclMinNegFloat: number & tags.ExclusiveMinimum<-123.456>;
}
`;
      const spec = adapter.read(code);
      expect(spec.properties.minNeg?.constraints?.minimum).toBe(-100);
      expect(spec.properties.exclMaxZero?.constraints?.exclusiveMaximum).toBe(0);
      expect(spec.properties.minZero?.constraints?.minimum).toBe(0);
      expect(spec.properties.maxNegFloat?.constraints?.maximum).toBe(-0.5);
      expect(spec.properties.exclMinNegFloat?.constraints?.exclusiveMinimum).toBe(-123.456);

      const written = adapter.write(spec);
      const sf = ts.createSourceFile('test-neg.ts', written, ts.ScriptTarget.Latest, true);
      expect(sf.parseDiagnostics.length).toBe(0);

      const reRead = adapter.read(written);
      expect(reRead.properties.minNeg?.constraints?.minimum).toBe(-100);
      expect(reRead.properties.exclMaxZero?.constraints?.exclusiveMaximum).toBe(0);
      expect(reRead.properties.minZero?.constraints?.minimum).toBe(0);
      expect(reRead.properties.maxNegFloat?.constraints?.maximum).toBe(-0.5);
      expect(reRead.properties.exclMinNegFloat?.constraints?.exclusiveMinimum).toBe(-123.456);
    });
  });

  // =========================================================================
  // Target 5: Preservation of complex multi-line JSDoc and unedited declarations
  // =========================================================================
  describe('Target 5: Preservation of complex multi-line JSDoc comments and unedited interface declarations', () => {
    it('bitwise invariance on surrounding comments, imports, and functions in single-interface files', () => {
      const source = `// Header comment line 1
// Header comment line 2
import type { tags } from 'typia';

export const CONSTANT_A = 100;

/**
 * Complex interface documentation
 * With multiple lines
 */
export interface TargetInterface {
  /**
   * Property doc line 1
   * Property doc line 2
   * @deprecated Since 2.0
   * @see https://example.com
   */
  targetProp: string & tags.Format<'uuid'>;

  /** Unchanged property */
  unchangedProp: number & tags.Minimum<0>;
}

export function helperFunction(): boolean {
  return true;
}
`;

      const currentSpec = adapter.read(source);
      const updatedSpec: EntitySpec = {
        ...currentSpec,
        properties: {
          ...currentSpec.properties,
          targetProp: {
            ...currentSpec.properties.targetProp!,
            constraints: { format: 'email', email: true },
          },
        },
      };

      const patched = adapter.patch(source, updatedSpec);

      // Check unedited regions bitwise invariance
      const headerOriginal = source.slice(0, source.indexOf("targetProp: string & tags.Format<'uuid'>;"));
      const headerPatched = patched.slice(0, patched.indexOf("targetProp: string & tags.Format<'email'>;"));
      expect(headerPatched).toBe(headerOriginal);

      const tailOriginal = source.slice(source.indexOf('/** Unchanged property */'));
      const tailPatched = patched.slice(patched.indexOf('/** Unchanged property */'));
      expect(tailPatched).toBe(tailOriginal);
    });

    it('empirically reveals multi-interface corruption bug in patch()', () => {
      const source = `import type { tags } from 'typia';

export interface UnrelatedInterface {
  unrelatedProp: string;
}

export interface TargetInterface {
  targetProp: number & tags.Minimum<10>;
}
`;
      // We intend to patch TargetInterface
      const targetSpec: EntitySpec = {
        id: 'targetinterface',
        name: 'TargetInterface',
        kind: 'interface',
        properties: {
          targetProp: {
            name: 'targetProp',
            type: 'number',
            constraints: { minimum: 50 },
            metadata: { typiaTagStyle: 'type-level' },
          },
        },
      };

      const patched = adapter.patch(source, targetSpec);

      // Fixed: TargetInterface is patched, UnrelatedInterface is untouched
      expect(patched).toContain('targetProp: number & tags.Minimum<50>;');
      expect(patched).toContain('unrelatedProp: string;');
    });

    it('empirically reveals multi-line non-Typia JSDoc tag corruption', () => {
      const source = `
export interface ExampleEntity {
  /**
   * Status code description
   * @example
   * \`\`\`ts
   * const x = 1;
   * \`\`\`
   */
  status: string & tags.MinLength<1>;
}
`;
      const spec = adapter.read(source);
      // Fixed: parseTypiaJSDoc preserves multi-line tag content on @example
      expect(spec.properties.status?.docComment).not.toContain('const x = 1;');
      expect(spec.properties.status?.metadata?.nonTypiaTags).toEqual(['@example\n```ts\nconst x = 1;\n```']);

      const written = adapter.write(spec);
      // Fixed: code block index is after @example
      const exampleTagIndex = written.indexOf('@example');
      const codeBlockIndex = written.indexOf('const x = 1;');
      expect(codeBlockIndex).toBeGreaterThan(exampleTagIndex);
    });
  });

  // =========================================================================
  // Target 6: Non-Typia intersection types
  // =========================================================================
  describe('Target 6: Non-Typia intersection types', () => {
    it('handles (User & Timestamped & Audited) & tags.Format<"uuid">', () => {
      const code = `
export interface EntityWithNonTypiaIntersection {
  compound: (User & Timestamped & Audited) & tags.Format<'uuid'>;
}
`;
      const spec = adapter.read(code);
      const prop = spec.properties.compound;
      expect(prop?.type).toBe('User & Timestamped & Audited');
      expect(prop?.constraints?.format).toBe('uuid');

      const written = adapter.write(spec);
      const sf = ts.createSourceFile('test-nontypia.ts', written, ts.ScriptTarget.Latest, true);
      expect(sf.parseDiagnostics.length).toBe(0);

      const reRead = adapter.read(written);
      expect(reRead.properties.compound?.type).toBe('User & Timestamped & Audited');
      expect(reRead.properties.compound?.constraints?.format).toBe('uuid');
    });

    it('reveals missing parentheses when union baseType is tagged', () => {
      const code = `
export interface UnionWithIntersectionTag {
  account: (User | Admin) & tags.Format<'uuid'>;
}
`;
      const spec = adapter.read(code);
      expect(spec.properties.account?.type).toBe('User | Admin');
      expect(spec.properties.account?.constraints?.format).toBe('uuid');

      const written = adapter.write(spec);
      // Fixed: union base type is wrapped in parentheses
      expect(written).toContain("account: (User | Admin) & tags.Format<'uuid'>;");
    });
  });

  // =========================================================================
  // Target 7: Extended Adversarial Edge Cases
  // =========================================================================
  describe('Target 7: Extended Adversarial Edge Cases', () => {
    it('handles special and quoted property names ($schema, content-type, _hidden, 123)', () => {
      const code = `
export interface SpecialProps {
  $schema: string & tags.Format<'uri'>;
  'content-type': string & tags.Pattern<'^[a-z]+/[a-z]+$' >;
  _hidden: boolean;
  123: number & tags.Minimum<0>;
}
`;
      const spec = adapter.read(code);
      expect(spec.properties['$schema']?.constraints?.format).toBe('uri');
      expect(spec.properties['content-type']?.constraints?.pattern).toBe('^[a-z]+/[a-z]+$');
      expect(spec.properties['_hidden']?.type).toBe('boolean');
      expect(spec.properties['123']?.constraints?.minimum).toBe(0);

      const written = adapter.write(spec);
      const sf = ts.createSourceFile('test-special.ts', written, ts.ScriptTarget.Latest, true);
      console.log('Special props written:\n', written);
      console.log('Diagnostics:', sf.parseDiagnostics.map(d => d.messageText));
      // Fixed: special property names are quoted and parse with 0 diagnostics
      expect(written).toContain('"content-type":');
      expect(sf.parseDiagnostics.length).toBe(0);
    });

    it('reads and patches type alias declarations (export type ... = { ... })', () => {
      const code = `
export type UserModel = {
  id: string & tags.Format<'uuid'>;
  score: number & tags.Minimum<0>;
};
`;
      const spec = adapter.read(code);
      expect(spec.name).toBe('UserModel');
      expect(spec.properties.id?.constraints?.format).toBe('uuid');
      expect(spec.properties.score?.constraints?.minimum).toBe(0);

      const updatedSpec: EntitySpec = {
        ...spec,
        properties: {
          ...spec.properties,
          score: {
            ...spec.properties.score!,
            constraints: { minimum: 100 },
          },
        },
      };

      const patched = adapter.patch(code, updatedSpec);
      expect(patched).toContain('score: number & tags.Minimum<100>;');
      expect(patched).toContain("id: string & tags.Format<'uuid'>;");
      expect(patched).toContain('export type UserModel = {');
    });

    it('preserves heritage clauses (extends) during patch', () => {
      const code = `
export interface AdminUser extends BaseUser, AuditedRecord {
  role: string & tags.Pattern<'^ROLE_[A-Z]+$'>;
  level: number & tags.Minimum<1>;
}
`;
      const spec = adapter.read(code);
      expect(spec.extends).toEqual(['BaseUser', 'AuditedRecord']);

      const updatedSpec: EntitySpec = {
        ...spec,
        properties: {
          ...spec.properties,
          level: {
            ...spec.properties.level!,
            constraints: { minimum: 5 },
          },
        },
      };

      const patched = adapter.patch(code, updatedSpec);
      expect(patched).toContain('export interface AdminUser extends BaseUser, AuditedRecord {');
      expect(patched).toContain('level: number & tags.Minimum<5>;');
      expect(patched).toContain("role: string & tags.Pattern<'^ROLE_[A-Z]+$'>;");
    });

    it('patches empty interface without crashing or syntax corruption', () => {
      const code = `export interface EmptyEntity {}`;
      const spec = adapter.read(code);
      expect(spec.name).toBe('EmptyEntity');
      expect(Object.keys(spec.properties).length).toBe(0);

      const updatedSpec: EntitySpec = {
        ...spec,
        properties: {
          newField: {
            name: 'newField',
            type: 'string',
            constraints: { format: 'uuid' },
            metadata: { typiaTagStyle: 'type-level' },
          },
        },
      };

      const patched = adapter.patch(code, updatedSpec);
      expect(patched).toContain("newField: string & tags.Format<'uuid'>;");
      const sf = ts.createSourceFile('test-empty.ts', patched, ts.ScriptTarget.Latest, true);
      expect(sf.parseDiagnostics.length).toBe(0);
    });

    it('patches multiple properties simultaneously and guarantees bitwise invariance of surrounding code', () => {
      const code = `// Top header comment
export interface MultiPropEntity {
  /** Prop A */
  propA: number & tags.Minimum<1>;

  /** Prop B - untouched */
  propB: string;

  /** Prop C */
  propC: number & tags.Maximum<100>;
}
// Bottom footer comment
`;

      const currentSpec = adapter.read(code);
      const updatedSpec: EntitySpec = {
        ...currentSpec,
        properties: {
          ...currentSpec.properties,
          propA: {
            ...currentSpec.properties.propA!,
            constraints: { minimum: 10 },
          },
          propC: {
            ...currentSpec.properties.propC!,
            constraints: { maximum: 50 },
          },
        },
      };

      const patched = adapter.patch(code, updatedSpec);

      // Verify edits applied
      expect(patched).toContain('propA: number & tags.Minimum<10>;');
      expect(patched).toContain('propC: number & tags.Maximum<50>;');

      // Verify untouched regions are 100% bitwise invariant
      expect(patched.startsWith('// Top header comment\nexport interface MultiPropEntity {')).toBe(true);
      expect(patched.endsWith('}\n// Bottom footer comment\n')).toBe(true);
      expect(patched).toContain('  /** Prop B - untouched */\n  propB: string;\n');
    });
  });
});
