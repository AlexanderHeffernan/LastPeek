<script lang="ts">
  let { href = "/" }: { href?: string } = $props();
</script>

<a class="brand" {href} aria-label="LastPeek home"
  ><span class="brand-mark">
    <svg
      width="35"
      height="35"
      viewBox="0 0 40 40"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M3 21C7 13 12 9 20 9C28 9 33 13 37 21C33 29 28 33 20 33C12 33 7 29 3 21Z"
        stroke="currentColor"
        stroke-width="3"
      />
      <path d="M20 14A7 7 0 1 0 27 21H20V14Z" fill="currentColor" />
      <path
        d="M29 4V12M25 8H33"
        stroke="currentColor"
        stroke-width="2.5"
        stroke-linecap="round"
      />
    </svg>
  </span>LastPeek</a
>
