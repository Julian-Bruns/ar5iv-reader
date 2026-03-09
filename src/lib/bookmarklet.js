export function buildBookmarkletHref(origin) {
  const source = [
    "(()=>{",
    `const origin=${JSON.stringify(origin)};`,
    "const currentUrl=window.location.href;",
    "const target=new URL(currentUrl);",
    "const input=`${target.hostname}${target.pathname}`.replace(/\\.pdf$/i,'');",
    "const modern=input.match(/\\b\\d{4}\\.\\d{4,5}(?:v\\d+)?\\b/i)?.[0];",
    "const legacy=input.match(/\\b[a-z-]+(?:\\.[a-z-]+)?\\/\\d{7}(?:v\\d+)?\\b/i)?.[0]?.toLowerCase();",
    "if(!(modern||legacy)){window.alert('Open an arXiv abstract, PDF, or ar5iv paper first.');return;}",
    "const receiveUrl=new URL('/receive',origin);",
    "receiveUrl.searchParams.set('url',currentUrl);",
    "receiveUrl.searchParams.set('title',document.title||'');",
    "const protocolUrl=new URL('web+ar5iv://open');",
    "protocolUrl.searchParams.set('url',currentUrl);",
    "protocolUrl.searchParams.set('title',document.title||'');",
    "let fallbackTimer=0;",
    "let completed=false;",
    "const cancelFallback=()=>{completed=true;if(fallbackTimer){clearTimeout(fallbackTimer);fallbackTimer=0;}};",
    "document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden'){cancelFallback();}},{once:true});",
    "window.addEventListener('blur',cancelFallback,{once:true});",
    "window.addEventListener('pagehide',cancelFallback,{once:true});",
    "fallbackTimer=window.setTimeout(()=>{if(completed){return;}const fallbackWindow=window.open(receiveUrl.toString(),'_blank','noopener,noreferrer');if(!fallbackWindow){window.location.assign(receiveUrl.toString());}},900);",
    "window.location.assign(protocolUrl.toString());",
    "})();"
  ].join("");

  return `javascript:${source}`;
}
