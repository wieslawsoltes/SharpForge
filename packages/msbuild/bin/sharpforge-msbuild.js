#!/usr/bin/env node
import { runMSBuildCLI } from '../src/cli.js';
try { const result=await runMSBuildCLI();if(typeof result==='number')process.exitCode=result; }
catch(error){console.error(error.message);process.exitCode=1;}
