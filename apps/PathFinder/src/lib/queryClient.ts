import { QueryClient } from "@tanstack/react-query";

// Central React Query client for PathFinder.
//
// Rationale (see CLAUDE.md — the Supabase layer has no cache/offline/retry):
// every call in api.ts hits the network directly and throws on failure. Wrapping
// reads/writes in React Query buys us, with zero api.ts signature changes:
//   • retry with backoff        → a dropped packet no longer fails an action
//   • staleTime + dedup         → the dashboard's many parallel reads are cached
//   • refetch on focus/reconnect→ multi-device edits show up without a manual reload
//   • networkMode "online"      → mutations pause while offline and auto-resume,
//                                 so optimistic UI survives a network blip
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000, // 30s — most PathFinder data changes on human timescales
      gcTime: 5 * 60_000,
      retry: 2, // 3 attempts total, exponential backoff below
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8_000),
      refetchOnWindowFocus: true, // cheap multi-device freshness on refocus
      refetchOnReconnect: true,
    },
    mutations: {
      retry: 1,
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8_000),
    },
  },
});

// Stable query keys — one factory so cache invalidation never drifts from reads.
export const qk = {
  tasks: ["tasks"] as const,
  plans: ["plans"] as const,
  goals: ["goals"] as const,
  systems: ["systems"] as const,
};
