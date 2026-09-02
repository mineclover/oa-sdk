import Ajv2020 from '../../packages/codegen/node_modules/ajv/dist/2020.js';
import standaloneCode from '../../packages/codegen/node_modules/ajv/dist/standalone/index.js';
import ts from '../../packages/codegen/node_modules/typescript/lib/typescript.js';
import { auditCspSourceSync, auditCspBundle } from '../../packages/codegen/src/cli/commands/audit-csp.ts';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';

const execFileAsync = promisify(execFile);
const AjvCtor = Ajv2020.default ?? Ajv2020;
const standaloneCodeFn = standaloneCode.default ?? standaloneCode;

// Complete standalone formats
const STANDALONE_FORMATS = {
  'date-time': /^\d{4}-\d{2}-\d{2}[Tt\s]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:[Zz]|[+-]\d{2}(?::?\d{2})?)?$/i,
  date: /^\d{4}-\d{2}-\d{2}$/,
  time: /^(?:[0-2]\d:[0-5]\d:[0-5]\d|23:59:60)(?:\.\d+)?(?:[Zz]|[+-]\d{2}(?::?\d{2})?)?$/i,
  'iso-date-time': /^\d{4}-\d{2}-\d{2}[Tt\s]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:[Zz]|[+-]\d{2}(?::?\d{2})?)?$/i,
  'iso-time': /^(?:[0-2]\d:[0-5]\d:[0-5]\d|23:59:60)(?:\.\d+)?(?:[Zz]|[+-]\d{2}(?::?\d{2})?)?$/i,
  duration: /^P(?!$)(?:(?:\d+Y)?(?:\d+M)?(?:\d+D)?(?:T(?=\d)(?:\d+H)?(?:\d+M)?(?:\d+S)?)?|\d+W)$/,
  uri: /^(?:[a-z][a-z0-9+\-.]*:)(?:\/?\/)?[^\s]*$/i,
  'uri-reference': /^(?:(?:[a-z][a-z0-9+\-.]*:)?\/?\/)?(?:[^\\\s#][^\s#]*)?(?:#[^\\\s]*)?$/i,
  'uri-template': /^(?:(?:[^\x00-\x20"'<>%\\^`{|}]|%[0-9a-f]{2})|\{[+#./;?&=,!@|]?(?:[a-z0-9_]|%[0-9a-f]{2})+(?::[1-9][0-9]{0,3}|\*)?(?:,(?:[a-z0-9_]|%[0-9a-f]{2})+(?::[1-9][0-9]{0,3}|\*)?)*\})*$/i,
  url: /^(?:https?|ftp):\/\/(?:\S+(?::\S*)?@)?(?:(?!(?:10|127)(?:\.\d{1,3}){3})(?!(?:169\.254|192\.168)(?:\.\d{1,3}){2})(?!172\.(?:1[6-9]|2\d|3[0-1])(?:\.\d{1,3}){2})(?:[1-9]\d?|1\d\d|2[01]\d|22[0-3])(?:\.(?:1?\d{1,2}|2[0-4]\d|25[0-5])){2}(?:\.(?:[1-9]\d?|1\d\d|2[0-4]\d|25[0-4]))|(?:(?:[a-z0-9\u{00a1}-\u{ffff}]+-)*[a-z0-9\u{00a1}-\u{ffff}]+)(?:\.(?:[a-z0-9\u{00a1}-\u{ffff}]+-)*[a-z0-9\u{00a1}-\u{ffff}]+)*(?:\.(?:[a-z\u{00a1}-\u{ffff}]{2,})))(?::\d{2,5})?(?:\/[^\s]*)?$/iu,
  email: /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/i,
  hostname: /^(?=.{1,253}\.?$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[-0-9a-z]{0,61}[a-z0-9])?)*\.?$/i,
  ipv4: /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/,
  ipv6: /^((([0-9a-f]{1,4}:){7}([0-9a-f]{1,4}|:))|(([0-9a-f]{1,4}:){6}(:[0-9a-f]{1,4}|((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3})|:))|(([0-9a-f]{1,4}:){5}(((:[0-9a-f]{1,4}){1,2})|:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3})|:))|(([0-9a-f]{1,4}:){4}(((:[0-9a-f]{1,4}){1,3})|((:[0-9a-f]{1,4})?:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(([0-9a-f]{1,4}:){3}(((:[0-9a-f]{1,4}){1,4})|((:[0-9a-f]{1,4}){0,2}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(([0-9a-f]{1,4}:){2}(((:[0-9a-f]{1,4}){1,5})|((:[0-9a-f]{1,4}){0,3}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(([0-9a-f]{1,4}:){1}(((:[0-9a-f]{1,4}){1,6})|((:[0-9a-f]{1,4}){0,4}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(:(((:[0-9a-f]{1,4}){1,7})|((:[0-9a-f]{1,4}){0,5}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:)))$/i,
  uuid: /^(?:urn:uuid:)?[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i,
  'json-pointer': /^(?:\/(?:[^~/]|~0|~1)*)*$/,
  'json-pointer-uri-fragment': /^#(?:\/(?:[a-z0-9_\-.!$&'()*+,;:=@]|%[0-9a-f]{2}|~0|~1)*)*$/i,
  'relative-json-pointer': /^(?:0|[1-9][0-9]*)(?:#|(?:\/(?:[^~/]|~0|~1)*)*)$/,
  byte: /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/,
  int32: { type: 'number', validate: (v) => Number.isInteger(v) && v <= 2147483647 && v >= -2147483648 },
  int64: { type: 'number', validate: (v) => Number.isInteger(v) },
  float: true,
  double: true,
  password: true,
  binary: true,
};

const UCS2LENGTH_INLINE = `function __ucs2length(str) {
  const len = str.length;
  let length = 0;
  let pos = 0;
  let value;
  while (pos < len) {
    length++;
    value = str.charCodeAt(pos++);
    if (value >= 0xd800 && value <= 0xdbff && pos < len) {
      value = str.charCodeAt(pos);
      if ((value & 0xfc00) === 0xdc00) pos++;
    }
  }
  return length;
}`;

const EQUAL_INLINE = `function __equal(a, b) {
  if (a === b) return true;
  if (a && b && typeof a == 'object' && typeof b == 'object') {
    if (a.constructor !== b.constructor) return false;
    let length, i, keys;
    if (Array.isArray(a)) {
      length = a.length;
      if (length != b.length) return false;
      for (i = length; i-- !== 0;)
        if (!__equal(a[i], b[i])) return false;
      return true;
    }
    keys = Object.keys(a);
    length = keys.length;
    if (length !== Object.keys(b).length) return false;
    for (i = length; i-- !== 0;)
      if (!Object.prototype.hasOwnProperty.call(b, keys[i])) return false;
    for (i = length; i-- !== 0;) {
      let key = keys[i];
      if (!__equal(a[key], b[key])) return false;
    }
    return true;
  }
  return a !== a && b !== b;
}`;

function postProcessGeneratedJs(rawJs) {
  let js = rawJs;

  // 1. Transform export syntax
  js = js.replace(
    /export const (\w+) = (\w+);/g,
    'export function $1(data, ...args) {\n  return $2(data, ...args);\n}',
  );

  let needsUcs2 = false;
  let needsEqual = false;

  // 2. Replace require("ajv/dist/runtime/ucs2length").default
  if (js.includes('require("ajv/dist/runtime/ucs2length")')) {
    needsUcs2 = true;
    js = js.replace(/const\s+(\w+)\s*=\s*require\("ajv\/dist\/runtime\/ucs2length"\)\.default;/g, 'const $1 = __ucs2length;');
  }

  // 3. Replace require("ajv/dist/runtime/equal").default
  if (js.includes('require("ajv/dist/runtime/equal")')) {
    needsEqual = true;
    js = js.replace(/const\s+(\w+)\s*=\s*require\("ajv\/dist\/runtime\/equal"\)\.default;/g, 'const $1 = __equal;');
  }

  // 4. Fallback for any stray require("ajv-formats/dist/formats")
  if (js.includes('require("ajv-formats/dist/formats")')) {
    for (const [fmtName, regex] of Object.entries(STANDALONE_FORMATS)) {
      if (regex instanceof RegExp) {
        const pattern = new RegExp(`const\\s+(\\w+)\\s*=\\s*require\\("ajv-formats/dist/formats"\\)\\.fullFormats(?:\\["${fmtName}"\\]|\\.${fmtName});`, 'g');
        js = js.replace(pattern, `const $1 = ${regex.toString()};`);
      }
    }
  }

  // Prepend inlined helpers if needed
  const helperDecls = [];
  if (needsUcs2) helperDecls.push(UCS2LENGTH_INLINE);
  if (needsEqual) helperDecls.push(EQUAL_INLINE);

  if (helperDecls.length > 0) {
    if (js.startsWith('"use strict";\n') || js.startsWith('"use strict";')) {
      js = js.replace(/^"use strict";(\n)?/, `"use strict";\n\n${helperDecls.join('\n\n')}\n\n`);
    } else {
      js = `${helperDecls.join('\n\n')}\n\n${js}`;
    }
  }

  return js;
}

async function verifyAll() {
  console.log('=== TEST 1: RFC 9457 Problem Details Standalone Guard ===');
  const outDir = await fs.mkdtemp(path.join(os.tmpdir(), 'verify-remediation-'));
  
  const rfc9457Doc = {
    openapi: '3.1.0',
    info: { title: 'Problem Details API', version: '1.0.0' },
    components: {
      schemas: {
        ProblemDetails: {
          type: 'object',
          required: ['type', 'title', 'status'],
          properties: {
            type: { type: 'string', format: 'uri' },
            title: { type: 'string', minLength: 1 },
            status: { type: 'integer', minimum: 100, maximum: 599 },
            detail: { type: 'string' },
            instance: { type: 'string', format: 'uri-reference' },
            timestamp: { type: 'string', format: 'date-time' },
            contact: { type: 'string', format: 'email' },
            invalidParams: {
              type: 'array',
              items: {
                type: 'object',
                required: ['name', 'reason'],
                properties: {
                  name: { type: 'string' },
                  reason: { type: 'string' },
                },
              },
              uniqueItems: true,
            },
          },
        },
      },
    },
  };

  // Compile with standalone Ajv
  const ajv = new AjvCtor({
    code: { source: true, esm: true },
    strict: false,
    allErrors: false,
  });
  for (const [k, v] of Object.entries(STANDALONE_FORMATS)) {
    ajv.addFormat(k, v);
  }

  const rootDoc = { ...rfc9457Doc, $id: 'urn:oa-sdk:root' };
  ajv.addSchema(rootDoc);
  ajv.addSchema({ $ref: 'urn:oa-sdk:root#/components/schemas/ProblemDetails' }, 'isProblemDetails');

  const rawJs = standaloneCodeFn(ajv, { isProblemDetails: 'isProblemDetails' });
  const processedJs = postProcessGeneratedJs(rawJs);

  const guardsDir = path.join(outDir, 'guards');
  await fs.mkdir(guardsDir, { recursive: true });
  await fs.writeFile(path.join(guardsDir, 'ProblemDetails.js'), processedJs, 'utf8');
  await fs.writeFile(path.join(outDir, 'index.js'), "export * from './guards/ProblemDetails.js';\n", 'utf8');
  await fs.writeFile(path.join(outDir, 'package.json'), JSON.stringify({ type: 'module' }, null, 2) + '\n', 'utf8');

  // CSP Audit test
  const auditRes = await auditCspBundle(outDir);
  console.log('CSP Audit Valid:', auditRes.valid);
  console.log('Violations:', auditRes.violations.length);
  if (!auditRes.valid) throw new Error('CSP Audit Failed');

  // Node Subprocess Execution Test (like R1-ADV-5)
  console.log('\n=== TEST 2: Node Subprocess Execution (Pure ESM Invariant) ===');
  const runnerCode = `
    import { isProblemDetails } from '${pathToFileURL(path.join(guardsDir, 'ProblemDetails.js')).href}';
    import * as Barrel from '${pathToFileURL(path.join(outDir, 'index.js')).href}';

    const validPayload = {
      type: 'https://tools.ietf.org/html/rfc9457#section-3.1',
      title: 'Validation Error',
      status: 422,
      detail: 'Name is required',
      instance: '/orders/12345',
      timestamp: '2026-09-03T07:35:46Z',
      contact: 'api-support@example.com',
      invalidParams: [
        { name: 'email', reason: 'Must be a valid email' },
        { name: 'age', reason: 'Must be >= 18' }
      ]
    };

    if (!isProblemDetails(validPayload)) {
      console.error('Failed valid problem details check');
      process.exit(1);
    }
    if (!Barrel.isProblemDetails(validPayload)) {
      console.error('Failed barrel problem details check');
      process.exit(2);
    }

    if (isProblemDetails({ ...validPayload, type: 'not a uri' })) {
      console.error('Failed invalid URI rejection');
      process.exit(3);
    }
    if (isProblemDetails({ ...validPayload, status: 99 })) {
      console.error('Failed status minimum rejection');
      process.exit(4);
    }
    if (isProblemDetails({ ...validPayload, invalidParams: [{ name: 'a', reason: 'b' }, { name: 'a', reason: 'b' }] })) {
      console.error('Failed duplicate items rejection');
      process.exit(5);
    }

    process.stdout.write('SUBPROCESS_PASS');
  `;
  const runnerPath = path.join(outDir, 'runner.mjs');
  await fs.writeFile(runnerPath, runnerCode, 'utf8');

  const { stdout } = await execFileAsync(process.execPath, [runnerPath]);
  console.log('Subprocess Output:', stdout);
  if (stdout !== 'SUBPROCESS_PASS') throw new Error('Subprocess test failed');

  console.log('\n✅ ALL REMEDIATION VERIFICATION CHECKS PASSED!');
}

verifyAll().catch(e => {
  console.error('Verification Error:', e);
  process.exit(1);
});
