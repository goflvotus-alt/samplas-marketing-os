import { randomUUID } from 'node:crypto';
import { SessionError, SESSION_ID_PATTERN } from './session-store.mjs';

const fail = () => { throw new SessionError(400, 'invalid_timetable'); };
const object = v => v && typeof v === 'object' && !Array.isArray(v);
const keys = (v, allowed) => { if (!object(v) || Object.keys(v).some(k => !allowed.includes(k))) fail(); };
const itemId = v => typeof v === 'string' && /^[a-zA-Z0-9-]{1,100}$/.test(v);
const fields = ['start','end','title','details'];
const fieldSchema={type:'object',additionalProperties:false,properties:{start:{type:'string',maxLength:5},end:{type:'string',maxLength:5},title:{type:'string',minLength:1,maxLength:200},details:{type:'string',maxLength:10000}}};
const iid={type:'string',pattern:'^[a-zA-Z0-9-]{1,100}$'};
export const TIMETABLE_OPERATION_SCHEMA={oneOf:[
  {type:'object',additionalProperties:false,properties:{type:{const:'add_item'},item:{...fieldSchema,required:['title']}},required:['type','item']},
  {type:'object',additionalProperties:false,properties:{type:{const:'update_item'},itemId:iid,patch:{...fieldSchema,minProperties:1}},required:['type','itemId','patch']},
  ...['delete_item','restore_item'].map(type=>({type:'object',additionalProperties:false,properties:{type:{const:type},itemId:iid},required:['type','itemId']})),
  {type:'object',additionalProperties:false,properties:{type:{const:'move_item'},itemId:iid,beforeItemId:{anyOf:[iid,{type:'null'}]}},required:['type','itemId','beforeItemId']}
]};
function checkItem(item) {
  keys(item, ['id',...fields]);
  if (!itemId(item.id) || fields.some(k => typeof item[k] !== 'string')) fail();
  if (!item.title.trim() || item.title.length > 200 || item.details.length > 10000) fail();
  for (const t of [item.start,item.end]) if (t !== '' && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(t)) fail();
  if (item.start && item.end && item.end < item.start) fail();
}
export function emptyTimetable(id) {
  if (!SESSION_ID_PATTERN.test(String(id))) fail();
  return { schemaVersion: 1, id, version: 1, items: [], trash: [], log: [], updatedAt: null };
}
export function assertTimetable(doc) {
  if (!object(doc) || doc.schemaVersion !== 1 || !SESSION_ID_PATTERN.test(String(doc.id)) || !Number.isSafeInteger(doc.version) || doc.version < 1 || !Array.isArray(doc.items) || doc.items.length > 200 || !Array.isArray(doc.trash) || !Array.isArray(doc.log)) fail();
  const ids = new Set();
  for (const item of [...doc.items,...doc.trash.map(e=>e.item)]) { checkItem(item); if (ids.has(item.id)) fail(); ids.add(item.id); }
  return doc;
}
export const publicTimetable = doc => ({ id: doc.id, version: doc.version, items: doc.items.map(({id,start,end,title,details})=>({id,start,end,title,details})) });
export function applyTimetableOperations(source, operations, {actor, now = new Date().toISOString()} = {}) {
  assertTimetable(source);
  if (!Array.isArray(operations) || operations.length < 1 || operations.length > 20) fail();
  const doc = structuredClone(source), changes = [];
  for (const op of operations) {
    keys(op, {add_item:['type','item'],update_item:['type','itemId','patch'],delete_item:['type','itemId'],restore_item:['type','itemId'],move_item:['type','itemId','beforeItemId']}[op?.type] || []);
    if (op.type === 'add_item') {
      keys(op.item, fields);
      doc.items.push({ id: randomUUID(), start: '', end: '', details: '', ...op.item });
    } else if (op.type === 'restore_item') {
      const i = doc.trash.findIndex(e=>e.item.id===op.itemId); if (i<0) fail();
      const [entry] = doc.trash.splice(i,1); doc.items.splice(Math.min(entry.index,doc.items.length),0,entry.item);
    } else {
      if (!itemId(op.itemId)) fail();
      const i = doc.items.findIndex(e=>e.id===op.itemId); if (i<0) fail();
      if (op.type === 'update_item') { keys(op.patch,fields); if (!Object.keys(op.patch).length) fail(); Object.assign(doc.items[i],op.patch); }
      else if (op.type === 'delete_item') doc.trash.push({ item: doc.items.splice(i,1)[0], index: i, deletedAt: now, deletedBy: actor?.id || 'unknown' });
      else if (op.type === 'move_item') {
        if (op.beforeItemId !== null && !itemId(op.beforeItemId)) fail();
        if (op.beforeItemId === op.itemId) continue;
        const [item] = doc.items.splice(i,1);
        const before = op.beforeItemId === null ? doc.items.length : doc.items.findIndex(e=>e.id===op.beforeItemId);
        if (before<0) fail(); doc.items.splice(before,0,item);
      } else fail();
    }
    changes.push({type:op.type,itemId:op.itemId || doc.items.at(-1).id});
  }
  assertTimetable(doc);
  if (JSON.stringify(doc.items)===JSON.stringify(source.items) && JSON.stringify(doc.trash)===JSON.stringify(source.trash)) return {doc:source,unchanged:true};
  doc.version++; doc.updatedAt = now; doc.log.push({version:doc.version,at:now,actor:actor?.id || 'unknown',changes});
  return {doc,unchanged:false};
}

export function createTimetableService(store) {
  return {
    async timetable(id) { return (await store.readTimetable(id)).doc; },
    async updateTimetable(id, version, operations, actor) {
      if (!Number.isSafeInteger(version) || version<1) fail();
      const {doc,rev} = await store.readTimetable(id);
      if (doc.version!==version) throw new SessionError(409,'version_conflict','Timetable changed',{currentVersion:doc.version});
      const result = applyTimetableOperations(doc,operations,{actor});
      if (!result.unchanged) {
        await store.writeTimetable(id,result.doc,rev);
        const saved = (await store.readTimetable(id)).doc;
        if (JSON.stringify(saved)!==JSON.stringify(result.doc)) throw new SessionError(502,'write_unverified');
      }
      return result.doc;
    }
  };
}
