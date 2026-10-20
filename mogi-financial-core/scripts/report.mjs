import {writeFile,readFile} from 'node:fs/promises';
import {openDatabase} from '../src/db.mjs';
import {coverage} from '../src/repository.mjs';
import {runSimulation} from '../src/service.mjs';
const db=await openDatabase();
try{
 const sources=await coverage(db),asOf=new Date().toISOString();
 const base=JSON.parse(await readFile('examples/fixed.json','utf8'));
 const fixed=await runSimulation(db,base);
 const scenarioRequest={loan:{...base.loan,rate:{...base.loan.rate,annualPercent:'3',description:'Illustrative fixed linked rate; not estimated for a customer'}},boi451Index:{asOf,vintage:'2026-09-01',averaging:'calendar',indexFloor:'none'}};
 const linked=await runSimulation(db,scenarioRequest);
 await writeFile('examples/boi451-index.json',JSON.stringify(scenarioRequest,null,2));
 await writeFile('reports/fixed-simulation.json',JSON.stringify(fixed,null,2));
 await writeFile('reports/boi451-simulation.json',JSON.stringify(linked,null,2));
 const report={generatedAt:asOf,backend:db.backend,personalPricingEnabled:false,sources,totalObservations:sources.reduce((a,b)=>a+b.observations,0),totalSeries:sources.reduce((a,b)=>a+b.series,0),fixed:fixed.summary,boi451Linked:linked.summary,issues:(await db.query('SELECT source_id,code,severity,detail FROM coverage_issue ORDER BY source_id,code')).rows};
 await writeFile('reports/data-audit.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{await db.close()}
