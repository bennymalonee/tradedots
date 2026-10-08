export const memorySchema=`CREATE TABLE IF NOT EXISTS agent_memory (
 id text PRIMARY KEY, kind text NOT NULL, agent text NOT NULL, symbol text NOT NULL,
 at bigint NOT NULL, title text NOT NULL, text text NOT NULL, evidence jsonb NOT NULL,
 search_vector tsvector GENERATED ALWAYS AS (to_tsvector('english', title || ' ' || text || ' ' || symbol)) STORED
);
CREATE INDEX IF NOT EXISTS agent_memory_search ON agent_memory USING gin(search_vector);
CREATE INDEX IF NOT EXISTS agent_memory_time ON agent_memory(at DESC);
CREATE INDEX IF NOT EXISTS agent_memory_kind_time ON agent_memory(kind,at);`;
export function memoryStore(pool) {
 return {
  async upsert(docs) {
   // JSON is bound as a parameter. No query text is constructed from memories.
   for(let i=0;i<docs.length;i+=250)await pool.query(`INSERT INTO agent_memory(id,kind,agent,symbol,at,title,text,evidence)
    SELECT id,kind,agent,symbol,at,title,text,evidence FROM jsonb_to_recordset($1::jsonb)
    AS x(id text,kind text,agent text,symbol text,at bigint,title text,text text,evidence jsonb)
    ON CONFLICT(id) DO UPDATE SET title=EXCLUDED.title,text=EXCLUDED.text,evidence=EXCLUDED.evidence
    WHERE agent_memory.evidence IS DISTINCT FROM EXCLUDED.evidence OR agent_memory.text IS DISTINCT FROM EXCLUDED.text`,[JSON.stringify(docs.slice(i,i+250))]);
   await pool.query("DELETE FROM agent_memory WHERE kind='decision' AND at<$1",[Date.now()-14*86400000]);
  },
  async search({q='',agent='',kind='',symbol='',limit=30}={}) {
   q=String(q).slice(0,200);agent=String(agent).slice(0,20);kind=String(kind).slice(0,20);symbol=String(symbol).slice(0,80);
   limit=Math.max(1,Math.min(50,Number(limit)||30));
   const {rows}=await pool.query(`SELECT id,kind,agent,symbol,at,title,text,evidence,
    ts_rank(search_vector,websearch_to_tsquery('english',$1)) AS relevance
    FROM agent_memory WHERE ($1='' OR search_vector @@ websearch_to_tsquery('english',$1) OR symbol ILIKE $5)
    AND ($2='' OR agent=$2) AND ($3='' OR kind=$3) AND ($4='' OR symbol=$4)
    ORDER BY relevance DESC,at DESC,id LIMIT $6`,[q,agent,kind,symbol,'%'+q.replace(/[\\%_]/g,'\\$&')+'%',limit]);
   return rows.map(r=>({...r,at:Number(r.at),relevance:Number(r.relevance)}));
  },
  async stats() {
   const {rows:[row]}=await pool.query('SELECT count(*)::integer AS count,max(at) AS latest_at FROM agent_memory');
   return{available:true,count:row.count,latest_at:row.latest_at?Number(row.latest_at):null,search:'PostgreSQL full-text and symbol matching',decision_retention_days:14};
  }
 };
}
