// Supplement storage using the station response already fetched for the boards.
// Never replace departure selection or request another station/API response.
export function arrivalSelector(stops){
  const numbers=[...new Set(stops.filter(stop=>stop.ar?.pt&&stop.tl?.n).map(stop=>String(stop.tl.n)))];
  return numbers.length?{trainNumbers:numbers,arrivalTrainNumbers:numbers,categories:[]}:null;
}
