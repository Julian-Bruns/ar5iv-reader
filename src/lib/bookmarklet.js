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
    "const receiveUrl=new URL('/',origin);",
    "receiveUrl.searchParams.set('url',currentUrl);",
    "receiveUrl.searchParams.set('title',document.title||'');",
    "window.location.assign(receiveUrl.toString());",
    "})();"
  ].join("");

  return `javascript:${source}`;
}
