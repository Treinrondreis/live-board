import {sanityConfig} from './flora-sanity.mjs';
export {defaultRows,statuses,dayInAmsterdam,selectRows} from './reishuis-view.mjs';

export const normalizeStatus=value=>{const s=String(value||'').toLowerCase().trim();return ['wacht klant','wacht op reactie van klant'].includes(s)?'wacht op reactie klant':s||'zonder status';};
export function imageURL(value){
 if(typeof value!=='string')return null;
 try{const u=new URL(value);return u.origin==='https://cdn.sanity.io'&&/^\/images\/il9cyh3m\/production\/[a-f0-9]+-\d+x\d+\.(jpg|jpeg|png|webp)$/.test(u.pathname)?u.origin+u.pathname+'?w=640&h=360&fit=crop&auto=format':null;}catch{return null;}
}
export async function fetchReishuisBookings({fetcher=fetch,config=sanityConfig()}={}){
 if(!config.token||config.project!=='il9cyh3m'||config.dataset!=='production')throw Error('Reishuis requires the existing production read-only Sanity connection');
 const all=[];let after='';
 for(let page=0;page<1000;page++){
  const u=new URL('https://il9cyh3m.api.sanity.io/v2026-10-03/data/query/production');
  u.searchParams.set('query','*[_type == "tourBooking" && _id > $after] | order(_id asc)[0...100]{_id,_createdAt,_updatedAt,index,status,firstName,lastName,dateDeparture,dateReturn,dateCreated,payments[]{_key,type,status,price,dateDue,"hasLink":defined(checkoutUrl) && checkoutUrl != "",fulfillments[]{amount}},"photo":coalesce(trip->imagesWithData[0]->image.asset->url,trip->imagesWithData[0].image.asset->url)}');
  u.searchParams.set('$after',JSON.stringify(after));u.searchParams.set('perspective','raw');
  const r=await fetcher(u,{method:'GET',redirect:'error',headers:{Authorization:`Bearer ${config.token}`},signal:AbortSignal.timeout(30000)});
  if(!r.ok)throw Error('Sanity read failed');
  const {result}=await r.json();if(!Array.isArray(result))throw Error('Invalid Sanity response');
  all.push(...result);if(result.length<100){
   const unique=new Map();
   for(const b of all){if(typeof b._id!=='string')throw Error('Invalid booking');const id=b._id.replace(/^drafts\./,'');if(!unique.has(id)||b._id.startsWith('drafts.'))unique.set(id,{id,index:String(b.index??''),name:[b.firstName,b.lastName].filter(Boolean).join(' '),status:normalizeStatus(b.status),departure:String(b.dateDeparture||'').slice(0,10),return:String(b.dateReturn||'').slice(0,10),created:b.dateCreated||b._createdAt||'',updated:b._updatedAt||'',photo:imageURL(b.photo),payments:Array.isArray(b.payments)?b.payments.map(p=>({status:p.status,price:p.price,dateDue:p.dateDue,hasLink:p.hasLink===true,fulfillments:Array.isArray(p.fulfillments)?p.fulfillments.map(f=>({amount:f.amount})):[]})):[]});}
   return [...unique.values()];
  }
  const next=result.at(-1)?._id;if(typeof next!=='string'||next<=after)throw Error('Invalid Sanity cursor');after=next;
 }
 throw Error('Sanity page limit reached');
}
