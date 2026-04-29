-- ─────────────────────────────────────────────────────────────────────────
-- Extends cdc_center with comprehensive HHS coverage + a priority column.
-- ─────────────────────────────────────────────────────────────────────────
--
-- The 0011 seed left ~50% of awards in the OTHER bucket because GROUP_CONCAT
-- of award_federal_account returns codes in non-deterministic order. A CDC-
-- awarded NCHHSTP contract co-funded from FDA could be tagged "FDA". Two
-- structural fixes:
--
--  1. Add `priority` (lower = more specific to the awarding center). When an
--     award has multiple funding accounts, the worker picks the entry with
--     the lowest priority number — so a contract funded from both 075-0950
--     (NCHHSTP, priority 1) and 075-0600 (FDA, priority 8) is tagged NCHHSTP.
--
--  2. Seed every federal account observed in the warehouse (~80 codes total),
--     plus a few neighbours, so the OTHER fallback fires only for genuinely
--     novel accounts that show up in future ingests.
--
-- Priority bands:
--   1 — CDC national center (NCHHSTP, NCEH, NCCDPHP, NCEZID, NCIRD, NCIPC,
--       NCBDDD, NIOSH, CGH, OPHPR, OPHDST, PHSS)
--   2 — CDC umbrella / cross-cutting (CDC-Wide, ATSDR, WTC, IDRRRF, WCF,
--       CDC Buildings, CDC Gifts/CRADA)
--   3 — ASPR (public health emergency response — adjacent to CDC mission)
--   4 — HHS departmental / emergency / HHS-OS funds
--   5 — HRSA (health workforce)
--   6 — SAMHSA, ACF, ACL, AHRQ (other HHS sub-agencies)
--   7 — NIH (research arms; rarely the "owner" of a CDC-issued contract)
--   8 — FDA
--   9 — CMS / IHS (often inter-agency)
--  10 — External (State Department, etc.)

ALTER TABLE cdc_center ADD COLUMN priority INTEGER NOT NULL DEFAULT 100;

-- Update priorities on the original 0011 seed.
UPDATE cdc_center SET priority = 1 WHERE federal_account_code IN
  ('075-0947','075-0948','075-0949','075-0950','075-0951','075-0952',
   '075-0953','075-0954','075-0955','075-0956','075-0958','075-0959');
UPDATE cdc_center SET priority = 2 WHERE federal_account_code IN
  ('075-0943','075-0944','075-0945','075-0946','075-4553');
UPDATE cdc_center SET priority = 4 WHERE federal_account_code IN
  ('075-0140','075-0116','075-0120','075-0125','075-0150','075-0148','075-0133');
UPDATE cdc_center SET priority = 5 WHERE federal_account_code IN
  ('075-0350','075-0354','075-0356','075-0359');
UPDATE cdc_center SET priority = 7 WHERE federal_account_code IN
  ('075-0843','075-0846','075-0849','075-0885','075-0892');
UPDATE cdc_center SET priority = 9 WHERE federal_account_code IN
  ('075-0511','075-0512','075-0515');

-- Extend with everything else observed in the warehouse.
INSERT OR REPLACE INTO cdc_center (federal_account_code, center_code, center_name, priority) VALUES
    -- ─── More CDC-specific accounts (priority 2 — umbrella / infrastructure) ───
    ('075-0960', 'CDC-WIDE', 'CDC Buildings and Facilities',                                  2),
    ('075-5146', 'CDC-WIDE', 'CDC Cooperative Research and Development Agreements',           2),
    ('075-8250', 'CDC-WIDE', 'CDC Gifts and Donations',                                       2),

    -- ─── ASPR (Strategic Preparedness and Response) ───
    ('075-1000', 'ASPR',     'ASPR Research, Development, and Procurement',                   3),
    ('075-1001', 'ASPR',     'ASPR Operations, Preparedness, and Emergency Response',         3),

    -- ─── HHS departmental + emergency expansion ───
    ('075-0118', 'CO-OP',    'Consumer Operated and Oriented Plan Program (HHS)',             4),
    ('075-0127', 'NSAIF',    'No Surprises Act Implementation Fund (HHS)',                    4),
    ('075-0128', 'OIG',      'HHS Office of the Inspector General',                           4),
    ('075-0130', 'ONC',      'Office of the National Coordinator for Health IT (HHS)',        4),
    ('075-0131', 'ONC-RA',   'ONC for Health IT — Recovery Act (HHS)',                        4),
    ('075-0135', 'OCR',      'Office for Civil Rights (HHS)',                                 4),
    ('075-0142', 'ACL',      'Aging and Disability Services (Administration for Community Living)', 4),
    ('075-0145', 'PCORTF',   'PCORI Trust Fund Transfers (HHS)',                              4),
    ('075-4552', 'HHS-PSC',  'HHS Service and Supply Fund (Program Support Center)',          4),

    -- ─── HRSA expansion ───
    ('075-0353', 'HRSA-HW',  'HRSA Health Workforce',                                         5),
    ('075-0357', 'HRSA-HCS', 'HRSA Health Care Systems',                                      5),
    ('075-0358', 'HRSA-RH',  'HRSA Rural Health',                                             5),
    ('075-0360', 'HRSA-PHC', 'HRSA Primary Health Care',                                      5),
    ('075-0361', 'HRSA-PM',  'HRSA Program Management',                                       5),
    ('075-0365', 'HRSA-HCM', 'HRSA Health Centers Malpractice Claims',                        5),
    ('075-0321', 'HRSA-MIE', 'HRSA Maternal, Infant, and Early Childhood Home Visiting',      5),
    ('075-0330', 'HRSA-FCM', 'HRSA Free Clinics Malpractice Claims',                          5),

    -- ─── SAMHSA ───
    ('075-1362', 'SAMHSA',   'SAMHSA Health Surveillance and Program Support',                6),
    ('075-1363', 'SAMHSA',   'SAMHSA Mental Health',                                          6),
    ('075-1364', 'SAMHSA',   'SAMHSA Substance Abuse Treatment',                              6),
    ('075-1365', 'SAMHSA',   'SAMHSA Substance Abuse Prevention',                             6),

    -- ─── ACF (Administration for Children and Families) ───
    ('075-1503', 'ACF',      'ACF Refugee and Entrant Assistance',                            6),
    ('075-1515', 'ACF',      'ACF Child Care and Development Block Grant',                    6),
    ('075-1534', 'ACF',      'ACF Payments to States, Foster Care and Adoption',              6),
    ('075-1536', 'ACF',      'ACF Children and Families Services Programs',                   6),
    ('075-1545', 'ACF',      'ACF Promoting Safe and Stable Families',                        6),
    ('075-1550', 'ACF',      'ACF Child Care Entitlement to States',                          6),
    ('075-1552', 'ACF',      'ACF Temporary Assistance for Needy Families',                   6),
    ('075-1553', 'ACF',      'ACF Social Services Block Grant',                               6),

    -- ─── AHRQ ───
    ('075-1700', 'AHRQ',     'Agency for Healthcare Research and Quality',                    6),

    -- ─── NIH institutes (research; lower priority than CDC) ───
    ('075-0807', 'NIH-NLM',  'NIH National Library of Medicine',                              7),
    ('075-0819', 'NIH-FIC',  'NIH John E. Fogarty International Center',                      7),
    ('075-0837', 'NIH-ARPAH','ARPA-H (NIH)',                                                  7),
    ('075-0838', 'NIH-BF',   'NIH Buildings and Facilities',                                  7),
    ('075-0844', 'NICHD',    'NIH National Institute of Child Health and Human Development',  7),
    ('075-0851', 'NIGMS',    'NIH National Institute of General Medical Sciences',            7),
    ('075-0862', 'NIEHS',    'NIH National Institute of Environmental Health Sciences',       7),
    ('075-0872', 'NHLBI',    'NIH National Heart, Lung, and Blood Institute',                 7),
    ('075-0873', 'NIDCR',    'NIH National Institute of Dental and Craniofacial Research',    7),
    ('075-0875', 'NCATS',    'NIH National Center for Advancing Translational Sciences',      7),
    ('075-0884', 'NIDDK',    'NIH National Institute of Diabetes and Digestive and Kidney Diseases', 7),
    ('075-0886', 'NINDS',    'NIH National Institute of Neurological Disorders and Stroke',   7),
    ('075-0887', 'NEI',      'NIH National Eye Institute',                                    7),
    ('075-0888', 'NIAMS',    'NIH National Institute of Arthritis and Musculoskeletal',       7),
    ('075-0889', 'NINR',     'NIH National Institute of Nursing Research',                    7),
    ('075-0890', 'NIDCD',    'NIH National Institute on Deafness and Other Communication Disorders', 7),
    ('075-0891', 'NHGRI',    'NIH National Human Genome Research Institute',                  7),
    ('075-0893', 'NIDA',     'NIH National Institute on Drug Abuse',                          7),
    ('075-0894', 'NIAAA',    'NIH National Institute on Alcohol Abuse and Alcoholism',        7),
    ('075-0896', 'NCCIH',    'NIH National Center for Complementary and Integrative Health',  7),
    ('075-0897', 'NIMHD',    'NIH National Institute on Minority Health and Health Disparities', 7),
    ('075-0898', 'NIBIB',    'NIH National Institute of Biomedical Imaging and Bioengineering', 7),
    ('075-3966', 'NIH-MGT',  'NIH Management Fund',                                           7),
    ('075-4554', 'NIH-SSF',  'NIH Service and Supply Fund',                                   7),
    ('075-5145', 'NIH-CRADA','NIH Cooperative Research and Development Agreements',           7),
    ('075-8253', 'NIH-GIFT', 'NIH Conditional Gift Fund',                                     7),

    -- ─── FDA ───
    ('075-0600', 'FDA',      'FDA Salaries and Expenses',                                     8),
    ('075-4613', 'FDA-WCF',  'FDA Working Capital Fund',                                      8),
    ('075-5629', 'FDA-CURES','FDA Innovation, CURES Act',                                     8),

    -- ─── CMS / Medicare / Medicaid expansion ───
    ('075-0509', 'CMS',      'CMS Program Management — older line',                           9),
    ('075-0510', 'CMS',      'CMS Program Management (Recovery Act)',                         9),
    ('075-0516', 'CMS',      'CMS State Grants and Demonstration',                            9),
    ('075-0519', 'CMS-QIO',  'CMS Quality Improvement Organizations',                         9),
    ('075-0522', 'CMMI',     'CMS Center for Medicare and Medicaid Innovation',               9),
    ('075-0603', 'CMS',      'CMS Recovery Audit Program',                                    9),
    ('075-8004', 'MEDICARE', 'Medicare Supplementary Medical Insurance Trust Fund',           9),
    ('075-8005', 'MEDICARE', 'Medicare Hospital Insurance Trust Fund',                        9),
    ('075-8393', 'HCFAC',    'Health Care Fraud and Abuse Control (HHS/CMS/DOJ)',             9),

    -- ─── IHS ───
    ('075-0390', 'IHS',      'Indian Health Services',                                        9),
    ('075-0391', 'IHS-FAC',  'Indian Health Facilities',                                      9),

    -- ─── External / non-HHS that show up via inter-agency work ───
    ('019-1030', 'STATE',    'State Department — Educational and Cultural Exchange',         10),
    ('019-1031', 'STATE',    'State Department — Global Health Programs',                    10),
    ('070-0714', 'DHS',      'DHS — Federal Emergency Management',                            10),
    ('075-1512', 'OTHER',    'HHS Refugee Trust',                                             10);
