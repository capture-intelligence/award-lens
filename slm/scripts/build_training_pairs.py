"""
Builds a (question, SQL) dataset for fine-tuning a text-to-SQL model
against the federal awards warehouse. Every pair is executed against the
local SQLite copy; only ones that parse and run cleanly are emitted.

Output: data/training_pairs.jsonl
"""
import json
import sqlite3
import sys
from pathlib import Path

DB = Path(__file__).parent / "awards-warehouse.db"
OUT = Path(__file__).parent / "training_pairs.jsonl"
SCHEMA_OUT = Path(__file__).parent / "schema_prompt.txt"

# (category, difficulty, question, sql)
PAIRS = [
    # ───────────────────────── 1. Simple lookups ─────────────────────────
    ("simple", "easy", "How many awards are in the warehouse?",
     "SELECT COUNT(*) AS n FROM award;"),
    ("simple", "easy", "How many vendors do we have?",
     "SELECT COUNT(*) AS n FROM vendor;"),
    ("simple", "easy", "How many grant opportunities are tracked?",
     "SELECT COUNT(*) AS n FROM grant_opportunity;"),
    ("simple", "easy", "How many SAM exclusions are currently active?",
     "SELECT COUNT(*) AS n FROM sam_exclusion WHERE is_active = 1;"),
    ("simple", "easy", "List the distinct award types we ingest.",
     "SELECT DISTINCT award_type FROM award ORDER BY award_type;"),
    ("simple", "easy", "Show all CDC centers, ranked by priority.",
     "SELECT center_code, center_name, federal_account_code, priority FROM cdc_center ORDER BY priority, center_code;"),
    ("simple", "easy", "List the data sources we ingest from.",
     "SELECT source_id, display_name, base_url FROM source_system WHERE is_active = 1;"),
    ("simple", "easy", "How many ingestion runs have we recorded?",
     "SELECT COUNT(*) AS n FROM ingestion_run;"),
    ("simple", "easy", "Show the 5 most recently updated awards.",
     "SELECT award_id, award_piid, current_value, updated_at FROM award ORDER BY updated_at DESC LIMIT 5;"),
    ("simple", "easy", "Show 10 awards with their PIID and current value.",
     "SELECT award_piid, current_value FROM award LIMIT 10;"),
    ("simple", "easy", "What's the date range of our award period-of-performance start dates?",
     "SELECT MIN(pop_start_date) AS earliest, MAX(pop_start_date) AS latest FROM award;"),
    ("simple", "easy", "Show 5 NAICS codes with their descriptions.",
     "SELECT naics_code, description FROM naics_code LIMIT 5;"),
    ("simple", "easy", "List PSC categories we have.",
     "SELECT DISTINCT category FROM psc_code WHERE category IS NOT NULL ORDER BY category;"),
    ("simple", "easy", "How many vendors have been enriched with SAM data?",
     "SELECT COUNT(*) AS n FROM vendor WHERE sam_enriched_at IS NOT NULL;"),
    ("simple", "easy", "Show the most recent ingestion run.",
     "SELECT run_id, source_id, status, started_at, finished_at, rows_upserted FROM ingestion_run ORDER BY started_at DESC LIMIT 1;"),

    # ───────────────────────── 2. Aggregations ─────────────────────────
    ("aggregation", "easy", "What's the total obligated amount across all awards?",
     "SELECT SUM(obligated_amount) AS total_obligated FROM award;"),
    ("aggregation", "easy", "What's the average current value of an award?",
     "SELECT AVG(current_value) AS avg_value FROM award;"),
    ("aggregation", "easy", "How many awards per award type?",
     "SELECT award_type, COUNT(*) AS n FROM award GROUP BY award_type ORDER BY n DESC;"),
    ("aggregation", "medium", "What's the total current value awarded by each agency?",
     "SELECT o.canonical_name AS agency, SUM(a.current_value) AS total "
     "FROM award a JOIN organization o ON o.org_id = a.awarding_org_id "
     "GROUP BY o.org_id ORDER BY total DESC;"),
    ("aggregation", "medium", "How many awards each NAICS code has, top 10.",
     "SELECT a.naics_code, n.description, COUNT(*) AS n "
     "FROM award a LEFT JOIN naics_code n ON n.naics_code = a.naics_code "
     "GROUP BY a.naics_code ORDER BY n DESC LIMIT 10;"),
    ("aggregation", "medium", "Average award value per agency, agencies with at least 50 awards.",
     "SELECT o.canonical_name AS agency, COUNT(*) AS award_count, AVG(a.current_value) AS avg_value "
     "FROM award a JOIN organization o ON o.org_id = a.awarding_org_id "
     "GROUP BY o.org_id HAVING COUNT(*) >= 50 ORDER BY avg_value DESC;"),
    ("aggregation", "medium", "Total obligated dollars per fiscal year (using pop_start_date year).",
     "SELECT SUBSTR(pop_start_date, 1, 4) AS year, SUM(obligated_amount) AS obligated "
     "FROM award WHERE pop_start_date IS NOT NULL GROUP BY year ORDER BY year;"),
    ("aggregation", "easy", "How many active vs inactive SAM exclusions?",
     "SELECT is_active, COUNT(*) AS n FROM sam_exclusion GROUP BY is_active;"),
    ("aggregation", "medium", "Grant opportunity count by funding instrument.",
     "SELECT funding_instrument, COUNT(*) AS n FROM grant_opportunity GROUP BY funding_instrument ORDER BY n DESC;"),
    ("aggregation", "medium", "Per-state count of award performance locations, top 10.",
     "SELECT state, COUNT(*) AS n FROM award_performance_location WHERE state IS NOT NULL GROUP BY state ORDER BY n DESC LIMIT 10;"),
    ("aggregation", "medium", "Total federal-account spend per program activity, top 10.",
     "SELECT program_activity_name, COUNT(*) AS link_count "
     "FROM award_federal_account WHERE program_activity_name IS NOT NULL "
     "GROUP BY program_activity_name ORDER BY link_count DESC LIMIT 10;"),
    ("aggregation", "easy", "What's the largest single-award current value, and which agency awarded it?",
     "SELECT a.current_value, o.canonical_name AS agency "
     "FROM award a JOIN organization o ON o.org_id = a.awarding_org_id "
     "ORDER BY a.current_value DESC LIMIT 1;"),

    # ───────────────────────── 3. Joins ─────────────────────────
    ("join", "easy", "Show 5 awards with the vendor's legal name and the awarding agency.",
     "SELECT a.award_piid, v.legal_name AS vendor, o.canonical_name AS agency, a.current_value "
     "FROM award a "
     "LEFT JOIN vendor v ON v.vendor_id = a.vendor_id "
     "LEFT JOIN organization o ON o.org_id = a.awarding_org_id "
     "LIMIT 5;"),
    ("join", "medium", "Top 10 vendors by total current_value won.",
     "SELECT v.legal_name, COUNT(*) AS award_count, SUM(a.current_value) AS total_value "
     "FROM award a JOIN vendor v ON v.vendor_id = a.vendor_id "
     "GROUP BY v.vendor_id ORDER BY total_value DESC LIMIT 10;"),
    ("join", "medium", "Top 10 vendors by award count.",
     "SELECT v.legal_name, COUNT(*) AS n FROM award a JOIN vendor v ON v.vendor_id = a.vendor_id "
     "GROUP BY v.vendor_id ORDER BY n DESC LIMIT 10;"),
    ("join", "medium", "Awards routed through each contracting office, top 10.",
     "SELECT co.name AS office, COUNT(*) AS n "
     "FROM award a JOIN contracting_office co ON co.office_id = a.awarding_office_id "
     "GROUP BY co.office_id ORDER BY n DESC LIMIT 10;"),
    ("join", "medium", "List the NAICS codes used by CDC awards along with their descriptions.",
     "SELECT a.naics_code, n.description, COUNT(*) AS n "
     "FROM award a JOIN organization o ON o.org_id = a.awarding_org_id "
     "LEFT JOIN naics_code n ON n.naics_code = a.naics_code "
     "WHERE o.canonical_name = 'Centers for Disease Control and Prevention' "
     "GROUP BY a.naics_code ORDER BY n DESC LIMIT 10;"),
    ("join", "medium", "Awards along with the federal account they were funded from.",
     "SELECT a.award_piid, afa.federal_account_code, afa.federal_account_name, a.current_value "
     "FROM award a JOIN award_federal_account afa ON afa.award_id = a.award_id "
     "ORDER BY a.current_value DESC LIMIT 10;"),
    ("join", "medium", "Per-PSC-category total obligated dollars.",
     "SELECT p.category, SUM(a.obligated_amount) AS obligated "
     "FROM award a JOIN psc_code p ON p.psc_code = a.psc_code "
     "GROUP BY p.category ORDER BY obligated DESC;"),
    ("join", "medium", "Awards where the awarding and funding offices differ.",
     "SELECT a.award_piid, ao.name AS awarding_office, fo.name AS funding_office "
     "FROM award a "
     "JOIN contracting_office ao ON ao.office_id = a.awarding_office_id "
     "JOIN contracting_office fo ON fo.office_id = a.funding_office_id "
     "WHERE a.awarding_office_id <> a.funding_office_id LIMIT 10;"),
    ("join", "hard", "For each agency, the largest single award and the vendor that won it.",
     "SELECT o.canonical_name AS agency, v.legal_name AS vendor, a.current_value "
     "FROM award a "
     "JOIN organization o ON o.org_id = a.awarding_org_id "
     "JOIN vendor v ON v.vendor_id = a.vendor_id "
     "WHERE a.current_value = (SELECT MAX(current_value) FROM award a2 WHERE a2.awarding_org_id = a.awarding_org_id) "
     "ORDER BY a.current_value DESC;"),

    # ───────────────────────── 4. Top-N rankings ─────────────────────────
    ("ranking", "easy", "Top 5 awards by current value.",
     "SELECT award_id, award_piid, current_value FROM award ORDER BY current_value DESC LIMIT 5;"),
    ("ranking", "medium", "Top 5 vendors by total awards won at NIH.",
     "SELECT v.legal_name, COUNT(*) AS n, SUM(a.current_value) AS total "
     "FROM award a JOIN vendor v ON v.vendor_id = a.vendor_id "
     "JOIN organization o ON o.org_id = a.awarding_org_id "
     "WHERE o.canonical_name = 'National Institutes of Health' "
     "GROUP BY v.vendor_id ORDER BY total DESC LIMIT 5;"),
    ("ranking", "medium", "Top 5 NAICS codes by total obligated amount across the warehouse.",
     "SELECT a.naics_code, n.description, SUM(a.obligated_amount) AS obligated "
     "FROM award a LEFT JOIN naics_code n ON n.naics_code = a.naics_code "
     "GROUP BY a.naics_code ORDER BY obligated DESC LIMIT 5;"),
    ("ranking", "medium", "Top 10 contracting offices by total dollars awarded.",
     "SELECT co.name, SUM(a.current_value) AS total "
     "FROM award a JOIN contracting_office co ON co.office_id = a.awarding_office_id "
     "GROUP BY co.office_id ORDER BY total DESC LIMIT 10;"),
    ("ranking", "medium", "Bottom 5 awards by current_value (smallest non-zero).",
     "SELECT award_piid, current_value FROM award WHERE current_value > 0 ORDER BY current_value ASC LIMIT 5;"),
    ("ranking", "hard", "Per agency, top vendor by total dollars (using a window function).",
     "WITH ranked AS ("
     "  SELECT o.canonical_name AS agency, v.legal_name AS vendor, "
     "         SUM(a.current_value) AS total, "
     "         ROW_NUMBER() OVER (PARTITION BY o.org_id ORDER BY SUM(a.current_value) DESC) AS rk "
     "  FROM award a JOIN organization o ON o.org_id = a.awarding_org_id "
     "  JOIN vendor v ON v.vendor_id = a.vendor_id "
     "  GROUP BY o.org_id, v.vendor_id"
     ") SELECT agency, vendor, total FROM ranked WHERE rk = 1 ORDER BY total DESC;"),

    # ───────────────────────── 5. Time-window queries ─────────────────────────
    ("time", "medium", "How many awards have a period-of-performance starting in 2023?",
     "SELECT COUNT(*) AS n FROM award WHERE pop_start_date LIKE '2023-%';"),
    ("time", "medium", "Awards with period-of-performance ending in the next 90 days.",
     "SELECT award_piid, pop_end_date, current_value FROM award "
     "WHERE pop_end_date >= DATE('now') AND pop_end_date < DATE('now', '+90 days') "
     "ORDER BY pop_end_date;"),
    ("time", "medium", "Number of awards started per calendar year.",
     "SELECT SUBSTR(pop_start_date, 1, 4) AS year, COUNT(*) AS n "
     "FROM award WHERE pop_start_date IS NOT NULL "
     "GROUP BY year ORDER BY year;"),
    ("time", "medium", "Grant opportunities posted in the last 30 days.",
     "SELECT opportunity_id, title, posted_date FROM grant_opportunity "
     "WHERE posted_date >= DATE('now', '-30 days') ORDER BY posted_date DESC;"),
    ("time", "medium", "Grant opportunities closing in the next 30 days.",
     "SELECT opportunity_id, title, close_date FROM grant_opportunity "
     "WHERE close_date >= DATE('now') AND close_date < DATE('now', '+30 days') "
     "ORDER BY close_date;"),
    ("time", "medium", "How many awards were ingested in each ingestion run, ordered chronologically.",
     "SELECT run_id, source_id, started_at, rows_upserted FROM ingestion_run ORDER BY started_at DESC LIMIT 20;"),
    ("time", "hard", "Month-over-month award starts in the last 5 years.",
     "SELECT SUBSTR(pop_start_date, 1, 7) AS ym, COUNT(*) AS n, SUM(obligated_amount) AS obligated "
     "FROM award WHERE pop_start_date >= DATE('now', '-5 years') "
     "GROUP BY ym ORDER BY ym;"),
    ("time", "medium", "Awards with a period-of-performance longer than 5 years.",
     "SELECT award_piid, pop_start_date, pop_end_date, "
     "       CAST(julianday(pop_end_date) - julianday(pop_start_date) AS INTEGER) AS days "
     "FROM award WHERE pop_start_date IS NOT NULL AND pop_end_date IS NOT NULL "
     "  AND julianday(pop_end_date) - julianday(pop_start_date) > 365 * 5 "
     "ORDER BY days DESC LIMIT 10;"),
    ("time", "easy", "Earliest and latest grant opportunity posting dates.",
     "SELECT MIN(posted_date) AS earliest, MAX(posted_date) AS latest FROM grant_opportunity;"),

    # ───────────────────────── 6. Geographic ─────────────────────────
    ("geo", "easy", "Top 10 states by number of award performance locations.",
     "SELECT state, COUNT(*) AS n FROM award_performance_location WHERE state IS NOT NULL GROUP BY state ORDER BY n DESC LIMIT 10;"),
    ("geo", "medium", "Total obligated dollars by state of performance.",
     "SELECT apl.state, SUM(a.obligated_amount) AS obligated "
     "FROM award a JOIN award_performance_location apl ON apl.award_id = a.award_id "
     "WHERE apl.state IS NOT NULL GROUP BY apl.state ORDER BY obligated DESC LIMIT 10;"),
    ("geo", "medium", "Awards performed outside the United States.",
     "SELECT a.award_piid, apl.country_code, apl.city FROM award a "
     "JOIN award_performance_location apl ON apl.award_id = a.award_id "
     "WHERE apl.country_code IS NOT NULL AND apl.country_code <> 'USA' LIMIT 20;"),
    ("geo", "medium", "How many distinct cities have hosted at least one award?",
     "SELECT COUNT(DISTINCT city) AS n FROM award_performance_location WHERE city IS NOT NULL;"),
    ("geo", "medium", "Top 5 cities by award count.",
     "SELECT city, state, COUNT(*) AS n FROM award_performance_location "
     "WHERE city IS NOT NULL GROUP BY city, state ORDER BY n DESC LIMIT 5;"),
    ("geo", "medium", "Total dollars by congressional district, top 10.",
     "SELECT apl.congressional_district, SUM(a.current_value) AS total "
     "FROM award a JOIN award_performance_location apl ON apl.award_id = a.award_id "
     "WHERE apl.congressional_district IS NOT NULL "
     "GROUP BY apl.congressional_district ORDER BY total DESC LIMIT 10;"),

    # ───────────────────────── 7. NAICS / PSC analysis ─────────────────────────
    ("naics_psc", "easy", "What does NAICS code 541512 mean?",
     "SELECT naics_code, description FROM naics_code WHERE naics_code = '541512';"),
    ("naics_psc", "medium", "Total spend on NAICS 541512 awards.",
     "SELECT SUM(current_value) AS total FROM award WHERE naics_code = '541512';"),
    ("naics_psc", "medium", "Top 10 PSC codes by award count, with their descriptions.",
     "SELECT a.psc_code, p.description, COUNT(*) AS n "
     "FROM award a LEFT JOIN psc_code p ON p.psc_code = a.psc_code "
     "GROUP BY a.psc_code ORDER BY n DESC LIMIT 10;"),
    ("naics_psc", "medium", "Awards in NAICS family 5415 (computer systems design and related).",
     "SELECT COUNT(*) AS n, SUM(current_value) AS total FROM award WHERE naics_code LIKE '5415%';"),
    ("naics_psc", "hard", "Vendors who hold awards across more than 3 distinct NAICS codes.",
     "SELECT v.legal_name, COUNT(DISTINCT a.naics_code) AS naics_breadth "
     "FROM award a JOIN vendor v ON v.vendor_id = a.vendor_id "
     "WHERE a.naics_code IS NOT NULL "
     "GROUP BY v.vendor_id HAVING COUNT(DISTINCT a.naics_code) > 3 "
     "ORDER BY naics_breadth DESC LIMIT 10;"),
    ("naics_psc", "medium", "Cross-tab of award type by PSC category.",
     "SELECT a.award_type, p.category, COUNT(*) AS n "
     "FROM award a JOIN psc_code p ON p.psc_code = a.psc_code "
     "GROUP BY a.award_type, p.category ORDER BY a.award_type, n DESC;"),

    # ───────────────────────── 8. CDC center routing ─────────────────────────
    ("cdc", "medium", "How many awards are funded out of CDC NCHHSTP federal accounts?",
     "SELECT COUNT(DISTINCT a.award_id) AS n "
     "FROM award a JOIN award_federal_account afa ON afa.award_id = a.award_id "
     "JOIN cdc_center c ON c.federal_account_code = afa.federal_account_code "
     "WHERE c.center_code = 'NCHHSTP';"),
    ("cdc", "medium", "Total obligated dollars per CDC center.",
     "SELECT c.center_code, c.center_name, SUM(a.obligated_amount) AS obligated "
     "FROM award a JOIN award_federal_account afa ON afa.award_id = a.award_id "
     "JOIN cdc_center c ON c.federal_account_code = afa.federal_account_code "
     "GROUP BY c.center_code ORDER BY obligated DESC;"),
    ("cdc", "medium", "Awards with a manual CDC-center override.",
     "SELECT cco.award_piid, cco.center_code, cco.center_name, cco.reason "
     "FROM cdc_center_override cco;"),
    ("cdc", "hard", "Top 5 vendors at CDC's NCEZID, by total dollars.",
     "SELECT v.legal_name, SUM(a.current_value) AS total "
     "FROM award a "
     "JOIN award_federal_account afa ON afa.award_id = a.award_id "
     "JOIN cdc_center c ON c.federal_account_code = afa.federal_account_code "
     "JOIN vendor v ON v.vendor_id = a.vendor_id "
     "WHERE c.center_code = 'NCEZID' "
     "GROUP BY v.vendor_id ORDER BY total DESC LIMIT 5;"),

    # ───────────────────────── 9. Compliance / SAM exclusions ─────────────────────────
    ("compliance", "easy", "How many SAM exclusions list a US state?",
     "SELECT COUNT(*) AS n FROM sam_exclusion WHERE state IS NOT NULL;"),
    ("compliance", "medium", "Distinct exclusion types and how many of each.",
     "SELECT exclusion_type, COUNT(*) AS n FROM sam_exclusion GROUP BY exclusion_type ORDER BY n DESC;"),
    ("compliance", "medium", "Agencies that have issued the most SAM exclusions, top 10.",
     "SELECT excluding_agency, COUNT(*) AS n FROM sam_exclusion "
     "WHERE excluding_agency IS NOT NULL GROUP BY excluding_agency ORDER BY n DESC LIMIT 10;"),
    ("compliance", "hard", "Vendors in our warehouse who appear on the SAM exclusion list (matched on UEI).",
     "SELECT v.legal_name, v.uei, e.exclusion_type, e.excluding_agency "
     "FROM vendor v JOIN sam_exclusion e ON e.uei = v.uei AND e.is_active = 1;"),
    ("compliance", "hard", "Active awards whose vendor is on the SAM exclusion list.",
     "SELECT a.award_piid, v.legal_name, e.excluding_agency, a.current_value "
     "FROM award a JOIN vendor v ON v.vendor_id = a.vendor_id "
     "JOIN sam_exclusion e ON e.uei = v.uei AND e.is_active = 1 "
     "WHERE a.pop_end_date >= DATE('now');"),
    ("compliance", "medium", "Exclusions added in the last 90 days.",
     "SELECT exclusion_id, legal_name, exclusion_type, active_date FROM sam_exclusion "
     "WHERE active_date >= DATE('now', '-90 days') ORDER BY active_date DESC;"),
    ("compliance", "medium", "Are there any exclusions that have already terminated?",
     "SELECT COUNT(*) AS n FROM sam_exclusion WHERE termination_date IS NOT NULL AND termination_date < DATE('now');"),

    # ───────────────────────── 10. Grant opportunities ─────────────────────────
    ("grants", "easy", "How many grant opportunities are currently posted (not forecasted)?",
     "SELECT COUNT(*) AS n FROM grant_opportunity WHERE status = 'posted';"),
    ("grants", "easy", "List the largest 5 grant opportunities by estimated total funding.",
     "SELECT opportunity_number, title, est_total_funding, agency_code FROM grant_opportunity "
     "WHERE est_total_funding IS NOT NULL ORDER BY est_total_funding DESC LIMIT 5;"),
    ("grants", "medium", "Grant opportunities closing this week.",
     "SELECT opportunity_id, title, close_date FROM grant_opportunity "
     "WHERE close_date BETWEEN DATE('now') AND DATE('now', '+7 days') ORDER BY close_date;"),
    ("grants", "medium", "Grant opportunities by category.",
     "SELECT category, COUNT(*) AS n FROM grant_opportunity GROUP BY category ORDER BY n DESC;"),
    ("grants", "medium", "Grant opportunities funded by HHS (agency_code starts with 'HHS').",
     "SELECT opportunity_number, title, posted_date, est_total_funding FROM grant_opportunity "
     "WHERE agency_code LIKE 'HHS%' ORDER BY posted_date DESC LIMIT 10;"),
    ("grants", "medium", "Grant opportunities with award_ceiling above $1M.",
     "SELECT opportunity_number, title, award_ceiling FROM grant_opportunity "
     "WHERE award_ceiling > 1000000 ORDER BY award_ceiling DESC LIMIT 20;"),
    ("grants", "medium", "Average estimated total funding by funding instrument.",
     "SELECT funding_instrument, AVG(est_total_funding) AS avg_funding, COUNT(*) AS n "
     "FROM grant_opportunity WHERE est_total_funding IS NOT NULL "
     "GROUP BY funding_instrument ORDER BY avg_funding DESC;"),

    # ───────────────────────── 11. Mod history / amendments ─────────────────────────
    ("mods", "easy", "How many award modifications are recorded?",
     "SELECT COUNT(*) AS n FROM award_modification;"),
    ("mods", "medium", "Distinct modification action types.",
     "SELECT action_type, COUNT(*) AS n FROM award_modification GROUP BY action_type ORDER BY n DESC;"),
    ("mods", "medium", "Top 10 awards by number of modifications.",
     "SELECT award_id, COUNT(*) AS mod_count FROM award_modification "
     "GROUP BY award_id ORDER BY mod_count DESC LIMIT 10;"),
    ("mods", "hard", "Net obligation delta per award (sum of obligation deltas), top 10 absolute.",
     "SELECT award_id, SUM(obligation_delta) AS net_delta FROM award_modification "
     "GROUP BY award_id ORDER BY ABS(SUM(obligation_delta)) DESC LIMIT 10;"),

    # ───────────────────────── 12. Reconciliation / runs ─────────────────────────
    ("ops", "easy", "How many ingestion runs failed?",
     "SELECT COUNT(*) AS n FROM ingestion_run WHERE status = 'failed';"),
    ("ops", "medium", "Last successful ingestion run for each source.",
     "SELECT source_id, MAX(started_at) AS last_success FROM ingestion_run "
     "WHERE status = 'success' GROUP BY source_id;"),
    ("ops", "medium", "Reconciliation checks where drift exceeded 5%.",
     "SELECT check_date, dimension_type, dimension_value, drift_pct, status FROM reconciliation_check "
     "WHERE ABS(drift_pct) > 5 ORDER BY ABS(drift_pct) DESC LIMIT 20;"),
    ("ops", "medium", "Total rows upserted per source over the last 30 days.",
     "SELECT source_id, SUM(rows_upserted) AS upserted FROM ingestion_run "
     "WHERE started_at >= DATETIME('now', '-30 days') GROUP BY source_id;"),
    ("ops", "medium", "Average reconciliation drift by dimension type.",
     "SELECT dimension_type, AVG(drift_pct) AS avg_drift, COUNT(*) AS checks "
     "FROM reconciliation_check GROUP BY dimension_type;"),

    # ───────────────────────── 13. Subqueries / EXISTS / IN ─────────────────────────
    ("subquery", "medium", "Vendors with at least one award worth more than $100M.",
     "SELECT v.legal_name FROM vendor v WHERE v.vendor_id IN "
     "(SELECT a.vendor_id FROM award a WHERE a.current_value > 100000000) ORDER BY v.legal_name;"),
    ("subquery", "medium", "Vendors that have NEVER received an award above $1M.",
     "SELECT v.legal_name FROM vendor v WHERE NOT EXISTS "
     "(SELECT 1 FROM award a WHERE a.vendor_id = v.vendor_id AND a.current_value > 1000000) "
     "AND EXISTS (SELECT 1 FROM award a2 WHERE a2.vendor_id = v.vendor_id) "
     "ORDER BY v.legal_name LIMIT 20;"),
    ("subquery", "medium", "Awards where the obligated amount equals the current value.",
     "SELECT award_piid, current_value FROM award "
     "WHERE obligated_amount = current_value AND current_value IS NOT NULL LIMIT 20;"),
    ("subquery", "medium", "Awards larger than the average award value.",
     "SELECT award_piid, current_value FROM award "
     "WHERE current_value > (SELECT AVG(current_value) FROM award) "
     "ORDER BY current_value DESC LIMIT 20;"),
    ("subquery", "hard", "Per agency, the approximate median award value (using NTILE).",
     "WITH ranked AS ("
     "  SELECT a.awarding_org_id, a.current_value, "
     "         NTILE(2) OVER (PARTITION BY a.awarding_org_id ORDER BY a.current_value) AS half "
     "  FROM award a WHERE a.current_value IS NOT NULL"
     ") SELECT o.canonical_name, MIN(r.current_value) AS approx_median "
     "  FROM ranked r JOIN organization o ON o.org_id = r.awarding_org_id "
     "  WHERE r.half = 2 GROUP BY o.org_id ORDER BY approx_median DESC LIMIT 5;"),

    # ───────────────────────── 14. CTEs and window functions ─────────────────────────
    ("window", "hard", "For each award type, the share each PSC category contributes (% by current_value).",
     "WITH t AS ("
     "  SELECT a.award_type, p.category, SUM(a.current_value) AS v "
     "  FROM award a JOIN psc_code p ON p.psc_code = a.psc_code "
     "  GROUP BY a.award_type, p.category"
     ") SELECT award_type, category, v, "
     "         ROUND(100.0 * v / SUM(v) OVER (PARTITION BY award_type), 2) AS pct "
     "  FROM t ORDER BY award_type, pct DESC;"),
    ("window", "hard", "Running cumulative obligated dollars per agency over time.",
     "SELECT o.canonical_name, a.pop_start_date, "
     "       SUM(a.obligated_amount) OVER (PARTITION BY o.org_id ORDER BY a.pop_start_date) AS running_total "
     "FROM award a JOIN organization o ON o.org_id = a.awarding_org_id "
     "WHERE a.pop_start_date IS NOT NULL ORDER BY o.canonical_name, a.pop_start_date LIMIT 30;"),
    ("window", "hard", "For each agency, list its top 3 vendors by total dollars.",
     "WITH ranked AS ("
     "  SELECT o.canonical_name AS agency, v.legal_name AS vendor, "
     "         SUM(a.current_value) AS total, "
     "         ROW_NUMBER() OVER (PARTITION BY o.org_id ORDER BY SUM(a.current_value) DESC) AS rk "
     "  FROM award a JOIN organization o ON o.org_id = a.awarding_org_id "
     "  JOIN vendor v ON v.vendor_id = a.vendor_id "
     "  GROUP BY o.org_id, v.vendor_id"
     ") SELECT agency, vendor, total FROM ranked WHERE rk <= 3 ORDER BY agency, rk;"),
    ("window", "hard", "Year-over-year change in award count per agency.",
     "WITH yearly AS ("
     "  SELECT o.canonical_name AS agency, SUBSTR(a.pop_start_date,1,4) AS yr, COUNT(*) AS n "
     "  FROM award a JOIN organization o ON o.org_id = a.awarding_org_id "
     "  WHERE a.pop_start_date IS NOT NULL "
     "  GROUP BY o.org_id, yr"
     ") SELECT agency, yr, n, "
     "         n - LAG(n) OVER (PARTITION BY agency ORDER BY yr) AS yoy_delta "
     "  FROM yearly ORDER BY agency, yr;"),
    ("window", "hard", "Rank vendors by award count within each agency, show top 2.",
     "WITH r AS ("
     "  SELECT o.canonical_name AS agency, v.legal_name AS vendor, COUNT(*) AS n, "
     "         RANK() OVER (PARTITION BY o.org_id ORDER BY COUNT(*) DESC) AS rk "
     "  FROM award a JOIN organization o ON o.org_id = a.awarding_org_id "
     "  JOIN vendor v ON v.vendor_id = a.vendor_id "
     "  GROUP BY o.org_id, v.vendor_id"
     ") SELECT * FROM r WHERE rk <= 2 ORDER BY agency, rk;"),

    # ───────────────────────── 15. Edge cases ─────────────────────────
    ("edge", "easy", "How many awards have no vendor linked?",
     "SELECT COUNT(*) AS n FROM award WHERE vendor_id IS NULL;"),
    ("edge", "easy", "How many awards have NULL current_value?",
     "SELECT COUNT(*) AS n FROM award WHERE current_value IS NULL;"),
    ("edge", "medium", "Awards where description is missing or empty.",
     "SELECT COUNT(*) AS n FROM award WHERE description IS NULL OR TRIM(description) = '';"),
    ("edge", "medium", "Use COALESCE to show award value, falling back to obligated_amount when current_value is null.",
     "SELECT award_piid, COALESCE(current_value, obligated_amount, 0) AS effective_value "
     "FROM award ORDER BY effective_value DESC LIMIT 10;"),
    ("edge", "medium", "Categorize awards as 'small' (<$100k), 'medium' (<$10M), 'large' otherwise.",
     "SELECT CASE WHEN current_value < 100000 THEN 'small' "
     "            WHEN current_value < 10000000 THEN 'medium' "
     "            ELSE 'large' END AS bucket, COUNT(*) AS n "
     "FROM award WHERE current_value IS NOT NULL GROUP BY bucket ORDER BY MIN(current_value);"),
    ("edge", "medium", "Vendors that are stubs (placeholder records).",
     "SELECT COUNT(*) AS n FROM vendor WHERE is_stub = 1;"),
    ("edge", "easy", "Awards with negative obligated_amount (de-obligations).",
     "SELECT award_piid, obligated_amount FROM award WHERE obligated_amount < 0 ORDER BY obligated_amount LIMIT 10;"),
    ("edge", "medium", "Unique fiscal years touched by reconciliation checks.",
     "SELECT DISTINCT fiscal_year FROM reconciliation_check WHERE fiscal_year IS NOT NULL ORDER BY fiscal_year;"),

    # ───────────────────────── 16. Natural-language exploration questions ─────────────────────────
    ("natural", "medium", "Which agency awards the most contracts at CDC?",
     "SELECT o.canonical_name, COUNT(*) AS n FROM award a JOIN organization o ON o.org_id = a.awarding_org_id "
     "WHERE o.canonical_name LIKE '%Disease Control%' GROUP BY o.org_id ORDER BY n DESC;"),
    ("natural", "medium", "What is Moderna's total contract value with the federal government in our warehouse?",
     "SELECT v.legal_name, SUM(a.current_value) AS total FROM award a JOIN vendor v ON v.vendor_id = a.vendor_id "
     "WHERE v.legal_name LIKE 'MODERNA%' GROUP BY v.vendor_id;"),
    ("natural", "medium", "Show the description of the largest CDC award.",
     "SELECT a.description, a.current_value FROM award a JOIN organization o ON o.org_id = a.awarding_org_id "
     "WHERE o.canonical_name = 'Centers for Disease Control and Prevention' "
     "ORDER BY a.current_value DESC LIMIT 1;"),
    ("natural", "medium", "How many distinct vendors have done business with NIH?",
     "SELECT COUNT(DISTINCT a.vendor_id) AS n FROM award a JOIN organization o ON o.org_id = a.awarding_org_id "
     "WHERE o.canonical_name = 'National Institutes of Health';"),
    ("natural", "medium", "Which contracts are ending this year?",
     "SELECT award_piid, pop_end_date, current_value FROM award "
     "WHERE pop_end_date LIKE strftime('%Y', 'now') || '-%' ORDER BY pop_end_date;"),
    ("natural", "medium", "Are there any vendors who only received purchase orders?",
     "SELECT v.legal_name FROM vendor v WHERE v.vendor_id IN "
     "(SELECT vendor_id FROM award GROUP BY vendor_id HAVING COUNT(DISTINCT award_type) = 1 AND MAX(award_type) = 'PURCHASE ORDER') "
     "ORDER BY v.legal_name LIMIT 10;"),
    ("natural", "hard", "Which awarding agency has the highest concentration of dollars going to a single vendor?",
     "WITH per AS ("
     "  SELECT o.canonical_name AS agency, v.legal_name AS vendor, SUM(a.current_value) AS v_total, "
     "         SUM(SUM(a.current_value)) OVER (PARTITION BY o.org_id) AS agency_total "
     "  FROM award a JOIN organization o ON o.org_id = a.awarding_org_id "
     "  JOIN vendor v ON v.vendor_id = a.vendor_id "
     "  GROUP BY o.org_id, v.vendor_id"
     ") SELECT agency, vendor, ROUND(100.0 * v_total / agency_total, 2) AS pct_of_agency "
     "  FROM per WHERE agency_total > 0 ORDER BY pct_of_agency DESC LIMIT 5;"),
    ("natural", "medium", "Show solicitations that resulted in an award (joined by solicitation_id).",
     "SELECT s.sol_number, s.title, a.award_piid, a.current_value FROM solicitation s "
     "JOIN award a ON a.solicitation_id = s.solicitation_id LIMIT 20;"),

    # ───────────────────────── 17. JSON / TEXT search ─────────────────────────
    ("text_search", "easy", "Awards whose description mentions 'vaccine'.",
     "SELECT award_piid, description, current_value FROM award WHERE description LIKE '%vaccine%' LIMIT 10;"),
    ("text_search", "easy", "Grant opportunities with 'cancer' in the title.",
     "SELECT opportunity_number, title FROM grant_opportunity WHERE title LIKE '%cancer%' LIMIT 10;"),
    ("text_search", "medium", "Awards whose description mentions COVID or pandemic.",
     "SELECT COUNT(*) AS n FROM award WHERE description LIKE '%COVID%' OR description LIKE '%pandemic%' OR description LIKE '%SARS-CoV-2%';"),
    ("text_search", "medium", "Grant opportunities with 'mental health' in title or description.",
     "SELECT opportunity_number, title FROM grant_opportunity "
     "WHERE title LIKE '%mental health%' OR description LIKE '%mental health%' LIMIT 10;"),
    ("text_search", "medium", "Vendors whose legal name starts with 'UNIVERSITY'.",
     "SELECT legal_name, uei FROM vendor WHERE legal_name LIKE 'UNIVERSITY%' ORDER BY legal_name LIMIT 20;"),

    # ───────────────────────── 18. Identity / governance (auth tables) ─────────────────────────
    ("admin", "easy", "How many users are pending approval?",
     "SELECT COUNT(*) AS n FROM app_user WHERE role = 'pending';"),
    ("admin", "easy", "List active dashboard sessions and the user they belong to.",
     "SELECT s.session_id, u.email, s.last_seen_at FROM app_session s JOIN app_user u ON u.user_id = s.user_id "
     "WHERE s.expires_at > DATETIME('now') ORDER BY s.last_seen_at DESC;"),
    ("admin", "medium", "How many users have been granted access to each view?",
     "SELECT v.name AS view_name, COUNT(va.user_id) AS users_granted "
     "FROM data_view v LEFT JOIN view_access va ON va.view_id = v.view_id AND va.status = 'granted' "
     "GROUP BY v.view_id ORDER BY users_granted DESC;"),
    ("admin", "medium", "Pending view access requests, oldest first.",
     "SELECT u.email, v.name AS view_name, va.requested_at, va.requested_note "
     "FROM view_access va JOIN app_user u ON u.user_id = va.user_id "
     "JOIN data_view v ON v.view_id = va.view_id "
     "WHERE va.status = 'requested' ORDER BY va.requested_at ASC;"),

    # ───────────────────────── 19. View-membership analytics (legacy view_award) ─────────────────────────
    ("views", "easy", "How many awards each data view contains.",
     "SELECT v.name, COUNT(va.award_id) AS award_count FROM data_view v "
     "LEFT JOIN view_award va ON va.view_id = v.view_id GROUP BY v.view_id ORDER BY award_count DESC;"),
    ("views", "medium", "Total dollars represented in each enabled data view.",
     "SELECT v.name, SUM(a.current_value) AS total_dollars "
     "FROM data_view v JOIN view_award va ON va.view_id = v.view_id "
     "JOIN award a ON a.award_id = va.award_id "
     "WHERE v.enabled = 1 GROUP BY v.view_id ORDER BY total_dollars DESC;"),

    # ───────────────────────── 20. Multi-step / analytical ─────────────────────────
    ("analytical", "hard", "What share of CDC's total dollars went to its top 3 vendors combined?",
     "WITH cdc AS ("
     "  SELECT a.vendor_id, SUM(a.current_value) AS v "
     "  FROM award a JOIN organization o ON o.org_id = a.awarding_org_id "
     "  WHERE o.canonical_name = 'Centers for Disease Control and Prevention' "
     "  GROUP BY a.vendor_id"
     "), top3 AS (SELECT vendor_id, v FROM cdc ORDER BY v DESC LIMIT 3) "
     "SELECT (SELECT SUM(v) FROM top3) * 1.0 / (SELECT SUM(v) FROM cdc) AS top3_share;"),
    ("analytical", "hard", "Vendors who have at least one award at CDC and at least one at NIH.",
     "SELECT v.legal_name FROM vendor v WHERE v.vendor_id IN ("
     "  SELECT a.vendor_id FROM award a JOIN organization o ON o.org_id = a.awarding_org_id "
     "  WHERE o.canonical_name = 'Centers for Disease Control and Prevention'"
     ") AND v.vendor_id IN ("
     "  SELECT a.vendor_id FROM award a JOIN organization o ON o.org_id = a.awarding_org_id "
     "  WHERE o.canonical_name = 'National Institutes of Health'"
     ") ORDER BY v.legal_name;"),
    ("analytical", "hard", "Average award value per agency, plus how that agency compares to the warehouse-wide average.",
     "WITH global_avg AS (SELECT AVG(current_value) AS g FROM award) "
     "SELECT o.canonical_name AS agency, AVG(a.current_value) AS agency_avg, "
     "       (SELECT g FROM global_avg) AS warehouse_avg, "
     "       AVG(a.current_value) - (SELECT g FROM global_avg) AS delta "
     "FROM award a JOIN organization o ON o.org_id = a.awarding_org_id "
     "GROUP BY o.org_id ORDER BY agency_avg DESC LIMIT 10;"),
    ("analytical", "hard", "Top 3 NAICS codes used at each CDC center.",
     "WITH r AS ("
     "  SELECT c.center_code, a.naics_code, COUNT(*) AS n, "
     "         ROW_NUMBER() OVER (PARTITION BY c.center_code ORDER BY COUNT(*) DESC) AS rk "
     "  FROM award a JOIN award_federal_account afa ON afa.award_id = a.award_id "
     "  JOIN cdc_center c ON c.federal_account_code = afa.federal_account_code "
     "  WHERE a.naics_code IS NOT NULL "
     "  GROUP BY c.center_code, a.naics_code"
     ") SELECT center_code, naics_code, n FROM r WHERE rk <= 3 ORDER BY center_code, rk;"),
    ("analytical", "hard", "Concentration ratio: what % of total dollars goes to the top 5 vendors overall?",
     "WITH t AS (SELECT v.legal_name, SUM(a.current_value) AS v "
     "           FROM award a JOIN vendor v ON v.vendor_id = a.vendor_id "
     "           GROUP BY v.vendor_id), "
     "     top5 AS (SELECT v FROM t ORDER BY v DESC LIMIT 5) "
     "SELECT (SELECT SUM(v) FROM top5) * 100.0 / (SELECT SUM(v) FROM t) AS pct_top5;"),
]


def build_schema_prompt() -> str:
    """The schema string a model would be given as context for inference."""
    conn = sqlite3.connect(DB)
    cur = conn.cursor()
    rows = cur.execute(
        "SELECT sql FROM sqlite_master "
        "WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' "
        "AND name NOT IN ('app_session','app_user_audit','d1_migrations','sam_api_budget','staging_raw_record') "
        "ORDER BY name"
    ).fetchall()
    conn.close()
    return "\n\n".join(r[0].strip() for r in rows if r[0])


def main() -> int:
    if not DB.exists():
        print(f"ERROR: db not found at {DB}", file=sys.stderr)
        return 1

    conn = sqlite3.connect(DB)
    cur = conn.cursor()

    valid, invalid = [], []
    for cat, diff, q, sql in PAIRS:
        try:
            cur.execute(sql)
            rows = cur.fetchall()
            valid.append({
                "category": cat,
                "difficulty": diff,
                "question": q,
                "sql": sql.strip(),
                "row_count": len(rows),
            })
        except sqlite3.Error as e:
            invalid.append({"question": q, "sql": sql.strip(), "error": str(e)})

    OUT.write_text("\n".join(json.dumps(v) for v in valid) + ("\n" if valid else ""))
    SCHEMA_OUT.write_text(build_schema_prompt())

    print(f"Wrote {len(valid)} valid pairs to {OUT}")
    print(f"Wrote schema prompt to {SCHEMA_OUT}")
    if invalid:
        print(f"\n{len(invalid)} INVALID pair(s):")
        for v in invalid:
            print(f"  Q: {v['question']}")
            print(f"     ERR: {v['error']}")
            print(f"     SQL: {v['sql'][:140]}...")

    # Summary by category
    by_cat: dict[str, int] = {}
    for v in valid:
        by_cat[v["category"]] = by_cat.get(v["category"], 0) + 1
    print("\nBy category:")
    for cat, n in sorted(by_cat.items(), key=lambda x: -x[1]):
        print(f"  {n:3d}  {cat}")

    by_diff: dict[str, int] = {}
    for v in valid:
        by_diff[v["difficulty"]] = by_diff.get(v["difficulty"], 0) + 1
    print("\nBy difficulty:")
    for d in ("easy", "medium", "hard"):
        print(f"  {by_diff.get(d, 0):3d}  {d}")

    conn.close()
    return 0 if not invalid else 2


if __name__ == "__main__":
    sys.exit(main())
