import { createHmac, timingSafeEqual } from 'node:crypto';
import { SessionError } from './session-store.mjs';
import { publicTimetable } from './session-timetable.mjs';

export function verifyTimetableActor(req, id, env, now = Date.now()) {
  const secret = env.SESSION_TIMETABLE_WEB_SECRET;
  if (typeof secret !== 'string' || secret.length < 32) return false;
  const [payload,sig,extra] = String(req.headers['x-session-timetable-actor'] || '').split('.');
  if (!payload || !sig || extra !== undefined || payload.length > 1024) return false;
  const want = createHmac('sha256',secret).update('session-timetable-actor:v1.'+payload).digest(), got = Buffer.from(sig,'base64url');
  if (got.length!==want.length || !timingSafeEqual(got,want)) return false;
  let c; try { c=JSON.parse(Buffer.from(payload,'base64url')); } catch { return false; }
  const t=Math.floor(now/1000);
  return c.scope==='timetable:write' && c.id===id && c.method===req.method && Number.isInteger(c.iat) && Number.isInteger(c.exp) && c.iat<=t+30 && c.exp>t && c.exp>c.iat && c.exp-c.iat<=120;
}
export async function timetableRequest(req, id, {env,service,actor,readBody,now=Date.now()}) {
  const editor=verifyTimetableActor(req,id,env,now);
  if (req.method==='GET') {
    const doc=await service.timetable(id);
    return {ok:true,timetable:editor?doc:publicTimetable(doc)};
  }
  if (req.method!=='PUT') throw new SessionError(405,'method_not_allowed');
  if (!editor) throw new SessionError(403,'timetable_editor_required');
  const body=await readBody(req);
  if (!body || Object.keys(body).some(k=>!['version','operations'].includes(k))) throw new SessionError(400,'invalid_timetable');
  return {ok:true,verified:true,timetable:await service.updateTimetable(id,body.version,body.operations,actor)};
}
