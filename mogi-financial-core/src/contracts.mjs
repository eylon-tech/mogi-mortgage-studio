import {z} from 'zod';
import Decimal from 'decimal.js';
export const decimal=z.string().max(64).regex(/^-?\d+(\.\d{1,16})?$/).refine(x=>new Decimal(x).isFinite());
export const nonnegative=decimal.refine(x=>new Decimal(x).gte(0)&&new Decimal(x).lte('1000000000000'));
export const positive=nonnegative.refine(x=>new Decimal(x).gt(0));
export const rate=decimal.refine(x=>new Decimal(x).gt(-100)&&new Decimal(x).lte(100),'Rate must be greater than -100 and at most 100 percent');
const month=z.number().int().min(1).max(360);
export const simulationInput=z.object({
 schemaVersion:z.literal('1'),currency:z.literal('ILS'),principal:positive,termMonths:month,
 rate:z.object({annualPercent:rate,convention:z.enum(['nominal_annual','effective_annual']),origin:z.enum(['contract','manual','scenario']),description:z.string().min(1).max(500)}).strict(),
 amortization:z.enum(['annuity','equal_principal','interest_only','capitalized_balloon']),
 grace:z.object({months:z.number().int().min(0).max(359),mode:z.enum(['interest_only','capitalize'])}).strict().default({months:0,mode:'interest_only'}),
 resets:z.array(z.object({month:month,annualPercent:rate,description:z.string().min(1).max(500)}).strict()).max(359).default([]),
 indexation:z.object({base:positive,levels:z.array(positive).min(1).max(360),floor:z.enum(['none','base']),origin:z.enum(['scenario','manual','historical_replay']),description:z.string().min(1).max(500)}).strict().optional(),
 prepayments:z.array(z.object({month:month,amount:positive,fee:nonnegative,mode:z.enum(['recast_payment','reduce_term'])}).strict()).max(360).default([]),
 upfrontFee:nonnegative.default('0'),discountAnnualEffectivePercent:rate.default('0')
}).strict().superRefine((x,c)=>{
 const issue=message=>c.addIssue({code:z.ZodIssueCode.custom,message});
 if(x.grace.months>=x.termMonths)issue('Grace must end before maturity');
 if(x.grace.months && ['interest_only','capitalized_balloon'].includes(x.amortization))issue('Grace is defined only for amortizing loans');
 if(x.indexation && x.indexation.levels.length!==x.termMonths)issue('Every monthly index level must be explicit; no extrapolation');
 for(const arr of [x.resets,x.prepayments]){
  if(new Set(arr.map(y=>y.month)).size!==arr.length)issue('Duplicate event month');
  if(arr.some(y=>y.month>x.termMonths))issue('Event after maturity');
 }
 if(x.resets.some(y=>y.month===1))issue('Initial rate applies to month 1; resets start at month 2');
 if(x.prepayments.some(y=>y.mode==='reduce_term') && x.amortization!=='annuity')issue('Term reduction currently supports annuity only');
 if(new Decimal(x.upfrontFee).gte(x.principal))issue('Upfront fee must be smaller than principal');
});
export const scenarioSelector=z.object({asOf:z.string().datetime({offset:true}),vintage:z.string().regex(/^\d{4}-\d{2}-01$/).refine(x=>!Number.isNaN(Date.parse(x))&&new Date(x).toISOString().slice(0,10)===x),averaging:z.enum(['calendar','index_period']),indexFloor:z.enum(['none','base'])}).strict();
export const referenceMonth=z.string().regex(/^\d{4}-\d{2}-01$/).refine(x=>!Number.isNaN(Date.parse(x))&&new Date(x).toISOString().slice(0,10)===x);
export const cbsSelector=z.object({asOf:z.string().datetime({offset:true}),baseObservationPeriod:referenceMonth,firstObservationPeriod:referenceMonth,baseLabel:z.string().min(1).max(100).default('1951 ספטמבר'),indexFloor:z.enum(['none','base'])}).strict().refine(x=>x.firstObservationPeriod>x.baseObservationPeriod,'First reference period must follow base reference period');
export const simulationRequest=z.object({loan:simulationInput,boi451Index:scenarioSelector.optional(),cbsRealizedIndex:cbsSelector.optional()}).strict().superRefine((x,c)=>{if([x.boi451Index,x.cbsRealizedIndex,x.loan.indexation].filter(Boolean).length>1)c.addIssue({code:z.ZodIssueCode.custom,message:'Use either manual indexation or a database scenario, not both'})});
