import {readFile} from 'node:fs/promises';
import {D} from './cashflow.mjs';
export const ruleSet=JSON.parse(await readFile(new URL('../rules/boi329.json',import.meta.url),'utf8'));
export async function seedRules(db){await db.query('INSERT INTO regulatory_rule_set SELECT * FROM jsonb_populate_record(NULL::regulatory_rule_set,$1::jsonb) ON CONFLICT DO NOTHING',[JSON.stringify(ruleSet)])}
const money=x=>new D(x).toFixed(2),pct=(a,b)=>new D(b).gt(0)?new D(a).div(b).mul(100).toFixed(8):null;
export function assessRegulation(x,trackMetrics){
 const rules=ruleSet.rules,review=[],warnings=[],checks=[],incomeLines=[],commitmentLines=[];
 const check=(code,pass,actual,limit,section)=>checks.push({code,status:pass?'pass':'fail',actual,limit,section});
 const dateValid=x.valuationDate>=ruleSet.effective_from&&x.valuationDate<=ruleSet.verified_through;
 if(!dateValid)review.push('Rules have not been verified for this valuation date');
 const t=x.transaction;
 const standard=['purchase','non_purchase'].includes(t.purpose)&&t.inIsrael&&t.specialCases.length===0&&(t.propertyClass==='investment'||t.isIsraeliCitizen);
 if(!standard)review.push('This purpose, jurisdiction or special case requires a separate regulatory assessment');
 let recognized=new D(0);
 for(const item of x.income){
  let amount=new D(0),reason=item.reason;
  if(item.status==='requires_review')review.push('Income requires review: '+item.id);
  if(item.status==='included'){
   if(item.kind==='future_rent'&&t.propertyCountAfterTransaction<2){review.push('Future rent is outside the agreed product scope: '+item.id);reason='Excluded under product scope until reviewed';}
   else amount=new D(item.recognizedNet).div(item.frequency==='annual'?12:1);
  }
  recognized=recognized.plus(amount);incomeLines.push({id:item.id,recognizedMonthly:money(amount),status:item.status,reason});
 }
 let deductions=new D(0),retainedPayment=new D(0),retainedPrincipal=new D(0);
 for(const item of x.commitments){
  let treatment='excluded',reason='Does not meet the applicable inclusion rule';
  const repaid=item.disposition==='repaid'&&!!item.payoffEvidence;
  if(item.disposition==='repaid'&&!item.payoffEvidence)review.push('Payoff is not substantiated; commitment retained: '+item.id);
  if(repaid)reason='Payoff evidence supplied by caller';
  else{
   const longer=item.remainingMonths===null||item.remainingMonths>18;
   if(item.remainingMonths===null){review.push('Unknown remaining term; conservatively treated as more than 18 months: '+item.id)}
   if(item.kind==='same_property_mortgage'){
    retainedPrincipal=retainedPrincipal.plus(item.remainingPrincipal);
    if(longer){retainedPayment=retainedPayment.plus(item.payment);treatment='numerator';reason='Retained mortgage secured on the same property';}
   }else if((item.kind==='rent'&&!t.willResideInProperty)||(item.kind!=='rent'&&longer)){
    deductions=deductions.plus(item.payment);treatment='income_deduction';reason=item.kind==='rent'?'Rent when borrower will not reside in purchased property':'Commitment with more than 18 months remaining';
   }
  }
  commitmentLines.push({id:item.id,treatment,amount:money(item.payment),reason});
 }
 const principal=x.tracks.reduce((v,tr)=>v.plus(tr.simulation.loan.principal),new D(0));
 const variable=x.tracks.filter(tr=>['prime','variable_linked','variable_unlinked'].includes(tr.kind)).reduce((v,tr)=>v.plus(tr.simulation.loan.principal),new D(0));
 const newPayment=trackMetrics.reduce((v,tr)=>v.plus(tr.ptiPayment),new D(0));
 const disposable=recognized.minus(deductions),numerator=newPayment.plus(retainedPayment),secured=principal.plus(retainedPrincipal),property=new D(t.propertyValue);
 let limit=property.mul(rules.ltvPercent[t.propertyClass]).div(100);
 if(t.purpose==='non_purchase'){
  limit=property.mul('0.5');const concession=D.min(property.mul('0.7'),property.mul('0.5').plus('200000'));
  if(t.nonPurchaseConcessionEvidence)limit=concession;
  else if(secured.gt(limit)&&secured.lte(concession))review.push('Non-purchase LTV concession requires documented bank approval');
  if(principal.lte('120000'))review.push('Small non-purchase loan may qualify for an exception; manual applicability review required');
 }
 if(standard){
  check('VARIABLE_SHARE',variable.mul(100).lte(principal.mul(rules.variableShareMaxPercent)),pct(variable,principal),rules.variableShareMaxPercent,'329 §7');
  check('LTV',secured.lte(limit),money(secured),money(limit),'329 §§2,4,10a');
  if(disposable.gt(0))check('PTI',numerator.mul(100).lte(disposable.mul(rules.ptiMaxPercent)),pct(numerator,disposable),rules.ptiMaxPercent,'329 §5 / Appendix A');
  else review.push('No positive recognized disposable income');
  if(x.tracks.some(tr=>tr.kind==='other'))review.push('Other track requires a verified regulatory classification');
  check('TERM',x.tracks.every(tr=>tr.simulation.loan.termMonths<=rules.termMaxMonths),String(Math.max(...x.tracks.map(tr=>tr.simulation.loan.termMonths))),String(rules.termMaxMonths),'329 §8');
 }
 if(disposable.gt(0)&&numerator.mul(100).gt(disposable.mul(40)))warnings.push('PTI exceeds 40%; this is a capital-weight threshold, not an automatic additional prohibition');
 const conditionalException=t.purpose==='non_purchase'&&(principal.lte('120000')||(!t.nonPurchaseConcessionEvidence&&secured.gt(property.mul('.5'))&&secured.lte(D.min(property.mul('.7'),property.mul('.5').plus('200000')))));
 const violations=checks.filter(c=>c.status==='fail');
 const status=!dateValid||!standard||conditionalException?'requires_review':violations.length?'fails_baseline':review.length?'requires_review':'passes_baseline';
 return {ruleSetId:ruleSet.id,effectiveFrom:ruleSet.effective_from,verifiedThrough:ruleSet.verified_through,sourceUrl:ruleSet.source_url,sourceSha256:ruleSet.source_sha256,status,eligibleForAutomatedOptimization:status==='passes_baseline',bankApproval:false,checks,review,warnings,metrics:{newPrincipal:money(principal),retainedSecuredPrincipal:money(retainedPrincipal),ltvPercent:pct(secured,property),variableSharePercent:pct(variable,principal),recognizedMonthlyIncome:money(recognized),incomeDeductions:money(deductions),disposableIncome:money(disposable),newPtiPayment:money(newPayment),retainedSamePropertyPayment:money(retainedPayment),ptiNumerator:money(numerator),ptiPercent:pct(numerator,disposable)},incomeLines,commitmentLines};
}
