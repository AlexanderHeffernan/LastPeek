import { SvelteMap } from "svelte/reactivity";

// Each layout owns its registry, including during SSR. Never share account data globally.
export class Presence {
  users = new SvelteMap<string, number>();
  activity = new SvelteMap<string, string | null>();
  now = $state(Date.now());

  watch(id: string) {
    this.users.set(id, (this.users.get(id) ?? 0) + 1);
    return () => {
      const count = this.users.get(id)! - 1;
      if (count) this.users.set(id, count);
      else this.users.delete(id);
    };
  }
}
