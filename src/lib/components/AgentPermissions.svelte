<script lang="ts">
  import { Checkbox } from "$lib/components/ui/checkbox/index.js";
  import Icon from "$lib/components/Icon.svelte";
  import {
    agentPermissions,
    agentPermissionGroups,
    agentScopes,
    type AgentScope,
  } from "$lib/agents";
  let {
    selected = $bindable<AgentScope[]>([]),
    available = agentScopes,
    prefix = "permission",
  }: {
    selected?: AgentScope[];
    available?: readonly AgentScope[];
    prefix?: string;
  } = $props();
</script>

<div class="permissions">
  {#each agentPermissionGroups as group}
    {@const permissions = agentPermissions.filter(
      (permission) =>
        (group.scopes as readonly AgentScope[]).includes(permission.scope) &&
        available.includes(permission.scope),
    )}
    {#if permissions.length}
      {@const count = permissions.filter((permission) =>
        selected.includes(permission.scope),
      ).length}
      <fieldset>
        <legend>{group.label}</legend>
        <details>
          <summary aria-label={group.label}>
            <span>{group.label}</span>
            <span class="selection-count">{count} of {permissions.length}</span>
            <span class="caret"><Icon name="down" size={16} /></span>
          </summary>
          <div class="group-permissions">
            {#each permissions as permission}
              <label class="permission" for={`${prefix}-${permission.scope}`}>
                <Checkbox
                  id={`${prefix}-${permission.scope}`}
                  name="scope"
                  value={permission.scope}
                  checked={selected.includes(permission.scope)}
                  onCheckedChange={(checked) => {
                    selected = checked
                      ? [...new Set([...selected, permission.scope])]
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
        </details>
        <label class="group-toggle" for={`${prefix}-${group.label}`}>
          <Checkbox
            id={`${prefix}-${group.label}`}
            aria-label={`All ${group.label.toLowerCase()} permissions`}
            checked={count === permissions.length}
            indeterminate={count > 0 && count < permissions.length}
            onCheckedChange={(checked) => {
              const scopes = permissions.map((permission) => permission.scope);
              selected = checked
                ? [...new Set([...selected, ...scopes])]
                : selected.filter(
                    (scope) =>
                      !scopes.includes(scope as (typeof scopes)[number]),
                  );
            }}
          />
        </label>
      </fieldset>
    {/if}
  {/each}
</div>

<style>
  .permissions {
    display: grid;
    gap: 12px;
  }
  fieldset {
    position: relative;
    margin: 0;
    padding: 0;
    border: 0;
    min-width: 0;
  }
  legend {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
  }
  summary {
    display: flex;
    gap: 10px;
    align-items: center;
    min-height: 44px;
    padding-right: 66px;
    border-bottom: 1px solid var(--line);
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    list-style: none;
  }
  summary::-webkit-details-marker {
    display: none;
  }
  summary:focus-visible {
    outline: 2px solid var(--ring);
    outline-offset: 2px;
    border-radius: 4px;
  }
  .selection-count {
    color: var(--muted-foreground);
    font-weight: 400;
  }
  .caret {
    position: absolute;
    right: 4px;
    display: flex;
    transition: transform 160ms ease;
  }
  details[open] .caret {
    transform: rotate(180deg);
  }
  .group-toggle {
    position: absolute;
    top: 0;
    right: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 40px;
    height: 44px;
    cursor: pointer;
  }
  .group-permissions {
    display: grid;
    gap: 14px;
    padding-top: 14px;
  }
  @media (prefers-reduced-motion: reduce) {
    .caret {
      transition: none;
    }
  }
  .permission {
    display: flex;
    gap: 14px;
    align-items: flex-start;
    cursor: pointer;
    margin: 0;
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
