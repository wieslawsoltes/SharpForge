/**
 * Assembly identities (ECMA-335 II.22.2 / II.22.5) with Roslyn's display, parsing and comparison rules.
 *
 * An identity is name + version + culture + public key (or token) + the Retargetable flag + content type.
 * `compareAssemblyIdentity` follows Roslyn's AssemblyIdentityComparer: weakly named definitions match on
 * simple name (and culture) alone, strongly named ones need the same key and, unless a framework
 * unification policy applies, the same version.
 */
const hex=bytes=>Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
const unhex=text=>Uint8Array.from(text.match(/../g)??[],h=>parseInt(h,16));
const rotl=(x,n)=>(x<<n)|(x>>>(32-n));
/** SHA-1 of a byte array; public key tokens are the last eight bytes of this digest, reversed. */
export function sha1(bytes){
  const length=bytes.length,padded=new Uint8Array(((length+8>>>6)+1)*64);padded.set(bytes);padded[length]=0x80;const view=new DataView(padded.buffer);view.setUint32(padded.length-8,Math.floor(length/0x20000000));view.setUint32(padded.length-4,(length<<3)>>>0);
  let h0=0x67452301,h1=0xefcdab89,h2=0x98badcfe,h3=0x10325476,h4=0xc3d2e1f0;const w=new Int32Array(80);
  for(let at=0;at<padded.length;at+=64){
    for(let i=0;i<16;i++)w[i]=view.getInt32(at+i*4);for(let i=16;i<80;i++)w[i]=rotl(w[i-3]^w[i-8]^w[i-14]^w[i-16],1);
    let a=h0,b=h1,c=h2,d=h3,e=h4;
    for(let i=0;i<80;i++){const f=i<20?(b&c)|(~b&d):i<40?b^c^d:i<60?(b&c)|(b&d)|(c&d):b^c^d,k=i<20?0x5a827999:i<40?0x6ed9eba1:i<60?0x8f1bbcdc:0xca62c1d6,t=(rotl(a,5)+f+e+k+w[i])|0;e=d;d=c;c=rotl(b,30);b=a;a=t;}
    h0=(h0+a)|0;h1=(h1+b)|0;h2=(h2+c)|0;h3=(h3+d)|0;h4=(h4+e)|0;
  }
  const out=new Uint8Array(20),ov=new DataView(out.buffer);[h0,h1,h2,h3,h4].forEach((h,i)=>ov.setInt32(i*4,h));return out;
}
/** The 8-byte public key token (lower-case hex) of a full public key blob. */
export function publicKeyToken(publicKey){return publicKey.length?hex(sha1(publicKey).slice(12).reverse()):'';}
/** Which parts a parsed display name specified (Roslyn AssemblyIdentityParts). */
export const AssemblyIdentityParts=Object.freeze({Name:1,Version:2,Culture:4,PublicKeyOrToken:8,Retargetability:16,ContentType:32});
export const IdentityComparison=Object.freeze({NotEquivalent:'notEquivalent',Equivalent:'equivalent',EquivalentIgnoringVersion:'equivalentIgnoringVersion'});
const sameText=(a,b)=>a.toLowerCase()===b.toLowerCase();
const versionOf=v=>{const parts=Array.isArray(v)?v:String(v??'0.0.0.0').split('.').map(Number);if(parts.length>4||parts.some(n=>!Number.isInteger(n)||n<0||n>65535))throw new RangeError(`Invalid assembly version '${v}'`);return Object.freeze([parts[0]??0,parts[1]??0,parts[2]??0,parts[3]??0]);};
/** -1, 0 or 1 for two four-part versions. */
export function compareVersions(a,b){for(let i=0;i<4;i++)if(a[i]!==b[i])return a[i]<b[i]?-1:1;return 0;}

/** An immutable assembly identity. */
export class AssemblyIdentity {
  /** @param {object} init name, version (array or dotted text), cultureName, publicKey (hex or bytes), publicKeyToken (hex or bytes), isRetargetable, contentType ('default'|'windowsRuntime'). */
  constructor(init={}){
    if(!init.name)throw new RangeError('An assembly identity needs a simple name');
    const text=v=>v==null?'':typeof v==='string'?v.toLowerCase():hex(v);
    this.name=init.name;this.version=versionOf(init.version);this.cultureName=init.cultureName&&!sameText(init.cultureName,'neutral')?init.cultureName:'';
    this.publicKey=text(init.publicKey);this.publicKeyToken=this.publicKey?publicKeyToken(unhex(this.publicKey)):text(init.publicKeyToken);
    this.isRetargetable=!!init.isRetargetable;this.contentType=init.contentType??'default';Object.freeze(this);
  }
  get hasPublicKey(){return this.publicKey!=='';}
  get isStrongName(){return this.publicKeyToken!=='';}
  get versionText(){return this.version.join('.');}
  /** Full-identity equality (Roslyn AssemblyIdentity.Equals): names and cultures compare case-insensitively. */
  equals(other){return other instanceof AssemblyIdentity&&sameText(this.name,other.name)&&compareVersions(this.version,other.version)===0&&sameText(this.cultureName,other.cultureName)&&this.publicKeyToken===other.publicKeyToken&&this.isRetargetable===other.isRetargetable&&this.contentType===other.contentType;}
  /** `Name, Version=1.0.0.0, Culture=neutral, PublicKeyToken=null`; `fullKey` writes PublicKey= when the full key is known. */
  getDisplayName(fullKey=false){
    const escaped=this.name.replace(/[\\,="']/g,c=>'\\'+c);
    return escaped+', Version='+this.versionText+', Culture='+(this.cultureName||'neutral')+(fullKey&&this.hasPublicKey?', PublicKey='+this.publicKey:', PublicKeyToken='+(this.publicKeyToken||'null'))+(this.isRetargetable?', Retargetable=Yes':'')+(this.contentType==='windowsRuntime'?', ContentType=WindowsRuntime':'');
  }
  toString(){return this.getDisplayName();}
  /** A copy with another version (used when describing unification results). */
  withVersion(version){return new AssemblyIdentity({name:this.name,version,cultureName:this.cultureName,publicKey:this.publicKey,publicKeyToken:this.publicKeyToken,isRetargetable:this.isRetargetable,contentType:this.contentType});}
  /**
   * Parses a display name. Returns `{identity,parts}` or null when the text is not a valid display name.
   * A partial version (`Version=1.2`) is accepted and reported by leaving the Version part out of `parts`.
   */
  static tryParse(displayName){
    if(typeof displayName!=='string')return null;const pieces=[];let current='',quote=null;
    for(let i=0;i<displayName.length;i++){const c=displayName[i];if(c==='\\'&&i+1<displayName.length){current+=displayName[++i];continue;}if(quote){if(c===quote)quote=null;else current+=c;continue;}if(c==='"'||c==="'"){quote=c;continue;}if(c===','){pieces.push(current);current='';continue;}current+=c;}
    if(quote)return null;pieces.push(current);const name=pieces.shift().trim();if(!name||name.includes('='))return null;
    const init={name};let parts=AssemblyIdentityParts.Name;const seen=new Set();
    for(const piece of pieces){
      const eq=piece.indexOf('=');if(eq<0)return null;const key=piece.slice(0,eq).trim().toLowerCase(),value=piece.slice(eq+1).trim();if(!value||seen.has(key))return null;seen.add(key);
      if(key==='version'){const numbers=value.split('.');if(numbers.length>4||numbers.some(n=>!/^\d{1,5}$/.test(n)||Number(n)>65535))return null;init.version=numbers.map(Number);if(numbers.length===4)parts|=AssemblyIdentityParts.Version;}
      else if(key==='culture'||key==='language'){init.cultureName=value;parts|=AssemblyIdentityParts.Culture;}
      else if(key==='publickeytoken'){if(!sameText(value,'null')&&!/^[0-9a-f]{16}$/i.test(value))return null;init.publicKeyToken=sameText(value,'null')?'':value;parts|=AssemblyIdentityParts.PublicKeyOrToken;}
      else if(key==='publickey'){if(!sameText(value,'null')&&(!/^([0-9a-f]{2})+$/i.test(value)))return null;init.publicKey=sameText(value,'null')?'':value;parts|=AssemblyIdentityParts.PublicKeyOrToken;}
      else if(key==='retargetable'){if(!sameText(value,'yes')&&!sameText(value,'no'))return null;init.isRetargetable=sameText(value,'yes');parts|=AssemblyIdentityParts.Retargetability;}
      else if(key==='contenttype'){if(!sameText(value,'windowsruntime'))return null;init.contentType='windowsRuntime';parts|=AssemblyIdentityParts.ContentType;}
      // Unknown properties (processorArchitecture, custom) are ignored, as Roslyn does.
    }
    if(init.isRetargetable&&!(parts&AssemblyIdentityParts.PublicKeyOrToken&&parts&AssemblyIdentityParts.Version&&parts&AssemblyIdentityParts.Culture))return null;
    return {identity:new AssemblyIdentity(init),parts};
  }
  /** Parses a display name or throws. */
  static parse(displayName){const result=AssemblyIdentity.tryParse(displayName);if(!result)throw new RangeError(`Invalid assembly display name '${displayName}'`);return result.identity;}
}
const fullParts=AssemblyIdentityParts.Name|AssemblyIdentityParts.Version|AssemblyIdentityParts.Culture|AssemblyIdentityParts.PublicKeyOrToken;
/**
 * Compares a reference identity with a definition identity (Roslyn AssemblyIdentityComparer.Compare).
 * @param {AssemblyIdentity|string} reference an identity, or a possibly partial display name
 * @param {AssemblyIdentity} definition
 * @param {object} [options] ignoreVersion: report EquivalentIgnoringVersion instead of NotEquivalent for a strong-name
 *   version mismatch (the reference manager needs this); isFrameworkAssembly(identity): a unification policy -
 *   versions of framework assemblies are unified, which makes them Equivalent with `unificationApplied`.
 * @returns {{result:string,unificationApplied:boolean}}
 */
export function compareAssemblyIdentity(reference,definition,options={}){
  const no={result:IdentityComparison.NotEquivalent,unificationApplied:false},yes={result:IdentityComparison.Equivalent,unificationApplied:false};
  let parts=fullParts;const text=typeof reference==='string'?reference:null;
  if(typeof reference==='string'){const parsed=AssemblyIdentity.tryParse(reference);if(!parsed)return no;reference=parsed.identity;parts=parsed.parts;}
  if(parts===fullParts&&!reference.isRetargetable&&reference.equals(definition))return yes;
  if(reference.contentType!==definition.contentType)return no;
  if(!sameText(reference.name,definition.name))return no;
  const compareCulture=!!(parts&AssemblyIdentityParts.Culture),compareKey=!!(parts&AssemblyIdentityParts.PublicKeyOrToken);
  if(compareCulture&&!sameText(reference.cultureName,definition.cultureName))return no;
  // A retargetable reference binds to the platform's own build of the assembly whatever its key and version.
  if(reference.isRetargetable&&!definition.isRetargetable)return {result:IdentityComparison.Equivalent,unificationApplied:compareVersions(reference.version,definition.version)!==0||reference.publicKeyToken!==definition.publicKeyToken};
  if(!definition.isStrongName)return compareKey&&reference.isStrongName?no:yes;
  if(compareKey&&reference.publicKeyToken!==definition.publicKeyToken)return no;
  const hasVersion=!!(parts&AssemblyIdentityParts.Version),specifiedVersion=text===null||/version\s*=/i.test(text);
  if(specifiedVersion&&(!hasVersion||compareVersions(reference.version,definition.version)!==0)){
    if(hasVersion&&options.isFrameworkAssembly?.(definition))return {result:IdentityComparison.Equivalent,unificationApplied:true};
    return hasVersion&&options.ignoreVersion?{result:IdentityComparison.EquivalentIgnoringVersion,unificationApplied:false}:no;
  }
  return yes;
}
/** True when `reference` binds to `definition` without any version leeway. */
export const referenceMatchesDefinition=(reference,definition,options)=>compareAssemblyIdentity(reference,definition,options).result===IdentityComparison.Equivalent;
