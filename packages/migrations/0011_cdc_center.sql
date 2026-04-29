-- ─────────────────────────────────────────────────────────────────────────
-- CDC center mapping — DB-backed lookup from federal_account_code → center
-- ─────────────────────────────────────────────────────────────────────────
--
-- Replaces the hardcoded TS map at workers/api/src/cdc/center-map.ts.
-- Seeded comprehensively from CDC's annual Justification of Estimates and
-- USAspending's /federal_accounts/ catalog (HHS toptier code 075). Inter-
-- agency accounts that appear on CDC contracts via co-funding (CMS-Medicaid,
-- HHS Emergency Fund, etc.) are also included so we don't have to special-
-- case them at query time.
--
-- Lookup order:
--   1. Award has at least one award_federal_account row → take the first
--      account, JOIN here for (center_code, center_name).
--   2. No funding rows → award lands in (UNKNOWN, "(no funding data captured)").
--      An admin can re-run the per-view ingest to backfill these.
--   3. Funding row's federal_account_code isn't in this table → falls
--      through to the fallback in the worker's decorate() function, which
--      labels it OTHER with the raw code.

CREATE TABLE IF NOT EXISTS cdc_center (
    federal_account_code TEXT PRIMARY KEY,
    center_code          TEXT NOT NULL,
    center_name          TEXT NOT NULL
);

INSERT OR REPLACE INTO cdc_center (federal_account_code, center_code, center_name) VALUES
    -- ─── CDC national centers ───
    ('075-0947', 'NCEH',     'National Center for Environmental Health'),
    ('075-0948', 'NCCDPHP',  'National Center for Chronic Disease Prevention and Health Promotion'),
    ('075-0949', 'NCEZID',   'National Center for Emerging and Zoonotic Infectious Diseases'),
    ('075-0950', 'NCHHSTP',  'National Center for HIV, Viral Hepatitis, STD, and TB Prevention'),
    ('075-0951', 'NCIRD',    'National Center for Immunization and Respiratory Diseases'),
    ('075-0952', 'NCIPC',    'National Center for Injury Prevention and Control'),
    ('075-0953', 'NCBDDD',   'National Center on Birth Defects and Developmental Disabilities'),
    ('075-0954', 'NIOSH',    'National Institute for Occupational Safety and Health'),
    ('075-0955', 'CGH',      'Center for Global Health'),
    ('075-0956', 'OPHPR',    'Office of Public Health Preparedness and Response'),
    ('075-0958', 'OPHDST',   'Office of Public Health Data, Surveillance, and Technology'),
    ('075-0959', 'PHSS',     'Public Health Scientific Services (NCHS / CSELS)'),
    -- ─── CDC cross-cutting / infrastructure ───
    ('075-0943', 'CDC-WIDE', 'CDC-Wide Activities and Program Support'),
    ('075-0945', 'IDRRRF',   'Infectious Diseases Rapid Response Reserve Fund'),
    ('075-4553', 'WCF',      'CDC Working Capital Fund'),
    -- ─── ATSDR / WTC (operate under CDC umbrella) ───
    ('075-0944', 'ATSDR',    'Toxic Substances and Environmental Public Health (ATSDR)'),
    ('075-0946', 'WTCHP',    'World Trade Center Health Program'),
    -- ─── HHS departmental + emergency funds touched by CDC contracts ───
    ('075-0140', 'PHSSEF',   'Public Health and Social Services Emergency Fund'),
    ('075-0116', 'PPHF',     'Prevention and Public Health Fund (HHS)'),
    ('075-0120', 'GDM',      'General Departmental Management (HHS)'),
    ('075-0125', 'NEF',      'Nonrecurring Expense Fund (HHS)'),
    ('075-0150', 'DPA-MSE',  'Defense Production Act Medical Supplies Enhancement'),
    -- ─── CMS (inter-agency funding) ───
    ('075-0512', 'CMS',      'Grants to States for Medicaid (CMS)'),
    ('075-0511', 'CMS-PFM',  'Program Management (CMS)'),
    ('075-0515', 'CMS-HCFAC','Health Care Fraud and Abuse Control (CMS)'),
    -- ─── HRSA (rare on CDC contracts but possible) ───
    ('075-0350', 'HRSA-HRS', 'Health Resources and Services'),
    ('075-0354', 'HRSA-MCH', 'Maternal and Child Health (HRSA)'),
    ('075-0356', 'RWHAP',    'Ryan White HIV/AIDS Program (HRSA)'),
    ('075-0359', 'HRSA-FP',  'Family Planning (HRSA)'),
    -- ─── NIH (in case of co-funded contracts) ───
    ('075-0885', 'NIAID',    'National Institute of Allergy and Infectious Diseases (NIH)'),
    ('075-0892', 'NIMH',     'National Institute of Mental Health (NIH)'),
    ('075-0846', 'NIH-OD',   'Office of the Director (NIH)'),
    ('075-0849', 'NCI',      'National Cancer Institute (NIH)'),
    ('075-0843', 'NIA',      'National Institute on Aging (NIH)'),
    -- ─── ASPR / FDA ───
    ('075-0133', 'ARPA-H',   'Advanced Research Projects Agency for Health'),
    ('075-0148', 'FDA-IA',   'FDA Innovation Account, CURES Act');
