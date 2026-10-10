import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { getDropboxAccessToken, isDropboxConfigured } from "./dropbox-report-uploader.mjs";

const GRAPH_VERSION_DEFAULT = "v25.0";
const IG_USER_ID_DEFAULT = "29479153961672886";
const READY_DIR_DEFAULT = "/SAMPLAS WORK/병구 작업/피드 자동화/VEIL/VEIL FOUND/READY";
const UPLOADED_DIR_DEFAULT = "/SAMPLAS WORK/병구 작업/피드 자동화/VEIL/VEIL FOUND/UPLOADED";

const DROPBOX_LIST_FOLDER_URL = "https://api.dropboxapi.com/2/files/list_folder";
const DROPBOX_LIST_FOLDER_CONTINUE_URL = "https://api.dropboxapi.com/2/files/list_folder/continue";
const DROPBOX_TEMP_LINK_URL = "https://api.dropboxapi.com/2/files/get_temporary_link";
const DROPBOX_MOVE_URL = "https://api.dropboxapi.com/2/files/move_v2";

let publisherRunning = false;

export function veilFoundConfig(env = process.env) {
  return {
    token: String(env.VEIL_FOUND_IG_TOKEN || "").trim(),
    igUserId: String(env.VEIL_FOUND_IG_USER_ID || IG_USER_ID_DEFAULT).trim(),
    graphVersion: String(env.GRAPH_VERSION || GRAPH_VERSION_DEFAULT).trim(),
    readyDir: String(env.VEIL_FOUND_READY_DIR || READY_DIR_DEFAULT).replace(/\/+$/, ""),
    uploadedDir: String(env.VEIL_FOUND_UPLOADED_DIR || UPLOADED_DIR_DEFAULT).replace(/\/+$/, "")
  };
}

export function isVeilFoundConfigured(env = process.env) {
  const config = veilFoundConfig(env);
  return Boolean(config.token && config.igUserId && isDropboxConfigured(env));
}

export function parseVeilFoundNumber(value) {
  const raw = String(value || "").trim();
  const match = raw.match(/(?:^|[\s_-])#?0*(\d{1,4})(?=$|[\s._-])/i)
    || raw.match(/^#?0*(\d{1,4})(?=$|[._ -])/i);
  if (!match) return null;
  const number = Number(match[1]);
  return Number.isInteger(number) && number > 0 ? number : null;
}

export function extractFeedNumbersFromCaption(caption) {
  const out = [];
  const text = String(caption || "");
  const regex = /(?:^|\s)#0*(\d{1,4})(?=\s|$|[.,:;!?()[\]{}])/g;
  let match;
  while ((match = regex.exec(text))) {
    const number = Number(match[1]);
    if (Number.isInteger(number) && number > 0) out.push(number);
  }
  return out;
}

export function isImageName(name) {
  return /\.(?:jpe?g|png)$/i.test(String(name || ""));
}

function formatNumber(number) {
  return `#${String(number).padStart(3, "0")}`;
}

function dropboxError(status, text, context) {
  return new Error(`Dropbox ${context} failed (HTTP ${status}): ${String(text || "").slice(0, 500) || "no response body"}`);
}

async function dropboxJson(endpoint, body, { accessToken, fetchImpl = fetch } = {}) {
  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const text = await response.text();
  if (!response.ok) throw dropboxError(response.status, text, endpoint.split("/").pop());
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("Dropbox returned an unreadable JSON response.");
  }
}

export async function listDropboxFolder(path, { accessToken, fetchImpl = fetch } = {}) {
  const entries = [];
  let body = await dropboxJson(
    DROPBOX_LIST_FOLDER_URL,
    { path, recursive: false, include_deleted: false },
    { accessToken, fetchImpl }
  );
  entries.push(...(body.entries || []));
  while (body.has_more && body.cursor) {
    body = await dropboxJson(
      DROPBOX_LIST_FOLDER_CONTINUE_URL,
      { cursor: body.cursor },
      { accessToken, fetchImpl }
    );
    entries.push(...(body.entries || []));
  }
  return entries;
}

async function getDropboxTemporaryLink(path, { accessToken, fetchImpl = fetch } = {}) {
  const body = await dropboxJson(DROPBOX_TEMP_LINK_URL, { path }, { accessToken, fetchImpl });
  if (!body.link) throw new Error("Dropbox temporary link response had no link.");
  return body.link;
}

async function moveDropboxFile(fromPath, toPath, { accessToken, fetchImpl = fetch } = {}) {
  return dropboxJson(
    DROPBOX_MOVE_URL,
    {
      from_path: fromPath,
      to_path: toPath,
      autorename: false,
      allow_ownership_transfer: false
    },
    { accessToken, fetchImpl }
  );
}

async function graphPost(path, params, { config, fetchImpl = fetch } = {}) {
  const endpoint = `https://graph.instagram.com/${config.graphVersion}/${path.replace(/^\//, "")}`;
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(params || {})) {
    if (value !== undefined && value !== null && value !== "") body.set(key, String(value));
  }
  body.set("access_token", config.token);

  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString()
  });
  const text = await response.text();
  let parsed;
  try { parsed = JSON.parse(text); } catch { parsed = { raw: text }; }
  if (!response.ok || parsed?.error) {
    const error = new Error(parsed?.error?.message || `Instagram API request failed (HTTP ${response.status})`);
    error.status = response.status;
    error.code = parsed?.error?.code;
    throw error;
  }
  return parsed;
}

async function graphGet(path, params, { config, fetchImpl = fetch } = {}) {
  const url = new URL(`https://graph.instagram.com/${config.graphVersion}/${path.replace(/^\//, "")}`);
  for (const [key, value] of Object.entries({ ...(params || {}), access_token: config.token })) {
    url.searchParams.set(key, String(value));
  }
  const response = await fetchImpl(url, { headers: { Accept: "application/json" } });
  const text = await response.text();
  let parsed;
  try { parsed = JSON.parse(text); } catch { parsed = { raw: text }; }
  if (!response.ok || parsed?.error) {
    const error = new Error(parsed?.error?.message || `Instagram API request failed (HTTP ${response.status})`);
    error.status = response.status;
    error.code = parsed?.error?.code;
    throw error;
  }
  return parsed;
}

export async function fetchInstagramFeed({ config, fetchImpl = fetch, maxPages = 10 } = {}) {
  const items = [];
  let nextUrl = null;
  let page = 0;

  do {
    let body;
    if (!nextUrl) {
      body = await graphGet(
        `${config.igUserId}/media`,
        { fields: "id,caption,timestamp,media_type,permalink", limit: 100 },
        { config, fetchImpl }
      );
    } else {
      const response = await fetchImpl(nextUrl, { headers: { Accept: "application/json" } });
      const text = await response.text();
      try { body = JSON.parse(text); } catch { body = { raw: text }; }
      if (!response.ok || body?.error) {
        const error = new Error(body?.error?.message || `Instagram feed pagination failed (HTTP ${response.status})`);
        error.status = response.status;
        error.code = body?.error?.code;
        throw error;
      }
    }

    items.push(...(body.data || []));
    nextUrl = body?.paging?.next || null;
    page += 1;
  } while (nextUrl && page < maxPages);

  if(nextUrl) throw new Error("Instagram feed coverage incomplete; refusing duplicate check.");
  return items;
}

async function waitForContainer(
  containerId,
  {
    config,
    fetchImpl = fetch,
    sleepImpl = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  } = {}
) {
  for (let attempt = 0; attempt < 18; attempt += 1) {
    const status = await graphGet(
      containerId,
      { fields: "status_code,status" },
      { config, fetchImpl }
    );
    if (status.status_code === "FINISHED") return status;
    if (["ERROR", "EXPIRED"].includes(status.status_code)) {
      throw new Error(`Instagram media container ${status.status_code}: ${status.status || "unknown error"}`);
    }
    await sleepImpl(2500);
  }
  throw new Error("Instagram media container did not finish in time.");
}

async function publishSingleImage(
  { imageUrl, caption, config, fetchImpl = fetch, sleepImpl } = {}
) {
  const container = await graphPost(
    `${config.igUserId}/media`,
    { image_url: imageUrl, caption },
    { config, fetchImpl }
  );
  if (!container.id) throw new Error("Instagram media container response had no id.");

  await waitForContainer(container.id, { config, fetchImpl, sleepImpl });

  const published = await graphPost(
    `${config.igUserId}/media_publish`,
    { creation_id: container.id },
    { config, fetchImpl }
  );
  if (!published.id) throw new Error("Instagram publish response had no media id.");
  return { containerId: container.id, mediaId: published.id };
}

function stateFilePath(workDir) {
  return join(workDir, "veil-found-publisher-state.json");
}

async function readState(workDir) {
  const file = stateFilePath(workDir);
  if (!existsSync(file)) {
    return { version: 5, slotKey: null, slotLimit: null, postedNumbers: [], lastPublishedAt: null };
  }
  try {
    const parsed = JSON.parse(await readFile(file, "utf8"));
    return {
      version: 5,
      slotKey: parsed.slotKey || null,
      slotLimit: Number.isInteger(parsed.slotLimit) ? parsed.slotLimit : null,
      postedNumbers: Array.isArray(parsed.postedNumbers) ? parsed.postedNumbers : [],
      lastPublishedAt: parsed.lastPublishedAt || null
    };
  } catch {
    throw new Error("VEIL FOUND publisher state file is unreadable; refusing to publish.");
  }
}

async function writeState(workDir, state) {
  await mkdir(workDir, { recursive: true });
  const file=stateFilePath(workDir),temp=file+".tmp";
  await writeFile(temp, `${JSON.stringify(state, null, 2)}\n`,{mode:0o600});
  await rename(temp,file);
}

export function queueItems(entries) {
  return entries
    .filter((entry) => entry?.[".tag"] === "file" && isImageName(entry.name))
    .map((entry) => {
      const number = parseVeilFoundNumber(entry.name);
      return number ? { number, image: entry } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.number - b.number || String(a.image.name).localeCompare(String(b.image.name)));
}

function seoulParts(date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);
  return Object.fromEntries(parts.map(({ type, value }) => [type, value]));
}

export function resolveVeilFoundSlot(date = new Date()) {
  const p = seoulParts(date);
  if (p.weekday !== "Fri" || Number(p.hour) !== 20) return null;
  return { key: `${p.year}-${p.month}-${p.day}@20:00`, type: "weekly-friday" };
}

function feedNumberSet(feed) {
  const set = new Set();
  for (const item of feed || []) {
    for (const number of extractFeedNumbersFromCaption(item.caption)) set.add(number);
  }
  return set;
}

function slotLimitForMissingCount(count) {
  return count > 7 ? Math.min(10, count) : Math.min(7, count);
}

async function reconcileAlreadyPublished(readyItems, publishedNumbers, config, options) {
  const moved = [];
  for (const item of readyItems) {
    if (!publishedNumbers.has(item.number)) continue;
    await moveDropboxFile(
      item.image.path_lower || item.image.path_display,
      `${config.uploadedDir}/${item.image.name}`,
      options
    );
    moved.push(item.number);
  }
  return moved;
}

export async function getVeilFoundStatus(
  { env = process.env, workDir, fetchImpl = fetch } = {}
) {
  const config = veilFoundConfig(env);
  const state = await readState(workDir);

  if (!isVeilFoundConfigured(env)) {
    return {
      configured: false,
      schedule: "Friday 20:00 KST",
      lastPublishedAt: state.lastPublishedAt
    };
  }

  const [accessToken, feed] = await Promise.all([
    getDropboxAccessToken({ env, fetchImpl }),
    fetchInstagramFeed({ config, fetchImpl })
  ]);

  const entries = await listDropboxFolder(config.readyDir, { accessToken, fetchImpl });
  const readyItems = queueItems(entries);
  const publishedNumbers = feedNumberSet(feed);
  const missingItems = readyItems.filter((item) => !publishedNumbers.has(item.number));

  return {
    configured: true,
    schedule: "Friday 20:00 KST",
    readyCount: readyItems.length,
    feedNumberCount: publishedNumbers.size,
    readyNumbers: readyItems.map((item) => item.number),
    missingNumbers: missingItems.map((item) => item.number),
    nextRunLimit: slotLimitForMissingCount(missingItems.length),
    currentSlotKey: state.slotKey,
    currentSlotLimit: state.slotLimit,
    postedThisSlot: state.postedNumbers,
    lastPublishedAt: state.lastPublishedAt
  };
}

export async function runVeilFoundPublisher(
  {
    env = process.env,
    workDir,
    now = new Date(),
    force = false,
    approvedPosts,
    onEvent = async () => {},
    fetchImpl = fetch,
    sleepImpl
  } = {}
) {
  if (publisherRunning) return { ok: true, skipped: true, reason: "already_running" };
  publisherRunning = true;

  try {
    const config = veilFoundConfig(env);
    if (!isVeilFoundConfigured(env)) {
      return { ok: false, skipped: true, reason: "not_configured" };
    }

    const slot = force ? { key: `manual:${now.toISOString()}`, type: "manual" } : resolveVeilFoundSlot(now);
    if (!slot) return { ok: true, skipped: true, reason: "not_due" };

    const accessToken = await getDropboxAccessToken({ env, fetchImpl });

    let entries = await listDropboxFolder(config.readyDir, { accessToken, fetchImpl });
    let readyItems = queueItems(entries);
    if(approvedPosts) readyItems=readyItems.filter(item=>approvedPosts.some(p=>p.number===item.number));

    let feed = await fetchInstagramFeed({ config, fetchImpl });
    let publishedNumbers = feedNumberSet(feed);

    const reconciledNumbers = await reconcileAlreadyPublished(
      readyItems,
      publishedNumbers,
      config,
      { accessToken, fetchImpl }
    );

    if (reconciledNumbers.length) {
      entries = await listDropboxFolder(config.readyDir, { accessToken, fetchImpl });
      readyItems = queueItems(entries);
      if(approvedPosts) readyItems=readyItems.filter(item=>approvedPosts.some(p=>p.number===item.number));
    }

    let missingItems = readyItems.filter((item) => !publishedNumbers.has(item.number));
    if (!missingItems.length) {
      return {
        ok: true,
        skipped: true,
        reason: "nothing_missing",
        reconciledNumbers,
        feedNumbers: [...publishedNumbers].sort((a, b) => a - b)
      };
    }

    const stateDir=force ? join(workDir,"veil-found-manual") : workDir;
    let state = await readState(stateDir);
    if (state.slotKey !== slot.key) {
      state = {
        version: 5,
        slotKey: slot.key,
        slotLimit: slotLimitForMissingCount(missingItems.length),
        postedNumbers: [],
        lastPublishedAt: state.lastPublishedAt || null
      };
      await writeState(stateDir, state);
    }

    const remainingAllowance = Math.max(0, Number(state.slotLimit || 0) - state.postedNumbers.length);
    if (remainingAllowance <= 0) {
      return {
        ok: true,
        skipped: true,
        reason: "weekly_limit_reached",
        slotKey: slot.key,
        slotLimit: state.slotLimit,
        postedNumbers: state.postedNumbers
      };
    }

    if(approvedPosts) missingItems = missingItems.filter(item => approvedPosts.some(p => p.number === item.number));
    const toPublish = missingItems.slice(0, remainingAllowance);
    // Resolve every caption before any Instagram write.
    for(const item of toPublish){
      const resolved=await resolveVeilCaption(item, config, {accessToken,fetchImpl});
      Object.assign(item,resolved);
      if(approvedPosts){
        const approved=approvedPosts.find(p=>p.number===item.number);
        if(!approved || approved.revision!==item.image.rev || approved.caption!==item.caption || approved.path!==(item.image.path_lower||item.image.path_display))throw new Error('approved_post_changed');
      }
    }
    const publishedNow = [];

    for (const item of toPublish) {
      // Re-check the real feed before every post. This catches a manual post made while
      // the automation is running and prevents duplicate #number publication.
      feed = await fetchInstagramFeed({ config, fetchImpl });
      publishedNumbers = feedNumberSet(feed);

      if (publishedNumbers.has(item.number)) {
        await moveDropboxFile(
          item.image.path_lower || item.image.path_display,
          `${config.uploadedDir}/${item.image.name}`,
          { accessToken, fetchImpl }
        );
        continue;
      }

      const fresh=queueItems(await listDropboxFolder(config.readyDir,{accessToken,fetchImpl})).filter(p=>p.number===item.number);
      if(fresh.length!==1||fresh[0].image.rev!==item.image.rev)throw new Error('source_image_changed');
      const currentCaption=await resolveVeilCaption(item,config,{accessToken,fetchImpl});
      if(currentCaption.caption!==item.caption)throw new Error('source_caption_changed');
      const imageUrl = await getDropboxTemporaryLink(
        item.image.path_lower || item.image.path_display,
        { accessToken, fetchImpl }
      );

      await onEvent({status:"publishing",number:item.number});
      const published = await publishSingleImage({
        imageUrl,
        caption: item.caption,
        config,
        fetchImpl,
        sleepImpl
      });

      await onEvent({status:"published",number:item.number,mediaId:published.mediaId});
      // Persist the weekly count immediately after each successful Instagram post.
      state.postedNumbers = [...state.postedNumbers, item.number];
      state.lastPublishedAt = new Date().toISOString();
      await writeState(stateDir, state);

      // A file replaced while Meta was publishing is not the successfully published original.
      const afterPublish=queueItems(await listDropboxFolder(config.readyDir,{accessToken,fetchImpl})).filter(p=>p.number===item.number);
      if(afterPublish.length!==1||afterPublish[0].image.rev!==item.image.rev)throw new Error('published_source_changed_not_moved');
      // Only move the source after Instagram confirmed a media id.
      await moveDropboxFile(
        item.image.path_lower || item.image.path_display,
        `${config.uploadedDir}/${item.image.name}`,
        { accessToken, fetchImpl }
      );

      publishedNow.push({
        number: item.number,
        mediaId: published.mediaId,
        fileName: item.image.name
      });
    }

    return {
      ok: true,
      skipped: false,
      slotKey: slot.key,
      slotLimit: state.slotLimit,
      reconciledNumbers,
      publishedNow,
      postedThisSlot: state.postedNumbers,
      remainingAllowance: Math.max(0, state.slotLimit - state.postedNumbers.length)
    };
  } finally {
    publisherRunning = false;
  }
}

export function validateVeilCaption(text,number){
 const lines=String(text).replace(/^\uFEFF/,'').replace(/\r\n/g,'\n').trim().split('\n');
 if(lines.length!==4 || lines.some(l=>!l.trim()) || !new RegExp('^VEIL FOUND #0*'+number+'$').test(lines[0].trim()) || !/^(?:[\d,]+(?:\.\d+)?\s*(?:KRW|원)|SOLD OUT)$/i.test(lines[3].trim()) || lines.join('\n').length>2200)throw new Error('invalid_four_line_caption');
 return lines.join('\n');
}
export async function resolveVeilCaption(item,config,{accessToken,fetchImpl=fetch}){
 const number=item.number, folder=String(number).padStart(3,'0');
 const roots=await listDropboxFolder(config.readyDir,{accessToken,fetchImpl});
 const candidates=[];
 if(roots.some(e=>e['.tag']==='folder'&&e.name===folder)) candidates.push(`${config.readyDir}/${folder}/caption.txt`);
 for(const e of roots){const m=e.name?.match(/^VEIL_FOUND_(\d+)-(\d+)$/);if(e['.tag']==='folder'&&m&&number>=Number(m[1])&&number<=Number(m[2]))candidates.push(`${config.readyDir}/${e.name}/${folder}/caption.txt`);}
 if(candidates.length!==1)throw new Error('caption_path_missing_or_ambiguous');
 const response=await fetchImpl('https://content.dropboxapi.com/2/files/download',{method:'POST',headers:{Authorization:`Bearer ${accessToken}`,'Dropbox-API-Arg':JSON.stringify({path:candidates[0]}).replace(/[\u007f-\uffff]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0'))}});
 if(!response.ok)throw new Error('caption_read_failed');
 return {caption:validateVeilCaption(await response.text(),number),captionPath:candidates[0]};
}
export async function previewVeilPosts({env=process.env,fetchImpl=fetch}={}){
 if(!isVeilFoundConfigured(env))throw new Error('not_configured');
 const config=veilFoundConfig(env),accessToken=await getDropboxAccessToken({env,fetchImpl});
 const entries=await listDropboxFolder(config.readyDir,{accessToken,fetchImpl}),feed=await fetchInstagramFeed({config,fetchImpl}),numbers=feedNumberSet(feed),items=queueItems(entries),seen=new Set();
 const posts=[];
 for(const item of items){
  const post={number:item.number,path:item.image.path_lower||item.image.path_display,revision:item.image.rev,fileName:item.image.name,duplicate:numbers.has(item.number),valid:true};
  try{if(!post.revision||seen.has(item.number))throw new Error('image_number_ambiguous_or_revision_missing');Object.assign(post,await resolveVeilCaption(item,config,{accessToken,fetchImpl}));}catch(error){post.valid=false;post.error=error.message;}
  seen.add(item.number);posts.push(post);
 }
 // Reject both sides of duplicate file numbers, rather than picking one.
 for(const post of posts)if(items.filter(i=>i.number===post.number).length!==1){post.valid=false;post.error='image_number_ambiguous';}
 return {ok:true,posts,warnings:posts.some(p=>/\.png$/i.test(p.fileName))?['PNG originals are passed unchanged; Meta acceptance has not been live-verified.']:[]};
}
