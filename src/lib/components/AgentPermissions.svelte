<script lang="ts">
  import { Checkbox } from "$lib/components/ui/checkbox/index.js";
  import { agentPermissions, agentScopes, type AgentScope } from "$lib/agents";
  let {
    selected = $bindable<AgentScope[]>([]),
    available = agentScopes,
    showUnavailable = false,
    prefix = "permission",
  }: {
    selected?: AgentScope[];
    available?: readonly AgentScope[];
    showUnavailable?: boolean;
    prefix?: string;
  } = $props();
</script>

<div class="permissions">
  {#each agentPermissions.filter((permission) => showUnavailable || available.includes(permission.scope)) as permission}
    <label
      class="permission"
      class:unavailable={!available.includes(permission.scope)}
      for={`${prefix}-${permission.scope}`}
    >
      <Checkbox
        id={`${prefix}-${permission.scope}`}
        name="scope"
        value={permission.scope}
        disabled={!available.includes(permission.scope)}
        checked={selected.includes(permission.scope)}
        onCheckedChange={(checked) => {
          selected = checked
            ? [...selected, permission.scope]
            : selected.filter((scope) => scope !== permission.scope);
        }}
      />
      <span
        ><strong>{permission.label}</strong><span class="description"
          >{permission.description}</span
        ></span
      >
    </label>
  {/each}
</div>

<style>
  .permissions {
    display: grid;
    gap: 18px;
  }
  .permission {
    display: flex;
    gap: 14px;
    align-items: flex-start;
    cursor: pointer;
    margin: 0;
  }
  .unavailable {
    cursor: default;
    color: var(--muted-foreground);
  }
  strong {
    display: block;
    font-size: 14px;
    font-weight: 600;
    line-height: 20px;
  }
  .description {
    display: block;
    color: var(--muted-foreground);
    font-size: 13px;
    line-height: 1.5;
    margin-top: 3px;
  }
</style>
