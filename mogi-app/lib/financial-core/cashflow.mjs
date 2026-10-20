import Decimal from 'decimal.js';
import {simulationInput} from './contracts.mjs';
export const D=Decimal.clone({precision:40,rounding:Decimal.ROUND_HALF_UP});
const zero=()=>new D(0),money=x=>new D(x).toDecimalPlaces(2),fmt=x=>new D(x).toFixed(2),sum=xs=>xs.reduce((a,b)=>a.plus(b),zero());
export const ENGINE_VERSION='mogi-cashflow-0.2.1';
export function monthlyRate(percent,convention='nominal_annual'){
 const annual=new D(percent).div(100);
 return convention==='nominal_annual'?annual.div(12):annual.plus(1).pow(new D(1).div(12)).minus(1);
}
export function annuity(principal,r,months){
 const p=new D(principal);if(r.isZero())return p.div(months);
 return p.mul(r).div(new D(1).minus(r.plus(1).pow(-months)));
}
export function npv(cashflows,annualEffectivePercent){
 const r=monthlyRate(annualEffectivePercent,'effective_annual');
 return sum(cashflows.map((c,i)=>new D(c).div(r.plus(1).pow(i))));
}
// Borrower convention: positive draw at t0 and nonpositive monthly outflows.
// Monotonic with exactly one sign change; reject ambiguous cashflows rather than guess an IRR.
export function irr(cashflows){
 const c=cashflows.map(x=>new D(x));
 if(c.length<2||!c[0].gt(0)||c.slice(1).some(x=>x.gt(0))||!c.slice(1).some(x=>x.lt(0)))throw Error('IRR requires one positive draw followed by nonpositive payments');
 const f=r=>{const growth=new D(1).plus(r);let value=c.at(-1);for(let i=c.length-2;i>=0;i--)value=value.div(growth).plus(c[i]);return value;};
 let lo=new D('-0.9999'),hi=new D(1);
 while(f(hi).lt(0)&&hi.lt('1000000'))hi=hi.mul(2);
 if(f(lo).gt(0)||f(hi).lt(0))throw Error('IRR root could not be bracketed');
 for(let i=0;i<160;i++){
  const mid=lo.plus(hi).div(2);if(f(mid).gt(0))hi=mid;else lo=mid;
  if(hi.minus(lo).lt('1e-24'))break;
 }
 const monthly=lo.plus(hi).div(2);return {monthly:monthly.toFixed(20),annualEffectivePercent:monthly.plus(1).pow(12).minus(1).mul(100).toFixed(12)};
}
export function forwardAnnualEffectivePercent(spotPercent,startMonth,lengthMonths){
 if(!Number.isInteger(startMonth)||startMonth<0||!Number.isInteger(lengthMonths)||lengthMonths<1)throw Error('Invalid forward interval');
 const end=startMonth+lengthMonths;
 if(end>spotPercent.length)throw Error('Forward interval exceeds observed curve; extrapolation disabled');
 const endpoint=m=>{const p=spotPercent[m-1];if(p==null||!new D(p).gt(-100))throw Error('Missing or invalid curve point');return new D(p).div(100).plus(1).pow(new D(m).div(12))};
 const ratio=endpoint(end).div(startMonth?endpoint(startMonth):1);
 return ratio.pow(new D(12).div(lengthMonths)).minus(1).mul(100).toFixed(16);
}
export function amortize(input){
 const x=simulationInput.parse(input);
 if(money(x.principal).isZero() || !money(x.principal).eq(x.principal))throw Error('Principal must be positive and denominated in whole agorot');
 for(const p of x.prepayments)if(!money(p.amount).eq(p.amount)||!money(p.fee).eq(p.fee))throw Error('Prepayment amounts and fees must be whole agorot');
 if(!money(x.upfrontFee).eq(x.upfrontFee))throw Error('Fee must be whole agorot');
 let balance=money(x.principal),rate=monthlyRate(x.rate.annualPercent,x.rate.convention),annual=x.rate.annualPercent;
 let planned=zero(),principalStep=zero(),previousIndex=new D(x.indexation?.base||1),recast=true;
 const baseIndex=previousIndex,resets=new Map(x.resets.map(e=>[e.month,e])),extras=new Map(x.prepayments.map(e=>[e.month,e]));
 const rows=[],warnings=[];
 for(let m=1;m<=x.termMonths&&balance.gt(0);m++){
  const opening=balance,remaining=x.termMonths-m+1,reset=resets.get(m);
  if(reset){annual=reset.annualPercent;rate=monthlyRate(annual,x.rate.convention);recast=true;}
  let level=x.indexation?new D(x.indexation.levels[m-1]):new D(1);
  if(x.indexation?.floor==='base')level=D.max(level,baseIndex);
  const ratio=level.div(previousIndex),indexation=money(balance.mul(ratio.minus(1)));
  balance=balance.plus(indexation);
  if(balance.lte(0))throw Error('Indexation leaves less than one agora of principal');
  const inGrace=m<=x.grace.months;
  if(m===x.grace.months+1)recast=true;
  if(!inGrace){
   if(recast){planned=money(annuity(balance,rate,remaining));principalStep=money(balance.div(remaining));recast=false;}
   else {planned=money(planned.mul(ratio));principalStep=money(principalStep.mul(ratio));}
  }
  const interest=money(balance.mul(rate));
  const capitalize=(inGrace&&x.grace.mode==='capitalize')||x.amortization==='capitalized_balloon';
  const capitalizedInterest=capitalize?interest:zero(),interestPaid=capitalize?zero():interest;
  balance=balance.plus(capitalizedInterest);
  let principalPaid=zero();
  if(!inGrace){
   if(x.amortization==='annuity')principalPaid=planned.minus(interestPaid);
   if(x.amortization==='equal_principal')principalPaid=principalStep;
  }
  if(principalPaid.lt(0))throw Error('Payment fails to cover interest; negative amortization not authorized');
  if(m===x.termMonths)principalPaid=balance;
  principalPaid=D.min(principalPaid,balance);balance=balance.minus(principalPaid);
  const event=extras.get(m);
  const extraPrincipal=event?D.min(new D(event.amount),balance):zero();
  // A requested fee is explicit even if the regular installment already closes the loan.
  const fee=event?new D(event.fee):zero();
  if(event&&new D(event.amount).gt(extraPrincipal))warnings.push(`Month ${m}: prepayment capped at remaining balance`);
  balance=balance.minus(extraPrincipal);
  if(event?.mode==='recast_payment')recast=true;
  const payment=interestPaid.plus(principalPaid).plus(extraPrincipal).plus(fee);
  if(payment.lt(0))throw Error('Negative payment is outside the current loan IRR convention');
  const identity=opening.plus(indexation).plus(capitalizedInterest).minus(principalPaid).minus(extraPrincipal);
  if(!identity.eq(balance))throw Error('Accounting invariant violated');
  rows.push({month:m,opening:fmt(opening),annualRatePercent:annual,indexLevel:level.toFixed(16),indexation:fmt(indexation),interestAccrued:fmt(interest),capitalizedInterest:fmt(capitalizedInterest),interestPaid:fmt(interestPaid),principalPaid:fmt(principalPaid),extraPrincipal:fmt(extraPrincipal),fee:fmt(fee),payment:fmt(payment),closing:fmt(balance)});
  previousIndex=level;
 }
 if(!balance.isZero())throw Error('Residual principal at maturity');
 for(const e of x.prepayments)if(e.month>rows.length)warnings.push(`Month ${e.month}: prepayment and fee not applied because the loan was already closed`);
 return {input:x,rows,warnings};
}
export function simulate(input){
 const {input:x,rows,warnings}=amortize(input);
 const flows=[new D(x.principal).minus(x.upfrontFee),...rows.map(r=>new D(r.payment).neg())];
 const total=key=>sum(rows.map(r=>r[key]));
 const totalPaid=total('payment').plus(x.upfrontFee);
 return {engineVersion:ENGINE_VERSION,schemaVersion:'1',currency:x.currency,
  conventions:{period:'equal_months',rate:x.rate.convention,rounding:'half_up_to_agorot_each_month',indexFloor:x.indexation?.floor||'not_linked',prepaymentTiming:'after_scheduled_payment',npvSign:'borrower_positive_draw_negative_payments',fees:'explicit_inputs_only',calendar:'no_stub_periods_or_day_count_adjustments',regulatoryEligibility:'not_assessed'},
  inputDeclaration:{rateOrigin:x.rate.origin,indexOrigin:x.indexation?.origin||null,verifiedCustomerRate:false},
  summary:{months:rows.length,firstPayment:rows[0].payment,peakPayment:fmt(D.max(...rows.map(r=>r.payment))),totalPaid:fmt(totalPaid),interestPaid:fmt(total('interestPaid')),capitalizedInterest:fmt(total('capitalizedInterest')),indexation:fmt(total('indexation')),totalFees:fmt(total('fee').plus(x.upfrontFee)),costAbovePrincipal:fmt(totalPaid.minus(x.principal)),closingBalance:rows.at(-1).closing,npv:npv(flows,x.discountAnnualEffectivePercent).toFixed(2),...irr(flows)},
  warnings,rows};
}
