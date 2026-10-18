// A standalone static page: no game boot, account, WebSocket or runtime dependencies.
import fs from 'node:fs/promises';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..');
const out=path.resolve(process.argv[2] || path.join(root,'dist/downloads'));
await fs.mkdir(out,{recursive:true});
for(const name of ['index.html','site.js','site.css']) {
  let body=await fs.readFile(path.join(root,'public/downloads',name),'utf8');
  if(name==='index.html')body=body.replace('../fonts/fonts.css','./fonts/fonts.css').replace('../css/theme.css','./theme.css');
  await fs.writeFile(path.join(out,name),body);
}
await fs.copyFile(path.join(root,'public/css/theme.css'),path.join(out,'theme.css'));
await fs.cp(path.join(root,'public/fonts'),path.join(out,'fonts'),{recursive:true,dereference:true});
const fonts=path.join(out,'fonts/fonts.css');
await fs.writeFile(fonts,(await fs.readFile(fonts,'utf8')).replaceAll("url('/fonts/","url('/downloads/fonts/"));
console.log('Built standalone resource download page');
