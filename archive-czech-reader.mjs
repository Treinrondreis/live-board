import {DuckDBInstance} from '@duckdb/node-api';
import {gtfsTime,dayKey} from './belgium.mjs';

const base='https://data.train-archive.eu/';
const literal=value=>"'"+String(value).replaceAll("'","''")+"'";
const allowed=url=>typeof url==='string'&&url.startsWith(base)&&!url.includes('?')&&!url.includes('#');

async function metadata(path,token){
  const response=await fetch(base+path,{headers:{'X-Api-Key':token},signal:AbortSignal.timeout(30000)});
  if(!response.ok)throw Error('Archive metadata unavailable');
  return response.json();
}

export async function readCzechArchive({token,plan,now=Date.now()}){
  const instance=await DuckDBInstance.create(':memory:',{memory_limit:'256MB',threads:'1',max_temp_directory_size:'256MB'});
  const connection=await instance.connect();
  const query=async sql=>(await connection.runAndReadAll(sql)).getRowObjectsJson();
  try{
    await connection.run("INSTALL httpfs; LOAD httpfs; SET TimeZone='Europe/Prague'; SET http_timeout=30; SET http_retries=1");
    await connection.run("CREATE SECRET archive_token (TYPE http,SCOPE 'https://data.train-archive.eu',EXTRA_HTTP_HEADERS MAP {'X-Api-Key':"+literal(token)+"})");
    const manifest=await metadata('cz-czptt/static/latest.json',token);
    if(!/^\d{4}-\d{2}-\d{2}_[\d-]+Z$/.test(manifest.version))throw Error('Invalid archive version');
    const table=name=>{
      const path=manifest.tables[name];
      const url=path?.startsWith(base)?path:base+path;
      if(!allowed(url)||!url.startsWith(base+'cz-czptt/static/'))throw Error('Invalid timetable address');
      return 'read_parquet('+literal(url)+')';
    };
    if(!plan||plan.version!==manifest.version||plan.day!==dayKey(now)){
      await connection.run(`CREATE TABLE stops AS SELECT stop_id,stop_name,parent_station,platform_code FROM ${table('stops')}`);
      await connection.run(`CREATE TABLE station_calls AS SELECT st.*,
        CASE s.stop_name WHEN 'Praha hlavní nádraží' THEN 'praha' ELSE 'praha-holesovice' END AS page,
        s.stop_name AS station,s.platform_code
        FROM ${table('stop_times')} st JOIN stops s USING(stop_id)
        WHERE s.stop_name IN ('Praha hlavní nádraží','Praha-Holešovice')
        AND coalesce(st.pickup_type,0)<>1 AND st.departure_time IS NOT NULL`);
      await connection.run(`CREATE TABLE trips AS SELECT t.* FROM ${table('trips')} t SEMI JOIN station_calls c USING(trip_id)`);
      await connection.run(`CREATE TABLE route_calls AS SELECT st.trip_id,st.stop_sequence,s.stop_name
        FROM ${table('stop_times')} st JOIN stops s USING(stop_id) SEMI JOIN trips t USING(trip_id)`);
      const dates=[-1,0,1].map(offset=>dayKey(now+offset*86400000));
      const dateSql=dates.map(d=>"DATE "+literal(d.slice(0,4)+'-'+d.slice(4,6)+'-'+d.slice(6))).join(',');
      const rows=await query(`WITH days AS (SELECT unnest([${dateSql}]) AS service_day),
        active AS (
          SELECT c.service_id,d.service_day FROM ${table('calendar')} c CROSS JOIN days d
          WHERE d.service_day BETWEEN c.start_date AND c.end_date AND
            CASE dayofweek(d.service_day) WHEN 0 THEN c.sunday WHEN 1 THEN c.monday WHEN 2 THEN c.tuesday
            WHEN 3 THEN c.wednesday WHEN 4 THEN c.thursday WHEN 5 THEN c.friday WHEN 6 THEN c.saturday END=1
          UNION SELECT service_id,date AS service_day FROM ${table('calendar_dates')} WHERE exception_type=1 AND date IN (SELECT * FROM days)
        ), removed AS (SELECT service_id,date AS service_day FROM ${table('calendar_dates')} WHERE exception_type=2 AND date IN (SELECT * FROM days)),
        future AS (SELECT c.trip_id,c.stop_sequence,list(r.stop_name ORDER BY r.stop_sequence) AS future_route
          FROM station_calls c JOIN route_calls r ON r.trip_id=c.trip_id AND r.stop_sequence>c.stop_sequence
          GROUP BY c.trip_id,c.stop_sequence)
        SELECT c.page,c.station,c.stop_id,c.stop_sequence,c.platform_code,c.departure_time,
          t.trip_id,t.trip_short_name,t.trip_headsign,a.service_day::VARCHAR AS date,f.future_route
        FROM station_calls c JOIN trips t USING(trip_id) JOIN active a USING(service_id)
        LEFT JOIN future f ON f.trip_id=c.trip_id AND f.stop_sequence=c.stop_sequence
        ANTI JOIN removed x ON x.service_id=t.service_id AND x.service_day=a.service_day`);
      plan={version:manifest.version,day:dayKey(now),generatedAt:now,rows:rows.map(r=>({
        ...r,plannedTimestamp:gtfsTime(r.date.replaceAll('-',''),durationClock(Number(r.departure_time))),
      })).filter(r=>Number.isFinite(r.plannedTimestamp)&&r.future_route?.length)};
      if(!plan.rows.length)throw Error('No planned Czech departures');
    }
    const files=await query(`SELECT url FROM read_parquet('${base}index.parquet')
      WHERE provider='cz-czptt' AND service='TripUpdate' AND kind='hourly'
      AND try_cast(date AS DATE) BETWEEN current_date-INTERVAL '1 day' AND current_date
      ORDER BY url DESC LIMIT 24`);
    if(!files.length)return {plan,updates:[],latestObservation:null};
    const urls=files.map(f=>f.url);
    if(!urls.every(u=>allowed(u)&&u.startsWith(base+'provider=cz-czptt/')))throw Error('Invalid archive file address');
    const updates=await query(`SELECT trip_tripId AS trip_id,trip_startDate AS service_day,staticVersion AS version,
      trip_scheduleRelationship AS relationship,stopTimeUpdate AS stops,epoch_ms(lastSeen)::DOUBLE AS observed
      FROM read_parquet([${urls.map(literal).join(',')}],union_by_name=true)
      WHERE staticVersion=${literal(plan.version)} AND lastSeen<=current_timestamp
      QUALIFY row_number() OVER(PARTITION BY feedId,trip_tripId,trip_startDate ORDER BY lastSeen DESC,fetchTime DESC)=1`);
    return {plan,updates,latestObservation:updates.length?Math.max(...updates.map(u=>u.observed)):null};
  }finally{
    connection.closeSync();
    instance.closeSync();
  }
}

function durationClock(milliseconds){
  const seconds=Math.floor(milliseconds/1000);
  return [Math.floor(seconds/3600),Math.floor(seconds/60)%60,seconds%60].map(v=>String(v).padStart(2,'0')).join(':');
}
