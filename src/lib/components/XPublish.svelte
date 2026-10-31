<script lang="ts">
  import { onDestroy } from "svelte";
  import { invalidateAll } from "$app/navigation";
  import { Button } from "$lib/components/ui/button/index.js";
  import Icon from "./Icon.svelte";
  import { postingProblem, type XPublishing } from "$lib/x-publishing";
  import type { Content } from "$lib/contracts";

  let {
    draftId,
    content,
    version,
    connection,
    disabled = false,
  }: {
    draftId: string;
    content: Content;
    version: number;
    connection: XPublishing;
    disabled?: boolean;
  } = $props();
  let dialog: HTMLDialogElement;
  let progress = $state(0),
    holding = $state(false),
    sending = $state(false);
  let error = $state(""),
    launched = $state(false);
  let completed = $state<XPublishing | null>(null);
  let snapshot = $state<{
    content: string;
    version: number;
    xId: string;
    username: string;
  } | null>(null);
  let frame = 0,
    started = 0,
    suppressClick = false,
    pointerId: number | null = null;
  let audio: AudioContext | undefined, chargeGain: GainNode | undefined;
  let voices: OscillatorNode[] = [];
  let lastPulse = 0;
  let disposed = false;
  const multiple = $derived(content.posts.length > 1);
  const problem = $derived(postingProblem(content));
  const publication = $derived(
    completed?.publication || connection.publication,
  );
  const blocked = $derived(
    publication &&
      (publication.status === "unknown" ||
        (publication.status === "pending" && !publication.resumable)),
  );
  const ready = $derived(
    connection.account?.ready &&
      (!content.posts.some((p) => p.media.length) ||
        connection.account.mediaReady),
  );
  const unavailable = $derived(
    disabled || sending || Boolean(problem) || Boolean(blocked),
  );
  const fingerprint = $derived(
    `${version}:${JSON.stringify(content)}:${connection.account?.id}`,
  );
  const sendingLabel = $derived(
    `${publication?.phase || (content.posts.some((p) => p.media.length) ? "Preparing media" : "Posting")}…`,
  );
  const continuing = $derived(Boolean(publication?.resumable));
  let heldFingerprint = "";

  function stopTone() {
    if (audio && chargeGain) {
      chargeGain.gain.cancelScheduledValues(audio.currentTime);
      chargeGain.gain.setTargetAtTime(0, audio.currentTime, 0.012);
      for (const voice of voices) voice.stop(audio.currentTime + 0.06);
    }
    voices = [];
    chargeGain = undefined;
  }
  function cancelHold() {
    if (typeof window !== "undefined") cancelAnimationFrame(frame);
    holding = false;
    progress = 0;
    pointerId = null;
    stopTone();
    if (typeof navigator !== "undefined") navigator.vibrate?.(0);
  }
  function note(
    frequency: number,
    at: number,
    duration: number,
    volume: number,
  ) {
    if (!audio) return;
    const voice = audio.createOscillator(),
      envelope = audio.createGain();
    voice.type = "sine";
    voice.frequency.setValueAtTime(frequency, at);
    envelope.gain.setValueAtTime(0, at);
    envelope.gain.linearRampToValueAtTime(volume, at + 0.006);
    envelope.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    voice.connect(envelope).connect(chargeGain || audio.destination);
    voice.start(at);
    voice.stop(at + duration + 0.02);
    if (chargeGain) voices.push(voice);
  }
  function tone() {
    try {
      audio ??= new AudioContext();
      void audio.resume().catch(() => {});
      chargeGain = audio.createGain();
      chargeGain.gain.setValueAtTime(0, audio.currentTime);
      chargeGain.gain.linearRampToValueAtTime(0.7, audio.currentTime + 1.5);
      chargeGain.connect(audio.destination);
      // A warm octave swell under the accelerating, tuned detents.
      for (const [frequency, volume] of [
        [110, 0.07],
        [220, 0.035],
      ]) {
        const voice = audio.createOscillator(),
          level = audio.createGain();
        voice.type = "triangle";
        voice.frequency.setValueAtTime(frequency, audio.currentTime);
        voice.frequency.exponentialRampToValueAtTime(
          frequency * 4,
          audio.currentTime + 1.5,
        );
        level.gain.value = volume;
        voice.connect(level).connect(chargeGain);
        voice.start();
        voices.push(voice);
      }
    } catch {
      /* Sound is progressive enhancement. */
    }
  }
  function celebrate() {
    navigator.vibrate?.([18, 25, 45]);
    if (!audio) return;
    try {
      const now = audio.currentTime;
      note(65.41, now, 0.3, 0.13);
      [523.25, 659.25, 783.99, 1046.5].forEach((frequency, index) =>
        note(frequency, now + index * 0.045, 0.45, 0.085),
      );
    } catch {
      /* Feedback must never mask successful publication. */
    }
  }
  function capture() {
    if (unavailable || !ready || !connection.account) return false;
    snapshot = {
      content: JSON.stringify(content),
      version,
      xId: connection.account.id,
      username: connection.account.username,
    };
    error = "";
    return true;
  }
  function begin(event: PointerEvent) {
    if (event.button !== 0 || !event.isPrimary || !capture()) return;
    suppressClick = false;
    pointerId = event.pointerId;
    heldFingerprint = fingerprint;
    holding = true;
    started = performance.now();
    lastPulse = 0;
    tone();
    const step = (now: number) => {
      if (!holding) return;
      progress = Math.min((now - started) / 1500, 1);
      const pulse = Math.floor(progress * progress * 9);
      if (pulse > lastPulse) {
        navigator.vibrate?.(6 + pulse * 2);
        if (audio && chargeGain) {
          try {
            const notes = [
              261.63, 329.63, 392, 523.25, 659.25, 783.99, 1046.5, 1318.5, 1568,
            ];
            note(
              notes[Math.min(pulse - 1, notes.length - 1)],
              audio.currentTime,
              0.1,
              0.12,
            );
          } catch {
            /* Audio is optional. */
          }
        }
        lastPulse = pulse;
      }
      if (progress === 1) {
        suppressClick = true;
        cancelHold();
        void send();
      } else frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
  }
  function end(event?: PointerEvent) {
    if (!holding) return;
    if (event && pointerId !== event.pointerId) return;
    // Only an ordinary short click opens confirmation. An aborted hold is inert.
    if (progress > 0.16) suppressClick = true;
    cancelHold();
  }
  function click(event: MouseEvent) {
    if (event.detail === 0) suppressClick = false;
    if (suppressClick) {
      suppressClick = false;
      return;
    }
    if (!capture()) return;
    dialog.showModal();
  }
  async function send() {
    if (
      !snapshot ||
      unavailable ||
      snapshot.version !== version ||
      snapshot.content !== JSON.stringify(content) ||
      snapshot.xId !== connection.account?.id
    )
      return;
    sending = true;
    error = "";
    dialog?.close();
    try {
      while (!disposed) {
        const response = await fetch(`/api/drafts/${draftId}/post-to-x`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            version: snapshot.version,
            xId: snapshot.xId,
          }),
        });
        const result = await response.json();
        if (!response.ok)
          throw new Error(
            result.message ||
              "Couldn’t finish posting. Check X before trying again.",
          );
        completed = result;
        if (result.publication?.status === "posted") {
          launched = true;
          celebrate();
          break;
        }
        if (!result.publication?.resumable)
          throw new Error("Publishing stopped. Check X before continuing.");
        if (result.publication.retryAfter)
          await new Promise((resolve) =>
            setTimeout(resolve, Math.min(result.publication.retryAfter, 60000)),
          );
      }
    } catch (e) {
      error = (e as Error).message;
    } finally {
      try {
        await invalidateAll();
        if (completed?.publication?.status !== "posted") completed = null;
      } finally {
        sending = false;
      }
    }
  }
  $effect(() => {
    if (holding && (unavailable || fingerprint !== heldFingerprint)) {
      suppressClick = true;
      cancelHold();
    }
    if (
      snapshot &&
      (snapshot.version !== version ||
        snapshot.content !== JSON.stringify(content) ||
        snapshot.xId !== connection.account?.id)
    )
      dialog?.close();
  });
  onDestroy(() => {
    disposed = true;
    cancelHold();
    void audio?.close();
  });
</script>

<svelte:window
  onpointerup={end}
  onpointercancel={() => {
    suppressClick = true;
    cancelHold();
  }}
  onblur={() => {
    suppressClick = true;
    cancelHold();
  }}
  onkeydown={(event) => {
    if (event.key === "Escape") {
      suppressClick = true;
      cancelHold();
    }
  }}
/>
<svelte:document
  onvisibilitychange={() => {
    if (document.hidden) {
      suppressClick = true;
      cancelHold();
    }
  }}
/>

{#if publication?.status === "posted" && publication.url}
  <span class="launch-shell" data-launched={launched}>
    {#if launched}<span class="burst" aria-hidden="true"
        >{#each Array(8) as _, index}<i style={`--angle:${index * 45}deg`}
          ></i>{/each}</span
      >{/if}
    <Button
      class={launched ? "x-posted" : ""}
      variant="secondary"
      href={publication.url}
      aria-label="View on X"
      target="_blank"
      rel="noopener noreferrer"
      title={publication.version !== version
        ? "Edited since posting. View on X shows the posted version."
        : "Posted to X"}>View on <Icon name="x" size={16} /></Button
    >
  </span>
{:else if connection.enabled}
  {#if !ready}
    <form method="POST" action="/auth/x/start">
      <input type="hidden" name="publishDraft" value={draftId} />
      <Button
        type="submit"
        {disabled}
        title="Connect X and allow posting"
        aria-label={connection.account ? "Allow posting" : "Connect X"}
        >{#if connection.account}Allow posting{:else}Connect <Icon
            name="x"
            size={16}
          />{/if}</Button
      >
    </form>
  {:else}
    <Button
      class="x-publish"
      disabled={unavailable}
      aria-busy={sending}
      aria-label={sending
        ? sendingLabel
        : continuing
          ? "Continue posting"
          : multiple
            ? "Post all"
            : "Post to X"}
      aria-describedby={`posting-help-${draftId}`}
      title={problem ||
        `Post as @${connection.account?.username}. Click to confirm, or hold to post.`}
      style={`--charge:${progress}`}
      data-holding={holding}
      data-launched={launched}
      onpointerdown={begin}
      onpointermove={(event) => {
        if (!holding) return;
        const rect = event.currentTarget.getBoundingClientRect();
        if (
          event.clientX < rect.left ||
          event.clientX > rect.right ||
          event.clientY < rect.top ||
          event.clientY > rect.bottom
        ) {
          suppressClick = true;
          cancelHold();
        }
      }}
      onpointerup={end}
      onpointerleave={() => {
        if (holding) {
          suppressClick = true;
          cancelHold();
        }
      }}
      oncontextmenu={(event) => event.preventDefault()}
      onclick={click}
    >
      <span class="charge" aria-hidden="true"></span>
      <span class="sheen" aria-hidden="true"></span>
      <span class="label"
        >{#if sending}{sendingLabel}{:else if continuing}Continue posting{:else if multiple}Post
          all{:else}Post to <Icon name="x" size={16} />{/if}</span
      >
    </Button>
  {/if}
  <span class="sr-only" id={`posting-help-${draftId}`}
    >{problem || ""} Posts as @{connection.account?.username ||
      "your connected account"}. Click to confirm, or hold for one and a half
    seconds to post without a dialog.</span
  >
{/if}
{#if connection.enabled || publication}
  <div class="posting-feedback" aria-live="polite">
    {#if blocked}<p role="alert">
        X may have received this post. Check X before posting again; retry is
        blocked to avoid duplicates.
      </p>
    {:else if error || publication?.message}<p role="alert">
        {error || publication?.message}
      </p>
    {/if}
    {#if publication?.url && publication.status !== "posted"}
      <p>
        <a href={publication.url} target="_blank" rel="noopener noreferrer"
          >View {publication.completed} published {publication.completed === 1
            ? "post"
            : "posts"} on X</a
        >
      </p>
    {/if}
  </div>
{/if}

<dialog
  bind:this={dialog}
  class="confirm-dialog x-confirm"
  aria-labelledby={`x-title-${draftId}`}
>
  <h2 id={`x-title-${draftId}`}>
    {continuing
      ? "Continue posting to X?"
      : multiple
        ? "Post all to X?"
        : "Post to X?"}
  </h2>
  <p>Posting as <strong>@{snapshot?.username}</strong></p>
  {#if continuing}<p>
      {publication?.completed} of {publication?.total} posts published. Continue with
      the remaining posts only.
    </p>{/if}
  <p class="hold-tip">
    <Icon name="sparkle" size={16} />Tip: hold the post button to skip
    confirmation.
  </p>
  {#if error}<p class="danger" role="alert">{error}</p>{/if}
  <div class="row dialog-actions">
    <Button variant="outline" onclick={() => dialog.close()}>Cancel</Button
    ><Button
      disabled={unavailable}
      onclick={() => {
        tone();
        stopTone();
        void send();
      }}>Post now</Button
    >
  </div>
</dialog>

<style>
  :global(.x-publish) {
    position: relative;
    isolation: isolate;
    overflow: hidden;
    touch-action: pan-y;
    -webkit-touch-callout: none;
    transform: scale(calc(1 - var(--charge) * 0.065));
    transition:
      transform 180ms cubic-bezier(0.2, 1.7, 0.4, 1),
      box-shadow 160ms ease,
      border-color 160ms ease;
  }
  :global(.x-publish[data-holding="true"]) {
    transition:
      box-shadow 80ms linear,
      border-color 80ms linear;
    border-color: rgb(255 235 184 / var(--charge));
    box-shadow:
      inset 0 1px 0 rgb(255 255 255 / 45%),
      0 0 0 calc(1px + var(--charge) * 3px)
        rgb(255 172 103 / calc(var(--charge) * 0.24)),
      0 0 calc(var(--charge) * 28px)
        rgb(255 91 124 / calc(var(--charge) * 0.55)),
      0 0 calc(var(--charge) * 48px)
        rgb(255 184 85 / calc(var(--charge) * 0.22));
  }
  .charge {
    position: absolute;
    inset: 0;
    background: linear-gradient(
      110deg,
      #ff87bf 0%,
      #ff9270 42%,
      #ffd479 75%,
      #fff0bb 100%
    );
    clip-path: inset(0 calc((1 - var(--charge)) * 100%) 0 0);
    z-index: -1;
  }
  .sheen {
    position: absolute;
    inset: -50% -30%;
    background: linear-gradient(
      110deg,
      transparent 38%,
      #fff8 48%,
      transparent 58%
    );
    transform: translateX(calc(-85% + var(--charge) * 170%));
    opacity: var(--charge);
    pointer-events: none;
  }
  .label {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: 7px;
  }
  .posting-feedback {
    flex-basis: 100%;
    width: 100%;
  }
  .posting-feedback:empty {
    display: none;
  }
  .posting-feedback p {
    margin: 6px 0 0;
    color: var(--muted-foreground);
    font-size: 12px;
    line-height: 1.5;
    white-space: normal;
  }
  .posting-feedback [role="alert"] {
    color: var(--destructive);
  }
  .launch-shell {
    position: relative;
    display: inline-flex;
  }
  :global(.x-posted) {
    animation: posted-settle 550ms cubic-bezier(0.16, 1, 0.3, 1);
  }
  @keyframes posted-settle {
    0% {
      transform: scale(0.92);
      box-shadow: 0 0 22px #ffc27580;
    }
    35% {
      transform: scale(1.07);
    }
    100% {
      transform: scale(1);
      box-shadow: 0 0 0 transparent;
    }
  }
  .burst {
    position: absolute;
    inset: 50%;
    pointer-events: none;
  }
  .burst i {
    position: absolute;
    width: 5px;
    height: 3px;
    border-radius: 3px;
    background: #ffd889;
    box-shadow: 0 0 5px #ffad80;
    animation: spark 650ms cubic-bezier(0.1, 0.6, 0.3, 1) both;
  }
  @keyframes spark {
    from {
      opacity: 1;
      transform: rotate(var(--angle)) translateX(18px) scaleX(1.8);
    }
    to {
      opacity: 0;
      transform: rotate(var(--angle)) translateX(67px) scaleX(0.3);
    }
  }
  .hold-tip {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 13px;
    color: var(--muted-foreground);
    margin-top: 20px;
  }
  @media (prefers-reduced-motion: reduce) {
    :global(.x-posted) {
      animation: none;
    }
    :global(.x-publish) {
      transform: none;
      transition: none;
    }
    :global(.x-publish[data-holding="true"]) {
      box-shadow: none;
    }
    .sheen,
    .burst {
      display: none;
    }
  }
</style>
