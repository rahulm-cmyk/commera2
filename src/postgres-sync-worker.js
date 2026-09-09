import { workerData } from 'node:worker_threads';
import pg from 'pg';

pg.types.setTypeParser(20,value=>Number(value));
pg.types.setTypeParser(1114,value=>value);
pg.types.setTypeParser(1184,value=>value);

const port=workerData.port;
const client=new pg.Client({connectionString:workerData.connectionString});
const identityTables=new Set();
async function refreshIdentityTables(){
  const identityResult=await client.query("SELECT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='id' AND is_identity='YES'");
  identityTables.clear();
  for(const row of identityResult.rows)identityTables.add(row.table_name);
}
const ready=(async()=>{
  await client.connect();
  await refreshIdentityTables();
})();

function dialect(input){
  let sql=String(input).trim().replace(/;$/,'');
  const ignored=/^INSERT\s+OR\s+IGNORE\s+/i.test(sql);
  sql=sql.replace(/^INSERT\s+OR\s+IGNORE\s+/i,'INSERT ')
    .replace(/^BEGIN\s+IMMEDIATE$/i,'BEGIN')
    .replace(/datetime\('now','-1 hour'\)/gi,"CURRENT_TIMESTAMP - INTERVAL '1 hour'")
    .replace(/datetime\('now','-24 hours'\)/gi,"CURRENT_TIMESTAMP - INTERVAL '24 hours'")
    .replace(/\(julianday\(([^)]+)\)\s*-\s*julianday\(([^)]+)\)\)\s*\*\s*86400/gi,"EXTRACT(EPOCH FROM ($1::timestamp - $2::timestamp))")
    .replace(/\bcreated_at\s*>=\s*(CURRENT_TIMESTAMP\s*-\s*INTERVAL\s*'[^']+')/gi,'created_at::timestamp >= $1')
    .replace(/GROUP_CONCAT\(quantity \|\| '× ' \|\| name, ', '\)/gi,"STRING_AGG(quantity::text || '× ' || name, ', ')");
  if(ignored)sql+=' ON CONFLICT DO NOTHING';
  let index=0;
  return sql.replace(/\?/g,()=>`$${++index}`);
}

function normalizeError(error){
  const prefix=error.code==='23505'?'UNIQUE constraint: ':error.code==='23503'?'FOREIGN KEY constraint: ':'';
  return{message:prefix+(error.message||'PostgreSQL query failed'),code:error.code||''};
}

port.on('message',async message=>{
  const signal=new Int32Array(message.signal);
  try{
    await ready;
    if(message.mode==='refresh-identities'){
      await refreshIdentityTables();
      port.postMessage({ok:true,data:{changes:0}});
      return;
    }
    let sql=dialect(message.sql);
    if(message.mode==='run'){
      const table=sql.match(/^INSERT\s+INTO\s+"?([a-z_][a-z0-9_]*)"?/i)?.[1];
      if(table&&identityTables.has(table)&&!/\bRETURNING\b/i.test(sql))sql+=' RETURNING id';
    }
    const result=await client.query(sql,message.params||[]);
    const data=message.mode==='get'?result.rows[0]:message.mode==='all'?result.rows:message.mode==='run'?{changes:result.rowCount,lastInsertRowid:result.rows[0]?.id??null}:{changes:result.rowCount};
    port.postMessage({ok:true,data});
  }catch(error){port.postMessage({ok:false,error:normalizeError(error)});}
  finally{Atomics.store(signal,0,1);Atomics.notify(signal,0);}
});
