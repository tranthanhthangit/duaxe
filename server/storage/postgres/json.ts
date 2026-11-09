import {createHash} from 'node:crypto';
export function canonical(value:unknown):string {return JSON.stringify(normalize(value));}
function normalize(value:unknown):unknown {if(Array.isArray(value))return value.map(normalize);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([,v])=>v!==undefined).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,normalize(v)]));return value;}
export const checksum=(value:unknown)=>createHash('sha256').update(canonical(value)).digest('hex');
