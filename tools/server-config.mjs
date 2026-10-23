#!/usr/bin/env node
// Read/validate only. Never starts the server or prints credential-bearing environment variables.
import {resolveServerConfig} from '../server/runtimeConfig.js';
try{
 const args=process.argv.slice(2);
 if(args.length>1||args[0]?.startsWith('-'))throw new TypeError('usage: node tools/server-config.mjs [config-file]');
 const result=resolveServerConfig(args.length?{serverConfigFile:args[0]}:{},{log:{warn:message=>console.error(message)}});
 console.log(JSON.stringify(result.config,null,2));
}catch(error){console.error(`[config] ${error.message}`);process.exitCode=1;}
