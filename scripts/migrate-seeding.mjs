// One-time operator import. Not an HTTP route. Add mode never overwrites a store.
import { readFile } from 'node:fs/promises';
import { getDropboxAccessToken,asciiSafeJson } from './dropbox-report-uploader.mjs';
import { STORE_PATH,normalizeId } from './seeding-store.mjs';
const [sourcePath,credentialPath]=process.argv.slice(2);
if(!sourcePath||!credentialPath)throw Error('Usage: node scripts/migrate-seeding.mjs <private-json> <private-env>');
const env={...process.env};for(const line of (await readFile(credentialPath,'utf8')).split(/\r?\n/)){const i=line.indexOf('=');if(i>0&&!line.startsWith('#'))env[line.slice(0,i)]=line.slice(i+1);}
const doc=JSON.parse(await readFile(sourcePath,'utf8'));
if(doc.schemaVersion!==1||doc.projects.length!==1||doc.projects[0].name!=='MEANTIME SCHWARZE STUNDE'||doc.projects[0].version!==1)throw Error('Invalid actual migration project');
const handles=new Set(),ids=new Set();for(const c of doc.creators){const h=normalizeId(c.instagram);if(!h||handles.has(h)||ids.has(c.id))throw Error('Duplicate creator');handles.add(h);ids.add(c.id);c.instagram=h;}
const rows=new Set();for(const r of doc.seedings){if(r.projectId!==doc.projects[0].id||!ids.has(r.creatorId)||rows.has(r.creatorId))throw Error('Invalid seeding relationship');rows.add(r.creatorId);}
const token=await getDropboxAccessToken({env});
const existing=await fetch('https://content.dropboxapi.com/2/files/download',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Dropbox-API-Arg':asciiSafeJson({path:STORE_PATH})}});
if(existing.ok){const present=await existing.json();console.log(JSON.stringify({alreadyMigrated:true,projects:present.projects.length,seedings:present.seedings.length}));process.exit(0);}
const missing=await existing.json();if(existing.status!==409||!JSON.stringify(missing).includes('not_found'))throw Error('Cannot verify destination is absent');
const parts=STORE_PATH.split('/').slice(1,-1);let parent='';for(const part of parts){parent+='/'+part;const response=await fetch('https://api.dropboxapi.com/2/files/create_folder_v2',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({path:parent,autorename:false})});if(!response.ok){const body=await response.json();if(response.status!==409||!JSON.stringify(body).includes('folder'))throw Error('Migration folder unavailable');}}
const upload=await fetch('https://content.dropboxapi.com/2/files/upload',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/octet-stream','Dropbox-API-Arg':asciiSafeJson({path:STORE_PATH,mode:{'.tag':'add'},autorename:false,mute:true,strict_conflict:true})},body:JSON.stringify(doc)});
if(!upload.ok)throw Error('Migration upload failed '+upload.status);
console.log(JSON.stringify({migrated:true,project:doc.projects[0].name,version:1,seedings:doc.seedings.length,creators:doc.creators.length}));
