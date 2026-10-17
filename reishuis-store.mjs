let db,ready;
export function initReishuis(database){db=database;ready=null;}
export const emptyReishuis=()=>({customers:[],links:{},notes:{},preferences:{},history:[]});
async function ensure(){
 if(!db)throw Error('Reishuis storage unavailable');
 if(!ready)ready=(async()=>{const sql='CREATE TABLE IF NOT EXISTS reishuis_state (id INTEGER PRIMARY KEY, revision INTEGER NOT NULL, payload TEXT NOT NULL)';if(db.pool)await db.pool.query(sql);else db.sqlite.exec(sql);})().catch(e=>{ready=null;throw e;});
 await ready;
}
export async function readReishuis(){await ensure();const r=db.pool?(await db.pool.query('SELECT revision,payload FROM reishuis_state WHERE id=1')).rows[0]:db.sqlite.prepare('SELECT revision,payload FROM reishuis_state WHERE id=1').get();return r?{revision:Number(r.revision),state:JSON.parse(r.payload)}:{revision:0,state:emptyReishuis()};}
export async function writeReishuis(state,revision){
 await ensure();const args=[JSON.stringify(state),revision],sql='INSERT INTO reishuis_state(id,revision,payload) VALUES(1,1,$1) ON CONFLICT(id) DO UPDATE SET revision=reishuis_state.revision+1,payload=excluded.payload WHERE reishuis_state.revision=$2 RETURNING revision';
 const r=db.pool?(await db.pool.query(sql,args)).rows[0]:db.sqlite.prepare(sql.replace(/\$\d/g,'?')).get(...args);
 if(!r){const e=Error('Concurrent edit');e.status=409;throw e;}return Number(r.revision);
}
