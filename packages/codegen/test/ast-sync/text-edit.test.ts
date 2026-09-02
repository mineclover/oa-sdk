import { describe, it, expect } from 'vitest';
import {
  applyTextEdits,
  createInsertEdit,
  createReplaceEdit,
  createDeleteEdit,
} from '../../src/ast-sync/text-edit.js';
import type { TextEdit } from '../../src/ast-sync/entity-spec.js';

describe('TextEdit & applyTextEdits (Reverse-Offset Bottom-Up)', () => {
  it('returns original source when edits list is empty', () => {
    const source = 'export interface User { id: string; }';
    expect(applyTextEdits(source, [])).toBe(source);
  });

  it('applies a single insert edit at exact offset', () => {
    const source = 'export interface User {}';
    const offset = source.indexOf('}');
    const edit = createInsertEdit(offset, '\n  name: string;\n');
    const result = applyTextEdits(source, [edit]);
    expect(result).toBe('export interface User {\n  name: string;\n}');
  });

  it('applies a single replace edit', () => {
    const source = 'export interface User { name: string; }';
    const start = source.indexOf('string');
    const end = start + 'string'.length;
    const edit = createReplaceEdit(start, end, 'number');
    const result = applyTextEdits(source, [edit]);
    expect(result).toBe('export interface User { name: number; }');
  });

  it('applies a single delete edit', () => {
    const source = 'export interface User { name: string; age: number; }';
    const start = source.indexOf('age: number; ');
    const end = start + 'age: number; '.length;
    const edit = createDeleteEdit(start, end);
    const result = applyTextEdits(source, [edit]);
    expect(result).toBe('export interface User { name: string; }');
  });

  it('applies multiple edits in descending order with 0 offset shifting', () => {
    const source = 'interface A {\n  p1: string;\n  p2: number;\n  p3: boolean;\n}';
    // Edit p3 (highest offset) and p1 (lowest offset)
    const p3Start = source.indexOf('boolean');
    const p3End = p3Start + 'boolean'.length;
    const p1Start = source.indexOf('string');
    const p1End = p1Start + 'string'.length;

    const edits: TextEdit[] = [
      createReplaceEdit(p3Start, p3End, 'string[]'),
      createReplaceEdit(p1Start, p1End, 'number'),
    ];

    const result = applyTextEdits(source, edits);
    expect(result).toBe('interface A {\n  p1: number;\n  p2: number;\n  p3: string[];\n}');
  });

  it('automatically sorts ascending edits into descending order and applies correctly', () => {
    const source = 'const x = { a: 1, b: 2, c: 3 };';
    const aValStart = source.indexOf('1');
    const cValStart = source.indexOf('3');

    // Given in ascending order
    const edits: TextEdit[] = [
      createReplaceEdit(aValStart, aValStart + 1, '100'),
      createReplaceEdit(cValStart, cValStart + 1, '300'),
    ];

    const result = applyTextEdits(source, edits);
    expect(result).toBe('const x = { a: 100, b: 2, c: 300 };');
  });

  it('throws an error if edit ranges overlap', () => {
    const source = 'const msg = "Hello World";';
    // Edit 1: [13, 24] ("Hello World")
    // Edit 2: [19, 24] ("World") -> overlaps!
    const edits: TextEdit[] = [
      { start: 13, end: 24, newText: 'Hi' },
      { start: 19, end: 24, newText: 'Earth' },
    ];

    expect(() => applyTextEdits(source, edits)).toThrow(/Overlapping text edit ranges/);
  });

  it('throws an error for invalid range bounds', () => {
    const source = 'abc';
    expect(() => applyTextEdits(source, [{ start: -1, end: 2, newText: 'x' }])).toThrow(
      /Invalid text edit range/
    );
    expect(() => applyTextEdits(source, [{ start: 2, end: 1, newText: 'x' }])).toThrow(
      /Invalid text edit range/
    );
    expect(() => applyTextEdits(source, [{ start: 0, end: 10, newText: 'x' }])).toThrow(
      /exceeds source length/
    );
  });

  it('preserves surrounding trivia, formatting, and inline comments verbatim', () => {
    const source = `// Important header comment
export interface Profile {
  /* user identifier */
  id: string; // inline comment

  // multi-line comment
  // for status field
  status: 'active' | 'inactive';
}
`;
    const idStart = source.indexOf('id: string;');
    const idEnd = idStart + 'id: string;'.length;

    const edit = createReplaceEdit(idStart, idEnd, 'id: number;');
    const result = applyTextEdits(source, [edit]);

    expect(result).toContain('// Important header comment');
    expect(result).toContain('/* user identifier */');
    expect(result).toContain('// inline comment');
    expect(result).toContain('// multi-line comment');
    expect(result).toContain("status: 'active' | 'inactive';");
    expect(result).toContain('id: number;');
  });
});
