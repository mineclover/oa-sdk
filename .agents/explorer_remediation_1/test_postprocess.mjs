import Ajv2020 from '../../packages/codegen/node_modules/ajv/dist/2020.js';
import standaloneCode from '../../packages/codegen/node_modules/ajv/dist/standalone/index.js';
import ts from '../../packages/codegen/node_modules/typescript/lib/typescript.js';
import { auditCspSourceSync } from '../../packages/codegen/src/cli/commands/audit-csp.ts';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { pathToFileURL } from 'node:url';

const AjvCtor = Ajv2020.default ?? Ajv2020;
const standaloneCodeFn = standaloneCode.default ?? standaloneCode;

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

export function postProcessGeneratedJs(rawJs) {
  let js = rawJs;

  // 1. Transform export syntax to standard function
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

async function run() {
  const ajv = new AjvCtor({
    code: { source: true, esm: true },
    strict: false,
    allErrors: false,
  });
  for (const [k, v] of Object.entries(STANDALONE_FORMATS)) {
    ajv.addFormat(k, v);
  }

  const complexSchema = {
    $id: 'urn:test:problem-details',
    type: 'object',
    required: ['type', 'title', 'status'],
    properties: {
      type: { type: 'string', format: 'uri' },
      title: { type: 'string', minLength: 3, maxLength: 50 },
      status: { type: 'integer' },
      detail: { type: 'string' },
      instance: { type: 'string', format: 'uri-reference' },
      timestamp: { type: 'string', format: 'date-time' },
      contact: { type: 'string', format: 'email' },
      id: { type: 'string', format: 'uuid' },
      tags: { type: 'array', items: { type: 'object', properties: { k: { type: 'string' } } }, uniqueItems: true },
    },
  };

  ajv.addSchema(complexSchema, 'isProblemDetails');
  const raw = standaloneCodeFn(ajv, { isProblemDetails: 'isProblemDetails' });
  const processed = postProcessGeneratedJs(raw);

  // Write to temp file and dynamically import
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'test-postprocess-'));
  const jsPath = path.join(tmpDir, 'ProblemDetails.js');
  await fs.writeFile(jsPath, processed, 'utf8');
  await fs.writeFile(path.join(tmpDir, 'package.json'), JSON.stringify({ type: 'module' }), 'utf8');

  const mod = await import(pathToFileURL(jsPath).href);

  // Valid payload
  const valid = {
    type: 'https://api.example.com/errors/invalid-request',
    title: 'Invalid Request',
    status: 400,
    detail: 'Field username is required',
    instance: '/requests/req_12345',
    timestamp: '2026-09-03T07:35:46.000Z',
    contact: 'support@example.com',
    id: '123e4567-e89b-12d3-a456-426614174000',
    tags: [{ k: 'auth' }, { k: 'client' }],
  };
  console.log('Valid ProblemDetails test:', mod.isProblemDetails(valid) === true ? 'PASS' : 'FAIL');

  // Invalid URI
  console.log('Invalid URI test:', mod.isProblemDetails({ ...valid, type: 'not a uri' }) === false ? 'PASS' : 'FAIL');

  // Invalid date-time
  console.log('Invalid date-time test:', mod.isProblemDetails({ ...valid, timestamp: 'invalid-date' }) === false ? 'PASS' : 'FAIL');

  // Invalid email
  console.log('Invalid email test:', mod.isProblemDetails({ ...valid, contact: 'invalid-email' }) === false ? 'PASS' : 'FAIL');

  // Invalid UUID
  console.log('Invalid UUID test:', mod.isProblemDetails({ ...valid, id: 'bad-uuid' }) === false ? 'PASS' : 'FAIL');

  // Invalid minLength
  console.log('Invalid minLength test:', mod.isProblemDetails({ ...valid, title: 'ab' }) === false ? 'PASS' : 'FAIL');

  // Invalid duplicate tags (uniqueItems)
  console.log('Invalid uniqueItems test:', mod.isProblemDetails({ ...valid, tags: [{ k: 'auth' }, { k: 'auth' }] }) === false ? 'PASS' : 'FAIL');
}

run();
