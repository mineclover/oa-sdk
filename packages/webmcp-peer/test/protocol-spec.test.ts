// Conformance of the relay protocol spec (docs/internal/webmcp-relay-protocol.md) with this package.
// The spec is the single source of the protocol's wire rules, and every rule cites the code and the
// tests that hold it, so these checks read the document in its own format and fail when it and the
// package drift apart:
//   - every requirement ID is defined once, as a requirement paragraph or a row of the limits table,
//     and every ID the document mentions is defined,
//   - every requirement states its evidence exactly once, and every evidence line belongs to one,
//   - every source line the document cites exists and is not blank,
//   - every test it cites names an existing test file and an it()/test() title of that file,
//   - the limits table states the value of every exported constant it names, and names every limit
//     the config tier exports,
//   - the close code table states WEBMCP_CLOSE_CODES, and the error class table of R-ERR-001 with the
//     sentence after it states PEER_ERROR_CODES,
//   - a document that links to the spec cites only requirement IDs the spec defines.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import * as configTier from "../src/config.js";
import { WEBMCP_CLOSE_CODES } from "../src/config.js";
import { PEER_ERROR_CODES } from "../src/config/errors.js";

const PACKAGE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPOSITORY_DIR = resolve(PACKAGE_DIR, "../..");
const SPEC_PATH = resolve(REPOSITORY_DIR, "docs/internal/webmcp-relay-protocol.md");
const SPEC_LINES: readonly string[] = readFileSync(SPEC_PATH, "utf8").split("\n");

/** A requirement ID, `R-<AREA>-<NNN>` (spec 1.6). */
const REQUIREMENT_ID = /\bR-[A-Z]+-\d{3}\b/g;
/** A requirement paragraph opens with its ID in bold. */
const REQUIREMENT_PARAGRAPH = /^\*\*(R-[A-Z]+-\d{3})\*\*/;
/** A row of a requirement table (the limits table) opens with its ID. */
const REQUIREMENT_ROW = /^\|\s*(R-[A-Z]+-\d{3})\s*\|/;
/** An evidence line. The evidence list of the limits table names its row's ID first. */
const EVIDENCE_LINE = /^(?:- \*\*(R-[A-Z]+-\d{3})\*\* )?근거: (.*)$/;
/** The separator between an evidence line's code citations and its test citations. */
const TESTS_PART = "; 테스트: ";
/** The test part of a requirement without a test. */
const NO_TEST = "없음";
const SOURCE_CITATION = /`(src\/[^`:\s]+):(\d+)`/g;
const TEST_CITATION = /`(test\/[^`\s]+)` › `([^`]+)`/g;
const CONSTANT_NAME = /^[A-Z][A-Z0-9_]*$/;
const CODE_SPAN = /`([^`]+)`/g;

interface Spec {
  /** The lines (1-based) that define each requirement ID. */
  readonly definitions: ReadonlyMap<string, readonly number[]>;
  /** The IDs defined by a row of the limits table. */
  readonly tableRequirements: ReadonlySet<string>;
  /** The evidence lines of each requirement ID. */
  readonly evidence: ReadonlyMap<string, readonly number[]>;
  /** Evidence lines that follow no requirement waiting for its evidence. */
  readonly orphanEvidence: readonly number[];
  /** The IDs that evidence lines name explicitly, as the limits table's evidence list does. */
  readonly namedEvidence: readonly string[];
}

/** Reads the requirement structure of the spec: definitions and the evidence each one states. */
function parseSpec(lines: readonly string[]): Spec {
  const definitions = new Map<string, number[]>();
  const tableRequirements = new Set<string>();
  const evidence = new Map<string, number[]>();
  const orphanEvidence: number[] = [];
  const namedEvidence: string[] = [];
  const define = (id: string, line: number) => definitions.set(id, [...(definitions.get(id) ?? []), line]);
  const cite = (id: string, line: number) => evidence.set(id, [...(evidence.get(id) ?? []), line]);
  // The requirement paragraph whose evidence line has not come yet. Its evidence follows its
  // statement (tables and lists included) before the next requirement or heading.
  let waiting: string | undefined;
  lines.forEach((text, index) => {
    const line = index + 1;
    if (text.startsWith("#")) {
      waiting = undefined;
      return;
    }
    const paragraph = REQUIREMENT_PARAGRAPH.exec(text);
    if (paragraph) {
      define(paragraph[1]!, line);
      waiting = paragraph[1];
    }
    const row = REQUIREMENT_ROW.exec(text);
    if (row) {
      define(row[1]!, line);
      tableRequirements.add(row[1]!);
    }
    const stated = EVIDENCE_LINE.exec(text);
    if (!stated) return;
    if (stated[1]) {
      cite(stated[1], line);
      namedEvidence.push(stated[1]);
      return;
    }
    if (waiting) cite(waiting, line);
    else orphanEvidence.push(line);
    waiting = undefined;
  });
  return { definitions, tableRequirements, evidence, orphanEvidence, namedEvidence };
}

/** The cells of a Markdown table row; a `|` inside a code span or escaped as `\|` does not split a cell. */
function tableCells(row: string): string[] {
  const cells: string[] = [];
  let cell = "";
  let inCode = false;
  for (const char of row.trim().replace(/^\|/, "").replace(/\|$/, "")) {
    if (char === "`") inCode = !inCode;
    if (char === "|" && !inCode && !cell.endsWith("\\")) {
      cells.push(cell.trim());
      cell = "";
    } else {
      cell += char;
    }
  }
  cells.push(cell.trim());
  return cells;
}

interface Table {
  /** The header cells. */
  readonly header: readonly string[];
  /** The body rows, with the 1-based line each comes from. */
  readonly rows: ReadonlyArray<{ readonly line: number; readonly cells: readonly string[] }>;
  /** The 1-based line of the table's last row. */
  readonly lastLine: number;
}

/** The table that contains the 1-based line `line`. */
function tableAround(lines: readonly string[], line: number): Table {
  const isRow = (index: number) => lines[index]?.trimStart().startsWith("|") ?? false;
  let first = line - 1;
  if (!isRow(first)) throw new Error(`spec line ${line} is not in a table`);
  while (isRow(first - 1)) first -= 1;
  let last = first;
  while (isRow(last + 1)) last += 1;
  return {
    header: tableCells(lines[first]!),
    rows: lines.slice(first + 2, last + 1).map((text, offset) => ({ line: first + 3 + offset, cells: tableCells(text) })),
    lastLine: last + 1,
  };
}

/** The first table that starts after the 1-based line `line`. */
function tableAfter(lines: readonly string[], line: number): Table {
  for (let index = line; index < lines.length; index++) {
    if (lines[index]!.trimStart().startsWith("|")) return tableAround(lines, index + 1);
  }
  throw new Error(`no table after spec line ${line}`);
}

/** The last table that ends before the 1-based line `line`. */
function tableBefore(lines: readonly string[], line: number): Table {
  for (let index = line - 2; index >= 0; index--) {
    if (lines[index]!.trimStart().startsWith("|")) return tableAround(lines, index + 1);
  }
  throw new Error(`no table before spec line ${line}`);
}

/** The index of the header cell named `name`; the check fails if the table has none. */
function column(table: Table, name: string): number {
  const index = table.header.indexOf(name);
  if (index < 0) throw new Error(`the table has no "${name}" column: ${table.header.join(" | ")}`);
  return index;
}

/** The identifiers written as code spans in `text`, in order. */
function codeSpans(text: string): string[] {
  return [...text.matchAll(CODE_SPAN)].map((match) => match[1]!.trim());
}

/** The negative codes written in `text`, either minus sign included (`−32600`, `-32600`). */
function negativeCodes(text: string): number[] {
  return [...text.matchAll(/[−-](\d+)/g)].map((match) => -Number(match[1]));
}

/** The one requirement line of `id`; the definition checks report a missing or repeated one. */
function definitionLine(spec: Spec, id: string): number {
  const lines = spec.definitions.get(id);
  if (!lines || lines.length !== 1) throw new Error(`${id} is not defined exactly once`);
  return lines[0]!;
}

const fileLines = new Map<string, readonly string[] | null>();

/** The lines of a package file, or null when it does not exist. */
function packageFileLines(path: string): readonly string[] | null {
  if (!fileLines.has(path)) {
    const absolute = join(PACKAGE_DIR, path);
    fileLines.set(path, existsSync(absolute) && statSync(absolute).isFile() ? readFileSync(absolute, "utf8").split("\n") : null);
  }
  return fileLines.get(path)!;
}

/** True for `it`, `test`, their modifiers and their tables: `it.skip`, `it.each([...])`, `test.skipIf(c)`. */
function isTestFunction(callee: ts.Expression): boolean {
  if (ts.isIdentifier(callee)) return callee.text === "it" || callee.text === "test";
  if (ts.isPropertyAccessExpression(callee) || ts.isCallExpression(callee)) return isTestFunction(callee.expression);
  if (ts.isTaggedTemplateExpression(callee)) return isTestFunction(callee.tag);
  return false;
}

const titlesByFile = new Map<string, ReadonlySet<string>>();

/**
 * The titles of the it() and test() calls of a test file: as written in the source (a template's
 * `${…}` and a table's `%s` included, as the spec cites them) and, for a plain string, its value.
 */
function testTitles(path: string): ReadonlySet<string> {
  let titles = titlesByFile.get(path);
  if (titles) return titles;
  const source = ts.createSourceFile(path, readFileSync(join(PACKAGE_DIR, path), "utf8"), ts.ScriptTarget.Latest, true);
  const found = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && isTestFunction(node.expression)) {
      const title = node.arguments[0];
      if (title && (ts.isStringLiteral(title) || ts.isNoSubstitutionTemplateLiteral(title) || ts.isTemplateExpression(title))) {
        found.add(title.getText(source).slice(1, -1));
        if (!ts.isTemplateExpression(title)) found.add(title.text);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  titles = found;
  titlesByFile.set(path, titles);
  return titles;
}

/** Every TypeScript module of `src`, as absolute paths. */
function sourceModules(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceModules(path);
    return entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts") ? [path] : [];
  });
}

/**
 * Every numeric constant (an UPPER_SNAKE name) that a module of `src` exports, by name, with the
 * modules that export it: a limit is checked wherever the package defines it, internal modules
 * included (e.g. `PEER_RELAY_MAX_REQUEST_ID_BYTES`, which the server and client tiers share).
 */
async function exportedConstants(): Promise<Map<string, Array<{ module: string; value: number }>>> {
  const constants = new Map<string, Array<{ module: string; value: number }>>();
  for (const file of sourceModules(join(PACKAGE_DIR, "src"))) {
    const module = (await import(pathToFileURL(file).href)) as Record<string, unknown>;
    for (const [name, value] of Object.entries(module)) {
      if (typeof value !== "number" || !CONSTANT_NAME.test(name)) continue;
      constants.set(name, [...(constants.get(name) ?? []), { module: relative(PACKAGE_DIR, file), value }]);
    }
  }
  return constants;
}

/** Every Markdown file under `directory`, outside dependency and build directories. */
function markdownFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" || entry.name === "dist" ? [] : markdownFiles(path);
    return entry.name.endsWith(".md") ? [path] : [];
  });
}

/** True when `values` appear in `numbers` in order, possibly with other numbers between them. */
function isSubsequence(values: readonly number[], numbers: readonly number[]): boolean {
  let next = 0;
  for (const number of numbers) if (next < values.length && number === values[next]) next += 1;
  return next === values.length;
}

const spec = parseSpec(SPEC_LINES);

describe("the relay protocol spec", () => {
  it("defines every requirement ID once", () => {
    const repeated = [...spec.definitions].filter(([, lines]) => lines.length > 1).map(([id, lines]) => `${id} at lines ${lines.join(", ")}`);
    expect(repeated).toEqual([]);
    expect(spec.definitions.size).toBeGreaterThan(0);
  });

  it("defines every requirement ID it mentions", () => {
    const undefinedIds = SPEC_LINES.flatMap((text, index) =>
      [...text.matchAll(REQUIREMENT_ID)].filter((match) => !spec.definitions.has(match[0])).map((match) => `${match[0]} at line ${index + 1}`),
    );
    expect(undefinedIds).toEqual([]);
  });

  it("states the evidence of every requirement exactly once", () => {
    const misstated = [...spec.definitions.keys()]
      .filter((id) => (spec.evidence.get(id)?.length ?? 0) !== 1)
      .map((id) => `${id}: ${spec.evidence.get(id)?.length ?? 0} evidence lines`);
    expect(misstated).toEqual([]);
    expect(spec.orphanEvidence.map((line) => `evidence at line ${line} follows no requirement`)).toEqual([]);
    // Only a table row's evidence names its ID; a paragraph's follows its statement.
    expect(spec.namedEvidence.filter((id) => !spec.tableRequirements.has(id))).toEqual([]);
  });

  it("cites code and tests in the evidence format, a test part of 없음 or of file › title citations", () => {
    const malformed: string[] = [];
    SPEC_LINES.forEach((text, index) => {
      const stated = EVIDENCE_LINE.exec(text);
      if (!stated) return;
      const body = stated[2]!.replace(/\\$/, "");
      const split = body.indexOf(TESTS_PART);
      if (split < 0 || body.indexOf(TESTS_PART, split + 1) >= 0) {
        malformed.push(`line ${index + 1}: no single "${TESTS_PART.trim()}" part`);
        return;
      }
      const tests = body.slice(split + TESTS_PART.length).trim();
      if (tests === NO_TEST) return;
      const rest = tests.replace(TEST_CITATION, "").split(";").map((part) => part.trim()).filter(Boolean);
      if (rest.length > 0) malformed.push(`line ${index + 1}: not a test citation: ${rest.join("; ")}`);
    });
    expect(malformed).toEqual([]);
  });

  it("cites source lines that exist and are not blank", () => {
    const stale: string[] = [];
    let citations = 0;
    SPEC_LINES.forEach((text, index) => {
      for (const [, path, number] of text.matchAll(SOURCE_CITATION)) {
        citations += 1;
        const lines = packageFileLines(path!);
        const at = Number(number);
        if (!lines) stale.push(`${path}:${number} (spec line ${index + 1}): no such file`);
        else if (at < 1 || at > lines.length) stale.push(`${path}:${number} (spec line ${index + 1}): the file has ${lines.length} lines`);
        else if (lines[at - 1]!.trim() === "") stale.push(`${path}:${number} (spec line ${index + 1}): a blank line`);
      }
    });
    expect(stale).toEqual([]);
    expect(citations).toBeGreaterThan(0);
  });

  it("cites tests by an existing test file and an it() or test() title of that file", () => {
    const missing: string[] = [];
    let citations = 0;
    SPEC_LINES.forEach((text, index) => {
      for (const [, path, title] of text.matchAll(TEST_CITATION)) {
        citations += 1;
        if (!packageFileLines(path!)) missing.push(`${path} (spec line ${index + 1}): no such file`);
        else if (!testTitles(path!).has(title!)) missing.push(`${path} › ${title} (spec line ${index + 1}): no such test`);
      }
    });
    expect(missing).toEqual([]);
    expect(citations).toBeGreaterThan(0);
  });

  it("states the value of every exported constant its limits table names", async () => {
    const constants = await exportedConstants();
    const inconsistent = [...constants]
      .filter(([, definitions]) => new Set(definitions.map((definition) => definition.value)).size > 1)
      .map(([name, definitions]) => `${name}: ${definitions.map((definition) => `${definition.value} in ${definition.module}`).join(", ")}`);
    expect(inconsistent).toEqual([]);

    const limits = tableAround(SPEC_LINES, definitionLine(spec, [...spec.tableRequirements][0]!));
    const nameColumn = column(limits, "이름");
    const valueColumn = column(limits, "값");
    const disagreeing: string[] = [];
    let checked = 0;
    for (const { line, cells } of limits.rows) {
      const values = codeSpans(cells[nameColumn]!)
        .filter((name) => constants.has(name))
        .map((name) => constants.get(name)![0]!.value)
        .filter((value, index, all) => index === 0 || value !== all[index - 1]);
      if (values.length === 0) continue;
      checked += 1;
      const numbers = (cells[valueColumn]!.match(/\d+/g) ?? []).map(Number);
      if (numbers[0] !== values[0] || !isSubsequence(values, numbers)) {
        disagreeing.push(`${cells[0]} (line ${line}): ${cells[nameColumn]} = ${values.join(", ")}, but the value is "${cells[valueColumn]}"`);
      }
    }
    expect(disagreeing).toEqual([]);
    expect(checked).toBeGreaterThan(0);
  });

  it("names every limit the config tier exports in its limits table", () => {
    const limits = tableAround(SPEC_LINES, definitionLine(spec, [...spec.tableRequirements][0]!));
    const nameColumn = column(limits, "이름");
    const named = new Set(limits.rows.flatMap(({ cells }) => codeSpans(cells[nameColumn]!)));
    const published = Object.entries(configTier).filter(([name, value]) => typeof value === "number" && CONSTANT_NAME.test(name));
    expect(published.length).toBeGreaterThan(0);
    expect(published.map(([name]) => name).filter((name) => !named.has(name))).toEqual([]);
  });

  it("states WEBMCP_CLOSE_CODES in the close code table R-WS-030 refers to", () => {
    const table = tableBefore(SPEC_LINES, definitionLine(spec, "R-WS-030"));
    const codeColumn = column(table, "code");
    const rows = table.rows.flatMap(({ cells }) => {
      const code = /^(\d{4})\b/.exec(cells[codeColumn]!);
      return code ? [{ code: Number(code[1]), names: codeSpans(cells[codeColumn]!) }] : [];
    });
    const wrong: string[] = [];
    for (const [name, code] of Object.entries(WEBMCP_CLOSE_CODES)) {
      if (!rows.some((row) => row.code === code)) wrong.push(`${name} (${code}) has no row`);
    }
    for (const row of rows) {
      for (const name of row.names) {
        const code = (WEBMCP_CLOSE_CODES as Readonly<Record<string, number>>)[name];
        if (code !== row.code) wrong.push(`the row of ${row.code} names ${name}, which is ${code ?? "not a close code"}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it("leaves no document that links to it citing a requirement ID it does not define", () => {
    const linking = [...markdownFiles(join(REPOSITORY_DIR, "docs")), ...markdownFiles(PACKAGE_DIR)]
      .filter((file) => file !== SPEC_PATH)
      .filter((file) => readFileSync(file, "utf8").includes("webmcp-relay-protocol.md"));
    expect(linking.length).toBeGreaterThan(0);
    const undefinedIds = linking.flatMap((file) =>
      [...readFileSync(file, "utf8").matchAll(REQUIREMENT_ID)]
        .filter((match) => !spec.definitions.has(match[0]))
        .map((match) => `${match[0]} in ${relative(REPOSITORY_DIR, file)}`),
    );
    expect(undefinedIds).toEqual([]);
  });

  it("states PEER_ERROR_CODES in the error class table of R-ERR-001 and the sentence after it", () => {
    const definition = definitionLine(spec, "R-ERR-001");
    const table = tableAfter(SPEC_LINES, definition);
    const codeColumn = column(table, "code");
    const nameColumn = column(table, "이름");
    const namesByCode = new Map<number, Set<string>>();
    for (const [name, code] of Object.entries(PEER_ERROR_CODES)) namesByCode.set(code, (namesByCode.get(code) ?? new Set()).add(name));
    const known = (names: readonly string[]) => new Set(names.filter((name) => Object.hasOwn(PEER_ERROR_CODES, name)));
    const sameSet = (a: ReadonlySet<string>, b: ReadonlySet<string>) => a.size === b.size && [...a].every((name) => b.has(name));

    const stated = new Map<number, Set<string>>();
    for (const { cells } of table.rows) {
      const [code] = negativeCodes(cells[codeColumn]!);
      if (code !== undefined) stated.set(code, known(codeSpans(cells[nameColumn]!)));
    }
    // The paragraph after the table names each code that one name alone uses (`−32004 \`ROOM_NOT_FOUND\`, …`),
    // up to the requirement's evidence line; a pair may be wrapped across lines.
    let next = table.lastLine;
    while (SPEC_LINES[next]?.trim() === "") next += 1;
    const sentence: string[] = [];
    for (; next < SPEC_LINES.length && !EVIDENCE_LINE.test(SPEC_LINES[next]!) && SPEC_LINES[next]!.trim() !== ""; next++) {
      sentence.push(SPEC_LINES[next]!.trim());
    }
    for (const [, digits, name] of sentence.join(" ").matchAll(/[−-](\d+)\s+`([A-Z_]+)`/g)) {
      const code = -Number(digits);
      stated.set(code, new Set([...(stated.get(code) ?? []), ...known([name!])]));
    }

    const wrong: string[] = [];
    for (const [code, names] of namesByCode) {
      const listed = stated.get(code);
      if (!listed) wrong.push(`${code} (${[...names].join(", ")}) is not stated`);
      else if (!sameSet(listed, names)) wrong.push(`${code} is stated for ${[...listed].join(", ") || "no known name"}, but is ${[...names].join(", ")}`);
    }
    expect(wrong).toEqual([]);
  });
});
