import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import {
  auditShapeCommand,
  auditShapeFiles,
  findTypeScriptFiles,
} from '../../cli/commands/audit-shape.js';
import { CliExitError } from '../../cli/lib/errors.js';

describe('CLI: oa-gen audit:shape', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oa-shape-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('recursively finds TypeScript files and ignores node_modules and .d.ts', () => {
    fs.mkdirSync(path.join(tempDir, 'src', 'nested'), { recursive: true });
    fs.mkdirSync(path.join(tempDir, 'node_modules', 'pkg'), { recursive: true });

    fs.writeFileSync(path.join(tempDir, 'src', 'a.ts'), 'export type A = string;');
    fs.writeFileSync(path.join(tempDir, 'src', 'nested', 'b.tsx'), 'export type B = number;');
    fs.writeFileSync(path.join(tempDir, 'src', 'types.d.ts'), 'export declare type C = boolean;');
    fs.writeFileSync(path.join(tempDir, 'node_modules', 'pkg', 'ignored.ts'), 'export type D = any;');

    const files = findTypeScriptFiles(tempDir);
    expect(files).toHaveLength(2);
    expect(files.some((f) => f.endsWith('a.ts'))).toBe(true);
    expect(files.some((f) => f.endsWith('b.tsx'))).toBe(true);
    expect(files.some((f) => f.endsWith('types.d.ts'))).toBe(false);
    expect(files.some((f) => f.includes('node_modules'))).toBe(false);
  });

  it('audits clean valid types and returns valid: true', () => {
    const validFile = path.join(tempDir, 'valid.ts');
    fs.writeFileSync(
      validFile,
      `
      export interface User {
        id: string;
        name: string;
        roles: string[];
      }
      export type Status = 'active' | 'inactive';
    `
    );

    const result = auditShapeFiles(validFile);
    expect(result.valid).toBe(true);
    expect(result.scannedDeclarations).toBe(2);
    expect(result.scannedFiles).toBe(1);
    expect(result.diagnostics.filter((d) => d.severity === 'error')).toHaveLength(0);
    expect(result.summary).toContain('✅ 0 shape issues found');
  });

  it('detects unsupported conditional and mapped shapes and populates diagnostics', () => {
    const invalidFile = path.join(tempDir, 'invalid.ts');
    fs.writeFileSync(
      invalidFile,
      `
      export type MappedDictionary = { [K in string]: number };
      export type Conditional<T> = T extends string ? number : boolean;
      export type Access<T> = T['key'];
    `
    );

    const result = auditShapeFiles(invalidFile);
    expect(result.valid).toBe(false);
    expect(result.scannedDeclarations).toBe(3);

    const errors = result.diagnostics.filter((d) => d.severity === 'error');
    expect(errors.length).toBeGreaterThanOrEqual(3);

    expect(errors.some((e) => e.feature === 'mapped')).toBe(true);
    expect(errors.some((e) => e.feature === 'conditional')).toBe(true);
    expect(errors.some((e) => e.feature === 'indexed-access')).toBe(true);

    const mappedDiag = errors.find((e) => e.feature === 'mapped');
    expect(mappedDiag?.line).toBe(2);
    expect(mappedDiag?.snippet).toContain('export type MappedDictionary = { [K in string]: number };');
  });

  it('throws CliExitError(1) when unsupported shapes exist and failOnUnsupported is true', async () => {
    const invalidFile = path.join(tempDir, 'invalid.ts');
    fs.writeFileSync(invalidFile, 'export type Bad = { [K in string]: string };');

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await expect(
      auditShapeCommand.run({
        source: invalidFile,
        'fail-on-unsupported': true,
      })
    ).rejects.toThrow(CliExitError);

    expect(logSpy).toHaveBeenCalled();
  });

  it('does not throw when fail-on-unsupported is false even with unsupported shapes', async () => {
    const invalidFile = path.join(tempDir, 'invalid.ts');
    fs.writeFileSync(invalidFile, 'export type Bad = { [K in string]: string };');

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await expect(
      auditShapeCommand.run({
        source: invalidFile,
        'fail-on-unsupported': false,
      })
    ).resolves.toBeUndefined();

    expect(logSpy).toHaveBeenCalled();
  });

  it('outputs valid JSON format when --json is passed', async () => {
    const validFile = path.join(tempDir, 'valid.ts');
    fs.writeFileSync(validFile, 'export interface Item { id: string; }');

    let output = '';
    vi.spyOn(console, 'log').mockImplementation((msg) => {
      output += msg;
    });

    await auditShapeCommand.run({
      source: validFile,
      json: true,
    });

    const parsed = JSON.parse(output);
    expect(parsed.valid).toBe(true);
    expect(parsed.scannedDeclarations).toBe(1);
    expect(parsed.diagnostics).toEqual([]);
  });

  it('throws when target path is missing', async () => {
    await expect(auditShapeCommand.run({})).rejects.toThrow(
      'Target path must be specified via --bundle or --source'
    );
  });
});
