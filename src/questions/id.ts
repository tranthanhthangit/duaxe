/** Question IDs are identifiers, never authentication credentials. Works on HTTP LAN too. */
export function newQuestionId() {
 if(typeof crypto.randomUUID==='function')return crypto.randomUUID();
 const bytes=crypto.getRandomValues(new Uint8Array(16));
 return 'q-'+Array.from(bytes,value=>value.toString(16).padStart(2,'0')).join('');
}
