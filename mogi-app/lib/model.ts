import {D,amortize,irr,ENGINE_VERSION} from './financial-core/cashflow.mjs';
export {ENGINE_VERSION};
export const MODEL_VERSION='mogi-2.0.0';
export const TRACKS={fixed:'קבועה לא צמודה',prime:'פריים',variable:'משתנה לא צמודה',indexed:'קבועה צמודה',variableIndexed:'משתנה צמודה',eligibility:'זכאות',other:'אחר'} as const;
export type TrackKind=keyof typeof TRACKS;
export type Method='annuity'|'equal'|'balloonPartial'|'balloonFull';
export type Track={id:string;kind:TrackKind;amount:number;rate:number;months:number;method:Method;resetMonths:number;nextReset?:number;anchor?:number;anchorDate?:string;spread?:number;existing?:boolean;graceMonths:number;grace:'none'|'partial'|'full';source:'estimate'|'offer'|'manual';prepayMonth?:number;prepayAmount?:number;prepayFee?:number;locked?:boolean;prepayMode?:'payment'|'term'};
export type Curve={id:string;year:number;month:number;average:string;nominal:number[];real:number[];index:number[]};
export type Forecast={mode:'boi'|'flat'|'custom';curve:Curve;inflation:number;rateShock:number;shockMonth:number;rateDecimals?:number};
export type Income={id:string;label:string;declared:number;recognized:number;status:'verified'|'review'|'excluded'};
export type Debt={id:string;label:string;payment:number;remainingMonths:number|null;kind:'debt'|'rent'|'sameProperty'|'otherProperty'|'repaid';verifiedRepaid:boolean;balance?:number|null};
export type Case={name:string;purpose:'single'|'replacement'|'investment'|'unknown';property:number;loan:number;target:number;income:Income[];debts:Debt[];occupies:boolean;fees:number};
export type Row={month:number;opening:number;rate:number;indexation:number;interest:number;principal:number;regular:number;extra:number;fees:number;payment:number;balance:number};
export type Summary={rows:Row[];first:number;current:number;peak:number;peakMonth:number;maturity:number;total:number;interest:number;indexation:number;irr:number;ptiPayment:number;complete:boolean;warnings:string[]};
export const isIndexed=(k:TrackKind)=>['indexed','variableIndexed','eligibility'].includes(k);
export const isVariable=(k:TrackKind)=>['prime','variable','variableIndexed'].includes(k);
export const effectiveToNominal=(pct:number)=>1200*(Math.pow(1+pct/100,1/12)-1);
export const nominalToEffective=(pct:number)=>100*(Math.pow(1+pct/1200,12)-1);
export function payment(p:number,annualPct:number,n:number){if(n<=0)return p;const r=annualPct/1200;return Math.abs(r)<1e-12?p/n:p*r/-Math.expm1(-n*Math.log1p(r));}
export function forward(curve:number[],start:number,length:number){const end=start+length;if(end>curve.length||start<0||length<=0)throw Error('עקום התחזית קצר מתקופת העוגן המבוקשת');const a=start?Math.log1p(curve[start-1]/100)*start/12:0;const b=Math.log1p(curve[end-1]/100)*end/12;return 100*Math.expm1((b-a)*12/length);}
export function validateTrack(t:Track){const e:string[]=[];if(!(t.kind in TRACKS))e.push('סוג מסלול לא מוכר');if(!Number.isFinite(t.amount)||t.amount<=0)e.push('נדרש סכום חיובי');if(!Number.isFinite(t.rate)||t.rate<0||t.rate>30)e.push('נדרשת ריבית בין 0% ל־30%');if(!Number.isInteger(t.months)||t.months<1||t.months>360)e.push('נדרשת תקופה של 1–360 חודשים');if(!['annuity','equal','balloonPartial','balloonFull'].includes(t.method))e.push('נדרשת שיטת החזר');if(!Number.isInteger(t.graceMonths)||t.graceMonths<0||t.graceMonths>=t.months)e.push('הגרייס חייב להיות קצר מההלוואה');if(t.grace==='none'&&t.graceMonths!==0)e.push('ללא גרייס נדרשים אפס חודשי גרייס');if(t.grace!=='none'&&t.graceMonths<1)e.push('נדרש משך לגרייס');if(isVariable(t.kind)&&(!Number.isInteger(t.resetMonths)||t.resetMonths<1||t.resetMonths>120))e.push('נדרשת תדירות עדכון בחודשים');if(t.existing&&isVariable(t.kind)&&t.kind!=='prime'&&(!Number.isInteger(t.nextReset)||!t.nextReset||t.nextReset>t.resetMonths))e.push('בהלוואה קיימת נדרש מועד שינוי הריבית הבא');if(!Number.isFinite(t.prepayAmount??0)||!Number.isFinite(t.prepayFee??0)||(t.prepayAmount??0)<0||(t.prepayFee??0)<0)e.push('פירעון ועמלה אינם יכולים להיות שליליים');if([t.anchor,t.spread].some(v=>v!==undefined&&!Number.isFinite(v)))e.push('העוגן והמרווח חייבים להיות מספריים');if((t.prepayAmount??0)>0&&(!t.prepayMonth||t.prepayMonth<1||t.prepayMonth>t.months))e.push('נדרש חודש תקין לפירעון');return e;}
// All published cashflows are produced by the versioned Decimal core.
const pathCache=new WeakMap<Curve,Map<string,number[]>>();
export function ratePath(t:Track,f:Forecast){
 const key=JSON.stringify([t.kind,t.rate,t.months,t.resetMonths,t.nextReset,t.anchor,t.spread,f.mode,f.rateShock,f.shockMonth,f.rateDecimals]);
 let cache=pathCache.get(f.curve);if(!cache){cache=new Map();pathCache.set(f.curve,cache)}const saved=cache.get(key);if(saved)return saved;
 const result:number[]=[],v=t.kind==='prime'?1:t.resetMonths,first=t.kind==='prime'?1:(t.nextReset??v),curve=isIndexed(t.kind)?f.curve.real:f.curve.nominal;
 // BOI 451 spot and forward rates are effective annual; contracts here are nominal annual.
 const anchor=(start:number)=>effectiveToNominal(forward(curve,start,v));
 const inferred=isVariable(t.kind)&&f.mode==='boi'?t.rate-anchor(0):0;
 let rate=t.rate;
 for(let m=1;m<=t.months;m++){
  if(isVariable(t.kind)&&m>first&&(m-first-1)%v===0){
   rate=f.mode==='boi'?anchor(m-1)+(t.kind==='prime'?1.5:0)+(t.spread??(t.anchor!==undefined?t.rate-t.anchor:inferred-(t.kind==='prime'?1.5:0))):t.rate;
   if(m>=f.shockMonth)rate+=f.rateShock;
  }
  result.push(m>first&&f.rateDecimals!==undefined?Number(rate.toFixed(f.rateDecimals)):rate);
 }
 if(cache.size>512)cache.clear();cache.set(key,result);return result;
}
const decimal=(n:number)=>new D(n).toFixed(16).replace(/0+$/,'').replace(/\.$/,'');
export function toCoreInput(t:Track,f:Forecast){
 const errors=validateTrack(t);
 if(!Number.isFinite(f.inflation)||f.inflation<-5||f.inflation>20||!Number.isFinite(f.rateShock)||f.rateShock<-10||f.rateShock>20||!Number.isInteger(f.shockMonth)||f.shockMonth<1||f.shockMonth>360)errors.push('יש להשלים פרמטרים תקינים לתחזית');
 if(t.method.startsWith('balloon')&&t.grace!=='none')errors.push('שילוב גרייס ובלון דורש לוח חוזי נפרד');
 if(t.prepayMode==='term'&&(t.prepayAmount??0)>0&&t.method!=='annuity')errors.push('קיצור תקופה נתמך כרגע בשפיצר בלבד');
 if(errors.length)throw Error(errors.join(' · '));
 const path=ratePath(t,f);
 const levels=isIndexed(t.kind)?Array.from({length:t.months},(_,i)=>{const level=f.mode==='flat'?1:f.mode==='custom'?Math.pow(1+f.inflation/100,(i+1)/12):f.curve.index[i+1]/100;if(!Number.isFinite(level)||level<=0)throw Error('חסר ערך מדד בתחזית; אין השלמה אוטומטית');return decimal(level)}):undefined;
 return {schemaVersion:'1',currency:'ILS',principal:decimal(t.amount),termMonths:t.months,
  rate:{annualPercent:decimal(t.rate),convention:'nominal_annual',origin:t.source==='offer'?'contract':t.source==='manual'?'manual':'scenario',description:'Mogi: '+TRACKS[t.kind]},
  amortization:({annuity:'annuity',equal:'equal_principal',balloonPartial:'interest_only',balloonFull:'capitalized_balloon'} as const)[t.method],
  grace:{months:t.grace==='none'?0:t.graceMonths,mode:t.grace==='full'?'capitalize':'interest_only'},
  resets:path.flatMap((r,i)=>i&&r!==path[i-1]?[{month:i+1,annualPercent:decimal(r),description:'Contractual reset using explicit scenario'}]:[]),
  ...(levels?{indexation:{base:'1',levels,floor:'none',origin:'scenario',description:f.mode==='boi'?'BOI 451 '+f.curve.id:'Explicit '+f.mode+' scenario'}}:{}),
  prepayments:(t.prepayAmount??0)>0?[{month:t.prepayMonth,amount:decimal(t.prepayAmount!),fee:decimal(t.prepayFee??0),mode:t.prepayMode==='term'?'reduce_term':'recast_payment'}]:[],upfrontFee:'0',discountAnnualEffectivePercent:'0'};
}
const scheduleCache=new WeakMap<Curve,Map<string,Row[]>>();
export function schedule(t:Track,f:Forecast):Row[]{
 const {id,...financial}=t;const key=JSON.stringify([financial,f.mode,f.inflation,f.rateShock,f.shockMonth,f.rateDecimals]);let cache=scheduleCache.get(f.curve);if(!cache){cache=new Map();scheduleCache.set(f.curve,cache)}const cached=cache.get(key);if(cached)return cached;
 const result=amortize(toCoreInput(t,f));
 const rows=result.rows.map((r:any)=>{const balloon=t.method.startsWith('balloon')&&r.month===t.months?Number(r.principalPaid):0;return {month:r.month,opening:Number(r.opening),rate:Number(r.annualRatePercent),indexation:Number(r.indexation),interest:Number(r.interestAccrued),principal:Number(r.principalPaid)-balloon,regular:Number(new D(r.interestPaid).plus(r.principalPaid).minus(balloon)),extra:Number(new D(r.extraPrincipal).plus(balloon)),fees:Number(r.fee),payment:Number(r.payment),balance:Number(r.closing)}});
 if(cache.size>=256)cache.delete(cache.keys().next().value!);cache.set(key,rows);return rows;
}
export function cashflowIRR(principal:number,rows:Row[],fees=0){return Number(irr([new D(principal).minus(fees).toString(),...rows.map(r=>new D(r.payment).neg().toString())]).annualEffectivePercent)}
const sumMoney=(values:number[])=>Number(values.reduce((s,n)=>s.plus(n),new D(0)).toFixed(2));
export function summarize(tracks:Track[],f:Forecast,fees=0,includeIrr=true):Summary{
 if(!tracks.length)throw Error('יש להוסיף מסלול');
 const flat={...f,mode:'flat' as const,rateShock:0};
 const currents=tracks.map(t=>schedule(t,flat));let schedules:Row[][],forecastIssue='';
 try{schedules=tracks.map(t=>schedule(t,f))}catch(e){forecastIssue=e instanceof Error?e.message:'אין תחזית מלאה';schedules=currents;}
 const n=Math.max(...schedules.map(s=>s.length));
 const rows:Row[]=Array.from({length:n},(_,i)=>{const row:Row={month:i+1,opening:0,rate:0,indexation:0,interest:0,principal:0,regular:0,extra:0,fees:0,payment:0,balance:0};for(const k of ['opening','indexation','interest','principal','regular','extra','fees','payment','balance'] as const)row[k]=sumMoney(schedules.map(s=>s[i]?.[k]??0));return row});
 const peak=Math.max(...rows.map(r=>r.regular)),current=sumMoney(currents.map(r=>r[0].regular));
 const ptiPayment=sumMoney(tracks.map((t,i)=>t.method.startsWith('balloon')?t.amount*t.rate/1200:currents[i][t.grace!=='none'?t.graceMonths:0]?.regular??0));
 const warnings:string[]=[];
 if(forecastIssue)warnings.push(forecastIssue+'; מוצגים תנאים נוכחיים בלבד לכל התמהיל');
 if(peak>=current*1.1&&peak>current+1)warnings.push('ההחזר המרבי החזוי גבוה ב־10% לפחות מההחזר הנוכחי');
 if(tracks.some(t=>isVariable(t.kind)&&t.spread===undefined&&t.anchor===undefined))warnings.push('במסלול משתנה ללא עוגן חוזי, המרווח נאמד מול עקום התחזית');
 if(tracks.some(t=>t.source!=='offer'))warnings.push('התמהיל כולל ריביות שלא אושרו בהצעה אישית');
 if(tracks.some(t=>t.kind==='other'))warnings.push('מסלול אחר חושב בתנאים נוכחיים; התחזית לתמהיל אינה מלאה');
 if(tracks.some(t=>isIndexed(t.kind)))warnings.push('הצמדה ללא רצפת מדד בסיס; יש לאמת מול חוזה ההלוואה');
 const maturity=sumMoney(tracks.map((t,i)=>t.method.startsWith('balloon')?schedules[i].at(-1)?.extra??0:0));
 return {rows,first:current,current,peak,peakMonth:rows.find(r=>Math.abs(r.regular-peak)<.005)?.month??1,maturity,total:sumMoney([fees,...rows.map(r=>r.payment)]),interest:sumMoney(rows.map(r=>r.interest)),indexation:sumMoney(rows.map(r=>r.indexation)),irr:includeIrr?cashflowIRR(sumMoney(tracks.map(t=>t.amount)),rows,fees):NaN,ptiPayment,complete:!forecastIssue&&!tracks.some(t=>t.kind==='other'),warnings};
}
export function affordability(c:Case){const recognized=c.income.filter(i=>i.status==='verified').reduce((s,i)=>s+i.recognized,0);let commitments=0,sameProperty=0;const warnings:string[]=[];for(const d of c.debts){if(d.kind==='repaid'&&d.verifiedRepaid)continue;if(d.remainingMonths===null)warnings.push(`${d.label}: מועד הסיום חסר; ההתחייבות נכללה`);if(d.remainingMonths===null||d.remainingMonths>18||(d.kind==='rent'&&!c.occupies)){if(d.kind==='sameProperty')sameProperty+=d.payment;else commitments+=d.payment;}}if(c.income.some(i=>i.status==='review'))warnings.push('הכנסה שדורשת בדיקה לא נכללה בהכנסה המוכרת');return {recognized,commitments,disposable:recognized-commitments,sameProperty,securedBalance:c.debts.filter(d=>d.kind==='sameProperty').reduce((s,d)=>s+(d.balance??0),0),ltv:(c.loan+c.debts.filter(d=>d.kind==='sameProperty').reduce((s,d)=>s+(d.balance??0),0))/c.property,maxLtv:{single:.75,replacement:.70,investment:.50,unknown:0}[c.purpose],warnings};}
export function caseErrors(c:Case){const e:string[]=[];if(c.purpose==='unknown')e.push('יש להשלים את סוג הרכישה');if(c.debts.some(d=>d.kind==='sameProperty'&&(d.balance==null||!Number.isFinite(d.balance)||d.balance<0)))e.push('נדרשת יתרת החוב על אותו נכס לצורך מימון מצטבר');for(const k of ['property','loan','target'] as const)if(!Number.isFinite(c[k])||c[k]<=0)e.push('נדרשים סכום הלוואה, שווי נכס ויעד החזר חיוביים');if(!Number.isFinite(c.fees)||c.fees<0||c.fees>=c.loan)e.push('סכום עמלות לא תקין');if(c.income.some(i=>!Number.isFinite(i.recognized)||!Number.isFinite(i.declared)||i.recognized<0||i.declared<0||i.recognized>i.declared))e.push('הכנסה מוכרת אינה יכולה לעלות על ההכנסה המוצהרת');if(c.debts.some(d=>!Number.isFinite(d.payment)||d.payment<0||(d.remainingMonths!==null&&(!Number.isInteger(d.remainingMonths)||d.remainingMonths<0))))e.push('התחייבות לא תקינה');const a=affordability(c);if(!Number.isFinite(a.disposable)||a.disposable<=0)e.push('יש לאמת הכנסה פנויה חיובית');if(a.ltv>a.maxLtv+1e-9)e.push(`שיעור המימון חורג ממגבלת ${a.maxLtv*100}%`);return e;}
export const defaultCase:Case={name:'תיק לדוגמה',purpose:'single',property:2000000,loan:1200000,target:6500,occupies:true,fees:0,income:[{id:'salary',label:'שכר נטו — נתון לדוגמה',declared:26000,recognized:26000,status:'verified'}],debts:[{id:'car',label:'הלוואה — נתון לדוגמה',payment:1500,remainingMonths:36,kind:'debt',verifiedRepaid:false}]};
export const makeTrack=(kind:TrackKind,amount:number,rate:number,months=300):Track=>({id:crypto.randomUUID(),kind,amount,rate,months,method:'annuity',resetMonths:kind==='prime'?1:60,graceMonths:0,grace:'none',source:'estimate'});
