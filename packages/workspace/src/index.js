import { SourceText, BoundedCache } from '@sharpforge/text';
import {documentSyntax} from './syntax-cache.js';
import {compileWorkspace} from './compilation.js';
/** Versioned workspace. Unchanged documents retain their complete syntax trees; semantic binding is compilation-wide. */
export class Workspace {
  constructor({maxDocumentLength=2_000_000,maxDocuments=100,tokenCacheSize=32768,extensions=null,extensionOptions={},additionalFiles=[],compilationOptions={}}={}){this.compilationOptions={...compilationOptions};this.extensions=extensions;this.extensionOptions=extensionOptions;this.additionalFiles=additionalFiles;this.generatedDocuments=new Map();this.documents=new Map();this.tokenCache=new BoundedCache(tokenCacheSize);this.revision=0;this.result=null;this.maxDocumentLength=maxDocumentLength;this.maxDocuments=maxDocuments;this.metrics={parsedDocuments:0,syntaxCacheHits:0,compilationCacheHits:0};}
  update(uri,text,version){
    if(typeof uri==='string'&&uri.startsWith('generated://'))throw new Error('Generated documents are read-only');if(typeof uri!=='string'||!uri||typeof text!=='string')throw new TypeError('A URI and source string are required');if(text.length>this.maxDocumentLength)throw new RangeError('Document exceeds the source size limit');
    const old=this.documents.get(uri);version??=(old?.source.version??0)+1;if(old&&version<=old.source.version)return false;
    if(old?.source.text===text){old.source=new SourceText(text,uri,version);old.parsed=null;this.result=null;this.revision++;return true;}
    if(!old&&this.documents.size>=this.maxDocuments)throw new RangeError('Workspace document limit exceeded');
    this.documents.set(uri,{source:new SourceText(text,uri,version),parsed:null});this.revision++;this.result=null;return true;
  }
  change(uri,changes,version){let source=this.documents.get(uri)?.source;if(!source)throw new Error('Document is not open');if(version<=source.version)return false;for(const change of changes){if(change.range){const start=source.offsetAt(change.range.start),end=source.offsetAt(change.range.end);source=source.withChange(start,end-start,change.text);}else source=new SourceText(change.text,uri,version);}return this.update(uri,source.text,version);}
  remove(uri){if(this.documents.delete(uri)){this.revision++;this.result=null;}}
  /** Read syntax using configured or explicitly supplied compilation settings. */
  syntax(uri, options=this.compilationOptions){return documentSyntax(this,uri,options);}
  compile(options={}){return compileWorkspace(this,options);}
  /** Semantic source queries share the current compilation and are invalidated with every source/options change. */
  sourceModel(options={}){this.compile(options);return this.documents.size?this.compilation.getSourceModel():null;}
  exportProject(){return {format:'sharpforge-project',version:1,files:[...this.documents.values()].map(d=>({uri:d.source.uri,text:d.source.text,version:d.source.version}))};}
  importProject(project){if(project?.format!=='sharpforge-project'||project.version!==1||!Array.isArray(project.files))throw new Error('Not a SharpForge project');if(project.files.length>this.maxDocuments)throw new Error('Too many documents');const next=new Workspace({maxDocumentLength:this.maxDocumentLength,maxDocuments:this.maxDocuments});for(const file of project.files)next.update(file.uri,file.text,1);this.documents=next.documents;this.generatedDocuments.clear();this.revision++;this.result=null;}
}
