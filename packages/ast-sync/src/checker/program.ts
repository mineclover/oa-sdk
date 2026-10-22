/**
 * TypeScript Program and TypeChecker Factory
 *
 * Provides factory functions to construct ts.Program and ts.TypeChecker instances
 * for both virtual (in-memory multi-file) test suites and disk-backed tsconfig projects.
 */

import ts from 'typescript';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

/** Temporary directories owned by virtual programs, kept outside the TypeScript program. */
const programTempDirs = new WeakMap<ts.Program, string>();

/** Returns the temporary directory a virtual program was created with, if any. */
export function getProgramTempDir(program: ts.Program): string | undefined {
  return programTempDirs.get(program);
}

/**
 * Creates a ts.Program backed by an isolated temporary directory,
 * guaranteeing native TypeScript compiler module resolution and binder symbol binding.
 *
 * @param files Map of relative file paths to their source code content
 * @param compilerOptions Optional compiler options overriding default ES2022/Bundler options
 * @returns An initialized ts.Program instance
 */
export function createVirtualProgram(
  files: Record<string, string>,
  compilerOptions: ts.CompilerOptions = {}
): ts.Program {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oa-ast-virtual-'));
  const filePaths: string[] = [];

  for (const [relPath, content] of Object.entries(files)) {
    const cleanRel = relPath.startsWith('/') ? relPath.slice(1) : relPath;
    const fullPath = path.join(tempDir, cleanRel);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content, 'utf8');
    filePaths.push(fullPath);
  }

  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    ...compilerOptions,
  };

  const program = ts.createProgram(filePaths, options);
  programTempDirs.set(program, tempDir);

  return program;
}

/**
 * Alias for createVirtualProgram for in-memory test compatibility.
 */
export const createInMemoryProgram = createVirtualProgram;

/**
 * Creates a ts.Program from an on-disk tsconfig.json file.
 *
 * Parses compiler options, extended configs, and root files using TypeScript's
 * native configuration parser.
 *
 * @param tsconfigPath Path to tsconfig.json on disk
 * @param compilerOptions Optional overrides for parsed compiler options
 * @returns An initialized ts.Program instance
 */
export function createProgramFromTsconfig(
  tsconfigPath: string,
  compilerOptions: ts.CompilerOptions = {}
): ts.Program {
  const fullTsconfigPath = path.resolve(tsconfigPath);
  if (!fs.existsSync(fullTsconfigPath)) {
    throw new Error(`tsconfig file not found at: ${fullTsconfigPath}`);
  }

  const configFile = ts.readConfigFile(fullTsconfigPath, ts.sys.readFile);
  if (configFile.error) {
    const message = ts.flattenDiagnosticMessageText(configFile.error.messageText, '\n');
    throw new Error(`Failed to read tsconfig at ${fullTsconfigPath}: ${message}`);
  }

  const basePath = path.dirname(fullTsconfigPath);
  const parsed = ts.parseJsonConfigFileContent(
    configFile.config,
    ts.sys,
    basePath,
    compilerOptions
  );

  if (parsed.errors && parsed.errors.length > 0) {
    const errorDiag = parsed.errors.find(
      (d) => d.category === ts.DiagnosticCategory.Error
    );
    if (errorDiag) {
      const message = ts.flattenDiagnosticMessageText(errorDiag.messageText, '\n');
      throw new Error(`Failed to parse tsconfig at ${fullTsconfigPath}: ${message}`);
    }
  }

  const programOptions: ts.CreateProgramOptions = {
    rootNames: parsed.fileNames,
    options: parsed.options,
  };
  if (parsed.projectReferences !== undefined) {
    programOptions.projectReferences = parsed.projectReferences;
  }

  return ts.createProgram(programOptions);
}

/**
 * Cleans up temporary resources allocated for a virtual ts.Program.
 *
 * @param program The ts.Program instance to clean up
 */
export function cleanupProgram(program: ts.Program): void {
  const tempDir = getProgramTempDir(program);
  if (tempDir !== undefined && fs.existsSync(tempDir)) {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * Helper to obtain the TypeChecker for a given ts.Program.
 */
export function getTypeChecker(program: ts.Program): ts.TypeChecker {
  return program.getTypeChecker();
}
