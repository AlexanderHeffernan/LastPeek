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
  }
}
export {};
