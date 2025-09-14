let _blobsPromise;
export function getBlobs(){ if(!_blobsPromise) _blobsPromise=import('@netlify/blobs'); return _blobsPromise; }
export async function loadNdjson(source){
  if(!source) return '';
  if(typeof source==='string'){
    if(/^data:/i.test(source)){
      const m=source.match(/^data:([^,]*?),(.*)$/i); if(!m) return '';
      const meta=m[1]||''; const data=m[2]||'';
      return /;base64/i.test(meta)?Buffer.from(data,'base64').toString('utf8'):decodeURIComponent(data);
    }
    if(/^https?:\/\//i.test(source)){
      const res=await fetch(source);
      if(!res.ok) throw new Error(`fetch ${source} -> ${res.status}`);
      return await res.text();
    }
    if(/^(store:|blob:)/i.test(source)){
      const spec=source.replace(/^(store:|blob:)/i,'');
      const [storeName,...rest]=spec.split(/[/:]/); const key=rest.join('/');
      if(!storeName||!key) return '';
      const {getStore}=await getBlobs(); const store=getStore({name:storeName});
      return (await store.get(key,{type:'text'}))??'';
    }
    if(/^[^/]+\/.+/.test(source)){
      const [storeName,...rest]=source.split('/'); const key=rest.join('/');
      const {getStore}=await getBlobs(); const store=getStore({name:storeName});
      return (await store.get(key,{type:'text'}))??'';
    }
  }
  const cfg=(typeof source==='object'&&source)||{};
  if(cfg.url) return await loadNdjson(String(cfg.url));
  if(cfg.blobKey) return await loadNdjson(String(cfg.blobKey));
  if(cfg.store&&cfg.key){
    const {getStore}=await getBlobs(); const s=getStore({name:String(cfg.store)});
    return (await s.get(String(cfg.key),{type:'text'}))??'';
  }
  return '';
}
export function parseNdjsonToArray(text){
  if(!text) return [];
  return String(text).split(/\r?\n/).filter(Boolean).map(l=>{ try{return JSON.parse(l);}catch{return l;} });
}
export function diagWindow(info={}){
  const bets = Array.isArray(info.bets) ? info.bets : [];
  const mkt  = Array.isArray(info.mkt)  ? info.mkt  : [];
  const counts = { bets: bets.length, mkt: mkt.length, matched:0, coveragePct:0, inWindow:0, inWindowPct:0, oddsHas:0, oddsPct:0 };
  return { ok:true, nowISO:new Date().toISOString(), byStatus:{}, upcoming:[], inside:[], counts, ...info };
}; }
export async function loadWindowNdjson(kind='mkt'){
  const e=process.env||{};
  const url = kind==='bets'? e.EV_BETS_URL : e.EV_MKT_URL;
  const blobKey = kind==='bets'? e.EV_BETS_BLOB_KEY : e.EV_MKT_BLOB_KEY;
  if(url) return await loadNdjson(url);
  if(blobKey){
    const spec=/^(store:|blob:)/i.test(blobKey)? blobKey : `store:${blobKey}`;
    return await loadNdjson(spec);
  }
  return '';
}
const _default={getBlobs,loadNdjson,loadWindowNdjson,parseNdjsonToArray,diagWindow};
export default _default;
