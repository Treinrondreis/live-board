// Supplement storage using the station response already fetched for the boards.
// Never replace departure selection or request another station/API response.
export function iceArrivalSelector(stops){
  const numbers=[...new Set(stops.filter(stop=>String(stop.tl?.c||'').trim().toUpperCase()==='ICE'&&stop.ar?.pt&&stop.tl?.n).map(stop=>String(stop.tl.n)))];
  return numbers.length?{trainNumbers:numbers,arrivalTrainNumbers:numbers,categories:['ICE']}:null;
}
