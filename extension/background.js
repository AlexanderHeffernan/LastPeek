const MAX_BYTES = 25 * 1024 * 1024;

browser.runtime.onMessage.addListener(async (message, sender) => {
  if (!sender.tab?.url?.startsWith("https://x.com/")) throw new Error("Open a draft on x.com first.");
  if (message.type === "read-media") {
    const url = new URL(message.url);
    if (url.protocol !== "https:" || !["pbs.twimg.com", "video.twimg.com"].includes(url.hostname)) throw new Error("Unsupported attachment source.");
    const response = await fetch(url.href, { credentials: "omit", redirect: "error" });
    if (!response.ok) throw new Error(`Could not read an attachment (${response.status}).`);
    const blob = await response.blob();
    if (blob.size > MAX_BYTES) throw new Error("An attachment exceeds 25 MB.");
    if (!/^(image\/(jpeg|png|gif|webp|avif)|video\/[a-z0-9.+-]+)$/i.test(blob.type)) throw new Error("This attachment format can’t be embedded.");
    const buffer = new Uint8Array(await blob.arrayBuffer());
    let binary = "";
    for (let offset = 0; offset < buffer.length; offset += 16384) binary += String.fromCharCode(...buffer.subarray(offset, offset + 16384));
    return { data: `data:${blob.type};base64,${btoa(binary)}`, bytes: blob.size };
  }
  if (message.type === "share-draft") {
    if (typeof message.html !== "string" || message.html.length > 40 * 1024 * 1024) throw new Error("The preview is too large to share.");
    return browser.runtime.sendNativeMessage("com.hefferalex.XDraft", { action: "share", html: message.html });
  }
  throw new Error("Unknown X Draft request.");
});

browser.action.onClicked.addListener(tab => {
  if (tab.id) browser.tabs.sendMessage(tab.id, { type: "open-preview" }).catch(() => {});
});
