import type { User } from "$lib/server/auth";
declare global {
  namespace App {
    interface Locals {
      user: User | null;
      pushSession?: string;
    }
    interface PageData {
      connections: import("$lib/contracts").FriendConnection[];
      viewerId: string | null;
      unreadNotifications: number;
    }
    interface PageState {
      // The landing page's sign-in dialog, opened over / with /login as its address.
      signIn?: boolean;
    }
  }
}
export {};
