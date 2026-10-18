import { randomUUID } from 'node:crypto';
import { SessionError, SESSION_ID_PATTERN } from './session-store.mjs';

const fail = (field='operations',reason='invalid_shape') => { throw new SessionError(400, 'invalid_timetable', `${field}: ${reason}`, {field,reason}); };
const object = v => v && typeof v === 'object' && !Array.isArray(v);
const keys = (v, allowed, field='item') => { if (!object(v)) fail(field,'invalid_type'); if(Object.keys(v).some(k => !allowed.includes(k))) fail(field,'unknown_fields'); };
const itemId = v => typeof v === 'string' && /^[a-zA-Z0-9-]{1,100}$/.test(v);
const fields = ['start','end','title','details'];
const fieldSchema={type:'object',additionalProperties:false,properties:{start:{type:'string',maxLength:5},end:{type:'string',maxLength:5},title:{type:'string',minLength:1,maxLength:200},details:{type:'string',maxLength:10000}}};
const iid={type:'string',pattern:'^[a-zA-Z0-9-]{1,100}$'};
export const TIMETABLE_OPERATION_SCHEMA={oneOf:[
  {type:'object',additionalProperties:false,properties:{type:{const:'add_item'},item:{...fieldSchema,required:['start','title']}},required:['type','item']},
  {type:'object',additionalProperties:false,properties:{type:{const:'update_item'},itemId:iid,patch:{...fieldSchema,minProperties:1}},required:['type','itemId','patch']},
  ...['delete_item','restore_item'].map(type=>({type:'object',additionalProperties:false,properties:{type:{const:type},itemId:iid},required:['type','itemId']})),
  {type:'object',additionalProperties:false,properties:{type:{const:'move_item'},itemId:iid,beforeItemId:{anyOf:[iid,{type:'null'}]}},required:['type','itemId','beforeItemId']}
]};
function checkItem(item,requireStart=false) {
  keys(item, ['id',...fields]);
  if (!itemId(item.id)) fail('itemId','invalid_format');
  for(const field of fields)if(typeof item[field]!=='string')fail(field,'invalid_type');
  if(requireStart && !item.start)fail('start','required');
  if (!item.title.trim()) fail('title','required');
  if(item.title.length>200)fail('title','too_long');
  if(item.details.length>10000)fail('details','too_long');
  for (const field of ['start','end']) if (item[field] !== '' && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(item[field])) fail(field,'invalid_format');
  if (item.start && item.end && item.end < item.start) fail('end','end_before_start');
}
export function emptyTimetable(id) {
  if (!SESSION_ID_PATTERN.test(String(id))) fail('id','invalid_format');
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
  if (!Array.isArray(operations) || operations.length < 1 || operations.length > 20) fail('operations','out_of_range');
  const doc = structuredClone(source), changes = [];
  for (const op of operations) {
    keys(op, {add_item:['type','item'],update_item:['type','itemId','patch'],delete_item:['type','itemId'],restore_item:['type','itemId'],move_item:['type','itemId','beforeItemId']}[op?.type] || [], 'operations');
    if (op.type === 'add_item') {
      keys(op.item, fields);
      doc.items.push({ id: randomUUID(), start: '', end: '', details: '', ...op.item });
      checkItem(doc.items.at(-1),true);
    } else if (op.type === 'restore_item') {
      const i = doc.trash.findIndex(e=>e.item.id===op.itemId); if (i<0) fail('itemId','not_found');
      const [entry] = doc.trash.splice(i,1); doc.items.splice(Math.min(entry.index,doc.items.length),0,entry.item);
    } else {
      if (!itemId(op.itemId)) fail('itemId','invalid_format');
      const i = doc.items.findIndex(e=>e.id===op.itemId); if (i<0) fail('itemId','not_found');
      if (op.type === 'update_item') { keys(op.patch,fields,'patch'); if (!Object.keys(op.patch).length) fail('patch','required'); Object.assign(doc.items[i],op.patch); checkItem(doc.items[i],true); }
      else if (op.type === 'delete_item') doc.trash.push({ item: doc.items.splice(i,1)[0], index: i, deletedAt: now, deletedBy: actor?.id || 'unknown' });
      else if (op.type === 'move_item') {
        if (op.beforeItemId !== null && !itemId(op.beforeItemId)) fail('beforeItemId','invalid_format');
        if (op.beforeItemId === op.itemId) continue;
        const [item] = doc.items.splice(i,1);
        const before = op.beforeItemId === null ? doc.items.length : doc.items.findIndex(e=>e.id===op.beforeItemId);
        if (before<0) fail('beforeItemId','not_found'); doc.items.splice(before,0,item);
      } else fail('type','invalid_operation');
    }
    changes.push({type:op.type,itemId:op.itemId || doc.items.at(-1).id});
  }
  doc.trash=doc.trash.slice(-100);
  assertTimetable(doc);
  if (JSON.stringify(doc.items)===JSON.stringify(source.items) && JSON.stringify(doc.trash)===JSON.stringify(source.trash)) return {doc:source,unchanged:true};
  doc.version++; doc.updatedAt = now; doc.log.push({version:doc.version,at:now,actor:actor?.id || 'unknown',changes});
  doc.log=doc.log.slice(-200);
  return {doc,unchanged:false};
}

export function createTimetableService(store) {
  return {
    async timetable(id) { return (await store.readTimetable(id)).doc; },
    async updateTimetable(id, version, operations, actor) {
      if (!Number.isSafeInteger(version) || version<1) fail('version','out_of_range');
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
