/** Bounded document-location history. It stores locations, not source text or editor instances. */
export class NavigationHistory {
  constructor({limit=100}={}){if(!Number.isSafeInteger(limit)||limit<1||limit>10000)throw new RangeError('Invalid navigation history limit');this.limit=limit;this.clear();}
  clear(){this.entries=[];this.index=-1;}
  location(value){if(!value||typeof value.uri!=='string'||!value.uri||value.uri.length>8192||!Number.isSafeInteger(value.start)||value.start<0||!Number.isSafeInteger(value.end??value.start)||(value.end??value.start)<value.start)throw new TypeError('Invalid document location');return Object.freeze({uri:value.uri,start:value.start,end:value.end??value.start});}
  get current(){return this.entries[this.index]??null;}
  get canBack(){return this.index>0;}
  get canForward(){return this.index>=0&&this.index<this.entries.length-1;}
  update(value){const item=this.location(value);if(this.index<0)return this.push(item);this.entries[this.index]=item;return item;}
  push(value){const item=this.location(value),current=this.current;if(current&&current.uri===item.uri&&current.start===item.start&&current.end===item.end)return current;this.entries.splice(this.index+1);this.entries.push(item);if(this.entries.length>this.limit)this.entries.shift();this.index=this.entries.length-1;return item;}
  back(current){if(current)this.update(current);return this.canBack?this.entries[--this.index]:null;}
  forward(current){if(current)this.update(current);return this.canForward?this.entries[++this.index]:null;}
  snapshot(){return {entries:[...this.entries],index:this.index,canBack:this.canBack,canForward:this.canForward};}
}
