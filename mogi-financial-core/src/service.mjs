import {randomUUID} from 'node:crypto';
import {simulationRequest} from './contracts.mjs';
import {simulate,ENGINE_VERSION} from './cashflow.mjs';
import {realizedIndex} from './cpi.mjs';
import {observations,hash} from './repository.mjs';
export async function curve(db,{asOf,vintage,averaging}){
 const rows=await observations(db,{source:'boi_forecast451',asOf,from:vintage,to:vintage,limit:3000});
 const selected=rows.filter(r=>r.dimensions.averaging===averaging);
 const pick=kind=>selected.filter(r=>r.dimensions.curve===kind).sort((a,b)=>a.horizon_months-b.horizon_months);
 const nominal=pick('nominal'),real=pick('real'),index=pick('index');
 for(const [name,points,start] of [['nominal',nominal,1],['real',real,1],['index',index,0]]){
  if(points.length!==361-start||points.some((r,i)=>r.horizon_months!==i+start||r.status!=='present'))throw Object.assign(Error('Complete curve unavailable for this vintage, averaging and asOf: '+name),{statusCode:422});
 }
 return {asOf,vintage,averaging,valueClass:'market_model',availabilityPolicy:'captured_and_ingested_by_asOf',nominal,real,index};
}
export async function resolveLoan(db,request){
 const parsed=simulationRequest.parse(request);let loan=parsed.loan;const evidence=[];
 if(parsed.boi451Index){
  const selector=parsed.boi451Index, snapshot=await curve(db,selector),points=snapshot.index.slice(0,loan.termMonths+1);
  loan={...loan,indexation:{base:points[0].value,levels:points.slice(1).map(p=>p.value),floor:selector.indexFloor,origin:'scenario',description:`BOI 451 ${selector.vintage} ${selector.averaging}; published market model, not realized CPI`}};
  evidence.push(...points.map(p=>({observationId:p.id,documentId:p.document_id,sha256:p.sha256,role:'index_scenario'})));
 }
 if(parsed.cbsRealizedIndex){
  const snapshot=await realizedIndex(db,parsed.cbsRealizedIndex,loan.termMonths),points=snapshot.points;
  loan={...loan,indexation:{base:points[0].value,levels:points.slice(1).map(p=>p.value),floor:parsed.cbsRealizedIndex.indexFloor,origin:'historical_replay',description:`CBS observed reference-month CPI, common base ${snapshot.baseLabel}; retrospective replay, not a forecast`}};
  evidence.push(...points.map(p=>({observationId:p.id,documentId:p.document_id,sha256:p.sha256,role:'realized_cpi'})));
 }
 return {parsed,loan,evidence};
}
export async function runSimulation(db,request){
 const {parsed,loan,evidence}=await resolveLoan(db,request);
 let result;try{result=simulate(loan)}catch(e){e.statusCode=422;throw e}
 const id=randomUUID(),input={request:parsed,resolvedLoan:loan,evidence};
 result.dataEvidence=evidence;result.personalPricingEnabled=false;
 await db.transaction(async tx=>{
  await tx.query('INSERT INTO simulation_run(id,engine_version,input_sha256,input,result) VALUES($1,$2,$3,$4,$5)',[id,ENGINE_VERSION,hash(input),JSON.stringify(input),JSON.stringify(result)]);
  for(const e of evidence)await tx.query('INSERT INTO simulation_evidence VALUES($1,$2,$3)',[id,e.observationId,e.role]);
 });
 return {id,...result};
}
