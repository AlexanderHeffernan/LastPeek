<script lang="ts">
  import { untrack } from "svelte";
  import { Button } from "$lib/components/ui/button/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import { Select } from "$lib/components/ui/select/index.js";
  import { financialModelSchema, type FinancialModel } from "$lib/admin";
  import type { Allowances, Plan } from "$lib/plans";
  let {
    plans,
    financialModel,
    owner,
    mode,
    send,
  }: {
    plans: Record<Plan, Allowances>;
    financialModel: FinancialModel;
    owner: boolean;
    mode: "plans" | "model";
    send: (command: object) => Promise<unknown>;
  } = $props();
  let editing = $state(untrack(() => $state.snapshot(plans)));
  let saved = $state<Plan | null>(null),
    busy = $state(false),
    failure = $state("");
  let pending = $state<Plan | null>(null),
    dialog = $state<HTMLDialogElement>();
  const fields = [
    ["drafts", "Saved drafts", 10000],
    ["storage_mb", "Storage (MB)", 1048576],
    ["upload_mb", "Upload size (MB)", 50],
    ["ai_usd", "AI budget (USD / period)", 1000],
    ["x_usd", "X budget (USD / period)", 1000],
  ] as const;
  let changes = $derived(
    pending
      ? fields.filter(
          ([field]) => editing[pending!][field] !== plans[pending!][field],
        )
      : [],
  );
  let immediate = $derived(
    changes.filter(
      ([field]) => pending === "free" || editing.pro[field] > plans.pro[field],
    ),
  );
  let deferred = $derived(
    changes.filter(
      ([field]) => pending === "pro" && editing.pro[field] < plans.pro[field],
    ),
  );
  async function save() {
    if (!pending || busy) return;
    busy = true;
    failure = "";
    try {
      await send({
        action: "allowances",
        plan: pending,
        limits: editing[pending],
      });
      saved = pending;
      dialog?.close();
    } catch (cause) {
      failure =
        cause instanceof Error ? cause.message : "Couldn’t save allowances.";
    } finally {
      busy = false;
    }
  }
  let free = $state(untrack(() => financialModel.free)),
    pro = $state(untrack(() => financialModel.pro)),
    complimentary = $state(untrack(() => financialModel.complimentary)),
    price = $state(untrack(() => financialModel.price));
  let currency = $state<string>(untrack(() => financialModel.currency)),
    fx = $state(untrack(() => financialModel.fx)),
    tax = $state(untrack(() => financialModel.tax)),
    fee = $state(untrack(() => financialModel.fee)),
    fixedFee = $state(untrack(() => financialModel.fixedFee));
  let hosting = $state(untrack(() => financialModel.hosting)),
    gbRate = $state(untrack(() => financialModel.gbRate)),
    backups = $state(untrack(() => financialModel.backups)),
    bandwidth = $state(untrack(() => financialModel.bandwidth)),
    transfer = $state(untrack(() => financialModel.transfer));
  let aiUse = $state(untrack(() => financialModel.aiUse)),
    xUse = $state(untrack(() => financialModel.xUse)),
    freeStorage = $state(untrack(() => financialModel.freeStorage)),
    proStorage = $state(untrack(() => financialModel.proStorage)),
    freeDrafts = $state(untrack(() => financialModel.freeDrafts)),
    proDrafts = $state(untrack(() => financialModel.proDrafts));
  let draftKB = $state(untrack(() => financialModel.draftKB)),
    revisionFactor = $state(untrack(() => financialModel.revisionFactor));
  let modelValues = $derived({
    free,
    pro,
    complimentary,
    price,
    currency,
    fx,
    tax,
    fee,
    fixedFee,
    hosting,
    gbRate,
    backups,
    bandwidth,
    transfer,
    aiUse,
    xUse,
    freeStorage,
    proStorage,
    freeDrafts,
    proDrafts,
    draftKB,
    revisionFactor,
  });
  let savedModel = $state(untrack(() => JSON.stringify(financialModel))),
    modelSaved = $state(false);
  let modelDirty = $derived(JSON.stringify(modelValues) !== savedModel);
  async function saveModel() {
    failure = "";
    const parsed = financialModelSchema.safeParse(modelValues);
    if (
      !parsed.success ||
      Object.values(modelValues).some((value) => value === undefined)
    ) {
      failure = "Check the model’s numeric inputs and ranges.";
      return;
    }
    busy = true;
    try {
      await send({ action: "financial-model", model: parsed.data });
      savedModel = JSON.stringify(parsed.data);
      modelSaved = true;
    } catch (cause) {
      failure = cause instanceof Error ? cause.message : "Couldn’t save model.";
    } finally {
      busy = false;
    }
  }
  const safe = (n: number | undefined) =>
    Number.isFinite(n) ? Math.max(0, Number(n)) : 0;
  let exchange = $derived(currency === "USD" ? 1 : safe(fx));
  let proAccounts = $derived(safe(pro) + safe(complimentary));
  let mediaGB = $derived(
    ((safe(free) * plans.free.storage_mb * safe(freeStorage)) / 100 +
      (proAccounts * plans.pro.storage_mb * safe(proStorage)) / 100) /
      1024,
  );
  let draftCount = $derived(
    (safe(free) * plans.free.drafts * safe(freeDrafts)) / 100 +
      (proAccounts * plans.pro.drafts * safe(proDrafts)) / 100,
  );
  let dbGB = $derived(
    (draftCount * safe(draftKB) * safe(revisionFactor)) / 1024 / 1024,
  );
  let apiUSD = $derived(
    proAccounts *
      ((plans.pro.ai_usd * safe(aiUse)) / 100 +
        (plans.pro.x_usd * safe(xUse)) / 100),
  );
  let revenue = $derived(safe(pro) * safe(price));
  let net = $derived(revenue / (1 + safe(tax) / 100));
  let fees = $derived(
    safe(pro) * ((safe(price) * safe(fee)) / 100 + safe(fixedFee)),
  );
  let infrastructure = $derived(
    safe(hosting) +
      (mediaGB + dbGB) * (1 + safe(backups)) * safe(gbRate) +
      mediaGB * safe(transfer) * safe(bandwidth),
  );
  let costs = $derived(infrastructure + apiUSD * exchange + fees);
  let profit = $derived(net - costs);
  let fullMedia = $derived(
    (safe(free) * plans.free.storage_mb + proAccounts * plans.pro.storage_mb) /
      1024,
  );
  let fullDB = $derived(
    ((safe(free) * plans.free.drafts + proAccounts * plans.pro.drafts) *
      safe(draftKB) *
      safe(revisionFactor)) /
      1024 /
      1024,
  );
  let fullCosts = $derived(
    safe(hosting) +
      (fullMedia + fullDB) * (1 + safe(backups)) * safe(gbRate) +
      fullMedia * safe(transfer) * safe(bandwidth) +
      proAccounts * (plans.pro.ai_usd + plans.pro.x_usd) * exchange +
      fees,
  );
  let variablePro = $derived(
    ((plans.pro.ai_usd * safe(aiUse)) / 100 +
      (plans.pro.x_usd * safe(xUse)) / 100) *
      exchange +
      ((plans.pro.storage_mb * safe(proStorage)) / 100 / 1024 +
        (((plans.pro.drafts * safe(proDrafts)) / 100) *
          safe(draftKB) *
          safe(revisionFactor)) /
          1024 /
          1024) *
        (1 + safe(backups)) *
        safe(gbRate) +
      ((plans.pro.storage_mb * safe(proStorage)) / 100 / 1024) *
        safe(transfer) *
        safe(bandwidth),
  );
  let contribution = $derived(
    safe(price) / (1 + safe(tax) / 100) -
      (safe(price) * safe(fee)) / 100 -
      safe(fixedFee) -
      variablePro,
  );
  let breakEven = $derived(
    contribution > 0
      ? Math.ceil(
          Math.max(
            0,
            infrastructure + apiUSD * exchange - safe(pro) * variablePro,
          ) / contribution,
        )
      : null,
  );
  const money = (n: number) => `${currency} ${n.toFixed(2)}`;
</script>

{#if mode === "plans"}
  <h2>Plan allowances</h2>
  <div class="plan-grid">
    {#each ["free", "pro"] as plan}
      {@const key = plan as Plan}
      <form
        class="stack panel"
        onsubmit={(event) => {
          event.preventDefault();
          pending = key;
          failure = "";
          dialog?.showModal();
        }}
      >
        <h3>{key === "free" ? "Free" : "Pro"}</h3>
        {#each fields as [field, label, max]}
          <label
            >{label}<Input
              type="number"
              min={field === "upload_mb" ? 1 : 0}
              {max}
              step={field.endsWith("usd") ? 0.01 : 1}
              bind:value={editing[key][field]}
              required
              disabled={!owner || (key === "free" && field.endsWith("usd"))}
              oninput={() => (saved = null)}
            /></label
          >
        {/each}
        {#if owner}<Button
            type="submit"
            disabled={JSON.stringify(editing[key]) ===
              JSON.stringify(plans[key])}
            >{saved === key
              ? "Saved"
              : `Save ${key === "free" ? "Free" : "Pro"} allowances`}</Button
          >{/if}
      </form>
    {/each}
  </div>
  <dialog
    bind:this={dialog}
    class="confirm-dialog"
    aria-label="Confirm allowance changes"
  >
    <h2>Change {pending === "pro" ? "Pro" : "Free"} allowances?</h2>
    {#if immediate.length}
      <h3>Effective immediately</h3>
      <ul>
        {#each immediate as [field, label]}<li>
            {label}: {plans[pending!][field]} → {editing[pending!][field]}
          </li>{/each}
      </ul>
    {/if}
    {#if deferred.length}
      <h3>Next billing period</h3>
      <p>
        These reductions apply at each account’s next renewal. Current
        allowances stay unchanged until then.
      </p>
      <ul>
        {#each deferred as [field, label]}<li>
            {label}: {plans.pro[field]} → {editing.pro[field]}
          </li>{/each}
      </ul>
    {/if}
    {#if pending === "free" && immediate.some(([field]) => editing.free[field] < plans.free[field])}<p
      >
        Existing content stays available. Accounts over the new limits cannot
        add more drafts or storage.
      </p>{/if}
    {#if failure}<p class="error" role="alert">{failure}</p>{/if}
    <div class="row">
      <Button variant="outline" disabled={busy} onclick={() => dialog?.close()}
        >Cancel</Button
      ><Button disabled={busy} onclick={save}
        >{busy ? "Saving…" : "Confirm allowances"}</Button
      >
    </div>
  </dialog>
{:else}
  <div class="model-heading">
    <h2>Financial model</h2>
    {#if owner}<Button disabled={busy || !modelDirty} onclick={saveModel}
        >{busy
          ? "Saving…"
          : modelSaved && !modelDirty
            ? "Saved"
            : "Save model"}</Button
      >{/if}
  </div>
  {#if failure}<p class="error" role="alert">{failure}</p>{/if}
  <div class="model-results" aria-live="polite">
    {#each [["Gross subscription revenue", revenue], ["Revenue excluding tax", net], ["Estimated costs", costs], ["Profit / loss", profit], ["Full-allowance profit / loss", net - fullCosts], ["Contribution / paying Pro", contribution]] as [label, value]}
      <div>
        <span class="small muted">{label}</span><strong
          >{money(Number(value))}</strong
        >
      </div>
    {/each}
  </div>
  <p class="small">
    Break-even paying Pro accounts: <strong
      >{breakEven ?? "Not achievable at this price and usage"}</strong
    >
    · Margin: {net ? ((profit / net) * 100).toFixed(1) : "0"}%
  </p>
  <p class="small muted">
    Media: {mediaGB.toFixed(2)} GB · Estimated database: {dbGB.toFixed(3)} GB · Drafts:
    {Math.round(draftCount)} · APIs: {money(apiUSD * exchange)} · Infrastructure:
    {money(infrastructure)} · Payment fees: {money(fees)}
  </p>
  <div class="plan-grid">
    <section class="stack panel">
      <h3>Accounts &amp; revenue</h3>
      <label
        >Currency<Select
          aria-label="Currency"
          bind:value={currency}
          options={[
            { value: "USD", label: "USD" },
            { value: "NZD", label: "NZD" },
          ]}
        /></label
      >
      {#if currency !== "USD"}<label
          >NZD per USD<Input
            type="number"
            min="0.01"
            step="0.01"
            bind:value={fx}
          /></label
        >{/if}
      <label
        >Free users<Input
          type="number"
          min="0"
          step="1"
          bind:value={free}
        /></label
      >
      <label
        >Paying Pro users<Input
          type="number"
          min="0"
          step="1"
          bind:value={pro}
        /></label
      >
      <label
        >Complimentary Pro users<Input
          type="number"
          min="0"
          step="1"
          bind:value={complimentary}
        /></label
      >
      <label
        >Pro monthly price<Input
          type="number"
          min="0"
          step="0.01"
          bind:value={price}
        /></label
      >
      <label
        >Tax included in price (%)<Input
          type="number"
          min="0"
          max="100"
          step="0.1"
          bind:value={tax}
        /></label
      >
      <label
        >Payment fee (%)<Input
          type="number"
          min="0"
          max="100"
          step="0.1"
          bind:value={fee}
        /></label
      >
      <label
        >Payment fee per subscription<Input
          type="number"
          min="0"
          step="0.01"
          bind:value={fixedFee}
        /></label
      >
    </section>
    <section class="stack panel">
      <h3>Average allowance use</h3>
      <label
        >Pro AI usage · {aiUse}%<input
          aria-label="Pro AI usage"
          type="range"
          min="0"
          max="100"
          bind:value={aiUse}
        /></label
      >
      <label
        >Pro X usage · {xUse}%<input
          aria-label="Pro X usage"
          type="range"
          min="0"
          max="100"
          bind:value={xUse}
        /></label
      >
      <label
        >Free storage usage · {freeStorage}%<input
          aria-label="Free storage usage"
          type="range"
          min="0"
          max="100"
          bind:value={freeStorage}
        /></label
      >
      <label
        >Pro storage usage · {proStorage}%<input
          aria-label="Pro storage usage"
          type="range"
          min="0"
          max="100"
          bind:value={proStorage}
        /></label
      >
      <label
        >Free draft usage · {freeDrafts}%<input
          aria-label="Free draft usage"
          type="range"
          min="0"
          max="100"
          bind:value={freeDrafts}
        /></label
      >
      <label
        >Pro draft usage · {proDrafts}%<input
          aria-label="Pro draft usage"
          type="range"
          min="0"
          max="100"
          bind:value={proDrafts}
        /></label
      >
    </section>
    <section class="stack panel">
      <h3>Infrastructure assumptions</h3>
      <label
        >Fixed hosting / month<Input
          type="number"
          min="0"
          step="0.01"
          bind:value={hosting}
        /></label
      >
      <label
        >Storage cost / GB-month<Input
          type="number"
          min="0"
          step="0.001"
          bind:value={gbRate}
        /></label
      >
      <label
        >Additional backup copies<Input
          type="number"
          min="0"
          step="1"
          bind:value={backups}
        /></label
      >
      <label
        >Transfer cost / GB<Input
          type="number"
          min="0"
          step="0.001"
          bind:value={bandwidth}
        /></label
      >
      <label
        >Monthly transfer / stored media GB<Input
          type="number"
          min="0"
          step="0.1"
          bind:value={transfer}
        /></label
      >
      <label
        >Database KB / draft snapshot<Input
          type="number"
          min="0"
          step="1"
          bind:value={draftKB}
        /></label
      >
      <label
        >Revision &amp; feedback multiplier<Input
          type="number"
          min="1"
          step="1"
          bind:value={revisionFactor}
        /></label
      >
    </section>
  </div>
{/if}

<style>
  .confirm-dialog h2 {
    margin: 0 0 24px;
  }
  .confirm-dialog h3 {
    margin: 20px 0 10px;
  }
  .confirm-dialog ul {
    display: grid;
    gap: 8px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .confirm-dialog p {
    margin: 12px 0;
  }
  .confirm-dialog .row {
    margin-top: 28px;
    gap: 12px;
  }
  .model-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
  }
  .model-heading h2 {
    margin: 0;
  }
  h2 {
    font-size: 24px;
    margin: 0 0 12px;
  }
  h3 {
    font-size: 18px;
    margin: 0;
  }
  .plan-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 18px;
    margin-top: 24px;
  }
  .panel {
    border: 1px solid var(--line);
    border-radius: 12px;
    padding: 18px;
    min-width: 0;
    background: var(--paper);
  }
  label {
    display: grid;
    gap: 8px;
    font-size: 13px;
  }
  input[type="range"] {
    width: 100%;
    accent-color: var(--primary);
    min-height: 32px;
  }
  .model-results {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
    margin: 24px 0;
  }
  .model-results > div {
    display: grid;
    gap: 10px;
    border: 1px solid var(--line);
    border-radius: 12px;
    padding: 16px;
    min-width: 0;
  }
  strong {
    overflow-wrap: anywhere;
  }
  .model-results strong {
    font-size: 22px;
  }
  @media (max-width: 750px) {
    .plan-grid {
      grid-template-columns: 1fr;
    }
  }
  @media (max-width: 350px) {
    .model-results {
      grid-template-columns: 1fr;
    }
  }
</style>
