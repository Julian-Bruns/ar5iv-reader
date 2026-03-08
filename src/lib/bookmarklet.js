export function buildBookmarkletHref(origin) {
  const source = [
    "(()=>{",
    `const origin=${JSON.stringify(origin)};`,
    "const input=`${window.location.hostname}${window.location.pathname}`.replace(/\\.pdf$/i,'');",
    "const modern=input.match(/\\b\\d{4}\\.\\d{4,5}(?:v\\d+)?\\b/i)?.[0];",
    "const legacy=input.match(/\\b[a-z-]+(?:\\.[a-z-]+)?\\/\\d{7}(?:v\\d+)?\\b/i)?.[0]?.toLowerCase();",
    "const id=modern||legacy;",
    "if(!id){window.alert('Open an arXiv abstract, PDF, or ar5iv paper first.');return;}",
    "const receiveUrl=new URL('/receive',origin);",
    "receiveUrl.searchParams.set('url',id);",
    "const launched=window.open(receiveUrl.toString(),'_blank','noopener,noreferrer');",
    "if(!launched){window.location.assign(receiveUrl.toString());}",
    "})();"
  ].join("");

  return `javascript:${source}`;
}
