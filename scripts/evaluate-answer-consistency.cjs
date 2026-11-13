'use strict';
// Replay existing parsed answers only. No model, credentials or network imports.
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const Checker=require('../benchmark/answer-consistency.cjs');
const args=process.argv.slice(2), opts={};
for(let i=0;i<args.length;i+=2) {
  if(!['--report','--contexts','--out','--diagnostics'].includes(args[i])||!args[i+1])throw Error('Usage: --report REPORT.json --contexts frozen-contexts.json --out NEW-DIRECTORY [--diagnostics ANALYSIS.json]');
  opts[args[i].slice(2)]=path.resolve(args[i+1]);
}
for(const k of ['report','contexts','out'])if(!opts[k])throw Error('Missing --'+k);
if(fs.existsSync(opts.out))throw Error('Output directory must be new; frozen evidence cannot be overwritten');
for(const source of [opts.report,opts.contexts,opts.diagnostics].filter(Boolean)) {
  const rel=path.relative(path.dirname(source),opts.out);
  if(!rel.startsWith('..'+path.sep)&&rel!=='..'&&!path.isAbsolute(rel))throw Error('Output cannot be inside an input evidence directory');
}
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const report=read(opts.report), contexts=read(opts.contexts);
const protectedFiles=[...new Set([opts.report,opts.contexts,opts.diagnostics,...(report.sourceFiles||[]).map(x=>x.path)].filter(Boolean))];
const before=protectedFiles.map(p=>({path:p,sha256:hash(p)}));
for(const source of report.sourceFiles||[])if(hash(source.path)!==source.sha256)throw Error('Source hash mismatch: '+source.path);
const diagnostics=opts.diagnostics?new Set(read(opts.diagnostics).cases.map(c=>c.decisionId)):new Set();
const rows=[];
for(const p of report.points) {
  if(!p.parsedAnswer)continue;
  const input=contexts.inputs.find(x=>x.decisionId===p.decisionId);
  if(!input)throw Error('No frozen context for '+p.decisionId);
  const result=Checker.inspect(input.context,p.parsedAnswer);
  rows.push({id:p.id,decisionId:p.decisionId,passNumber:p.passNumber,originalQualityStatus:p.qualityStatus,inDiagnosticSubset:diagnostics.has(p.decisionId),result});
}
const summarize=xs=>({answers:xs.length,flaggedAnswers:xs.filter(x=>x.result.findings.length).length,findings:xs.reduce((n,x)=>n+x.result.findings.length,0),boundaryWarningAnswers:xs.filter(x=>x.result.boundaryWarnings.length).length,
  coverage:xs.reduce((o,x)=>{for(const [k,v]of Object.entries(x.result.coverage))o[k]=(o[k]||0)+v;return o;},{})});
const summary={version:Checker.VERSION,createdAt:new Date().toISOString(),all:summarize(rows),originalPassControls:summarize(rows.filter(x=>x.originalQualityStatus==='pass')),originalFail:summarize(rows.filter(x=>x.originalQualityStatus==='fail')),diagnosticBothFail:summarize(rows.filter(x=>x.inDiagnosticSubset)),
  implementation:[path.resolve(__dirname,'../benchmark/answer-consistency.cjs'),__filename].map(p=>({path:p,sha256:hash(p)})),
  flaggedControlAnswerIds:rows.filter(x=>x.originalQualityStatus==='pass'&&x.result.findings.length).map(x=>x.id),
  metricsBoundary:'Flagged fail answers are not error recall. Flags in previously passed answers require inspection, not automatic relabeling. Existing reviewer statuses are unchanged; this is development replay, not held-out validation.',
  automaticCorrectionEnabled:false,networkRequests:0,protectedSources:before.map(x=>({...x,unchanged:hash(x.path)===x.sha256}))};
if(summary.protectedSources.some(x=>!x.unchanged))throw Error('Source changed');
fs.mkdirSync(opts.out,{recursive:true});
fs.writeFileSync(path.join(opts.out,'RESULTS.json'),JSON.stringify({summary,rows},null,2)+'\n');
fs.writeFileSync(path.join(opts.out,'SUMMARY.json'),JSON.stringify(summary,null,2)+'\n');
console.log(JSON.stringify({out:opts.out,...Object.fromEntries(['all','originalPassControls','originalFail','diagnosticBothFail','flaggedControlAnswerIds'].map(k=>[k,summary[k]]))}));
