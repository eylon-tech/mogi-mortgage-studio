import {observations} from './repository.mjs';
import {D} from './cashflow.mjs';
export function shiftMonth(period,delta){const [year,month]=period.split('-').map(Number);const date=new Date(Date.UTC(year,month-1+delta,1));return date.toISOString().slice(0,10)}
export async function realizedIndex(db,selector,months){
 const series=(await db.query("SELECT id FROM series WHERE source_id='cbs_cpi' AND dimensions->>'measure'='level' AND dimensions->>'base_label'=$1",[selector.baseLabel])).rows;
 if(series.length!==1)throw Object.assign(Error('CBS index base unavailable'),{statusCode:422});
 const end=shiftMonth(selector.firstObservationPeriod,months-1);
 const rows=await observations(db,{series:series[0].id,asOf:selector.asOf,from:selector.baseObservationPeriod,to:end,limit:2000});
 const map=new Map(rows.map(r=>[r.period,r]));
 const periods=[selector.baseObservationPeriod,...Array.from({length:months},(_,i)=>shiftMonth(selector.firstObservationPeriod,i))];
 const points=periods.map(p=>map.get(p));
 if(points.some(r=>!r||r.status!=='present'||!new D(r.value).gt(0)))throw Object.assign(Error('Complete observed CPI path unavailable; no interpolation or forecast substitution'),{statusCode:422});
 return {mode:'historical_replay',baseLabel:selector.baseLabel,asOf:selector.asOf,publicationDatesVerified:false,referencePeriodsExplicit:true,points};
}
