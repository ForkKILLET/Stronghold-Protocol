// Build the independent admin image's UI, fonts and bundled Node service; never build/install game art.
import path from 'node:path';
import fs from 'node:fs';
import {build} from 'vite';
import {fileURLToPath} from 'node:url';
const root=path.resolve(import.meta.dirname,'..'),out=path.join(root,'dist/admin');
await fs.promises.rm(out,{recursive:true,force:true});
await build({configFile:false,root:path.join(root,'public'),publicDir:false,base:'/admin/assets/',
  resolve:{alias:[['preact','preact.module'],['preact/hooks','hooks.module'],['htm','htm.module']].flatMap(([name,file])=>{
    const replacement=fileURLToPath(import.meta.resolve(name));
    return [{find:new RegExp('^'+name+'$'),replacement},
      {find:new RegExp('^.*[/]vendor[/]'+file.replaceAll('.','\\.')+'\\.js$'),replacement}];
  })},
  build:{outDir:path.join(out,'public'),emptyOutDir:false,assetsDir:'',assetsInlineLimit:0,target:'es2022',
    rollupOptions:{input:path.join(root,'public/admin/index.html')}}});
await build({configFile:false,root,publicDir:false,ssr:{noExternal:true},
  build:{ssr:true,outDir:out,emptyOutDir:false,target:'node22',
    rollupOptions:{input:path.join(root,'server/admin/service.js'),output:{entryFileNames:'server.js'}}}});
