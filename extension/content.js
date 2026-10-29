(() => {
  if (globalThis.xDraftInstalled) return;
  globalThis.xDraftInstalled = true;
  const { composerFor, capture } = globalThis.XDraftCapture;
  let preparing = false;
  const buttonStyle = document.createElement("style");
  buttonStyle.textContent = `
    [data-x-draft-share]{background-color:transparent!important}
    [data-x-draft-share]:hover:not(:disabled){background-color:color-mix(in srgb,var(--x-draft-icon-color) 10%,transparent)!important}
    [data-x-draft-share]:active:not(:disabled){background-color:color-mix(in srgb,var(--x-draft-icon-color) 20%,transparent)!important}
    [data-x-draft-share]:focus-visible{outline:2px solid var(--x-draft-icon-color)!important;outline-offset:2px!important}
  `;
  document.head.append(buttonStyle);

  async function readMedia(url, type) {
    if (/^https:\/\/(pbs|video)\.twimg\.com\//.test(url)) return browser.runtime.sendMessage({ type: "read-media", url });
    if (!url.startsWith("blob:") && !url.startsWith("data:")) throw new Error("Unsupported attachment source.");
    let blob;
    try { blob = await (await fetch(url)).blob(); } catch { throw new Error("This attachment is no longer readable. Reattach it in X and try again."); }
    if (blob.size > 25 * 1024 * 1024) throw new Error("An attachment exceeds 25 MB.");
    if (!(type === "video" ? /^video\// : /^image\//).test(blob.type)) throw new Error("X’s video preview is not an exportable file. Reattach the original video and try again; it has not been replaced with a still image.");
    const data = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("An attachment could not be read."));
      reader.readAsDataURL(blob);
    });
    return { data, bytes: blob.size };
  }

  function showDialog(html, error) {
    document.querySelector("#x-draft-dialog")?.remove();
    const host = document.createElement("div");
    host.id = "x-draft-dialog";
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `<style>
      :host{position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;background:#0009;font:15px -apple-system,BlinkMacSystemFont,sans-serif;color-scheme:light dark;color:light-dark(#0f1419,#e7e9ea)}
      dialog{position:relative;margin:auto;display:flex;flex-direction:column;width:min(620px,90vw);height:${html ? "85vh" : "auto"};padding:0;border:1px solid #536471;border-radius:20px;background:light-dark(#fff,#000);color:inherit;overflow:hidden}
      header,footer{padding:16px;display:flex;align-items:center;gap:10px;flex-wrap:wrap}header{border-bottom:1px solid #536471}h2{font-size:18px;margin:0;flex:1}button{font:inherit;cursor:pointer;border-radius:999px;border:1px solid #536471;padding:9px 16px;color:inherit;background:transparent}button:disabled{opacity:.5;cursor:wait}.primary{background:#1d9bf0;color:#fff;border:0;font-weight:700}iframe{width:100%;flex:1;border:0;min-height:0}p{padding:0 16px;line-height:1.5}#status{font-size:13px;margin:0;padding:0 16px 12px;white-space:pre-wrap}
      </style><dialog aria-labelledby="xd-title"><header><h2 id="xd-title">${html ? "Review your draft" : "Couldn’t prepare draft"}</h2><button id="close" aria-label="Close preview">✕</button></header>
      ${html ? '<iframe sandbox="allow-scripts" title="Standalone draft preview"></iframe><footer><button class="primary" id="share">Share via Messages</button><button id="save">Save HTML</button></footer>' : '<p id="error"></p>'}<p id="status" role="status" aria-live="polite"></p></dialog>`;
    document.body.append(host);
    const dialog = shadow.querySelector("dialog");
    const close = () => { dialog.close(); host.remove(); };
    shadow.querySelector("#close").onclick = close;
    dialog.addEventListener("cancel", event => { event.preventDefault(); close(); });
    dialog.showModal();
    if (!html) { shadow.querySelector("#error").textContent = error; return; }
    // WebKit's native video controls need allow-scripts. The generated HTML's
    // CSP still forbids page scripts, and the frame retains an opaque origin.
    shadow.querySelector("iframe").srcdoc = html;
    shadow.querySelector("#save").onclick = () => {
      const url = URL.createObjectURL(new Blob([html], { type: "text/html;charset=utf-8" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `x-draft-${new Date().toISOString().replace(/[:.]/g, "-")}.html`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    };
    shadow.querySelector("#share").onclick = async event => {
      const button = event.currentTarget;
      const status = shadow.querySelector("#status");
      button.disabled = true;
      status.textContent = "Preparing the Messages sharing window…";
      try {
        const response = await browser.runtime.sendMessage({ type: "share-draft", html });
        if (!response?.ok) throw new Error(response?.error || "The X Draft Mac app didn’t accept the preview.");
        status.textContent = "Handed to the X Draft Mac app. Choose the recipient in the Messages sharing window and press Send. This preview is a snapshot; later edits in X aren’t included.";
      } catch (error) { status.textContent = `${error.message}\nYou can still use Save HTML and attach the file in Messages.`; }
      finally { button.disabled = false; }
    };
  }

  async function openPreview(root) {
    if (preparing) return;
    if (!root) { showDialog(null, "Open a post composer in X first."); return; }
    preparing = true;
    const button = root.querySelector("[data-x-draft-share]");
    if (button) { button.disabled = true; button.setAttribute("aria-label", "Preparing draft…"); }
    try { showDialog(globalThis.XDraftPreview.render(await capture(root, readMedia))); }
    catch (error) { showDialog(null, error.message); }
    finally {
      preparing = false;
      if (button) { button.disabled = false; button.setAttribute("aria-label", "Share draft"); }
    }
  }

  function installButtons() {
    for (const toolbar of document.querySelectorAll('[data-testid="toolBar"]')) {
      if (toolbar.querySelector("[data-x-draft-share]")) continue;
      const root = composerFor(toolbar);
      if (!root) continue;
      const mediaInput = toolbar.querySelector('input[data-testid="fileInput"]');
      const reference = toolbar.querySelector('button[data-testid="fileInputButton"]')
        || mediaInput?.parentElement.querySelector("button")
        || toolbar.querySelector('button[aria-label="Add photos or video"]');
      if (!reference) continue;
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.xDraftShare = "";
      button.title = "Share draft";
      button.setAttribute("aria-label", "Share draft");
      button.className = reference.className;
      button.style.cssText = reference.style.cssText;
      button.style.flexShrink = "0";
      const referenceIcon = reference.querySelector("svg");
      const referenceContent = referenceIcon?.parentElement;
      const content = referenceContent && referenceContent !== reference ? referenceContent.cloneNode(false) : document.createElement("span");
      button.style.setProperty("--x-draft-icon-color", getComputedStyle(referenceContent || reference).color);
      const icon = referenceIcon?.cloneNode(false) || document.createElementNS("http://www.w3.org/2000/svg", "svg");
      icon.setAttribute("viewBox", "0 0 24 24");
      icon.setAttribute("aria-hidden", "true");
      if (!referenceIcon) { icon.setAttribute("width", "20"); icon.setAttribute("height", "20"); icon.setAttribute("fill", "currentColor"); }
      icon.innerHTML = '<path d="m12 2 5.7 5.7-1.4 1.4L13 5.8V16h-2V5.8L7.7 9.1 6.3 7.7 12 2ZM4 12h2v8h12v-8h2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8Z"/>';
      content.append(icon);
      button.append(content);
      button.onclick = event => { event.preventDefault(); event.stopPropagation(); openPreview(composerFor(toolbar)); };
      const iconRow = reference.closest('[data-testid="ScrollSnap-List"]');
      if (iconRow) {
        const referenceSlot = reference.closest('[role="presentation"]');
        const slot = referenceSlot?.cloneNode(false) || document.createElement("div");
        slot.setAttribute("role", "presentation");
        slot.style.flexShrink = "0";
        let branch = button;
        for (let wrapper = reference.parentElement; wrapper && wrapper !== referenceSlot && wrapper !== iconRow; wrapper = wrapper.parentElement) {
          const shell = wrapper.cloneNode(false);
          shell.append(branch);
          branch = shell;
        }
        slot.append(branch);
        iconRow.append(slot);
      } else { reference.parentElement.append(button); }
    }
  }

  let queued = false;
  new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; installButtons(); });
  }).observe(document.body, { childList: true, subtree: true });
  installButtons();
  browser.runtime.onMessage.addListener(message => {
    if (message.type === "open-preview") {
      const editors = [...document.querySelectorAll('[contenteditable="true"][data-testid^="tweetTextarea_"]')].filter(e => e.getClientRects().length);
      const active = editors.find(e => e.contains(document.activeElement)) || editors.at(-1);
      openPreview(active && composerFor(active));
    }
  });
})();
