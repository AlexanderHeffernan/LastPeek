<script lang="ts">
  import { Textarea } from "$lib/components/ui/textarea/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import Icon from "$lib/components/Icon.svelte";
  import {
    mentionResult,
    type MentionAccount,
    type MentionResult,
  } from "$lib/x-mentions";
  import twitter from "twitter-text";
  import { tick } from "svelte";

  let {
    value = $bindable(""),
    invalid = $bindable([]),
    url,
    enabled = true,
    id,
    label,
    placeholder,
    onchange,
  }: {
    value: string;
    invalid?: string[];
    url: string;
    enabled?: boolean;
    id: string;
    label: string;
    placeholder: string;
    onchange: () => void;
  } = $props();
  let field: HTMLTextAreaElement | null = $state(null);
  let term = $state<{ query: string; start: number; end: number } | null>(null);
  let accounts = $state<MentionAccount[]>([]);
  let selected = $state(0);
  let open = $state(false);
  let loading = $state(false);
  let problem = $state("");
  let dismissedValue = $state<string | null>(null);
  let composing = false;
  // Short-lived, per-editor memoization avoids repeated requests while moving the caret.
  const memo = new Map<string, { result: MentionResult; until: number }>();
  const pending = new Map<string, Promise<MentionResult>>();
  let generation = 0;
  let validation = 0;
  const listId = $derived(`${id}-mentions`);
  async function lookup(kind: "search" | "check", query: string) {
    const key = `${kind}:${query.toLowerCase()}`;
    const cached = memo.get(key);
    if (cached && cached.until > Date.now()) return cached.result;
    const inFlight = pending.get(key);
    if (inFlight) return inFlight;
    const request = (async () => {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, query }),
      });
      const raw = await response.json();
      if (!response.ok)
        throw new Error(
          typeof raw.message === "string"
            ? raw.message
            : "Couldn’t check X accounts. Try again later.",
        );
      const result = mentionResult.parse(raw);
      memo.set(key, {
        result,
        until: Date.now() + (result.missing ? 300000 : 900000),
      });
      for (const account of result.accounts)
        memo.set(`check:${account.username.toLowerCase()}`, {
          result: { accounts: [account], missing: false },
          until: Date.now() + 900000,
        });
      return result;
    })();
    pending.set(key, request);
    try {
      return await request;
    } finally {
      pending.delete(key);
    }
  }
  function locate() {
    if (!field || composing || field.selectionStart !== field.selectionEnd) {
      term = null;
      return;
    }
    const end = field.selectionStart;
    const match = value
      .slice(0, end)
      .match(/(?:^|\s|[([{])@([A-Za-z0-9_]{3,15})$/);
    // Do not replace just the prefix when the caret sits inside an existing handle.
    term =
      match && !/[A-Za-z0-9_]/.test(value[end] ?? " ")
        ? { query: match[1], start: end - match[1].length - 1, end }
        : null;
  }
  $effect(() => {
    const current = term;
    const revision = ++generation;
    accounts = [];
    selected = 0;
    problem = "";
    open = false;
    loading = false;
    if (!enabled || !current || dismissedValue === value) return;
    const timer = setTimeout(async () => {
      open = true;
      loading = true;
      try {
        const result = await lookup("search", current.query);
        if (revision === generation) accounts = result.accounts;
      } catch (cause) {
        if (revision === generation) problem = (cause as Error).message;
      } finally {
        if (revision === generation) loading = false;
      }
    }, 650);
    return () => clearTimeout(timer);
  });
  async function choose(account: MentionAccount) {
    if (!term || !field) return;
    const { start, end } = term;
    const suffix = value.slice(end);
    const replacement = `@${account.username}${/^\s/.test(suffix) ? "" : " "}`;
    value = value.slice(0, start) + replacement + suffix;
    invalid = invalid.filter(
      (handle) => handle !== account.username.toLowerCase(),
    );
    term = null;
    open = false;
    onchange();
    await tick();
    field.focus();
    field.setSelectionRange(
      start + replacement.length,
      start + replacement.length,
    );
  }
  async function check() {
    if (!enabled || dismissedValue === value) return;
    const revision = ++validation;
    const snapshot = value;
    const handles = [
      ...new Set(
        twitter.extractMentions(value).map((handle) => handle.toLowerCase()),
      ),
    ];
    const missing: string[] = [];
    for (const handle of handles) {
      try {
        const result = await lookup("check", handle);
        if (result.missing) missing.push(handle);
      } catch (cause) {
        if (revision === validation && value === snapshot)
          problem = (cause as Error).message;
        break;
      }
      if (revision !== validation || value !== snapshot) return;
    }
    if (revision === validation && value === snapshot) invalid = missing;
  }
  function dismissWarning() {
    dismissedValue = value;
    validation++;
    invalid = [];
    problem = "";
    term = null;
  }
</script>

<div class="mention-editor">
  <Textarea
    bind:ref={field}
    bind:value
    disabled={!field}
    {id}
    aria-label={label}
    {placeholder}
    class="post-editor"
    maxlength={25000}
    rows={1}
    role="combobox"
    aria-autocomplete="list"
    aria-expanded={open}
    aria-controls={open ? listId : undefined}
    aria-activedescendant={open && accounts.length
      ? `${listId}-${selected}`
      : undefined}
    aria-describedby={invalid.length || (!open && problem)
      ? `${id}-mention-status`
      : undefined}
    oninput={(event) => {
      value = event.currentTarget.value;
      dismissedValue = null;
      validation++;
      invalid = [];
      onchange();
      locate();
    }}
    onclick={locate}
    onselect={locate}
    oncompositionstart={() => {
      composing = true;
      term = null;
    }}
    oncompositionend={() => {
      composing = false;
      locate();
    }}
    onkeyup={(event) => {
      if (
        !["ArrowDown", "ArrowUp", "Enter", "Escape", "Tab"].includes(event.key)
      )
        locate();
    }}
    onkeydown={async (event) => {
      if (!open || composing) return;
      if (event.key === "Escape") {
        event.preventDefault();
        term = null;
      }
      if (accounts.length && ["ArrowDown", "ArrowUp"].includes(event.key)) {
        event.preventDefault();
        selected =
          (selected + (event.key === "ArrowDown" ? 1 : accounts.length - 1)) %
          accounts.length;
        await tick();
        document
          .getElementById(`${listId}-${selected}`)
          ?.scrollIntoView({ block: "nearest" });
      }
      if (event.key === "Enter" && accounts.length) {
        event.preventDefault();
        void choose(accounts[selected]);
      }
      if (event.key === "Tab") term = null;
    }}
    onblur={() => {
      term = null;
      void check();
    }}
  />
  {#if open}
    <div class="mention-menu">
      <div role="listbox" id={listId} aria-label="X accounts">
        {#each accounts as account, index (account.id)}
          <Button
            variant="ghost"
            role="option"
            id={`${listId}-${index}`}
            aria-selected={selected === index}
            class="mention-option"
            tabindex={-1}
            onpointerdown={(event) => event.preventDefault()}
            onpointerup={() => choose(account)}
            onclick={() => choose(account)}
          >
            {#if account.profile_image_url}<img
                src={account.profile_image_url}
                alt=""
                referrerpolicy="no-referrer"
              />{:else}<span class="mention-avatar" aria-hidden="true"
                >{account.name.slice(0, 1)}</span
              >{/if}
            <span class="mention-identity"
              ><strong>{account.name}</strong><span>@{account.username}</span
              ></span
            >
          </Button>
        {/each}
      </div>
      {#if loading || problem || !accounts.length}<div class="mention-feedback">
          <p role="status">
            {loading ? "Searching X…" : problem || "No accounts found"}
          </p>
          {#if !loading}<Button
              variant="ghost"
              size="icon"
              aria-label="Dismiss mention warning"
              onclick={dismissWarning}><Icon name="close" size={16} /></Button
            >{/if}
        </div>{/if}
    </div>
  {/if}
  {#if invalid.length || (!open && problem)}<div
      class="mention-feedback mention-status"
    >
      <p id={`${id}-mention-status`} role="status">
        {invalid.length
          ? `${invalid.map((handle) => `@${handle}`).join(", ")} not found on X.`
          : problem}
      </p>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Dismiss mention warning"
        onclick={dismissWarning}><Icon name="close" size={16} /></Button
      >
    </div>{/if}
</div>

<style>
  .mention-editor {
    position: relative;
    min-width: 0;
  }
  .mention-menu {
    position: absolute;
    z-index: 30;
    top: 100%;
    left: 0;
    width: min(360px, 100%);
    background: var(--popover);
    border: 1px solid var(--post-border);
    border-radius: 12px;
    box-shadow: 0 8px 28px var(--shadow);
    overflow: hidden;
  }
  .mention-menu [role="listbox"] {
    max-height: min(320px, 40dvh);
    overflow-y: auto;
  }
  .mention-menu :global(.mention-option) {
    display: flex;
    width: 100%;
    height: auto;
    min-height: 72px;
    border-radius: 0;
    justify-content: flex-start;
    gap: 12px;
    padding: 12px 16px;
    text-align: left;
    color: var(--post-foreground);
  }
  .mention-menu :global(.mention-option[aria-selected="true"]) {
    background: var(--post-surface);
  }
  .mention-menu :global(.mention-option:hover) {
    background: var(--accent);
  }
  img,
  .mention-avatar {
    width: 40px;
    height: 40px;
    border-radius: 50%;
    flex-shrink: 0;
    object-fit: cover;
  }
  .mention-avatar {
    display: grid;
    place-items: center;
    background: var(--avatar-background);
  }
  .mention-identity {
    min-width: 0;
    display: flex;
    flex-direction: column;
    font-size: 15px;
    line-height: 20px;
  }
  .mention-identity strong,
  .mention-identity > span {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .mention-identity > span {
    color: var(--post-muted);
  }
  .mention-feedback {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .mention-feedback p {
    flex: 1;
    margin: 0;
    padding: 12px;
    color: var(--post-subtle);
    font-size: 13px;
    line-height: 18px;
  }
  .mention-status {
    padding-top: 4px;
  }
  .mention-status p {
    padding: 4px 0;
    color: var(--destructive);
  }
</style>
