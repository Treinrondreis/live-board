const fields=['id','source','train','number','category','plannedTime','time','to','track','transportMode','status','delay','cancelled','type','partialCancellation','hasRealtime'];
const compact=row=>Object.fromEntries(fields.filter(k=>row[k]!==undefined).map(k=>[k,row[k]]));
export function embedPayload(payload,query){
 if(!payload?.departures||!['quick','full'].includes(query.get('embed')))return payload;
 const result=Object.fromEntries(['source','page','station','title','country','lastScanAt','status','notice','boardSettings'].filter(k=>payload[k]!==undefined).map(k=>[k,payload[k]]));
 result.quick=(payload.quick||[]).map(g=>({...g,trains:(g.trains||[]).map(compact)}));
 if(query.get('embed')==='full'){
  const tab=['all','fernverkehr','regional'].includes(query.get('tab'))?query.get('tab'):'all';
  const limit=Math.max(30,Math.min(3000,Number(query.get('limit'))||30));const rows=payload.departures[tab]||[];
  result.departures={[tab]:rows.slice(0,limit).map(compact)};result.pagination={tab,total:rows.length,shown:Math.min(limit,rows.length),hasMore:rows.length>limit};
 }
 return result;
}
