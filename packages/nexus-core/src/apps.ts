// Deployed ecosystem web apps — the single source of truth for the header's app
// switcher. Committed deliberately rather than read from per-deployment
// `VITE_*_URL` env vars: those lived only in the Vercel dashboard, invisible to the
// repo, and exactly one of them drifted. Protocol's `VITE_PATHFINDER_URL` pointed at
// PathFinder's *team-scoped* deployment URL, which is gated by Vercel Authentication
// (`ssoProtection: all_except_custom_domains`). Any user who is not a member of the
// Vercel team — i.e. every actual user of these apps — got "Request Sent / Team
// owners emailed" instead of PathFinder. The owner never saw it, because his browser
// carries a Vercel session for the owning team.
//
// So: these MUST be the public production aliases, never a
// `*-bastian-thomsens-projects.vercel.app` URL. Those are reachable only by Vercel
// team members, and needing a Vercel seat to switch apps is never the intent.
//
// Note Vault's URL is `neurovias-nexus-vault`, not `vault` — the bare
// `vault.vercel.app` was claimed long ago by an unrelated project (a crates.io
// dependency visualizer) and serves a stranger's site. Do not "tidy" it shorter.

export interface WebApp {
  /**
   * Must match exactly the `appName` prop the app passes to <NexusHeader>, or the
   * switcher stops marking the current app and offers a link back to itself.
   */
  name: string;
  /** Public production URL. Verify it loads with no Vercel session before adding. */
  url: string;
}

export const WEB_APPS: WebApp[] = [
  { name: "Vault", url: "https://neurovias-nexus-vault.vercel.app" },
  { name: "PathFinder", url: "https://nexus-path-finder.vercel.app" },
  { name: "Protocol", url: "https://nexus-protocol-ilx4.vercel.app" },
];
