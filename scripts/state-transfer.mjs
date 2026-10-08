import fs from 'node:fs/promises';
import {openDatabase} from '../server/database.mjs';
import {safeTransferState} from '../server/transfer.mjs';
const [action,file] = process.argv.slice(2);
if(!['export','import'].includes(action)||!file)throw Error('Usage: node scripts/state-transfer.mjs export|import /private/path/snapshot.backup.json');
const {pool}=await openDatabase(process.env.DATABASE_URL);
try {
  if(action==='export') {
    const {rows:[row]}=await pool.query('SELECT version,payload FROM desk_state WHERE id=1');
    if(!row)throw Error('No desk state exists yet');
    const state=JSON.parse(row.payload);delete state.ai_connection;delete state.gmgn_connection;
    await fs.writeFile(file,JSON.stringify({format:'dots-full-state-v1',exported_at:new Date().toISOString(),state},null,2),{mode:0o600,flag:'wx'});
    console.log('Snapshot exported without saved provider credentials. Store privately.');
  } else {
    const input=JSON.parse(await fs.readFile(file,'utf8'));
    const state=safeTransferState(input);
    const result=await pool.query('INSERT INTO desk_state(id,version,payload) VALUES(1,0,$1) ON CONFLICT(id) DO NOTHING',[JSON.stringify(state)]);
    if(result.rowCount!==1)throw Error('Destination is not empty. Import refused; use a new database or restore a backup after review.');
    console.log('Imported full state. Monitoring, AI research and simulation remain paused. Reconnect credentials and verify before resuming.');
  }
} finally {await pool.end();}
