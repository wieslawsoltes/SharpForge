import {SourceText} from '@sharpforge/text';
import {ExtensionDriver,BuildInfoGenerator,JsonSchemaGenerator} from '@sharpforge/extensions';
/** Feed actual generated source to direct compiler tests; never substitute a hand-written model. */
export function sampleSources(sample){
  if(!sample.extensions)return sample.files;
  const config=sample.extensions,driver=new ExtensionDriver();
  if(config.buildInfo)driver.registerGenerator(BuildInfoGenerator);
  if(config.schema)driver.registerGenerator(JsonSchemaGenerator);
  const generated=driver.generate(sample.files.map(f=>new SourceText(f.text,f.uri,1)),{additionalFiles:config.additionalFiles??[],options:{version:config.version,schemaProperties:!!config.schemaProperties}});
  if(generated.diagnostics.some(d=>d.severity==='error'))throw new Error(JSON.stringify(generated.diagnostics));
  return [...sample.files,...generated.files];
}
