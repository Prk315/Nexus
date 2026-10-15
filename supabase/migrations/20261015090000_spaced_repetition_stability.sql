-- Rigtig spaced repetition (litteratur: expanding retrieval / SM-2 / FSRS):
-- per-koncept stabilitet i dage. Due = kæmpende (mean < 0.6) ELLER
-- dage-siden-review >= stabilitet. Heat forbliver ACT-R-tilstand og er IKKE
-- længere planlæggeren — 24h-halveringstiden gjorde alt due dagligt for evigt.
alter table lr_memory_state add column if not exists stability_days real not null default 1;
