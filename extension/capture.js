(() => {
  const editorSelector = '[contenteditable="true"][data-testid^="tweetTextarea_"]';
  const editorsIn = root => [...root.querySelectorAll(editorSelector)];
  const visible = element => element.getClientRects().length > 0;

  function composerFor(element) {
    const dialog = element.closest('[role="dialog"]');
    if (dialog && dialog.querySelector('[data-testid="tweetButton"], [data-testid="tweetButtonInline"]') && editorsIn(dialog).length) return dialog;
    for (let node = element.parentElement; node && node !== document.body; node = node.parentElement) {
      if (node.querySelector('[data-testid="tweetButton"], [data-testid="tweetButtonInline"]') && editorsIn(node).length) return node;
    }
    return null;
  }

  function regions(root) {
    const editors = editorsIn(root).filter(visible);
    return editors.map(editor => {
      if (editors.length === 1) return { editor, region: root };
      let region = editor;
      while (region.parentElement && region.parentElement !== root && editorsIn(region.parentElement).filter(visible).length === 1) region = region.parentElement;
      return { editor, region };
    });
  }

  function textFrom(editor) {
    // Draft.js uses a block for each paragraph. innerText alone collapses empty
    // blocks differently across WebKit and Chromium.
    const blocks = [...editor.querySelectorAll('[data-block="true"]')];
    return blocks.length ? blocks.map(block => block.textContent === "" ? "" : block.innerText.replace(/\r\n/g, "\n")).join("\n") : editor.innerText.replace(/\r\n/g, "\n");
  }

  function mediaIn(region) {
    const videos = [...region.querySelectorAll("video")];
    const images = [...region.querySelectorAll("img")].filter(img => {
      const src = img.currentSrc || img.src;
      return !src.includes("/profile_images/") && !src.includes("/emoji/") && !img.closest('[data-testid="videoPlayer"]')
        && (img.closest('[data-testid="attachments"]') || src.startsWith("blob:") || src.startsWith("data:image/") || /^https:\/\/pbs\.twimg\.com\/media\//.test(src));
    });
    return [...videos, ...images].sort((a, b) => a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);
  }

  const sourceOf = element => element.currentSrc || element.src || element.querySelector("source")?.src;
  function snapshot(root) {
    return regions(root).map(({ editor, region }) => ({
      text: textFrom(editor),
      media: mediaIn(region).map(element => ({ type: element.tagName === "VIDEO" ? "video" : "image", src: sourceOf(element), alt: element.getAttribute("alt") || "" }))
    }));
  }

  function authorFrom(root) {
    const account = document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"]');
    const lines = account?.innerText.split("\n").filter(Boolean) || [];
    const handle = lines.find(line => /^@[A-Za-z0-9_]+$/.test(line));
    if (!handle || !lines[0] || lines[0] === handle) throw new Error("Could not read your name and handle from X’s account menu. Expand the sidebar and try again.");
    const avatar = root.querySelector('img[src*="/profile_images/"]') || account.querySelector("img");
    return { name: lines[0], handle, avatarURL: avatar?.currentSrc || avatar?.src };
  }

  async function capture(root, readMedia) {
    if (!root.isConnected) throw new Error("The composer has closed. Open the draft and try again.");
    if (root.querySelector('[data-testid="tweet"]') || [...root.querySelectorAll('[data-testid*="poll" i]')].some(element => !element.closest('[data-testid="toolBar"]'))) throw new Error("Quote posts, reply context and polls aren’t supported yet. Nothing was shared.");
    const uploads = root.querySelectorAll('[data-testid="attachments"] [role="progressbar"], [data-testid="videoPlayer"] [role="progressbar"], [data-testid="mediaUploadProgress"]');
    if ([...uploads].some(element => visible(element) && getComputedStyle(element).visibility !== "hidden"
      && (!element.hasAttribute("aria-valuenow") || Number(element.getAttribute("aria-valuenow")) < Number(element.getAttribute("aria-valuemax") || 100)))) throw new Error("An attachment is still uploading. Wait for it to finish, then try again.");
    for (const container of root.querySelectorAll('[data-testid="attachments"], [data-testid="videoPlayer"]')) {
      if (!mediaIn(container).length && (container.children.length || container.textContent.trim())) throw new Error("An attachment could not be identified. Nothing was shared.");
    }
    const posts = snapshot(root);
    if (!posts.length || posts.every(post => !post.text.trim() && !post.media.length)) throw new Error("Write a post or attach media first.");
    const author = authorFrom(root);
    const before = JSON.stringify(posts);
    let bytes = 0;
    async function embed(src, type) {
      if (!src) throw new Error("An attachment has no readable source. Remove and reattach it, then try again.");
      const result = await readMedia(src, type);
      bytes += result.bytes;
      if (bytes > 25 * 1024 * 1024) throw new Error("This draft exceeds the 25 MB attachment limit for this version.");
      return result.data;
    }
    for (const post of posts) {
      for (const media of post.media) {
        media.data = await embed(media.src, media.type);
      }
    }
    if (author.avatarURL) author.avatar = await embed(author.avatarURL, "image");
    if (!root.isConnected || JSON.stringify(snapshot(root)) !== before) throw new Error("The draft changed while preparing it. Try again to capture the latest version.");
    return { author, posts, capturedAt: new Date().toISOString() };
  }

  globalThis.XDraftCapture = { composerFor, capture };
})();
