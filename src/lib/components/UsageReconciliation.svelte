<script lang="ts">
  import { Button } from "$lib/components/ui/button/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import { Textarea } from "$lib/components/ui/textarea/index.js";
  import { Checkbox } from "$lib/components/ui/checkbox/index.js";
  import { Select } from "$lib/components/ui/select/index.js";
  import type { UsageData } from "$lib/usage";
  let {
    usage,
    owner,
    send,
  }: {
    usage: UsageData;
    owner: boolean;
    send: (command: object) => Promise<unknown>;
  } = $props();
  let selected = $state<string[]>([]),
    decision = $state("non_billable"),
    usd = $state<number>();
  let reason = $state(""),
    evidence = $state(""),
    failure = $state(""),
    busy = $state(false);
  let checkpoint = $state<string | null>(null),
    dialog = $state<HTMLDialogElement>();
  const id = $props.id();
  const date = (value: string) => new Date(value).toLocaleString();
  const money = (value: number) =>
    `US$${value.toLocaleString("en-US", { maximumFractionDigits: 6 })}`;
  function open(balance = false) {
    checkpoint = balance ? (usage.xBalance?.id ?? null) : null;
    reason = "";
    evidence = "";
    failure = "";
    decision = "non_billable";
    usd = undefined;
    dialog?.showModal();
  }
  async function save(event: SubmitEvent) {
    event.preventDefault();
    if (busy) return;
    busy = true;
    failure = "";
    try {
      await send(
        checkpoint
          ? {
              action: "reconcile-x-balance",
              snapshotId: checkpoint,
              reason,
              evidence,
            }
          : {
              action: "reconcile-usage",
              ids: selected,
              decision,
              ...(decision === "confirmed" ? { usd } : {}),
              reason,
              evidence,
            },
      );
      selected = [];
      dialog?.close();
    } catch (cause) {
      failure =
        cause instanceof Error ? cause.message : "Couldn’t reconcile usage.";
    } finally {
      busy = false;
    }
  }
</script>

<section class="reconciliation" aria-label="Usage reconciliation">
  <h3>Reconciliation</h3>
  {#if usage.unresolved.length}
    <p class="small muted">
      Oldest unresolved requests · up to 50 per selection
    </p>
    {#if owner}<label class="row selection">
        <Checkbox
          aria-label="Select all resolvable requests"
          checked={usage.unresolved.some((row) => row.resolvable) &&
            usage.unresolved
              .filter((row) => row.resolvable)
              .every((row) => selected.includes(row.id))}
          onCheckedChange={(checked) =>
            (selected = checked
              ? usage.unresolved
                  .filter((row) => row.resolvable)
                  .map((row) => row.id)
              : [])}
        />
        Select all available
      </label>{/if}
    <ul class="requests">
      {#each usage.unresolved as request (request.id)}
        <li>
          {#if owner}<Checkbox
              aria-label={`Select request ${request.id}`}
              disabled={!request.resolvable}
              checked={selected.includes(request.id)}
              onCheckedChange={(checked) =>
                (selected = checked
                  ? [...selected, request.id]
                  : selected.filter((value) => value !== request.id))}
            />{/if}
          <div>
            <strong>{request.operation}</strong>
            <p class="small muted">
              {request.account || "Unattributed app cost"} · {date(
                request.createdAt,
              )}
            </p>
            <p class="small muted">
              {request.outcome}{#if !request.resolvable}
                · active; check again after ten minutes{/if}
            </p>
            <code>{request.id}</code>
          </div>
        </li>
      {/each}
    </ul>
    {#if owner}<Button disabled={!selected.length} onclick={() => open()}
        >Reconcile {selected.length} requests</Button
      >{/if}
  {:else}<p class="small muted">
      No requests awaiting reconciliation in this view.
    </p>{/if}
  {#if owner && usage.xBalance?.state === "review"}
    <div class="checkpoint">
      <Button variant="outline" onclick={() => open(true)}
        >Review X balance checkpoint</Button
      >
    </div>
  {/if}
  {#if usage.reconciliations.length}
    <h4>Reconciliation history</h4>
    <ul class="audit">
      {#each usage.reconciliations as entry (entry.id)}
        <li>
          <strong
            >{entry.decision === "checkpoint"
              ? "X balance checkpoint"
              : entry.decision === "non_billable"
                ? `${entry.requests} non-billable exceptions`
                : `${entry.requests} requests · ${money(entry.usd ?? 0)} confirmed`}</strong
          >
          <p>{entry.reason}</p>
          {#if entry.evidence}<p class="small">{entry.evidence}</p>{/if}
          <p class="small muted">{entry.actor} · {date(entry.createdAt)}</p>
          {#if entry.thread}<p class="small muted">{entry.thread}</p>{/if}
          {#if entry.snapshotId}<p class="small muted">
              X balance snapshot {entry.snapshotId}
            </p>{/if}
          {#if entry.ids.length}<details>
              <summary>Affected request IDs</summary
              >{#each entry.ids as request}<code class="request-id"
                  >{request}</code
                >{/each}
            </details>{/if}
          <code>{entry.id}</code>
        </li>
      {/each}
    </ul>
  {/if}
</section>
<dialog
  bind:this={dialog}
  class="confirm-dialog"
  aria-labelledby={`${id}-title`}
  oncancel={(event) => {
    if (busy) event.preventDefault();
  }}
>
  <h2 id={`${id}-title`}>
    {checkpoint
      ? "Accept a new X balance baseline?"
      : `Reconcile ${selected.length} requests`}
  </h2>
  <form class="stack" onsubmit={save}>
    {#if checkpoint}
      <p class="small">
        Snapshot {checkpoint} · {usage.xBalance
          ? date(usage.xBalance.observedAt)
          : ""}
      </p>
      <p>
        This accepts the reviewed discrepancy and starts future comparisons from
        this snapshot. It does not assign historical charges to users or claim
        that earlier totals matched.
      </p>
      {#if usage.xBalance}<dl>
          <div>
            <dt>Prepaid credit</dt>
            <dd>{money(usage.xBalance.prepaidUsd)}</dd>
          </div>
          <div>
            <dt>Free credit</dt>
            <dd>{money(usage.xBalance.freeUsd)}</dd>
          </div>
          <div>
            <dt>Recorded payer ledger subtotal</dt>
            <dd>{money(usage.xBalance.ledgerUsd)}</dd>
          </div>
          <div>
            <dt>Requests / unresolved at snapshot</dt>
            <dd>{usage.xBalance.requests} / {usage.xBalance.unresolved}</dd>
          </div>
        </dl>{/if}
    {:else}
      <label
        >Decision<Select
          bind:value={decision}
          options={[
            { value: "non_billable", label: "Non-billable exception" },
            { value: "confirmed", label: "Confirmed provider cost" },
          ]}
        /></label
      >
      {#if decision === "confirmed"}
        <label
          >Verified USD per request<Input
            type="number"
            min="0"
            max="1000"
            step="0.000001"
            required
            bind:value={usd}
          /></label
        >
        <p class="small">
          The same amount applies to each of the {selected.length} selected requests.
          Select separately when costs differ. Use itemized evidence, never a budget
          reservation or a rounded payer total.
        </p>
      {:else}<p>
          The {selected.length} selected requests will be excluded from billing. Their
          original unknown provider costs stay unknown, not zero. Safety allowances
          are unchanged.
        </p>{/if}
      <details>
        <summary>Selected request IDs</summary>{#each selected as request}<code
            class="request-id">{request}</code
          >{/each}
      </details>
    {/if}
    <label
      >Reason<Textarea
        bind:value={reason}
        required
        minlength={5}
        maxlength={500}
      /></label
    >
    <label
      >Evidence or reference<Textarea
        bind:value={evidence}
        required={Boolean(checkpoint) || decision === "confirmed"}
        minlength={checkpoint || decision === "confirmed" ? 5 : 0}
        maxlength={1000}
      /></label
    >
    {#if failure}<p class="error" role="alert">{failure}</p>{/if}
    <div class="row actions">
      <Button
        type="button"
        variant="ghost"
        disabled={busy}
        onclick={() => dialog?.close()}>Cancel</Button
      ><Button type="submit" disabled={busy}
        >{busy
          ? "Recording…"
          : checkpoint
            ? "Accept checkpoint"
            : "Record reconciliation"}</Button
      >
    </div>
  </form>
</dialog>

<style>
  .reconciliation {
    margin-top: 24px;
    min-width: 0;
  }
  .requests,
  .audit {
    list-style: none;
    padding: 0;
    margin: 12px 0;
  }
  li {
    border-top: 1px solid var(--border);
    padding: 16px 0;
    overflow-wrap: anywhere;
  }
  .requests li {
    display: flex;
    gap: 16px;
    align-items: flex-start;
  }
  .requests li > div {
    min-width: 0;
  }
  .requests :global([data-slot="checkbox"]) {
    margin-top: 4px;
  }
  li p {
    margin: 4px 0;
  }
  code {
    font-size: 11px;
    overflow-wrap: anywhere;
  }
  .selection {
    min-height: 44px;
  }
  .checkpoint {
    margin: 20px 0;
  }
  .request-id {
    display: block;
    margin: 4px 0;
  }
  .actions {
    justify-content: flex-end;
    flex-wrap: wrap;
  }
  dialog {
    max-height: calc(100dvh - 32px);
    overflow: auto;
  }
</style>
