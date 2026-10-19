/** Bounded JSON bodies for the authenticated operational routes. */
export async function adminBody(req,max=2048) {
  if (!/^application\/json(?:\s*;|$)/i.test(String(req.headers['content-type'] || ''))) throw Object.assign(new Error(),{status:415});
  const chunks=[];let size=0;
  for await (const chunk of req) {size+=chunk.length;if(size>max)throw Object.assign(new Error(),{status:413});chunks.push(chunk);}
  try {const value=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(!value||Array.isArray(value)||typeof value!=='object')throw Error();return value;}
  catch {throw Object.assign(new Error(),{status:400});}
}
