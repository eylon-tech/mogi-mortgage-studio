import test from 'node:test';
import assert from 'node:assert/strict';
import {simulate,D,monthlyRate,annuity,npv,irr,forwardAnnualEffectivePercent} from '../src/cashflow.mjs';
const base={schemaVersion:'1',currency:'ILS',principal:'1200000.00',termMonths:300,rate:{annualPercent:'4.5',convention:'nominal_annual',origin:'manual',description:'Synthetic mathematical test'},amortization:'annuity'};
const close=(a,b,t='0.000001')=>assert.ok(new D(a).minus(b).abs().lte(t),`${a} != ${b}`);
function reconcile(s,p){
 let totalPrincipal=new D(0),index=new D(0),cap=new D(0);
 for(const [i,r] of s.rows.entries()){
  close(new D(r.opening).plus(r.indexation).plus(r.capitalizedInterest).minus(r.principalPaid).minus(r.extraPrincipal),r.closing,'0');
  close(new D(r.interestPaid).plus(r.principalPaid).plus(r.extraPrincipal).plus(r.fee),r.payment,'0');
  if(i)assert.equal(r.opening,s.rows[i-1].closing);
  totalPrincipal=totalPrincipal.plus(r.principalPaid).plus(r.extraPrincipal);index=index.plus(r.indexation);cap=cap.plus(r.capitalizedInterest);
 }
 close(totalPrincipal,new D(p).plus(index).plus(cap),'0');assert.equal(s.summary.closingBalance,'0.00');
}
test('Known fixed annuity: closed-form PMT and reconciled monthly agorot',()=>{
 close(annuity('1200000',monthlyRate('4.5'),300),'6669.9897355438682462450632445581959963060922777366', '1e-30');
 const s=simulate(base);assert.equal(s.rows[0].payment,'6669.99');assert.equal(s.rows[0].interestPaid,'4500.00');assert.equal(s.rows[0].principalPaid,'2169.99');
 close(s.summary.totalPaid,'2000996.9206631604738735189733674587988918276833210','2');reconcile(s,base.principal);
 close(s.summary.annualEffectivePercent,new D(1).plus(new D('0.045').div(12)).pow(12).minus(1).mul(100),'0.00001');
});
test('Zero interest divides principal and adjusts final cent',()=>{
 const s=simulate({...base,principal:'100.00',termMonths:3,rate:{...base.rate,annualPercent:'0'}});
 assert.deepEqual(s.rows.map(r=>r.payment),['33.33','33.33','33.34']);assert.equal(s.summary.totalPaid,'100.00');reconcile(s,'100');
});
test('Effective annual rate is converted, never divided by twelve',()=>{
 const effective=new D('1.00375').pow(12).minus(1).mul(100).toFixed(16);
 close(monthlyRate(effective,'effective_annual'),'0.00375','1e-18');
 assert.equal(simulate({...base,rate:{...base.rate,annualPercent:effective,convention:'effective_annual'}}).summary.totalPaid,simulate(base).summary.totalPaid);
});
test('Equal principal independent arithmetic reference',()=>{
 const s=simulate({...base,amortization:'equal_principal'});
 assert.equal(s.rows[0].payment,'8500.00');assert.equal(s.summary.totalPaid,'1877250.00');reconcile(s,base.principal);
});
test('Interest-only balloon pays principal at maturity',()=>{
 const s=simulate({...base,amortization:'interest_only'});assert.equal(s.rows[0].payment,'4500.00');assert.equal(s.rows.at(-1).payment,'1204500.00');assert.equal(s.summary.totalPaid,'2550000.00');reconcile(s,base.principal);
});
test('Capitalized balloon matches compound accumulation within monthly rounding bound',()=>{
 const s=simulate({...base,amortization:'capitalized_balloon'});assert.equal(s.rows[0].payment,'0.00');close(s.summary.totalPaid,new D('1200000').mul(new D('1.00375').pow(300)),'4');reconcile(s,base.principal);
});
test('Interest-only grace preserves principal and leaves amortization within original term',()=>{
 const s=simulate({...base,grace:{months:12,mode:'interest_only'}});assert.equal(s.rows[11].closing,'1200000.00');assert.equal(s.rows[11].payment,'4500.00');assert.ok(new D(s.rows[12].payment).gt('6669.99'));assert.equal(s.rows.length,300);reconcile(s,base.principal);
});
test('Capitalizing grace accrues interest before amortization',()=>{
 const s=simulate({...base,grace:{months:12,mode:'capitalize'}});assert.equal(s.rows[0].payment,'0.00');assert.equal(s.rows[0].closing,'1204500.00');assert.ok(new D(s.rows[12].payment).gt('6821'));reconcile(s,base.principal);
});
test('Reset applies on named month, including during grace',()=>{
 const loan={...base,principal:'12000',termMonths:12,amortization:'interest_only',resets:[{month:3,annualPercent:'6',description:'test reset'}]};const s=simulate(loan);
 assert.equal(s.rows[1].interestPaid,'45.00');assert.equal(s.rows[2].interestPaid,'60.00');reconcile(s,'12000');
 const g=simulate({...base,grace:{months:12,mode:'interest_only'},resets:loan.resets});assert.equal(g.rows[2].payment,'6000.00');
});
test('Index level is applied to opening principal before interest',()=>{
 const s=simulate({...base,principal:'1000',termMonths:2,rate:{...base.rate,annualPercent:'12'},amortization:'interest_only',indexation:{base:'100',levels:['110','110'],floor:'none',origin:'scenario',description:'test'}});
 assert.equal(s.rows[0].indexation,'100.00');assert.equal(s.rows[0].interestPaid,'11.00');assert.equal(s.rows[1].payment,'1111.00');reconcile(s,'1000');
});
test('Base floor is not a previous-month ratchet',()=>{
 const common={...base,principal:'1000',termMonths:3,rate:{...base.rate,annualPercent:'0'},amortization:'interest_only'};
 const s=simulate({...common,indexation:{base:'100',levels:['110','105','90'],floor:'base',origin:'scenario',description:'test'}});
 assert.equal(s.rows[1].closing,'1050.00');assert.equal(s.rows[2].payment,'1000.00');reconcile(s,'1000');
 const n=simulate({...common,indexation:{base:'100',levels:['110','105','90'],floor:'none',origin:'scenario',description:'test'}});assert.equal(n.rows[2].payment,'900.00');
});
test('Prepayment is after installment; recast begins next month',()=>{
 const s=simulate({...base,prepayments:[{month:60,amount:'100000',fee:'250',mode:'recast_payment'}]});
 assert.equal(s.rows[59].extraPrincipal,'100000.00');assert.equal(s.rows[59].fee,'250.00');assert.equal(s.rows[59].principalPaid,simulate(base).rows[59].principalPaid);assert.ok(new D(s.rows[60].payment).lt('6669.99'));reconcile(s,base.principal);
});
test('Term reduction retains payment and closes early',()=>{
 const s=simulate({...base,prepayments:[{month:60,amount:'100000',fee:'0',mode:'reduce_term'}]});assert.equal(s.rows[60].payment,'6669.99');assert.ok(s.rows.length<300);reconcile(s,base.principal);
});
test('Full prepayment caps at outstanding principal',()=>{
 const s=simulate({...base,prepayments:[{month:1,amount:'2000000',fee:'100',mode:'recast_payment'}]});assert.equal(s.rows.length,1);assert.equal(s.rows[0].extraPrincipal,'1197830.01');assert.equal(s.summary.totalPaid,'1204600.00');assert.ok(s.warnings.length);reconcile(s,base.principal);
});
test('NPV borrower sign and IRR independent one-period root',()=>{
 assert.equal(npv(['100','-110'],'0').toString(),'-10');close(irr(['100','-110']).monthly,'0.1','1e-18');close(irr(['100','-110']).annualEffectivePercent,new D('1.1').pow(12).minus(1).mul(100),'1e-10');assert.throws(()=>irr(['100','-200','110']));
});
test('Upfront fee changes net draw and raises effective borrowing cost',()=>{
 const a=simulate({...base,termMonths:12,principal:'12000'}),b=simulate({...base,termMonths:12,principal:'12000',upfrontFee:'100'});assert.ok(new D(b.summary.annualEffectivePercent).gt(a.summary.annualEffectivePercent));assert.equal(b.summary.totalFees,'100.00');
});
test('Forward curve: flat curve stays flat; missing or out-of-range fails',()=>{
 close(forwardAnnualEffectivePercent(Array(360).fill('4'),60,60),'4','1e-12');assert.throws(()=>forwardAnnualEffectivePercent(['4'],0,2));assert.throws(()=>forwardAnnualEffectivePercent([null],0,1));
});
test('Negative rates are supported under the stated monthly convention',()=>{
 const s=simulate({...base,termMonths:12,principal:'12000',rate:{...base.rate,annualPercent:'-1'}});assert.ok(new D(s.summary.totalPaid).lt('12000'));reconcile(s,'12000');
});
test('Ambiguous/missing inputs are rejected, including numeric JSON rates and incomplete paths',()=>{
 for(const patch of [{principal:'0'},{principal:'0.001'},{termMonths:0},{termMonths:361},{grace:{months:300,mode:'capitalize'}},{rate:{...base.rate,annualPercent:4.5}},{indexation:{base:'100',levels:['101'],floor:'none',origin:'scenario',description:'missing'}},{resets:[{month:1,annualPercent:'5',description:'invalid'}]},{prepayments:[{month:301,amount:'1',fee:'0',mode:'recast_payment'}]},{unexpected:1}])assert.throws(()=>simulate({...base,...patch}));
});
test('Deterministic mixed scenarios conserve every agora',()=>{
 for(let i=0;i<8;i++){
  const n=12+i,loan={...base,principal:String(30000+i*71),termMonths:n,rate:{...base.rate,annualPercent:String(i/2)},grace:{months:i%3,mode:i%2?'capitalize':'interest_only'},amortization:i%2?'annuity':'equal_principal',indexation:{base:'100',levels:Array.from({length:n},(_,m)=>new D(100).mul(new D('1.001').pow(m+1)).toFixed(10)),floor:'none',origin:'scenario',description:'Synthetic conservation case'},prepayments:[{month:6,amount:'500',fee:'30',mode:'recast_payment'}]};
  const a=simulate(loan);reconcile(a,loan.principal);assert.deepEqual(a,simulate(loan));
 }
});
