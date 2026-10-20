import {optimize,type Config} from './optimizer';
import type {Case,Track,Forecast} from './model';
self.onmessage=(event:MessageEvent<{caseData:Case;cfg:Config;rates:Record<string,number>;forecast:Forecast;tracks:Track[]}>)=>{
 const {caseData,cfg,rates,forecast,tracks}=event.data;
 try{self.postMessage({result:optimize(caseData,cfg,rates,forecast,{baseTracks:tracks})})}catch(e){self.postMessage({error:e instanceof Error?e.message:'החיפוש לא הושלם'})}
};
