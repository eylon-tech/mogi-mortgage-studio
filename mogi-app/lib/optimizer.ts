import {schedule} from './legacy-model';
import {affordability,caseErrors,makeTrack,ratePath,summarize,isVariable,isIndexed,type Case,type Track,type Forecast,type TrackKind,type Summary} from './model';
import {checkEligibility} from './eligibility';
export type Config={weights:[number,number,number];maxVariable:number;maxIndexed:number;maxYears:number;minYears:number;grid:number;maxPeak:number;strictBudget:boolean;maxPti:number;enabled:TrackKind[]};
export const defaultConfig:Config={weights:[45,30,25],maxVariable:66.66,maxIndexed:30,maxYears:30,minYears:15,grid:10,maxPeak:0,strictBudget:true,maxPti:40,enabled:['fixed','prime','variable','indexed','variableIndexed']};
export type Candidate={id:string;tracks:Track[];first:number;peak:number;total:number;risk:number;score:number;pti:number;linked:number;variable:number;pareto:boolean;pricingBasis?:string};
export type Optimization={candidates:Candidate[];tested:number;generated:number;feasible:number;screenedFeasible:number;verified:number;verificationRejected:number;rejected:Record<string,number>;errors:string[];nearest:Candidate|null;config:Config;scope:string};
export type PriceResolver=(tracks:Track[])=>{tracks:Track[];basis:string;error?:string};
export type SearchContext={baseTracks?:Track[];price?:PriceResolver};
export const mustKeep=(t:Track)=>Boolean(t.locked||t.existing||t.source==='offer'||(t.prepayAmount??0)>0||t.grace!=='none'||t.method!=='annuity');
export const economicKey=(tracks:Track[])=>JSON.stringify(tracks.map(({id,...t})=>t).sort((a,b)=>a.kind.localeCompare(b.kind)||a.months-b.months||a.amount-b.amount));
export function optimize(c:Case,cfg:Config,rates:Record<string,number>,f:Forecast,context:SearchContext={}):Optimization{
 const out:Optimization={candidates:[],tested:0,generated:0,feasible:0,screenedFeasible:0,verified:0,verificationRejected:0,rejected:{budget:0,peak:0,pti:0,regulation:0,pricing:0},errors:caseErrors(c),nearest:null,config:cfg,scope:''};
 const kinds:TrackKind[]=['fixed','prime','variable','indexed','variableIndexed'];
 if(!Number.isInteger(cfg.grid)||cfg.grid<5||cfg.grid>25)out.errors.push('רזולוציית החיפוש צריכה להיות בין 5 ל־25 אחוזים');
 if(cfg.weights.some(x=>!Number.isFinite(x)||x<0)||cfg.weights.reduce((s,x)=>s+x,0)<=0)out.errors.push('יש לבחור משקל חיובי אחד לפחות');
 if(!Number.isInteger(cfg.minYears)||!Number.isInteger(cfg.maxYears)||cfg.minYears<5||cfg.maxYears>30||cfg.maxYears<cfg.minYears)out.errors.push('טווח תקופות לא תקין');
 if(!Number.isFinite(cfg.maxVariable)||cfg.maxVariable<0||cfg.maxVariable>66.66||!Number.isFinite(cfg.maxIndexed)||cfg.maxIndexed<0||cfg.maxIndexed>100||!Number.isFinite(cfg.maxPti)||cfg.maxPti<=0||cfg.maxPti>50||!Number.isFinite(cfg.maxPeak)||cfg.maxPeak<0)out.errors.push('יש להשלים מגבלות מספריות תקינות');
 const locked=(context.baseTracks??[]).filter(mustKeep),remaining=c.loan-locked.reduce((s,t)=>s+t.amount,0);
 if(remaining<-.01)out.errors.push('סכומי המסלולים שנשמרים גבוהים מהבקשה');
 if(remaining>.01&&!cfg.enabled.some(k=>k==='fixed'||k==='indexed')&&!locked.some(t=>!isVariable(t.kind)))out.errors.push('נדרש מסלול בריבית קבועה');
 if(!context.price&&remaining>.01&&kinds.some(k=>cfg.enabled.includes(k)&&(!Number.isFinite(rates[k])||rates[k]<0||rates[k]>30)))out.errors.push('חסרה ריבית למסלול פעיל');
 if(out.errors.length)return out;
 const a=affordability(c),seen=new Set<string>(),all:Candidate[]=[];
 const profile=new Map<string,{rows:ReturnType<typeof schedule>;stress:ReturnType<typeof schedule>;current:number;pti:number;total:number;unit:boolean}>();
 const shock={...f,rateShock:2,shockMonth:13};
 function metrics(t:Track){const unit=!mustKeep(t),base=unit?{...t,amount:1}:t,key=economicKey([base]);let p=profile.get(key);if(!p){const rows=schedule(base,f,ratePath(base,f)),stress=schedule(base,shock,ratePath(base,shock)),flat=schedule(base,{...f,mode:'flat',rateShock:0});p={rows,stress,current:flat[0].regular,pti:base.method.startsWith('balloon')?base.amount*base.rate/1200:flat[base.grace!=='none'?base.graceMonths:0].regular,total:rows.reduce((s,r)=>s+r.payment,0),unit};profile.set(key,p);}return p;}
 let lowestFirst=Infinity;const nearSeeds:Candidate[]=[];
 function evaluate(input:Track[]){
  out.generated++;let tracks=input,basis='ריביות ייחוס / הנחות קבועות; ללא חיזוי אישי';
  const key=economicKey(input);if(seen.has(key))return;seen.add(key);out.tested++;
  if(context.price){const quote=context.price(input);if(quote.error){out.rejected.pricing++;return;}tracks=quote.tracks;basis=quote.basis;}
  const structural=checkEligibility(c,tracks,0,{maxVariable:cfg.maxVariable,maxIndexed:cfg.maxIndexed});if(!structural.valid){out.rejected.regulation++;return;}
  let first=0,total=c.fees,ptiPayment=0,peak=0,stressPeak=0;
  try{const profiles=tracks.map(metrics),n=Math.max(...tracks.map(t=>t.months));
   for(let i=0;i<tracks.length;i++){const p=profiles[i],factor=p.unit?tracks[i].amount:1;first+=factor*p.current;total+=factor*p.total;ptiPayment+=factor*p.pti;}
   for(let m=0;m<n;m++){let pay=0,stress=0;for(let i=0;i<tracks.length;i++){const p=profiles[i],factor=p.unit?tracks[i].amount:1;pay+=factor*(p.rows[m]?.regular??0);stress+=factor*(p.stress[m]?.regular??0);}peak=Math.max(peak,pay);stressPeak=Math.max(stressPeak,stress);}
  }catch{out.rejected.regulation++;return;}
  const checks=checkEligibility(c,tracks,ptiPayment,cfg,first,peak);
  const candidate:Candidate={id:key,tracks,first,peak,total,risk:Math.max(0,stressPeak-first),score:0,pti:(ptiPayment+a.sameProperty)/a.disposable*100,linked:checks.indexed,variable:checks.variable,pareto:false,pricingBasis:basis};
  if(first<lowestFirst){lowestFirst=first;out.nearest=candidate;}
  if(!checks.valid){if(nearSeeds.length<8||first<nearSeeds.at(-1)!.first){nearSeeds.push(candidate);nearSeeds.sort((a,b)=>a.first-b.first);nearSeeds.splice(8);}const bad=checks.rules.find(r=>r.status==='fail'||r.status==='unknown')!;out.rejected[bad.code==='P_BUDGET'?'budget':bad.code==='P_PEAK'?'peak':bad.code.includes('PTI')?'pti':'regulation']++;return;}
  all.push(candidate);
 }
 if(remaining<=.01)evaluate(locked);
 else {
  const years=Array.from({length:cfg.maxYears-cfg.minYears+1},(_,i)=>cfg.minYears+i),patterns:number[][]=[];
  for(const y of years){patterns.push(kinds.map(()=>y*12));if(y!==cfg.maxYears)patterns.push(kinds.map(k=>isVariable(k)?cfg.maxYears*12:y*12));}
  const shares:number[]=[];
  function enumerate(i:number,left:number){if(i===kinds.length-1){shares[i]=left;if(left>0&&!cfg.enabled.includes(kinds[i]))return;const variable=(locked.filter(t=>isVariable(t.kind)).reduce((s,t)=>s+t.amount,0)+remaining*shares.reduce((s,x,j)=>s+(isVariable(kinds[j])?x:0),0)/100)/c.loan*100;const indexed=(locked.filter(t=>isIndexed(t.kind)).reduce((s,t)=>s+t.amount,0)+remaining*shares.reduce((s,x,j)=>s+(isIndexed(kinds[j])?x:0),0)/100)/c.loan*100;if(variable>cfg.maxVariable+1e-8||indexed>cfg.maxIndexed+1e-8)return;for(const months of patterns)evaluate([...locked,...kinds.flatMap((k,j)=>shares[j]>0?[{...makeTrack(k,Math.round(remaining*shares[j])/100,rates[k]??0,months[j]),id:`search-${k}`}]:[])]);return;}
   if(!cfg.enabled.includes(kinds[i])){shares[i]=0;enumerate(i+1,left);return;}for(let s=0;s<=left;s+=cfg.grid){shares[i]=s;enumerate(i+1,left-s);}}
  enumerate(0,100);
  // Explore monthly terms around candidates from each financial objective.
  const seeds=[...new Map((['total','first','risk'] as const).flatMap(k=>[...(all.length?all:nearSeeds)].sort((a,b)=>a[k]-b[k]).slice(0,8)).map(x=>[x.id,x])).values()];
  for(const seed of seeds)for(let i=0;i<seed.tracks.length;i++){if(mustKeep(seed.tracks[i]))continue;for(let delta=-12;delta<=12;delta++){const months=seed.tracks[i].months+delta;if(months<cfg.minYears*12||months>cfg.maxYears*12)continue;evaluate(seed.tracks.map((t,j)=>i===j?{...t,months}:t));}}
 }
 // Fast linear screening is followed by exact agorot schedules for the shortlist.
 // This is a bounded search, not a claim that every screened point was verified.
 out.screenedFeasible=all.length;
 const score=(items:Candidate[])=>{const keys=['total','first','risk'] as const,min=keys.map(k=>items.reduce((v,x)=>Math.min(v,x[k]),Infinity)),max=keys.map(k=>items.reduce((v,x)=>Math.max(v,x[k]),-Infinity)),ws=cfg.weights.reduce((s,x)=>s+x,0);for(const x of items)x.score=100*(1-keys.reduce((s,k,i)=>s+cfg.weights[i]/ws*(x[k]-min[i])/(max[i]-min[i]||1),0));return items.sort((a,b)=>b.score-a.score||a.total-b.total||a.id.localeCompare(b.id))};
 score(all);
 const composition=(x:Candidate)=>JSON.stringify(kinds.map(k=>x.tracks.filter(t=>t.kind===k).reduce((s,t)=>s+t.amount,0)));
 const diverse=new Map<string,Candidate>();for(const x of all)if(!diverse.has(composition(x)))diverse.set(composition(x),x);
 const selected=[...new Map([...all.slice(0,36),...(['total','first','risk'] as const).flatMap(k=>[...all].sort((a,b)=>a[k]-b[k]).slice(0,12)),...diverse.values()].map(x=>[x.id,x])).values()].slice(0,120);
 const exact:Candidate[]=[];
 for(const x of selected){out.verified++;try{
  const s=summarize(x.tracks,f,c.fees,false),stress=summarize(x.tracks,shock,c.fees,false);
  if(!s.complete||!stress.complete)throw Error('Incomplete forecast');
  const checks=checkEligibility(c,x.tracks,s.ptiPayment,cfg,s.first,s.peak);
  if(!checks.valid)throw Error('Exact constraints failed');
  exact.push({...x,first:s.first,peak:s.peak,total:s.total,risk:Math.max(0,stress.peak-s.first),pti:checks.pti!,pareto:false});
 }catch{out.verificationRejected++;}}
 out.feasible=exact.length;
 out.scope=`${cfg.grid}% מהסכום הפנוי · טווח ${cfg.minYears}–${cfg.maxYears} שנים והעמקה חודשית · ${out.screenedFeasible} חלופות עברו סינון מקורב, ${out.verified} נבדקו בלוח מדויק ומתוכן ${exact.length} עמדו במגבלות · ${locked.length} מסלולים נשמרים · ${context.price?'תמחור מחדש לכל חבילה':'הנחות ריבית קבועות, ללא חיזוי אישי'}. הדירוג הוא בין החלופות שאומתו; אין הבטחה לאופטימום גלובלי.`;
 if(!exact.length){out.errors.push('לא נמצאה חלופה מאומתת שעומדת בכל המגבלות בחיפוש שנבדק');return out;}
 score(exact);
 const front:Candidate[]=[];for(const x of [...exact].sort((a,b)=>a.total-b.total||a.first-b.first||a.risk-b.risk)){if(front.some(y=>y.first<=x.first+.001&&y.risk<=x.risk+.001))continue;x.pareto=true;front.push(x);}
 out.candidates=exact;out.nearest=null;return out;
}
export function compareSummary(t:Track[],f:Forecast,fees=0):Summary{return summarize(t,f,fees)}
