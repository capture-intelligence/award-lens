-- M2M between an award and the federal account(s) / program activity(ies)
-- it draws from. USAspending exposes this via /awards/funding/ — one row per
-- (award, account, program activity, fiscal period). We collapse to distinct
-- (account, program activity) tuples so a contract that touches an account in
-- multiple periods only stores one row per tuple.
--
-- Why this matters: the awarding_office field is too generic at the CDC level
-- (everything rolls up to "CDC OFFICE OF ACQUISITION SERVICES"). The federal
-- account is the precise center-level identifier — e.g., 075-0950 = "HIV/AIDS,
-- Viral Hepatitis, STD and TB Prevention" (NCHHSTP), 075-0948 = NCCDPHP, etc.

CREATE TABLE IF NOT EXISTS award_federal_account (
    award_id              TEXT NOT NULL REFERENCES award(award_id),
    federal_account_code  TEXT NOT NULL,    -- e.g., "075-0950"
    federal_account_name  TEXT,             -- e.g., "HIV/AIDS, Viral Hepatitis, STD and TB Prevention, CDC, HHS"
    program_activity_code TEXT,             -- e.g., "0012"
    program_activity_name TEXT,             -- e.g., "HIV/AIDS, VIRAL HEPATITIS, STD AND TB PREVENTION (0950)"
    PRIMARY KEY (award_id, federal_account_code, program_activity_code)
);

CREATE INDEX IF NOT EXISTS idx_award_federal_account_account
    ON award_federal_account(federal_account_code);
CREATE INDEX IF NOT EXISTS idx_award_federal_account_award
    ON award_federal_account(award_id);
