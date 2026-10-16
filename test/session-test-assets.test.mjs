import test from 'node:test';
import assert from 'node:assert/strict';
import {createAssetService} from '../scripts/session-assets.mjs';
import {SESSION_ROOTS} from '../scripts/session-dropbox.mjs';
test('test assets stay inside existing isolated storage and never visit production folders',async()=>{
 const calls=[];const folder=`${SESSION_ROOTS.test}/test-session-901/files`;
 const store={listFolder:async path=>{calls.push(path);return [{'.tag':'file',name:'cue.txt',path_display:`${folder}/cue.txt`,size:12}];},temporaryLink:async path=>`https://example.test/${encodeURIComponent(path)}`};
 const service=createAssetService(store,{env:{SESSION_ASSETS_ROOT:'/PRODUCTION'}});
 const result=await service.list('test-session-901');assert.equal(result.folder,folder);assert.equal(result.assets.length,1);assert.deepEqual(calls,[folder]);
 await assert.rejects(service.link('test-session-901','/PRODUCTION/SESSION 901/cue.txt'),e=>e.code==='asset_not_found');
 await assert.rejects(service.list('session-../001'),e=>e.code==='invalid_session_id');
});
