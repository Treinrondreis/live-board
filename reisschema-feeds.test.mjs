import test from 'node:test';
import assert from 'node:assert/strict';
import {zipSync,strToU8} from 'fflate';
import {parseGtfs,parseIff,gtfsClock,reconcilePlanningSources,sourceCheckFresh,createPlanningSources,visitZipCsv} from './reisschema-feeds.mjs';
const pack=files=>zipSync(Object.fromEntries(Object.entries(files).map(([k,v])=>[k,strToU8(v)])));
const meta={name:'Fictional feed',hash:'fictional-hash',loadedAt:'2031-06-02T12:00:00.000Z'};
const leg={leg_id:'example',travel_date:'2031-06-11',train_number:'RJ 700',departure_time:'01:12',arrival_time:'03:00',from_station:'Example North',to_station:'Example South'};
const checkedAt=Date.parse('2031-06-02T12:00:00Z');
const sourceResult=(source,dep='10:00',arr='12:00',age=0)=>({observation:{departure_date:'2031-06-10',departure_time:dep,arrival_date:'2031-06-10',arrival_time:arr,source,cancelled:false},sources:[JSON.stringify({source,downloaded_at:new Date(checkedAt-age).toISOString(),source_modified:'2031-05-27T12:00:00Z'})]});
test('streamed CSV keeps UTF-8 and multiline quotes across tiny chunks, rejects oversize input',()=>{
 const bytes=pack({'stop_times.txt':'id,name\na,"Example é\nNorth"\nb,"Example ""South"""\n'}),rows=[];
 visitZipCsv(bytes,'stop_times.txt',r=>rows.push(r),{chunkSize:1});
 assert.deepEqual(rows,[{id:'a',name:'Example é\nNorth'},{id:'b',name:'Example "South"'}]);
 assert.throws(()=>visitZipCsv(bytes,'stop_times.txt',()=>{},{limit:5}));
});

test('iRail success skips the NMBS ZIP; unresolved legs alone use one shared NMBS download',async()=>{
 const a={...leg,travel_date:'2031-06-11',train_number:'IC 700'},b={...a,leg_id:'second',train_number:'IC 701'};
 const nmbs=gtfs({'routes.txt':'route_id,route_short_name,route_type\nr,IC,2\n','trips.txt':'route_id,service_id,trip_id,trip_short_name,trip_headsign\nr,s,t,701,Example South\n'});
 const iff=pack({'delivery.dat':'@100,10062031,12062031,1,Fictional','footnote.dat':'#00001\n111','stations.dat':'1,a,05,05,NL,0,,,Other North\n1,b,05,05,NL,0,,,Other South','timetbls.dat':'#1\n%202,00999,,001,002\n-00001,000,999\n&IC,001,002\n>a,2512\n<b,2700'});
 for(const legs of [[a],[a,b]]){
  let downloads=0;
  const prepared=await createPlanningSources({env:{REISSCHEMA_IRAIL_ENABLED:'1',REISSCHEMA_NMBS_ENABLED:'1',BMC_PARTNER_KEY:'fictional'},clock:()=>checkedAt,fetcher:async url=>{
   if(url.includes('api.irail.be')){
    const pathname=new URL(url).pathname;
    const data=pathname.endsWith('stations')?{station:[{id:'fictional',name:'Example North'}]}:pathname.endsWith('liveboard')?{departures:{departure:[{vehicle:'BE.NMBS.IC700'}]}}:{vehicle:'BE.NMBS.IC700',stops:{stop:[{station:'Example North',scheduledDepartureTime:String(Date.parse('2031-06-10T23:12:00Z')/1000),departureCanceled:'0'},{station:'Example South',scheduledArrivalTime:String(Date.parse('2031-06-11T01:00:00Z')/1000),arrivalCanceled:'0'}]}};
    return new Response(JSON.stringify({timestamp:checkedAt/1000,...data}));
   }
   if(url.includes('nmbssncb'))downloads++;
   return new Response(url.includes('ndovloket')?iff:nmbs,{headers:{'Last-Modified':new Date(checkedAt).toUTCString()}});
  }}).prepare(legs);
  assert.equal((await prepared.lookup(a)).observation.source,'iRail');
  assert.equal(downloads,legs.length===1?0:1);
  if(legs.length===2)assert.equal((await prepared.lookup(b)).observation.source,'NMBS GTFS');
 }
});
test('two-minute differences are accepted with both sources retained and no averaging',()=>{
 const r=reconcilePlanningSources([sourceResult('First'),sourceResult('Second','10:02','12:02')],checkedAt);
 assert.equal(r.observation.departure_time,'10:00');assert.equal(r.sources.length,2);assert.match(r.reason,/2 minuten/);
});
test('three-minute departure or arrival differences, status differences and pairwise spread require review',()=>{
 for(const other of [sourceResult('Second','10:03'),sourceResult('Second','10:00','12:03'),{...sourceResult('Second'),observation:{...sourceResult('Second').observation,cancelled:true}}])assert.equal(reconcilePlanningSources([sourceResult('First'),other],checkedAt).sourceConflict,true);
 assert.equal(reconcilePlanningSources([sourceResult('First'),sourceResult('Second','10:02'),sourceResult('Third','10:04')],checkedAt).sourceConflict,true);
});
test('comparison requires checks at most four hours old, independent of source publication date',()=>{
 assert.equal(sourceCheckFresh(sourceResult('First','10:00','12:00',4*3600000),checkedAt),true);
 const r=reconcilePlanningSources([sourceResult('First'),sourceResult('Second','10:03','12:00',4*3600000+1)],checkedAt);
 assert.equal(r.observation,undefined);assert.match(r.reason,/4 uur/);
 assert.equal(sourceCheckFresh({...sourceResult('First'),sources:['bad evidence']},checkedAt),false);
});
function gtfs(extra={}){return pack({'feed_info.txt':'feed_version\nv1\n','stops.txt':'stop_id,stop_name\na,Example North\nb,Example South\n','routes.txt':'route_id,route_short_name\nr,RJ\n','trips.txt':'route_id,service_id,trip_id,trip_short_name,trip_headsign\nr,s,t,RJ 700,Example South\n','calendar_dates.txt':'service_id,date,exception_type\ns,20310610,1\n','stop_times.txt':'trip_id,stop_id,stop_sequence,arrival_time,departure_time\nt,a,1,25:10:00,25:12:00\nt,b,2,27:00:00,27:00:00\n',...extra});}
test('GTFS over-24 clocks and original service date are preserved with feed version/trip id',()=>{
 assert.deepEqual(gtfsClock('2031-06-10','33:13:00'),{date:'2031-06-11',time:'09:13'});
 const result=parseGtfs(gtfs(),[leg],meta).example;assert.equal(result.observation.departure_date,'2031-06-11');assert.equal(result.observation.departure_time,'01:12');assert.equal(result.evidence.service_date,'2031-06-10');assert.equal(result.evidence.feed_version,'v1');assert.equal(result.evidence.trip_id,'t');
});
test('calendar exception removes service, never reports cancelled',()=>{
 const r=parseGtfs(gtfs({'calendar_dates.txt':'service_id,date,exception_type\ns,20310610,2\n'}),[leg],meta).example;assert.equal(r.observation,undefined);assert.match(r.reason,/Geen volledig/);
});
test('NMBS resolves official stop translations and country suffixes, not guessed similar names',()=>{
 const bytes=gtfs({'stops.txt':'stop_id,stop_name\na,Example Nord\nb,Example Sud (FR)\n','translations.txt':'table_name,field_name,field_value,language,translation\nstops,stop_name,Example Nord,nl,Example North\nstops,stop_name,Example Sud (FR),nl,Example South (FR)\n'});
 assert.ok(parseGtfs(bytes,[leg],{...meta,name:'NMBS GTFS'}).example.observation);
 assert.equal(parseGtfs(bytes,[leg],meta).example.observation,undefined);
});
test('unnumbered RJ requires complete endpoints and destination, not similar time alone',()=>{
 const r=parseGtfs(gtfs({'trips.txt':'route_id,service_id,trip_id,trip_short_name,trip_headsign\nr,s,t,,Example South\n'}),[leg],meta).example;assert.equal(r.evidence.number_missing,true);
 const absent=parseGtfs(gtfs(),[{...leg,to_station:'Another place'}],meta).example;assert.equal(absent.observation,undefined);
});
test('ambiguous full matches are manual, even if times are equal',()=>{
 const bytes=gtfs({'trips.txt':'route_id,service_id,trip_id,trip_short_name,trip_headsign\nr,s,t,RJ 700,Example South\nr,s,u,RJ 700,Example South\n','stop_times.txt':'trip_id,stop_id,stop_sequence,arrival_time,departure_time\nt,a,1,25:10:00,25:12:00\nt,b,2,27:00:00,27:00:00\nu,a,1,25:10:00,25:12:00\nu,b,2,27:00:00,27:00:00\n'});
 assert.match(parseGtfs(bytes,[leg],meta).example.reason,/Meerdere/);
});
test('same-number parts can join at a shared station, with every source trip retained',()=>{
 const bytes=gtfs({'stops.txt':'stop_id,stop_name\na,Example North\nb,Boundary\nc,Example South\n','trips.txt':'route_id,service_id,trip_id,trip_short_name,trip_headsign\nr,s,t,RJ 700,Example South\nr,s,u,RJ 700,Example South\n','stop_times.txt':'trip_id,stop_id,stop_sequence,arrival_time,departure_time\nt,a,1,25:10:00,25:12:00\nt,b,2,26:00:00,26:00:00\nu,b,1,26:05:00,26:05:00\nu,c,2,27:00:00,27:00:00\n'});
 const r=parseGtfs(bytes,[leg],meta).example;assert.equal(r.observation.arrival_time,'03:00');assert.deepEqual(r.evidence.trip_ids,['t','u']);
});
test('SNCF uses its numeric headsign and explicit train category from the stop identifier',()=>{
 const bytes=gtfs({'routes.txt':'route_id,route_short_name,route_type\nr,C30,2\n','stops.txt':'stop_id,stop_name\nStopPoint:OCETrain TER-100,Example North\nStopPoint:OCETrain TER-200,Example South\n','trips.txt':'route_id,service_id,trip_id,trip_headsign\nr,s,t,700\n','stop_times.txt':'trip_id,stop_id,stop_sequence,arrival_time,departure_time\nt,StopPoint:OCETrain TER-100,1,25:10:00,25:12:00\nt,StopPoint:OCETrain TER-200,2,27:00:00,27:00:00\n'});
 assert.equal(parseGtfs(bytes,[{...leg,train_number:'TER 700'}],{...meta,name:'SNCF GTFS'}).example.observation.departure_time,'01:12');
 assert.equal(parseGtfs(bytes,[{...leg,train_number:'TGV 700'}],{...meta,name:'SNCF GTFS'}).example.observation.train_number,'TER 700');
 assert.equal(parseGtfs(bytes,[{...leg,train_number:'TER 700'}],meta).example.observation,undefined);
});
test('IFF preserves origin service day and now accepts complete international Nightjet endpoints',()=>{
 const bytes=pack({'delivery.dat':'@100,10062031,12062031,1,Fictional','footnote.dat':'#00001\n111','stations.dat':'1,a,05,05,NL,0,,,Example North\n1,b,05,05,NL,0,,,Example South\n0,c,00,00,D,0,,,Example Abroad','timetbls.dat':'#1\n%202,00700,,001,003\n-00001,000,999\n&NJ,001,003\n>a,2512\n+b,2700,2702\n<c,2900'});
 const rows=[{...leg,train_number:'NJ 700'},{...leg,leg_id:'abroad',train_number:'NJ 700',to_station:'Example Abroad'}],r=parseIff(bytes,rows,meta);
 assert.equal(r.example.observation.arrival_time,'03:00');assert.equal(r.abroad.observation.arrival_time,'05:00');
});
test('IFF accepts equal numeric numbers across categories and explicit renumbering inside one through journey',()=>{
 const bytes=pack({'delivery.dat':'@100,10062031,12062031,1,Fictional','footnote.dat':'#00001\n111','stations.dat':'1,a,05,05,NL,0,,,Example North\n1,b,05,05,D,0,,,Boundary\n1,c,05,05,A,0,,,Example South','timetbls.dat':'#1\n%202,00701,,001,002\n%202,00700,,002,003\n-00001,000,999\n&NJ,001,003\n>a,2512\n+b,2600,2605\n<c,2700'});
 const r=parseIff(bytes,[{...leg,train_number:'NJ 700'}],meta).example;
 assert.equal(r.observation.train_number,'NJ 701');assert.equal(r.observation.arrival_date,'2031-06-11');
 assert.deepEqual(JSON.parse(r.sources[0]).route_train_numbers,['701','700']);
 const other=pack({'delivery.dat':'@100,10062031,12062031,1,Fictional','footnote.dat':'#00001\n111','stations.dat':'1,a,05,05,NL,0,,,Example North\n1,c,05,05,NL,0,,,Example South','timetbls.dat':'#1\n%100,00700,,001,002\n-00001,000,999\n&SPR,001,002\n>a,2512\n<c,2700'});
 assert.equal(parseIff(other,[{...leg,train_number:'RE 700'}],meta).example.observation.train_number,'SPR 700');
});
test('a different GTFS number requires identical full endpoint dates/times and uniqueness',()=>{
 const bytes=gtfs({'trips.txt':'route_id,service_id,trip_id,trip_short_name,trip_headsign\nr,s,t,RJ 701,Example South\n'});
 assert.equal(parseGtfs(bytes,[leg],meta).example.observation.train_number,'RJ701');
 assert.equal(parseGtfs(bytes,[{...leg,departure_time:'01:13'}],meta).example.observation,undefined);
 const ambiguous=gtfs({'trips.txt':'route_id,service_id,trip_id,trip_short_name,trip_headsign\nr,s,t,RJ 701,Example South\nr,s,u,RJ 702,Example South\n','stop_times.txt':'trip_id,stop_id,stop_sequence,arrival_time,departure_time\nt,a,1,25:10:00,25:12:00\nt,b,2,27:00:00,27:00:00\nu,a,1,25:10:00,25:12:00\nu,b,2,27:00:00,27:00:00\n'});
 assert.equal(parseGtfs(ambiguous,[leg],meta).example.observation,undefined);
});

test('old participating feeds are fetched again once; fresh feeds avoid duplicate requests',async()=>{
 const iff=pack({'delivery.dat':'@100,10062031,12062031,1,Fictional','footnote.dat':'#00001\n111','stations.dat':'1,a,05,05,NL,0,,,Example North\n1,b,05,05,NL,0,,,Example South','timetbls.dat':'#1\n%202,00700,,001,002\n-00001,000,999\n&RJ,001,002\n>a,2512\n<b,2700'});
 let now=checkedAt,calls=0,fail=false;
 const sources=createPlanningSources({env:{REISSCHEMA_PATRICK_ENABLED:'1',REISSCHEMA_PATRICK_USER:'fictional',REISSCHEMA_PATRICK_PASSWORD:'fictional'},clock:()=>now,fetcher:async url=>{calls++;if(fail)throw Error('Fictional outage');return new Response(url.includes('ndovloket')?iff:gtfs(),{headers:{'Last-Modified':new Date(checkedAt).toUTCString()}});}});
 const prepared=await sources.prepare([leg]);assert.equal(calls,2);
 assert.ok((await prepared.lookup(leg)).observation);assert.equal(calls,2);
 now+=4*3600000+1;assert.ok((await prepared.lookup(leg)).observation);assert.equal(calls,4);
 assert.ok((await prepared.lookup(leg)).observation);assert.equal(calls,4);
});

test('an unsuccessful freshness refresh cannot turn a disagreement into an accepted single source',async()=>{
 const iff=pack({'delivery.dat':'@100,10062031,12062031,1,Fictional','footnote.dat':'#00001\n111','stations.dat':'1,a,05,05,NL,0,,,Example North\n1,b,05,05,NL,0,,,Example South','timetbls.dat':'#1\n%202,00700,,001,002\n-00001,000,999\n&RJ,001,002\n>a,2515\n<b,2700'});
 let now=checkedAt,calls=0,fail=false;
 const sources=createPlanningSources({env:{REISSCHEMA_PATRICK_ENABLED:'1'},clock:()=>now,fetcher:async url=>{calls++;if(fail)throw Error('Fictional outage');return new Response(url.includes('ndovloket')?iff:gtfs(),{headers:{'Last-Modified':new Date(checkedAt).toUTCString()}});}});
 const prepared=await sources.prepare([leg]);assert.equal((await prepared.lookup(leg)).sourceConflict,true);
 now+=4*3600000+1;fail=true;assert.equal((await prepared.lookup(leg)).sourceConflict,true);assert.equal(calls,4);
 assert.equal((await prepared.lookup(leg)).sourceConflict,true);assert.equal(calls,4);
});
