import {z} from 'zod';
import Decimal from 'decimal.js';
import {simulationRequest,nonnegative,positive,rate} from './contracts.mjs';
const id=z.string().min(1).max(100),month=z.number().int().min(0).max(1200);
export const bundleInput=z.object({
 schemaVersion:z.literal('1'),valuationDate:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(x=>!Number.isNaN(Date.parse(x))&&new Date(x).toISOString().slice(0,10)===x),
 discountAnnualEffectivePercent:rate.default('0'),
 transaction:z.object({purpose:z.enum(['purchase','non_purchase','refinance','bridge','subsidized_purchase']),propertyClass:z.enum(['single','replacement','investment']),propertyValue:positive,inIsrael:z.boolean(),isIsraeliCitizen:z.boolean(),willResideInProperty:z.boolean(),propertyCountAfterTransaction:z.number().int().min(1).max(100),nonPurchaseConcessionEvidence:z.string().min(1).max(500).optional(),specialCases:z.array(z.enum(['state_funding','foreign_currency','developer_subsidy','government_guarantee','unverified_property_value','relative_income'])).default([])}).strict(),
 income:z.array(z.object({id,kind:z.enum(['salary','dividend','rent','future_rent','other']),declaredNet:nonnegative,recognizedNet:nonnegative,frequency:z.enum(['monthly','annual']),status:z.enum(['included','requires_review','excluded']),reason:z.string().min(1).max(500),evidenceReference:z.string().min(1).max(500).optional()}).strict()).min(1).max(30),
 commitments:z.array(z.object({id,kind:z.enum(['same_property_mortgage','other_loan','maintenance','lease','rent']),payment:nonnegative,remainingMonths:month.nullable(),remainingPrincipal:nonnegative.default('0'),disposition:z.enum(['retained','repaid']),payoffEvidence:z.string().min(1).max(500).optional()}).strict()).max(50).default([]),
 tracks:z.array(z.object({id,kind:z.enum(['fixed_unlinked','fixed_linked','prime','variable_unlinked','variable_linked','entitlement','other']),projection:z.enum(['current_terms_only','explicit_scenario']),resetPolicy:z.object({firstResetMonth:z.number().int().min(2).max(1200),intervalMonths:z.number().int().min(1).max(120)}).strict().optional(),simulation:simulationRequest}).strict()).min(1).max(20)
}).strict().superRefine((x,c)=>{
 const issue=message=>c.addIssue({code:z.ZodIssueCode.custom,message});
 for(const a of [x.tracks,x.income,x.commitments])if(new Set(a.map(t=>t.id)).size!==a.length)issue('Duplicate IDs within a collection');
 for(const i of x.income){if(new Decimal(i.recognizedNet).gt(i.declaredNet))issue('Recognized income exceeds declared net income');if(i.status==='included'&&!i.evidenceReference)issue('Included income needs an evidence reference');if(i.status==='excluded'&&!new Decimal(i.recognizedNet).isZero())issue('Excluded income must have zero recognized amount');}
 for(const t of x.tracks){
  const v=['prime','variable_linked','variable_unlinked'].includes(t.kind),linked=['fixed_linked','variable_linked','entitlement'].includes(t.kind),s=t.simulation,l=s.loan,index=!!(l.indexation||s.boi451Index||s.cbsRealizedIndex);
  if(!linked&&index)issue('Indexation supplied for an unlinked track');
  if(!v&&l.resets.length)issue('Rate resets supplied for a fixed track');
  if(t.projection==='explicit_scenario'){
   if(linked&&!index)issue('Linked scenario needs a complete index path');
   if(t.kind==='other')issue('Other track cannot declare a complete forecast');
   if(v){if(!t.resetPolicy)issue('Variable-rate scenario requires an explicit reset policy');else{
    const expected=[];for(let m=t.resetPolicy.firstResetMonth;m<=l.termMonths;m+=t.resetPolicy.intervalMonths)expected.push(m);
    if(JSON.stringify(expected)!==JSON.stringify(l.resets.map(r=>r.month).sort((a,b)=>a-b)))issue('Reset events must cover exactly the contractual reset months');
   }}
  }
 }
});
