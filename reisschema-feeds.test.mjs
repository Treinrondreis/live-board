import test from 'node:test';
import assert from 'node:assert/strict';
import {zipSync,strToU8} from 'fflate';
import {parseGtfs,parseIff,gtfsClock} from './reisschema-feeds.mjs';
const pack=files=>zipSync(Object.fromEntries(Object.entries(files).map(([k,v])=>[k,strToU8(v)])));
const meta={name:'Fictional feed',hash:'fictional-hash',loadedAt:'2031-06-02T12:00:00.000Z'};
const leg={leg_id:'example',travel_date:'2031-06-11',train_number:'RJ 700',from_station:'Example North',to_station:'Example South'};
function gtfs(extra={}){return pack({'feed_info.txt':'feed_version\nv1\n','stops.txt':'stop_id,stop_name\na,Example North\nb,Example South\n','routes.txt':'route_id,route_short_name\nr,RJ\n','trips.txt':'route_id,service_id,trip_id,trip_short_name,trip_headsign\nr,s,t,RJ 700,Example South\n','calendar_dates.txt':'service_id,date,exception_type\ns,20310610,1\n','stop_times.txt':'trip_id,stop_id,stop_sequence,arrival_time,departure_time\nt,a,1,25:10:00,25:12:00\nt,b,2,27:00:00,27:00:00\n',...extra});}
test('GTFS over-24 clocks and original service date are preserved with feed version/trip id',()=>{
 assert.deepEqual(gtfsClock('2031-06-10','33:13:00'),{date:'2031-06-11',time:'09:13'});
 const result=parseGtfs(gtfs(),[leg],meta).example;assert.equal(result.observation.departure_date,'2031-06-11');assert.equal(result.observation.departure_time,'01:12');assert.equal(result.evidence.service_date,'2031-06-10');assert.equal(result.evidence.feed_version,'v1');assert.equal(result.evidence.trip_id,'t');
});
test('calendar exception removes service, never reports cancelled',()=>{
 const r=parseGtfs(gtfs({'calendar_dates.txt':'service_id,date,exception_type\ns,20310610,2\n'}),[leg],meta).example;assert.equal(r.observation,undefined);assert.match(r.reason,/Geen volledig/);
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
test('IFF preserves origin service day and limits Nightjet checks to Dutch endpoints',()=>{
 const bytes=pack({'delivery.dat':'@100,10062031,12062031,1,Fictional','footnote.dat':'#00001\n111','stations.dat':'1,a,05,05,NL,0,,,Example North\n1,b,05,05,NL,0,,,Example South\n0,c,00,00,D,0,,,Example Abroad','timetbls.dat':'#1\n%202,00700,,001,003\n-00001,000,999\n&NJ,001,003\n>a,2512\n+b,2700,2702\n<c,2900'});
 const rows=[{...leg,train_number:'NJ 700'},{...leg,leg_id:'abroad',train_number:'NJ 700',to_station:'Example Abroad'}],r=parseIff(bytes,rows,meta);
 assert.equal(r.example.observation.arrival_time,'03:00');assert.equal(r.abroad.observation,undefined);
});
