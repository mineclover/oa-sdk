// A successful probe reproduces known defects; it is never a passing product test.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createToolContext, hydrateToolsFromOpenApi, registerToolsOnMcpUse, createUnifiedTableIR, createTableApplyTwoPhaseHandler, readTableFromFile, writeTableToFile, readZipBuffer, createZipBuffer } from '../../packages/tools/src/index.js'
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'oa-review-round2-'))
const results: Record<string, unknown> = {}
function spec() { return {
 openapi:'3.2.0',info:{title:'Round 2',version:'1'},
 'x-oa-sdk-reserved-interfaces':{interfaces:['session']},
 paths:{'/apply':{post:{operationId:'apply','x-oa-sdk-tool':{stage:'apply',cliGroup:'table',cliCommand:'apply',mcpToolName:'table_apply'},responses:{'200':{description:'ok'}}}}},
} }
try {
 let current = createUnifiedTableIR({adapterKind:'tabular-ops',headers:['A','B'],rows:[[0,0]]})
 let arrivals=0; let release!:()=>void
 const barrier=new Promise<void>(resolve=>{release=resolve})
 const handler = createTableApplyTwoPhaseHandler(async()=>{
  const before=structuredClone(current)
  if(++arrivals===2)release()
  await barrier
  return before
 }, table=>{current=table})
 const b=hydrateToolsFromOpenApi(spec(),{apply:handler},{stateDir:path.join(root,'stale')})
 const outcomes=await Promise.all([0,1].map(col=>b.tools[0]!.execute(createToolContext(),{projectId:'same',adapterKind:'tabular-ops',operations:[{op:'set-cell',row:0,col,value:1}]})))
 const cells=current.cells.map(c=>c.raw)
 assert.equal(outcomes.length,2);assert.notDeepEqual(cells,[1,1])
 results.stalePlan={expected:[1,1],actual:cells,reportedSuccess:outcomes.map(o=>o.passed!==false),snapshots:b.sessionStore.readSession('same').undoStack.length}

 let domain={value:0};let restores=0
 const u=hydrateToolsFromOpenApi(spec(),{apply:{
  plan:async()=>({value:1}),captureState:async()=>({...domain}),
  commit:async()=>{domain={value:1};return {...domain}},
  restoreState:async(_ctx,_projectId,state)=>{restores++;domain={value:Number(state.value)}},
 }},{stateDir:path.join(root,'undo')})
 const surface=registerToolsOnMcpUse({tool:()=>undefined},u)
 await surface.invokeTool('table_apply',{projectId:'p'})
 const undone=await surface.invokeTool('session_undo',{projectId:'p'})
 assert.equal(undone.structuredContent.undone,true)
 assert.equal(restores,0);assert.equal(domain.value,1)
 results.undo={reportedUndone:undone.structuredContent.undone,sessionValue:u.sessionStore.readSession('p').currentState.value,domainValue:domain.value,restoreCalls:restores}

 const csv=path.join(root,'quoted.csv')
 fs.writeFileSync(csv,'id,note\r\n1,"hello\r\nworld"\r\n')
 const parsed=readTableFromFile(csv)
 assert.equal(parsed.rowCount,2)
 results.multilineCsv={expectedRows:1,actualRows:parsed.rowCount,cells:parsed.cells.map(c=>c.raw)}

 const xlsx=path.join(root,'book.xlsx')
 writeTableToFile(createUnifiedTableIR({adapterKind:'calc',tableId:'Original',headers:['A','B'],rows:[[1,null]]}),xlsx)
 const entries=readZipBuffer(fs.readFileSync(xlsx))
 entries['xl/worksheets/sheet1.xml']=Buffer.from(entries['xl/worksheets/sheet1.xml']!.toString().replace('</worksheet>','<mergeCells count="1"><mergeCell ref="A2:B2"/></mergeCells><dataValidations count="1"><dataValidation type="whole" sqref="A2"><formula1>0</formula1></dataValidation></dataValidations></worksheet>'))
 fs.writeFileSync(xlsx,createZipBuffer(entries))
 const original=readTableFromFile(xlsx)
 writeTableToFile(original,xlsx)
 const written=readZipBuffer(fs.readFileSync(xlsx))['xl/worksheets/sheet1.xml']!.toString()
 assert(!written.includes('<mergeCells'))
 results.xlsxNoopLoss={originalMergedCells:true,afterMergedCells:written.includes('<mergeCells'),originalValidation:true,afterValidation:written.includes('<dataValidations'),sameDataFingerprint:readTableFromFile(xlsx).fingerprint===original.fingerprint}

 const reordered=readZipBuffer(fs.readFileSync(xlsx))
 const first=reordered['xl/worksheets/sheet1.xml']!.toString()
 reordered['xl/worksheets/sheet2.xml']=Buffer.from(first.replace('<v>1</v>','<v>999</v>'))
 reordered['xl/workbook.xml']=Buffer.from('<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Budget" sheetId="2" r:id="rId2"/><sheet name="Notes" sheetId="1" r:id="rId1"/></sheets></workbook>')
 reordered['xl/_rels/workbook.xml.rels']=Buffer.from('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/></Relationships>')
 reordered['[Content_Types].xml']=Buffer.from(reordered['[Content_Types].xml']!.toString().replace('</Types>','<Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>'))
 fs.writeFileSync(xlsx,createZipBuffer(reordered))
 const selected=readTableFromFile(xlsx,{tableIndex:0})
 assert.equal(selected.tableId,'Budget');assert.equal(selected.cells[0]!.raw,1)
 results.xlsxSelection={selectedName:selected.tableId,expectedValue:999,actualValue:selected.cells[0]!.raw,selectedEntry:selected.adapterMetadata?.sheetEntryPath,expectedEntry:'xl/worksheets/sheet2.xml'}
 const sources = ['packages/tools/src/table-ir.ts', 'packages/tools/src/table-file-io.ts', 'packages/tools/src/mcp-use.ts', 'packages/tools/src/cli-anything.ts', 'packages/tools/src/openapi-hydrator.ts', 'packages/tools/src/reserved-interfaces.ts', 'scripts/review-probes/tools-round2.ts']
 const artifact = {
  schemaVersion: 1, kind: 'defect-reproduction', recordedAt: new Date().toISOString(),
  warning: 'These observations reproduce defects and are excluded from test pass counts.',
  sourceHashes: Object.fromEntries(sources.map(file => [file, createHash('sha256').update(fs.readFileSync(file)).digest('hex')])),
  observations: results,
 }
 const output = process.argv[2]
 if (!output) throw new Error('Usage: node --import tsx scripts/review-probes/tools-round2.ts <output.json>')
 if (fs.existsSync(output)) throw new Error('Choose a new output path; reproduction snapshots are immutable')
 fs.writeFileSync(output,JSON.stringify(artifact,null,2)+'\n')
 console.log('Reproduced 5 defects; no product test passes counted. Evidence: '+output)
} finally { fs.rmSync(root,{recursive:true,force:true}) }
