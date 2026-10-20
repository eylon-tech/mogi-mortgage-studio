import ruleSet from './financial-core/boi329.json';
import {affordability,caseErrors,validateTrack,isVariable,isIndexed,type Case,type Track} from './model';

export const RULE_VERSION=ruleSet.id;
export const RULE_VERIFIED_THROUGH=ruleSet.verified_through;
export const RULE_SOURCE=ruleSet.source_url;
export type RuleResult={code:string;label:string;actual:number|null;limit:number|null;status:'pass'|'fail'|'unknown'|'warning';category:'regulation'|'input'|'preference'};
export type Limits={maxVariable?:number;maxIndexed?:number;maxPti?:number;strictBudget?:boolean;maxPeak?:number};
export function checkEligibility(c:Case,tracks:Track[],payment?:number,limits:Limits={},first?:number,peak?:number){
 const a=affordability(c),amount=tracks.reduce((s,t)=>s+t.amount,0),rules:RuleResult[]=[];
 const add=(code:string,label:string,actual:number|null,limit:number|null,status:RuleResult['status'],category:RuleResult['category']='regulation')=>rules.push({code,label,actual,limit,status,category});
 caseErrors(c).forEach((e,i)=>add('CASE_'+i,e,null,null,'fail','input'));
 tracks.forEach((t,i)=>validateTrack(t).forEach((e,j)=>add(`TRACK_${i}_${j}`,`${i+1}: ${e}`,null,null,'fail','input')));
 add('SUM','סכומי המסלולים תואמים לבקשה',amount,c.loan,Number.isFinite(amount)&&Math.abs(amount-c.loan)<.01?'pass':'fail','input');
 const variable=amount>0?100*tracks.filter(t=>isVariable(t.kind)).reduce((s,t)=>s+t.amount,0)/amount:NaN;
 const indexed=amount>0?100*tracks.filter(t=>isIndexed(t.kind)).reduce((s,t)=>s+t.amount,0)/amount:NaN;
 add('VARIABLE','עד 66.66% בריבית משתנה כולל פריים',Number.isFinite(variable)?variable:null,Number(ruleSet.rules.variableShareMaxPercent),Number.isFinite(variable)?variable<=Number(ruleSet.rules.variableShareMaxPercent)+1e-8?'pass':'fail':'unknown');
 if(tracks.some(t=>t.kind==='other'))add('UNKNOWN_TRACK','נדרש לזהות את סוג המסלול לפני בדיקה',null,null,'unknown','input');
 if(c.debts.some(d=>d.remainingMonths===null&&!(d.kind==='repaid'&&d.verifiedRepaid)))add('UNKNOWN_COMMITMENT_TERM','נדרש לאמת מועד סיום התחייבות; נכללה בחישוב השמרני',null,null,'unknown','input');
 const missing=c.debts.some(d=>d.kind==='sameProperty'&&(d.balance==null||!Number.isFinite(d.balance)));
 add('LTV','מימון כולל יתרות על אותו נכס',missing?null:a.ltv*100,a.maxLtv*100,missing||!a.maxLtv?'unknown':a.ltv<=a.maxLtv+1e-9?'pass':'fail');
 const pti=payment===undefined||a.disposable<=0?null:(payment+a.sameProperty)/a.disposable*100;
 add('PTI','יחס החזר רגולטורי עד 50%',pti,Number(ruleSet.rules.ptiMaxPercent),pti===null?'unknown':pti<=Number(ruleSet.rules.ptiMaxPercent)+1e-8?'pass':'fail');
 if(pti!==null&&pti>40&&pti<=50)add('PTI_RISK','מעל 40% חלה דרישת משקל סיכון מוגברת',pti,40,'warning');
 const term=Math.max(0,...tracks.map(t=>t.months));
 add('TERM','תקופה מרבית 360 חודשים',term,ruleSet.rules.termMaxMonths,tracks.length&&term<=ruleSet.rules.termMaxMonths?'pass':'fail');
 for(const [code,label,actual,limit] of [
  ['P_VARIABLE','תקרת משתנה שנבחרה',variable,limits.maxVariable],['P_INDEX','תקרת הצמדה שנבחרה',indexed,limits.maxIndexed],
  ['P_PTI','יחס ההחזר שנבחר',pti,limits.maxPti],['P_BUDGET','יעד ההחזר המחייב',first,limits.strictBudget?c.target:undefined],
  ['P_PEAK','תקרת ההחזר החזוי',peak,limits.maxPeak||undefined]
 ] as const){if(limit!==undefined&&actual!=null)add(code,label,actual,limit,actual<=limit+.00001?'pass':'fail','preference');}
 const errors=rules.filter(r=>r.status==='fail'||r.status==='unknown').map(r=>r.label+(r.actual!==null&&r.limit!==null?` (${r.actual.toFixed(2)} מול ${r.limit.toFixed(2)})`:''));
 return {rules,errors,valid:errors.length===0,variable,indexed,pti,version:RULE_VERSION,scope:'רכישה רגילה בישראל; חריגים ותוכניות מיוחדות דורשים בדיקה נפרדת'};
}
