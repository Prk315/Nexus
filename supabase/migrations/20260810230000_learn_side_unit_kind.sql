-- Side units generalize: proofs and exam workshops share the lr_proof_* trio.
-- kind ∈ 'proof' | 'workshop'. Workshops anchor to the LAST unit of a chapter
-- (parent_unit_id) and unlock when ≥1 unit of that chapter is mastered.
ALTER TABLE lr_proof_unit ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'proof';
