export { sha256, sha1 } from '@sharpforge/cil';
export const hex=b=>Array.from(b,x=>x.toString(16).padStart(2,'0')).join('');
