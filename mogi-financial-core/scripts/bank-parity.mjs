import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {simulate,D} from '../src/cashflow.mjs';
const load=async name=>JSON.parse(await readFile('tests/fixtures/'+name+'.json','utf8'));
const source=await load('bank-calculator-findings'),wise=await load('wise-fixed-fixture'),jerusalem=await load('jerusalem-fixed-fixture');
const loan=JSON.parse(await readFile('examples/fixed.json','utf8')).loan,core=simulate(loan);
const d=x=>new D(String(x).replaceAll(',','').trim());
function compare(rows,columns){
 const monthly=rows.filter(row=>/^\d+$/.test(String(row[columns.month]).trim()));
 if(monthly.length!==300)throw Error('Expected exactly 300 captured rows');
 const metrics={};
 for(const [field,column] of Object.entries(columns).filter(([k])=>k!=='month')){
  const errors=monthly.map(row=>({month:Number(row[columns.month]),delta:new D(core.rows[Number(row[columns.month])-1][field]).minus(d(row[column]))}));
  const worst=errors.reduce((a,b)=>a.delta.abs().gte(b.delta.abs())?a:b);
  metrics[field]={maximumAbsoluteDifferenceIls:worst.delta.abs().toFixed(2),worstMonth:worst.month,meanAbsoluteDifferenceIls:errors.reduce((v,r)=>v.plus(r.delta.abs()),new D(0)).div(errors.length).toFixed(4)};
 }
 return {months:monthly.length,metrics};
}
const r=new D('0.045').div(12),unrounded=new D('1200000').mul(r).div(new D(1).minus(new D(1).plus(r).pow(-300)));
const findings={capturedAt:source.checkedAt,checkedAt:new Date().toISOString(),fixtureType:'Previously captured synthetic public-calculator scenarios; not customer approval documents',coreSummary:core.summary,unroundedMathematicalReference:{pmt:unrounded.toFixed(12),total:unrounded.mul(300).toFixed(12)},
 bankDisplayComparisons:source.directlyExercised.map(b=>({bank:b.bank,url:b.url,firstPaymentDifferenceIls:new D(core.summary.firstPayment).minus(b.firstPayment).toFixed(2),totalDifferenceIls:new D(core.summary.totalPaid).minus(b.total).toFixed(2),peakDifferenceIls:new D(core.summary.peakPayment).minus(b.peak).toFixed(2),sourceNotes:b.notes})),
 jerusalemRows:compare(jerusalem[0].slice(1),{month:0,opening:2,interestPaid:3,principalPaid:4,closing:5}),
 wiseRows:compare(wise.tables.at(-1).slice(1),{month:1,opening:2,principalPaid:3,interestPaid:4,payment:5}),
 status:'differences_measured_not_bank_certified',limitations:['Bank internal rounding/day-count conventions are not verified. Core rounds monthly monetary postings to agora.','Discount/Mercantile displayed peak differs despite fixed nominal input; cause remains unresolved.','No approved customer amortization document was provided. These fixtures do not train personal pricing.','Variable-rate Wise experiment remains unresolved; this comparison covers fixed unlinked only.'],
 fixtures:await Promise.all(['bank-calculator-findings','jerusalem-fixed-fixture','wise-fixed-fixture'].map(async n=>({file:'tests/fixtures/'+n+'.json',sha256:createHash('sha256').update(await readFile('tests/fixtures/'+n+'.json')).digest('hex')})))};
await writeFile('reports/bank-parity-v02.json',JSON.stringify(findings,null,2));console.log(JSON.stringify({banks:findings.bankDisplayComparisons,jerusalemRows:findings.jerusalemRows,wiseRows:findings.wiseRows},null,2));
