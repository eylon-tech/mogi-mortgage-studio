import {randomUUID} from 'node:crypto';
import {bundleInput} from './bundle-contracts.mjs';
import {simulate,D,irr,npv,ENGINE_VERSION} from './cashflow.mjs';
import {resolveLoan} from './service.mjs';
import {assessRegulation,seedRules} from './regulation.mjs';
import {hash} from './repository.mjs';
const sum=values=>values.reduce((v,x)=>v.plus(x),new D(0)),money=v=>new D(v).toFixed(2);
export function currentTermsLoan(loan){
 const {indexation,...rest}=loan;
 return {...rest,resets:[],prepayments:[],...(indexation?{indexation:{...indexation,levels:Array(loan.termMonths).fill(indexation.base),origin:'manual',description:'Constant index solely for current-terms comparison; not a CPI forecast'}}:{})};
}
function metrics(track,current){
 const loan=track.simulation.loan,grace=loan.grace.months;
 const balloon=['interest_only','capitalized_balloon'].includes(loan.amortization);
 return {id:track.id,currentPayment:current.rows[0].payment,ptiPayment:balloon?current.rows[0].interestAccrued:current.rows[grace].payment,ptiBasis:balloon?'monthly_interest':grace?'payment_after_grace':'initial_payment',paymentAfterGrace:grace?current.rows[grace].payment:null,maturityPayment:balloon?current.rows.at(-1).payment:null,termMonths:loan.termMonths};
}
function aggregate(x,results){
 const months=Math.max(...results.map(r=>r.rows.length));
 const columns=['opening','indexation','interestAccrued','capitalizedInterest','interestPaid','principalPaid','extraPrincipal','fee','payment','closing'];
 const rows=Array.from({length:months},(_,i)=>({month:i+1,...Object.fromEntries(columns.map(k=>[k,money(sum(results.map(r=>r.rows[i]?.[k]||'0')))]))}));
 const principal=sum(x.tracks.map(t=>t.simulation.loan.principal)),fee=sum(x.tracks.map(t=>t.simulation.loan.upfrontFee));
 const flows=[principal.minus(fee),...rows.map(r=>new D(r.payment).neg())];
 return {rows,summary:{principal:money(principal),months,firstPayment:rows[0].payment,peakPayment:money(D.max(...rows.map(r=>r.payment))),peakMonth:rows.reduce((best,r)=>new D(r.payment).gt(best.payment)?r:best,rows[0]).month,totalPaid:money(sum(rows.map(r=>r.payment)).plus(fee)),upfrontFees:money(fee),closingBalance:rows.at(-1).closing,npv:npv(flows,x.discountAnnualEffectivePercent).toFixed(2),...irr(flows)}};
}
export async function runBundle(db,request){
 const x=bundleInput.parse(request),tracks=[],evidence=[],resolved=[];
 for(const t of x.tracks){
  // Current repayment is computable independently of an unavailable future-data source.
  let current;try{current=simulate(currentTermsLoan(t.simulation.loan))}catch(e){e.statusCode=422;throw e}
  let scenario=null,missingReason=null;
  if(t.projection==='explicit_scenario'){
   try{
    const r=await resolveLoan(db,t.simulation);scenario=simulate(r.loan);resolved.push({trackId:t.id,loan:r.loan});
    evidence.push(...r.evidence.map(e=>({...e,trackId:t.id})));
   }catch(e){if(e.statusCode!==422)throw e;missingReason=e.message;}
  }else missingReason='Future path not supplied; current terms only';
  tracks.push({id:t.id,kind:t.kind,metrics:metrics(t,current),currentTerms:current,scenario,missingReason});
 }
 const current=aggregate(x,tracks.map(t=>t.currentTerms)),complete=tracks.every(t=>t.scenario),scenario=complete?aggregate(x,tracks.map(t=>t.scenario)):null;
 const assessment=assessRegulation(x,tracks.map(t=>t.metrics));
 const replay=x.tracks.some(t=>t.simulation.cbsRealizedIndex||t.simulation.loan.indexation?.origin==='historical_replay');
 const projected=x.tracks.some(t=>t.simulation.boi451Index||t.simulation.loan.indexation&&t.simulation.loan.indexation.origin!=='historical_replay'||t.simulation.loan.resets.length);
 const mode=complete?(replay?(projected?'mixed_replay_and_scenario':'historical_replay'):'explicit_scenario'):'incomplete';
 const result={engineVersion:ENGINE_VERSION,schemaVersion:'1',tracks,currentTerms:current,scenario,scenarioStatus:mode,completeScenario:complete,headline:{monthlyUnderCurrentTerms:current.summary.firstPayment,firstScenarioPayment:scenario?.summary.firstPayment||null,scenarioMaximum:scenario?.summary.peakPayment||null,maximumAtLeast10PercentAboveCurrent:scenario?new D(scenario.summary.peakPayment).gte(new D(current.summary.firstPayment).mul('1.1')):null,balloonMaturities:tracks.filter(t=>t.metrics.maturityPayment!==null).map(t=>({trackId:t.id,month:t.metrics.termMonths,underCurrentTerms:t.metrics.maturityPayment}))},regulation:assessment,dataEvidence:evidence,personalPricingEnabled:false,optimizationEnabled:false};
 const id=randomUUID(),input={request:x,resolvedScenarios:resolved};await seedRules(db);
 await db.transaction(async tx=>{
  await tx.query('INSERT INTO bundle_run(id,engine_version,rule_set_id,input_sha256,input,result) VALUES($1,$2,$3,$4,$5,$6)',[id,ENGINE_VERSION,assessment.ruleSetId,hash(input),JSON.stringify(input),JSON.stringify(result)]);
  for(const e of evidence)await tx.query('INSERT INTO bundle_evidence VALUES($1,$2,$3,$4)',[id,e.trackId,e.observationId,e.role]);
 });
 return {id,...result};
}
