import {appendFileSync} from 'node:fs';
import {args,isMain,json} from './core.js';
import {summary} from './compare.js';
if(isMain(import.meta.url)){const a=args(),text=summary(json(a.input));if(process.env.GITHUB_STEP_SUMMARY)appendFileSync(process.env.GITHUB_STEP_SUMMARY,text);process.stdout.write(text);}
