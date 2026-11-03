<script lang="ts">
  import { getContext, untrack, type Snippet } from "svelte";
  import { page } from "$app/state";
  import type { Presence } from "$lib/presence.svelte";
  import { avatarURL, presenceLabel } from "$lib/contracts";
  import Icon from "./Icon.svelte";
  let {
    name,
    avatarId,
    handle,
    userId,
    token,
    avatarOnly = false,
    guest = false,
    showPresence = true,
    compact = false,
    discussion = false,
    metadata,
    children,
  }: {
    name: string;
    avatarId?: string | null;
    handle?: string | null;
    userId?: string | null;
    token?: string;
    avatarOnly?: boolean;
    guest?: boolean;
    showPresence?: boolean;
    compact?: boolean;
    discussion?: boolean;
    metadata?: Snippet;
    children?: Snippet;
  } = $props();
  const presence = getContext<Presence>("presence");
  const friends = $derived(
    page.data.connections?.some(
      (person) => person.user_id === userId && person.accepted,
    ),
  );
  $effect(() => {
    if (userId && friends && showPresence && !avatarOnly)
      return untrack(() => presence.watch(userId!));
  });
  const seen = $derived(
    userId && friends ? presence.activity.get(userId) : undefined,
  );
  const label = $derived(showPresence ? presenceLabel(seen, presence.now) : "");
</script>

<div class="user-identity" class:avatar-only={avatarOnly} class:discussion>
  <span class="identity-photo">
    <span class="avatar" aria-hidden="true">
      {#if avatarId}<img
          src={avatarURL(avatarId, token)}
          alt=""
          loading="lazy"
        />
      {:else if guest}<Icon name="guest" size={34} />{:else}{name
          .slice(0, 1)
          .toUpperCase()}{/if}
    </span>
    {#if !avatarOnly && label === "Active now"}<span
        class="activity-dot"
        role="img"
        aria-label="Active now"
      ></span>{/if}
  </span>
  {#if !avatarOnly}
    <div class="identity-copy">
      <span class="identity-byline">
        <strong title={name}>{name}</strong>
        {#if handle && !discussion}<span class="identity-handle"
            >{handle.startsWith("@") ? handle : `@${handle}`}</span
          >{/if}
        {#if metadata && !discussion}{@render metadata()}{/if}
      </span>
      {#if discussion}<span class="identity-metadata">
          {#if handle}<span class="identity-handle" title={handle}
              >{handle.startsWith("@") ? handle : `@${handle}`}</span
            >{/if}
          {#if metadata}{@render metadata()}{/if}
        </span>{/if}
      {#if label && !compact}<span class="identity-presence">{label}</span>{/if}
      {#if children && !discussion}<div class="identity-details">
          {@render children()}
        </div>{/if}
    </div>
  {/if}
  {#if children && discussion}<div class="identity-details">
      {@render children()}
    </div>{/if}
</div>

<style>
  .user-identity {
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 0;
    flex: 1;
    text-align: left;
  }
  .avatar-only {
    flex: none;
  }
  .identity-photo {
    position: relative;
    flex-shrink: 0;
  }
  .activity-dot {
    position: absolute;
    bottom: 0;
    right: 0;
    width: 10px;
    height: 10px;
    border: 2px solid var(--background);
    border-radius: 50%;
    background: #71b989;
  }
  .identity-copy {
    min-width: 0;
    flex: 1;
    display: flex;
    flex-direction: column;
  }
  .identity-byline {
    display: flex;
    align-items: baseline;
    gap: 8px;
    min-width: 0;
  }
  strong,
  .identity-handle {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  strong {
    font-size: 15px;
    color: var(--foreground);
  }
  .identity-handle {
    font-size: 13px;
    color: var(--muted-foreground);
  }
  .identity-presence {
    color: var(--muted-foreground);
    font-size: 12px;
    line-height: 18px;
    white-space: nowrap;
  }
  .identity-details {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    column-gap: 6px;
    min-height: 20px;
    color: var(--muted-foreground);
    font-size: 12px;
  }
  .discussion {
    display: grid;
    grid-template-columns: 40px minmax(0, 1fr);
    align-items: flex-start;
    gap: 4px 10px;
  }
  .discussion .identity-byline {
    align-items: center;
    height: 20px;
  }
  .identity-metadata {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    height: 20px;
  }
  .discussion .identity-handle {
    min-width: 0;
    font-size: 11px;
  }
  .discussion .identity-details {
    grid-column: 1 / -1;
    display: block;
    color: var(--foreground);
    font-size: 14px;
    line-height: 20px;
  }
</style>
