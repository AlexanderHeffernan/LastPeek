# X Draft for Safari on Mac

A local Safari web extension and companion Mac app for sharing an unpublished X draft as a self-contained HTML attachment in Messages. No X API account, hosting, analytics, or automatic sending. Alexander confirmed the original `draft-preview.html` delivery trial opens successfully in Messages on Mac and iPhone.

## Workflow

1. Compose on **x.com in Safari**, including your own follow-up posts.
2. Click the new **Share draft** icon beside X's attachment/GIF/emoji controls, or use the extension's Safari toolbar button.
3. Review the captured snapshot. Click **Share via Messages** to open Apple's Messages sharing service, choose a recipient, and send yourself. **Save HTML** is also available for manual attachment.

Opening a preview does not change or publish the X draft. Edits made after capture aren't included in that snapshot. The recipient needs no extension or account with this app.

## Install and test locally

Open `mac/X Draft/X Draft.xcodeproj` in Xcode. The generated project references the files in `extension/` directly; do not maintain a second copy.

For the local-development app build on Alexander's Mac:

1. Run `bash scripts/build-mac.sh`, or unzip the corrected `X-Draft-local-test.zip`. Open **X Draft.app** in Finder. **Do not select the app or this app ZIP in Add Temporary Extension.**
2. In Safari Settings → Advanced, enable **Show features for web developers**, then in Developer enable **Allow unsigned extensions**. This deliberately permits unsigned development extensions until Safari quits; only enable the local extension you trust.
3. In Safari Settings → Extensions, enable **X Draft Extension** and allow it on x.com. Grant access to the listed X media hosts if prompted.
4. Reload x.com. Try **Share draft** → review → **Share via Messages**. Confirm an HTML file is attached before sending. If the native handoff fails, use **Save HTML** and report the error text.

**Add Temporary Extension is a different installation route.** It accepts the `extension/` folder containing `manifest.json`, or the browser-only `X-Draft-Safari-Temporary.zip`, not a Mac app bundle or ZIP of an app. That route can test capture and Save HTML, but cannot provide native Messages sharing.

For a signed installation:

1. Select the same signing team for **X Draft** and **X Draft Extension**.
2. Enable the App Groups capability for both targets, using `group.com.hefferalex.XDraft` (already in `Sharing.entitlements`). Allow Xcode to configure the required signing assets.
3. Run the **X Draft** scheme on **My Mac**. Open Safari Settings → Extensions, enable **X Draft Extension**, and allow access to x.com and its image/video hosts when prompted.
4. Reload x.com, open a draft, and try a single text post, a photo, and a two-post thread. In the Messages sharing window, verify the HTML attachment is present before choosing a recipient and sending.

Apple also supports local unsigned extension testing through Safari Settings → Developer → **Allow unsigned extensions**. That setting resets when Safari quits. A temporary installation of the `extension/` folder can exercise capture and **Save HTML**, but **cannot** supply the native Messages handoff; that requires the packaged Mac app. Shared-container access and handoff must be verified in the chosen signed/unsigned setup. Do not treat an unsigned compile as proof of a working sandboxed handoff.

Build without an Apple developer identity:

```sh
bash scripts/build-mac.sh
```

The script compiles both targets, applies complete ad-hoc bundle signatures and the sandbox/App Group entitlements, verifies the nested signatures, and creates `.amp/in/artifacts/X-Draft-local-test.zip`. Merely building with `CODE_SIGNING_ALLOWED=NO` leaves linker-only signatures: the earlier `X-Draft-test.zip` failed strict bundle validation and its extension did not register. Do not use that older archive.

The compiled app is `.amp/in/build/Build/Products/Debug/X Draft.app`. The corrected extension registers with macOS PlugInKit; Safari enablement and the complete native handoff still require live validation. Ad-hoc signing is for local development, not notarized distribution, and may encounter macOS security prompts when downloaded. Do not disable Gatekeeper globally.

## Capture support and limitations

- Reads the selected composer's visible editable posts, preserves text, blank lines, emoji, post order and per-post media order, and embeds the displayed account avatar when available.
- Images and GIF files are embedded, not left as remote links. Videos are embedded only if the displayed source is a readable video file. X's MediaSource/streaming blobs may not be exportable; this version reports an error rather than substituting a still image. Reopened drafts and edited/cropped media need live-X validation.
- Safari's review frame permits native media-control scripting while the generated document's CSP still blocks page scripts; the frame does not gain same-origin access. Messages/Quick Look's own HTML viewer is outside the extension's control. If its video controls don't work, open the attachment in a full browser instead; playback in that viewer has not been verified.
- Up to 25 MB of media per export (before base64 encoding). No silent truncation. A changed draft, failed download, unidentified attachment, detected poll or quoted/replied-to post blocks export.
- Polls, quotes, replies to other people's posts, X Articles, and rich-text Premium formatting are not supported. Standard links remain text; link-card fetching is not implemented. The preview labels itself unpublished and does not invent engagement counts, timestamps for published posts, or verification badges.
- Layout approximates X; line wrapping and image crops can differ from the final published post. Media-container and composer selectors depend on X's current DOM and may need updates.
- Browser permissions are limited to x.com, pbs.twimg.com and video.twimg.com. Media downloads omit account credentials. No private X endpoints or scripted Post/Send actions are used. This is not a claim of approval by X; its restrictions on non-API integrations still apply.

## Privacy and local files

Exported HTML contains no JavaScript or remote dependencies. Draft text and metadata are HTML-escaped, attachments use embedded data URLs, and the file includes a restrictive Content Security Policy. The review iframe is sandboxed with `allow-scripts` so WebKit can run its built-in video controls. The document's CSP forbids author scripts, and the sandbox retains an opaque origin.

The native extension writes exports to `Drafts/` in the shared App Group container, with random filenames and owner-only file permissions. Only an opaque UUID is passed through the local app URL. These temporary exports are pruned after seven days on a subsequent share; X's original draft is untouched. Messages and recipients keep their own copies. No draft text or media is logged.

Before sharing, the Mac app copies the export into its own sandbox's temporary directory with owner-only permissions. ShareKit cannot delegate access directly from the App Group directory in the tested local setup. The app retains this staged copy for the sharing session, then removes it on completion or cancellation/failure; an interrupted process may leave it for macOS temporary-file cleanup.

## Verification

```sh
npm ci
npm test                             # Installed Google Chrome, headless
npx playwright install webkit       # Once, for the WebKit test runtime
TEST_BROWSER=webkit npm test         # WebKit engine, not Safari's extension runtime
SCREENSHOTS=1 npm test               # Review artifacts under .amp/in/artifacts/
```

Tests exercise the share button, actual HTML download, thread/attachment association, blank lines, emoji, escaping, changed-draft rejection, and native-handoff failure feedback. The browser-to-native bridge is stubbed in these fixture tests, not verified by them. Native targets compile independently; Messages service availability can be checked without sending anything.

The video regression uses `tests/fixtures/video.mp4`, a generated three-second silent H.264 clip with a moving square (AVFoundation, 320 × 180 at 12 fps). It activates the browser's native controls and checks that playback advances in both the review and downloaded HTML. It also checks that inserted page scripts are blocked and the preview cannot access its parent document. On unchanged code, WebKit's centre Play button stayed paused with a blank-square icon; permitting native control scripting fixed the same scenario. The user's exported video was also tested: it decoded and played as standalone HTML in both Chrome and WebKit, while the no-script sandbox broke WebKit's native Play control.

Live Safari inspection found three selector bugs: the share button was inserted in a hidden scroll-arrow wrapper, the ordinary Add poll toolbar button was mistaken for poll content, and the toolbar's nearest ancestor could contain only the last reply in a thread. The button now targets the media icon row, poll detection excludes toolbar controls, and modal capture uses the whole composer dialog. Regression fixtures cover these cases; a repositioned button was confirmed visible and hit-testable in the live composer.

A subsequent live check found that the upload guard mistook the composer loading bar and character counter for media uploads. It now checks only visible, incomplete media upload indicators. Regression coverage includes unrelated progress bars, 99% versus 100% uploads, hidden indicators and indeterminate uploads. A read-only run of the patched capture against the open Safari composer generated a two-post HTML preview with an embedded avatar and matching text; it did not exercise the extension's native Messages bridge.

The share button reuses the media button's CSS classes, icon shell and layout wrappers without copying its event handlers or file input. Hover and pressed backgrounds use the native icon-content colour at 10% and 20% opacity, with a visible keyboard-focus outline. A separately rendered snapshot of the real toolbar verifies matching button size, icon size, colour and alignment; this is not a screenshot of the live Safari window.

Native validation reproduced the Messages failure in a GUI-launched, sandboxed probe: the App Group HTML was readable but `canPerform` returned false, while an app-local temporary copy returned true. The patched Mac app accepted the staged attachment and opened Messages' remote sharing view. ShareKit logs captured the change from denied file access and `canPerform = NO` to `canPerform = YES` and the sharing-window transition. No recipient was selected and no Send action was automated.

**Final delivery validation remains required:** install the updated packaged extension and confirm the complete Safari → native extension → shared file → Messages flow, then manually choose a recipient and send a preview. Close all running X Draft copies before replacing the app; save the current draft before restarting Safari and re-enable unsigned extensions if needed. **Allow JavaScript from Apple Events** is only needed for agent-driven inspection, not normal extension use.

If attachment delivery becomes awkward, the fallback remains private, revocable preview links hosted on Alexander's Raspberry Pi. Nothing has been provisioned or deployed there.
