//! Independent JSON Schema subset reader; no managed runtime is simulated here.
use serde_json::Value;
use std::{env,fs,process};
fn check(s:&Value,v:&Value,root:&Value,depth:usize,nodes:&mut usize)->Result<(),String>{
 *nodes+=1;if depth>128||*nodes>2_000_000{return Err("SCHEMA_LIMIT".into())}
 if s==&Value::Bool(true){return Ok(())}if s==&Value::Bool(false){return Err("SCHEMA_INVALID".into())}
 let definition=s.as_object().ok_or("SCHEMA_DEFINITION")?;
 let keys=["$schema","$id","$ref","$defs","title","description","type","properties","required","additionalProperties","items","minItems","maxItems","uniqueItems","minimum","maximum","minLength","maxLength","pattern","enum","const","anyOf","oneOf"];
 if definition.keys().any(|k|!keys.contains(&k.as_str())){return Err("SCHEMA_DEFINITION".into())}
 if let Some(r)=s.get("$ref").and_then(Value::as_str){if !r.starts_with("#/"){return Err("SCHEMA_DEFINITION".into())}let target=root.pointer(&r[1..]).ok_or("SCHEMA_DEFINITION")?;check(target,v,root,depth+1,nodes)?;}
 for key in ["anyOf","oneOf"] {if let Some(branches)=s.get(key){let mut count=0;for branch in branches.as_array().ok_or("SCHEMA_DEFINITION")?{match check(branch,v,root,depth+1,nodes){Ok(())=>count+=1,Err(e) if e=="SCHEMA_INVALID"=>{},Err(e)=>return Err(e)}}if count==0||key=="oneOf"&&count!=1{return Err("SCHEMA_INVALID".into())}}}
 let matches=|t:&str|match t {"null"=>v.is_null(),"object"=>v.is_object(),"array"=>v.is_array(),"string"=>v.is_string(),"boolean"=>v.is_boolean(),"number"=>v.is_number(),"integer"=>v.as_f64().is_some_and(|n|n.fract()==0.0&&n.abs()<=9007199254740991.0),_=>false};
 if let Some(t)=s.get("type"){let valid=if let Some(name)=t.as_str(){matches(name)}else{t.as_array().ok_or("SCHEMA_DEFINITION")?.iter().any(|n|n.as_str().is_some_and(matches))};if !valid{return Err("SCHEMA_INVALID".into())}}
 if s.get("const").is_some_and(|c|c!=v){return Err("SCHEMA_INVALID".into())}
 if let Some(values)=s.get("enum"){if !values.as_array().ok_or("SCHEMA_DEFINITION")?.contains(v){return Err("SCHEMA_INVALID".into())}}
 if let Some(n)=v.as_f64(){if s.get("minimum").and_then(Value::as_f64).is_some_and(|m|n<m)||s.get("maximum").and_then(Value::as_f64).is_some_and(|m|n>m){return Err("SCHEMA_INVALID".into())}}
 if let Some(text)=v.as_str(){let len=text.encode_utf16().count() as u64;if s.get("minLength").and_then(Value::as_u64).is_some_and(|m|len<m)||s.get("maxLength").and_then(Value::as_u64).is_some_and(|m|len>m){return Err("SCHEMA_INVALID".into())}if let Some(pattern)=s.get("pattern").and_then(Value::as_str){if !regex::Regex::new(pattern).map_err(|_|"SCHEMA_DEFINITION")?.is_match(text){return Err("SCHEMA_INVALID".into())}}}
 if let Some(items)=v.as_array(){let len=items.len() as u64;if s.get("minItems").and_then(Value::as_u64).is_some_and(|m|len<m)||s.get("maxItems").and_then(Value::as_u64).is_some_and(|m|len>m){return Err("SCHEMA_INVALID".into())}if s.get("uniqueItems")==Some(&Value::Bool(true)){let mut seen=std::collections::HashSet::new();for item in items{if !seen.insert(item.to_string()){return Err("SCHEMA_INVALID".into())}}}if let Some(item_schema)=s.get("items"){for item in items{check(item_schema,item,root,depth+1,nodes)?;}}}
 if let Some(object)=v.as_object(){if let Some(required)=s.get("required"){for key in required.as_array().ok_or("SCHEMA_DEFINITION")?{if !object.contains_key(key.as_str().ok_or("SCHEMA_DEFINITION")?){return Err("SCHEMA_INVALID".into())}}}for (key,item) in object {if let Some(prop)=s.get("properties").and_then(|p|p.get(key)){check(prop,item,root,depth+1,nodes)?}else if let Some(additional)=s.get("additionalProperties"){check(additional,item,root,depth+1,nodes)?}}}
 Ok(())
}
fn run()->Result<(),String>{let args:Vec<_>=env::args().collect();if args.len()!=3{return Err("USAGE: sharpforge-schema-reader schema.json document.json".into())}let read=|path:&str|->Result<Value,String>{let bytes=fs::read(path).map_err(|_|"SCHEMA_IO")?;if bytes.len()>64*1024*1024{return Err("SCHEMA_LIMIT".into())}serde_json::from_slice(&bytes).map_err(|_|"SCHEMA_JSON".into())};let schema=read(&args[1])?;let document=read(&args[2])?;if document.get("schemaVersion").is_some_and(|v|v!=1)||schema.get("properties").and_then(|p|p.get("formatVersion")).is_some()&&document.get("formatVersion").is_some_and(|v|v!=1){return Err("SCHEMA_VERSION".into())}check(&schema,&document,&schema,0,&mut 0)?;println!("OK");Ok(())}
fn main(){if let Err(error)=run(){eprintln!("{error}");process::exit(1)}}
