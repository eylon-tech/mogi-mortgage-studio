import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {openDatabase,migrate} from '../src/db.mjs';
import {runBundle} from '../src/bundle.mjs';
import {bundleInput} from '../src/bundle-contracts.mjs';
import {assessRegulation} from '../src/regulation.mjs';
import {ingest,observations} from '../src/repository.mjs';
import {runSimulation} from '../src/service.mjs';
import {D} from '../src/cashflow.mjs';
const base=JSON.parse(await readFile(new URL('../examples/fixed.json',import.meta.url)));
function request(){return {schemaVersion:'1',valuationDate:'2026-10-08',transaction:{purpose:'purchase',propertyClass:'single',propertyValue:'2000000',inIsrael:true,isIsraeliCitizen:true,willResideInProperty:true,propertyCountAfterTransaction:1},income:[{id:'salary',kind:'salary',declaredNet:'30000',recognizedNet:'30000',frequency:'monthly',status:'included',reason:'Synthetic test',evidenceReference:'synthetic:salary'}],tracks:[{id:'fixed',kind:'fixed_unlinked',projection:'explicit_scenario',simulation:structuredClone(base)}]}}
test('Multi-track cashflows, current terms and regulatory boundaries',async t=>{
 const db=await openDatabase({memory:true});await migrate(db);
 try{
 await t.test('Single-track bundle agrees with core and persists exact output',async()=>{const r=await runBundle(db,request());assert.equal(r.scenario.summary.totalPaid,'2000996.74');assert.equal(r.regulation.status,'passes_baseline');assert.equal(r.optimizationEnabled,false);assert.equal((await db.query('SELECT result FROM bundle_run WHERE id=$1',[r.id])).rows[0].result.scenario.summary.totalPaid,r.scenario.summary.totalPaid)});
 await t.test('Different maturities aggregate cashflows and close every balance',async()=>{const x=request();x.tracks[0].simulation.loan.principal='600000';x.tracks.push({...structuredClone(x.tracks[0]),id:'short',simulation:{loan:{...base.loan,principal:'200000',termMonths:120,rate:{...base.loan.rate,annualPercent:'3'}}}});const r=await runBundle(db,x);assert.equal(r.scenario.rows.length,300);assert.equal(r.scenario.summary.closingBalance,'0.00');for(const row of r.scenario.rows)assert.equal(new D(row.opening).plus(row.indexation).plus(row.capitalizedInterest).minus(row.principalPaid).minus(row.extraPrincipal).toFixed(2),row.closing);assert.notEqual(r.scenario.summary.annualEffectivePercent,r.tracks[0].scenario.summary.annualEffectivePercent)});
 await t.test('100% prime fails variable share even when affordability passes',async()=>{const x=request();x.tracks[0].kind='prime';x.tracks[0].projection='current_terms_only';const r=await runBundle(db,x);assert.equal(r.regulation.status,'fails_baseline');assert.equal(r.regulation.checks.find(c=>c.code==='VARIABLE_SHARE').status,'fail');assert.equal(r.scenario,null);assert.ok(r.currentTerms.summary.firstPayment)});
 await t.test('66.66 percent boundary is exact, not rounded up from two-thirds',()=>{const x=request();x.tracks[0].simulation.loan.principal='333400';x.tracks.push({...structuredClone(x.tracks[0]),id:'prime',kind:'prime',projection:'current_terms_only',simulation:{loan:{...base.loan,principal:'666600'}}});const assess=()=>assessRegulation(bundleInput.parse(x),[{ptiPayment:'5000'}]).checks.find(c=>c.code==='VARIABLE_SHARE').status;assert.equal(assess(),'pass');x.tracks[1].simulation.loan.principal='666601';assert.equal(assess(),'fail')});
 await t.test('Missing forecast retains current payment and no fake aggregate scenario',async()=>{const x=request();x.tracks[0].kind='fixed_linked';x.tracks[0].simulation.boi451Index={asOf:'2020-01-01T00:00:00Z',vintage:'2019-12-01',averaging:'calendar',indexFloor:'none'};const r=await runBundle(db,x);assert.equal(r.scenario,null);assert.ok(r.tracks[0].missingReason);assert.equal(r.headline.monthlyUnderCurrentTerms,'6669.99')});
 await t.test('Grace PTI uses post-grace payment',async()=>{const x=request();x.tracks[0].simulation.loan.grace={months:12,mode:'capitalize'};const r=await runBundle(db,x);assert.equal(r.headline.monthlyUnderCurrentTerms,'0.00');assert.ok(new D(r.regulation.metrics.newPtiPayment).gt(7000));assert.equal(r.tracks[0].metrics.ptiBasis,'payment_after_grace')});
 await t.test('Capitalized balloon exposes maturity and accrued interest for PTI',async()=>{const x=request();x.tracks[0].simulation.loan.amortization='capitalized_balloon';const r=await runBundle(db,x);assert.equal(r.regulation.metrics.newPtiPayment,'4500.00');assert.equal(r.headline.balloonMaturities.length,1);assert.ok(new D(r.headline.balloonMaturities[0].underCurrentTerms).gt('1200000'))});
 await t.test('Same-property debt is not also deducted from income; 18-month boundary',()=>{const x=request();x.commitments=[{id:'same',kind:'same_property_mortgage',payment:'2000',remainingMonths:19,remainingPrincipal:'100000',disposition:'retained'},{id:'other',kind:'other_loan',payment:'1000',remainingMonths:18,disposition:'retained'}];let r=assessRegulation(bundleInput.parse(x),[{ptiPayment:'5000'}]);assert.equal(r.metrics.incomeDeductions,'0.00');assert.equal(r.metrics.ptiNumerator,'7000.00');assert.equal(r.metrics.retainedSecuredPrincipal,'100000.00');x.commitments[1].remainingMonths=19;r=assessRegulation(bundleInput.parse(x),[{ptiPayment:'5000'}]);assert.equal(r.metrics.incomeDeductions,'1000.00')});
 await t.test('Unknown term, unsupported dates and exceptions require review',()=>{for(const change of [x=>x.valuationDate='2020-01-01',x=>x.transaction.purpose='bridge',x=>x.commitments=[{id:'unknown',kind:'other_loan',payment:'100',remainingMonths:null,disposition:'retained'}]]){const x=request();change(x);assert.equal(assessRegulation(bundleInput.parse(x),[{ptiPayment:'5000'}]).status,'requires_review')}});
 await t.test('Variable future paths need all contractual reset dates',()=>{const x=request();x.tracks[0].kind='variable_unlinked';assert.throws(()=>bundleInput.parse(x));x.tracks[0].resetPolicy={firstResetMonth:61,intervalMonths:60};assert.throws(()=>bundleInput.parse(x));x.tracks[0].simulation.loan.resets=[61,121,181,241].map(month=>({month,annualPercent:'5',description:'Explicit test scenario'}));assert.ok(bundleInput.parse(x))});
 }finally{await db.close()}
});

test('Actual CPI replay across rebasing pins evidence and forbids earlier availability',async()=>{
 const db=await openDatabase({memory:true});await migrate(db);
 try{
 const b=JSON.parse(await readFile(new URL('../data/normalized/cbs_cpi.json',import.meta.url)));const sid=b.series.find(s=>s.dimensions.base_label==='1951 ספטמבר').id;
 b.observations=b.observations.filter(o=>o.series_id===sid&&o.period>='2024-12-01'&&o.period<='2025-02-01');await ingest(db,b);
 const loan={...base.loan,termMonths:2};const selector={asOf:new Date().toISOString(),baseObservationPeriod:'2024-12-01',firstObservationPeriod:'2025-01-01',indexFloor:'none'};
 const result=await runSimulation(db,{loan,cbsRealizedIndex:selector});assert.equal(result.dataEvidence.length,3);assert.equal(result.inputDeclaration.indexOrigin,'historical_replay');assert.equal(result.summary.closingBalance,'0.00');
 await assert.rejects(runSimulation(db,{loan,cbsRealizedIndex:{...selector,asOf:'2025-03-01T00:00:00Z'}}),/unavailable/);
 await assert.rejects(runSimulation(db,{loan:{...loan,termMonths:3},cbsRealizedIndex:selector}),/unavailable/);
 }finally{await db.close()}
});

test('Rolling Equator release retains older months outside window, never missing cells within it',async()=>{
 const db=await openDatabase({memory:true});await migrate(db);
 try{
 const original=JSON.parse(await readFile(new URL('../data/normalized/boi_equator.json',import.meta.url)));const series=original.series.slice(0,2);const ids=new Set(series.map(s=>s.id));
 const b=structuredClone(original);b.series=series;b.observations=b.observations.filter(o=>ids.has(o.series_id)&&o.period<='2024-10-01');b.source.fetchedAt='2025-01-01T00:00:00Z';b.issues=[];await ingest(db,b);
 const newer=structuredClone(b);newer.source.fetchedAt='2026-01-01T00:00:00Z';newer.observations=newer.observations.filter(o=>o.period>='2024-09-01'&&!(o.series_id===series[0].id&&o.period==='2024-09-01'));await ingest(db,newer);
 const result=await observations(db,{source:'boi_equator',asOf:new Date().toISOString()});assert.equal(result.filter(o=>o.period==='2024-08-01').length,2);assert.equal(result.filter(o=>o.period==='2024-09-01').length,1);assert.equal(result.filter(o=>o.period==='2024-10-01').length,2);
 }finally{await db.close()}
});
