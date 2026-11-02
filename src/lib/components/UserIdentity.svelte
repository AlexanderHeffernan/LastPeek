<script lang="ts">
  import { getContext, untrack, type Snippet } from "svelte";
  import { page } from "$app/state";
  import type { Presence } from "$lib/presence.svelte";
  import { avatarURL, presenceLabel } from "$lib/contracts";
  let {
    name,
    avatarId,
    handle,
    userId,
    token,
    avatarOnly = false,
    showPresence = true,
    compact = false,
    children,
  }: {
    name: string;
    avatarId?: string | null;
    handle?: string | null;
    userId?: string | null;
    token?: string;
    avatarOnly?: boolean;
    showPresence?: boolean;
    compact?: boolean;
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

<span class="user-identity" class:avatar-only={avatarOnly}>
  <span class="identity-photo">
    <span class="avatar" aria-hidden="true">
      {#if avatarId}<img
          src={avatarURL(avatarId, token)}
          alt=""
          loading="lazy"
        />
      {:else}{name.slice(0, 1).toUpperCase()}{/if}
    </span>
    {#if !avatarOnly && label === "Active now"}<span
        class="activity-dot"
        role="img"
        aria-label="Active now"
      ></span>{/if}
  </span>
  {#if !avatarOnly}
    <span class="identity-copy">
      <span class="identity-byline">
        <strong title={name}>{name}</strong>
        {#if handle}<span class="identity-handle"
            >{handle.startsWith("@") ? handle : `@${handle}`}</span
          >{/if}
      </span>
      {#if label && !compact}<span class="identity-presence">{label}</span>{/if}
      {#if children}<span class="identity-details">{@render children()}</span
        >{/if}
    </span>
  {/if}
</span>

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
</style>
