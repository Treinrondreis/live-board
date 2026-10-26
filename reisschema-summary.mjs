import {floraRegister} from './flora-register.mjs';
import {enrichChanges} from './reisschema-changes.mjs';
import {enrichPunctuality,punctualityStatus} from './punctuality.mjs';
export const defaultLookupPlans=async(number,date)=>(await import('./journeys.mjs')).journeyPlansForDate(number,date);
export function createReisschemaSummary({register=floraRegister,lookupPlans=defaultLookupPlans}={}){
 return async()=>{
  const data=await register.summary();
  const [legs,notifications]=await Promise.all([
   data.available?enrichChanges(data.legs,lookupPlans).then(enrichPunctuality):[],
   data.available&&register.notificationContexts?register.notificationContexts():[]
  ]);
  return {...data,legs,notifications,punctualityStatus:punctualityStatus()};
 };
}
const readSummary=createReisschemaSummary();let saved,pending,until=0;export async function reisschemaSummary(){if(saved&&Date.now()<until)return saved;if(!pending)pending=readSummary().then(data=>{saved=data;until=Date.now()+10000;return data;}).finally(()=>pending=null);return pending;}reisschemaSummary.invalidate=()=>{saved=null;until=0;};
