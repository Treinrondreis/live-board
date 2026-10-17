import {createHash} from 'node:crypto';

// Shared database snapshot, process-local single flight. No browser persistence.
// Failed/incomplete reads never replace the last successful complete snapshot.
export function createBookingsCache({readSnapshot,writeSnapshot,fetchBookings,clock=Date.now,ttl=60000,retry=30000}){
 let snapshot=null,hydrated=false,hydrating,pending,nextAttempt=0,failed=false;
 const entry=value=>({...value,version:createHash('sha256').update(JSON.stringify(value.bookings)).digest('hex')});
 function refresh(){
  if(pending)return pending;
  const startedAt=clock();nextAttempt=startedAt+retry;
  pending=(async()=>{
   const bookings=await fetchBookings();if(!Array.isArray(bookings))throw Error('Invalid booking snapshot');
   const next={bookings,syncedAt:startedAt};await writeSnapshot(next);
   snapshot=entry(next);failed=false;nextAttempt=clock()+ttl;
   return snapshot;
  })().catch(()=>{failed=true;nextAttempt=clock()+retry;throw Error('Booking refresh unavailable');}).finally(()=>{pending=null;});
  return pending;
 }
 async function hydrate(){
  if(hydrated)return;
  if(!hydrating)hydrating=(async()=>{try{const saved=await readSnapshot();if(saved&&Array.isArray(saved.bookings)&&Number.isFinite(saved.syncedAt)){snapshot=entry(saved);nextAttempt=saved.syncedAt+ttl;}hydrated=true;}finally{hydrating=null;}})();
  await hydrating;
 }
 return {
  async get(){
   await hydrate();
   if(!snapshot){if(!pending&&clock()<nextAttempt)throw Error('Booking refresh unavailable');await refresh();}
   else if(clock()>=nextAttempt)void refresh().catch(()=>{});
   return {...snapshot,refreshing:!!pending,stale:clock()-snapshot.syncedAt>=ttl,failed};
  }
 };
}
