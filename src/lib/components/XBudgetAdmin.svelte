<script lang="ts">
  import { Button } from "$lib/components/ui/button/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import type { XBudget } from "$lib/admin";

  let {
    budget,
    isOwner,
    onsave,
  }: {
    budget: XBudget;
    isOwner: boolean;
    onsave: (command: object) => Promise<unknown>;
  } = $props();
  let amount = $state<number | undefined>();
  let saving = $state(false);
  let error = $state("");
  const id = $props.id();
  const usd = (cents: number) => `US$${(cents / 100).toFixed(2)}`;
  $effect(() => {
    amount = budget.limitCents === null ? undefined : budget.limitCents / 100;
  });

  async function save(event: SubmitEvent) {
    event.preventDefault();
    if (saving || amount === undefined) return;
    saving = true;
    error = "";
    try {
      await onsave({
        action: "x-api-budget",
        limitCents: Math.round(amount * 100),
      });
    } catch (cause) {
      error =
        cause instanceof Error
          ? cause.message
          : "Couldn’t save the X cap. Try again.";
    } finally {
      saving = false;
    }
  }
</script>

<section class="budget" aria-label="Global X API cap">
  <h3>Global X API cap</h3>
  <p class="small muted">
    {usd(budget.reservedCents)} reserved this month · {budget.limitCents ===
    null
      ? "Cap not configured"
      : `${usd(budget.limitCents)} cap`}
  </p>
  <form onsubmit={save}>
    <label for={id}>Monthly cap (USD)</label>
    <div class="controls">
      <Input
        {id}
        type="number"
        min="0"
        max="99999.99"
        step="0.01"
        required
        bind:value={amount}
        disabled={!isOwner || saving}
      />
      {#if isOwner}<Button
          type="submit"
          disabled={saving ||
            amount === undefined ||
            Math.round(amount * 100) === budget.limitCents}
          >{saving ? "Saving…" : "Save cap"}</Button
        >{/if}
    </div>
    {#if error}<p class="error small" role="alert">{error}</p>{/if}
  </form>
  <p class="small muted">
    Shared by all accounts. Safety reservations, not billed spend. Set 0 to stop
    new paid requests; lowering the cap never resets reservations or cancels
    calls already in flight.
  </p>
  <p class="small muted">
    Renews {new Date(budget.renewsAt).toLocaleDateString("en-NZ", {
      timeZone: "UTC",
      dateStyle: "medium",
    })} at 00:00 UTC. Per-account allowances still apply.
  </p>
</section>

<style>
  .budget {
    display: grid;
    gap: 12px;
    padding-bottom: 24px;
    margin-bottom: 24px;
    border-bottom: 1px solid var(--border);
  }
  h3,
  p {
    margin: 0;
  }
  form {
    display: grid;
    gap: 8px;
  }
  .controls {
    display: flex;
    align-items: center;
    gap: 12px;
    max-width: 360px;
  }
</style>
