import research from './data/core-research.json';
import {effectiveToNominal} from './model';
export {research};
export type ResearchScenario={resultSha256:string;datasetSha256:string;horizon:number;baseRates:Record<string,number>};
export function applyResearchScenario(baseRates:Record<string,number>,horizon:number){
 if(![1,3,6].includes(horizon))throw Error('טווח מחקר לא מוכר');
 const rates={...baseRates};
 for(const item of research.forecasts.filter(x=>x.horizon===horizon)){
  const base=rates[item.track];if(!Number.isFinite(base))throw Error('נדרשת ריבית ייחוס לקבועה צמודה ולקבועה לא צמודה');
  rates[item.track]=base+effectiveToNominal(item.prediction)-effectiveToNominal(item.baseline);
  if(rates[item.track]<0||rates[item.track]>30)throw Error('תרחיש המחקר יצר ריבית מחוץ לטווח המותר');
 }
 return {rates,scenario:{resultSha256:research.resultSha256,datasetSha256:research.datasetSha256,horizon,baseRates:{...baseRates}} as ResearchScenario};
}
export function verifyResearchScenario(s:ResearchScenario,rates:Record<string,number>){
 if(s.resultSha256!==research.resultSha256||s.datasetSha256!==research.datasetSha256)throw Error('גרסת המחקר אינה תואמת לגרסה המותקנת');
 const expected=applyResearchScenario(s.baseRates,s.horizon).rates;
 if(Object.keys(expected).length!==Object.keys(rates).length||Object.entries(expected).some(([k,v])=>!Number.isFinite(rates[k])||Math.abs(v-rates[k])>1e-9))throw Error('ריביות התרחיש שונו; יש לסמן אותן כהנחות ידניות');
 return true;
}
