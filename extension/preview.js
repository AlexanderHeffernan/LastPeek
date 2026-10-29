(() => {
  const escape = value => String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);

  function mediaHTML(media) {
    const allowed = media.type === "video" ? /^data:video\/[a-z0-9.+-]+;base64,/i : /^data:image\/(png|jpeg|gif|webp|avif);base64,/i;
    if (!allowed.test(media.data)) throw new Error("An attachment could not be embedded safely.");
    return media.type === "video"
      ? `<video controls playsinline preload="metadata" src="${escape(media.data)}" aria-label="${escape(media.alt || "Video attachment")}"></video>`
      : `<img src="${escape(media.data)}" alt="${escape(media.alt || "Image attachment")}">`;
  }

  function render(draft) {
    if (!draft.posts?.length) throw new Error("There are no posts to share.");
    const avatar = draft.author.avatar
      ? mediaHTML({ type: "image", data: draft.author.avatar, alt: "" })
      : escape(draft.author.name.slice(0, 1));
    const posts = draft.posts.map((post, index) => `<article aria-label="Post ${index + 1} of ${draft.posts.length}">
      <div class="avatar" aria-hidden="true">${avatar}</div><div class="body">
      <div class="author"><strong>${escape(draft.author.name)}</strong> <span>${escape(draft.author.handle)}</span></div>
      ${draft.posts.length > 1 ? `<div class="position">${index + 1} of ${draft.posts.length}</div>` : ""}
      <div class="text">${escape(post.text)}</div>
      ${post.media.length ? `<div class="media count-${post.media.length}">${post.media.map(mediaHTML).join("")}</div>` : ""}
      </div></article>`).join("");
    return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; media-src data:; base-uri 'none'; form-action 'none'">
<title>Draft · ${escape(draft.author.name)}</title><style>
:root{color-scheme:light dark;--bg:#fff;--fg:#0f1419;--muted:#536471;--line:#cfd9de;--surface:#f7f9f9}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
main{max-width:600px;min-height:100vh;margin:auto;border-inline:1px solid var(--line)}header{padding:16px;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;align-items:center;gap:12px}
h1{font-size:20px;margin:0}header span{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:#1d9bf0;font-weight:700}.thread{padding:20px 16px 0}
article{position:relative;display:grid;grid-template-columns:40px minmax(0,1fr);gap:12px;padding-bottom:28px}article:not(:last-child):before{content:"";position:absolute;left:19px;top:46px;bottom:6px;width:2px;background:var(--line)}
.avatar{width:40px;height:40px;border-radius:50%;overflow:hidden;background:var(--surface);display:grid;place-items:center;font-weight:700}.avatar img{width:100%;height:100%;object-fit:cover}
.author{overflow-wrap:anywhere}.author strong{font-weight:750}.author span,.position{color:var(--muted)}.position{font-size:12px;margin-top:2px}
.text{white-space:pre-wrap;overflow-wrap:anywhere;font-size:17px;line-height:1.5;margin-top:8px}.text:empty{display:none}
.media{margin-top:12px;display:grid;gap:2px;border:1px solid var(--line);border-radius:16px;overflow:hidden}.media img,.media video{display:block;width:100%;height:auto;max-height:600px;object-fit:contain;background:var(--surface)}
.count-2,.count-3,.count-4{grid-template-columns:1fr 1fr}.count-3 img:first-child{grid-row:span 2}.count-2 img,.count-3 img,.count-4 img{height:100%;max-height:320px;object-fit:cover;aspect-ratio:1}
footer{padding:16px;margin:0 16px;border-top:1px solid var(--line);color:var(--muted);font-size:12px}
@media(prefers-color-scheme:dark){:root{--bg:#000;--fg:#e7e9ea;--muted:#71767b;--line:#2f3336;--surface:#16181c}}
@media(max-width:420px){main{border:0}.text{font-size:16px}}
</style></head><body><main><header><h1>Post preview</h1><span>Unpublished draft</span></header>
<section class="thread" aria-label="Draft thread">${posts}</section>
<footer>Unpublished snapshot · ${escape(new Date(draft.capturedAt).toLocaleString("en-NZ", { timeZone: "Pacific/Auckland", dateStyle: "medium", timeStyle: "short" }))} NZ time<br>Appearance approximates X. Wrapping, media crops and link cards may differ after publishing.</footer>
</main></body></html>`;
  }

  globalThis.XDraftPreview = { render };
})();
