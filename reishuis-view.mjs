// Shared presentation logic. Contains no credentials or server dependencies.
export const defaultRows=[
 {status:'te verwerken',sort:'created'}, {status:'te verwerken',sort:'departure'},
 {status:'interrail leveren',sort:'departure'}, {status:'wacht op reactie klant',sort:'departure'},
 {status:'nu op reis',sort:'departure'}
];
export const statuses=['te verwerken','interrail leveren','wacht op reactie klant','nu op reis','afgehandeld','verwerkt','tickets versturen','nieuwe dienstregeling','geannuleerd','reistegoed','terugbetaald','zonder status','all'];
export const statusLabel=value=>value==='all'?'Alle boekingen':value?value[0].toUpperCase()+value.slice(1):'Zonder status';
export const dayInAmsterdam=(now=new Date())=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Amsterdam'}).format(now);
export function selectRows(bookings,rows=defaultRows,pages=[],search='',today=dayInAmsterdam()){
 const term=search.toLocaleLowerCase('nl-NL').trim();
 return rows.map((row,i)=>{
  const matches=bookings.filter(b=>(!term||`${b.index} ${b.name}`.toLocaleLowerCase('nl-NL').includes(term))&&(row.status==='all'||(row.status==='nu op reis'?b.status==='afgehandeld'&&b.departure<=today&&b.return>=today&&!!b.departure:b.status===row.status)));
  matches.sort((a,b)=>(row.sort==='created'?b.created.localeCompare(a.created):(a.departure||'9999').localeCompare(b.departure||'9999'))||a.id.localeCompare(b.id));
  const page=Math.min(Math.max(0,Number.isSafeInteger(pages[i])?pages[i]:0),Math.max(0,Math.ceil(matches.length/5)-1));
  return {...row,page,total:matches.length,bookings:matches.slice(page*5,page*5+5).map(({photo,...b})=>({...b,hasPhoto:b.hasPhoto??!!photo}))};
 });
}
