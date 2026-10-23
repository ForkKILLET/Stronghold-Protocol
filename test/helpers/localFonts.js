// Keep visual runs independent of Google Fonts availability; the app's local fonts and OS fallbacks still load.
export async function localFontsOnly(page) {
  await page.setRequestInterception(true);
  page.on('request',request=>{
    if(request.isInterceptResolutionHandled())return;
    if(new URL(request.url()).hostname==='fonts.googleapis.com') {
      void request.respond({status:200,contentType:'text/css',body:'/* Local fonts only for this isolated test. */'}).catch(()=>{});
    } else void request.continue().catch(()=>{});
  });
}
