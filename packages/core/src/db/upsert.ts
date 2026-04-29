import type { CanonicalAward, CanonicalOffice, CanonicalOrganization, CanonicalVendor } from '../models/canonical.js';
import { deterministicId, nowIso } from '../utils/ids.js';

/**
 * Builds prepared-statement batches for upserting a canonical award and its
 * dependent rows (vendor, orgs, mapping). Returns the statements for the
 * caller to execute via `db.batch([...])` so the write is atomic.
 *
 * Convention: `external_id_mapping` is the join pivot. Lookup by
 * (source, external_id) → internal_id. On cold-start we insert stubs.
 */
export async function buildUpsertStatements(
  db: D1Database,
  source: string,
  award: CanonicalAward,
): Promise<D1PreparedStatement[]> {
  const now = nowIso();
  const stmts: D1PreparedStatement[] = [];

  // --- vendor ---
  const vendorId = await deterministicId(source, `vendor::${award.vendor.external_id}`);
  stmts.push(
    db.prepare(`
      INSERT INTO vendor
        (vendor_id, uei, legal_name, country_code, state, city, zip,
         primary_naics, is_stub, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
      ON CONFLICT(vendor_id) DO UPDATE SET
        uei          = COALESCE(excluded.uei, vendor.uei),
        legal_name   = excluded.legal_name,
        country_code = COALESCE(excluded.country_code, vendor.country_code),
        state        = COALESCE(excluded.state, vendor.state),
        city         = COALESCE(excluded.city, vendor.city),
        zip          = COALESCE(excluded.zip, vendor.zip),
        updated_at   = excluded.updated_at
    `).bind(
      vendorId,
      award.vendor.uei ?? null,
      award.vendor.legal_name,
      award.vendor.country_code ?? null,
      award.vendor.state ?? null,
      award.vendor.city ?? null,
      award.vendor.zip ?? null,
      award.vendor.primary_naics ?? null,
      now, now,
    ),
  );
  stmts.push(externalIdMappingStmt(db, source, award.vendor.external_id, 'vendor', vendorId, now));

  // vendor classifications (business_categories → vendor_classification rows)
  if (award.vendor.business_categories?.length) {
    for (const cls of award.vendor.business_categories) {
      stmts.push(
        db.prepare(`
          INSERT OR IGNORE INTO vendor_classification
            (vendor_id, classification, source_id)
          VALUES (?, ?, ?)
        `).bind(vendorId, cls, source),
      );
    }
  }

  // --- awarding org ---
  let awardingOrgId: string | null = null;
  if (award.awarding_org) {
    awardingOrgId = await upsertOrg(db, stmts, source, award.awarding_org, now);
  }
  let fundingOrgId: string | null = null;
  if (award.funding_org) {
    fundingOrgId = await upsertOrg(db, stmts, source, award.funding_org, now);
  }

  // --- awarding office ---
  let awardingOfficeId: string | null = null;
  if (award.awarding_office) {
    awardingOfficeId = await upsertOffice(db, stmts, source, award.awarding_office, awardingOrgId, now);
  }
  let fundingOfficeId: string | null = null;
  if (award.funding_office) {
    fundingOfficeId = await upsertOffice(db, stmts, source, award.funding_office, fundingOrgId, now);
  }

  // --- reference stubs (must come BEFORE the award insert — SQLite checks
  //     foreign-key constraints immediately per statement, not at commit) ---
  if (award.naics_code) {
    stmts.push(
      db.prepare(`
        INSERT OR IGNORE INTO naics_code (naics_code, description)
        VALUES (?, ?)
      `).bind(award.naics_code, award.naics_description ?? '(unknown)'),
    );
  }
  if (award.psc_code) {
    stmts.push(
      db.prepare(`
        INSERT OR IGNORE INTO psc_code (psc_code, description)
        VALUES (?, ?)
      `).bind(award.psc_code, award.psc_description ?? '(unknown)'),
    );
  }

  // --- award ---
  const awardId = await deterministicId(source, `award::${award.external_id}`);
  stmts.push(
    db.prepare(`
      INSERT INTO award
        (award_id, award_piid, parent_piid, award_type, vendor_id,
         awarding_org_id, funding_org_id, awarding_office_id, funding_office_id,
         naics_code, psc_code,
         description, base_value, current_value, obligated_amount,
         currency_code, pop_start_date, pop_end_date, solicitation_id,
         source_last_modified, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(award_id) DO UPDATE SET
        award_piid           = excluded.award_piid,
        award_type           = excluded.award_type,
        vendor_id            = excluded.vendor_id,
        awarding_org_id      = COALESCE(excluded.awarding_org_id, award.awarding_org_id),
        funding_org_id       = COALESCE(excluded.funding_org_id, award.funding_org_id),
        awarding_office_id   = COALESCE(excluded.awarding_office_id, award.awarding_office_id),
        funding_office_id    = COALESCE(excluded.funding_office_id, award.funding_office_id),
        naics_code           = COALESCE(excluded.naics_code, award.naics_code),
        psc_code             = COALESCE(excluded.psc_code, award.psc_code),
        description          = excluded.description,
        current_value        = excluded.current_value,
        obligated_amount     = excluded.obligated_amount,
        pop_start_date       = COALESCE(excluded.pop_start_date, award.pop_start_date),
        pop_end_date         = COALESCE(excluded.pop_end_date, award.pop_end_date),
        source_last_modified = excluded.source_last_modified,
        updated_at           = excluded.updated_at
      WHERE excluded.source_last_modified >= award.source_last_modified
    `).bind(
      awardId,
      award.award_piid ?? null,
      award.parent_piid ?? null,
      award.award_type ?? null,
      vendorId,
      awardingOrgId,
      fundingOrgId,
      awardingOfficeId,
      fundingOfficeId,
      award.naics_code ?? null,
      award.psc_code ?? null,
      award.description ?? null,
      award.base_value ?? null,
      award.current_value ?? null,
      award.obligated_amount ?? null,
      award.currency_code ?? 'USD',
      award.pop_start_date ?? null,
      award.pop_end_date ?? null,
      award.solicitation_id ?? null,
      award.source_last_modified,
      now, now,
    ),
  );
  stmts.push(externalIdMappingStmt(db, source, award.external_id, 'award', awardId, now));

  // --- federal account funding (M2M) ---
  // Replace-style: clear existing rows for this award and re-insert. Cheap
  // (typically <5 rows per award) and avoids stale tuples when funding shifts.
  // Skip when the field wasn't enriched (undefined). Only `[]` signals
  // "definitively no funding accounts" and would still wipe stale rows.
  if (Array.isArray(award.funding_accounts)) {
    stmts.push(db.prepare('DELETE FROM award_federal_account WHERE award_id = ?').bind(awardId));
    const seen = new Set<string>();
    for (const fa of award.funding_accounts) {
      const pa = fa.program_activity_code ?? '';
      const dedupeKey = `${fa.federal_account_code}|${pa}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      stmts.push(
        db.prepare(`
          INSERT OR IGNORE INTO award_federal_account
            (award_id, federal_account_code, federal_account_name,
             program_activity_code, program_activity_name)
          VALUES (?, ?, ?, ?, ?)
        `).bind(
          awardId,
          fa.federal_account_code,
          fa.federal_account_name ?? null,
          pa,
          fa.program_activity_name ?? null,
        ),
      );
    }
  }

  // --- performance location ---
  if (award.performance_location) {
    const loc = award.performance_location;
    stmts.push(
      db.prepare(`
        INSERT INTO award_performance_location
          (award_id, country_code, state, city, zip, congressional_district)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(award_id) DO UPDATE SET
          country_code           = excluded.country_code,
          state                  = excluded.state,
          city                   = excluded.city,
          zip                    = excluded.zip,
          congressional_district = excluded.congressional_district
      `).bind(
        awardId,
        loc.country_code ?? null,
        loc.state ?? null,
        loc.city ?? null,
        loc.zip ?? null,
        loc.congressional_district ?? null,
      ),
    );
  }

  return stmts;
}

async function upsertOrg(
  db: D1Database,
  stmts: D1PreparedStatement[],
  source: string,
  org: CanonicalOrganization,
  now: string,
): Promise<string> {
  const orgId = await deterministicId(source, `org::${org.external_id}`);
  let parentId: string | null = null;
  if (org.parent_external_id) {
    parentId = await deterministicId(source, `org::${org.parent_external_id}`);
    stmts.push(
      db.prepare(`
        INSERT OR IGNORE INTO organization
          (org_id, org_type, canonical_name, is_stub, created_at, updated_at)
        VALUES (?, 'department', '(stub parent)', 1, ?, ?)
      `).bind(parentId, now, now),
    );
  }
  stmts.push(
    db.prepare(`
      INSERT INTO organization
        (org_id, parent_org_id, org_type, canonical_name, short_name, acronym,
         country_code, external_ids_json, is_stub, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
      ON CONFLICT(org_id) DO UPDATE SET
        canonical_name = excluded.canonical_name,
        short_name     = COALESCE(excluded.short_name, organization.short_name),
        parent_org_id  = COALESCE(excluded.parent_org_id, organization.parent_org_id),
        updated_at     = excluded.updated_at
    `).bind(
      orgId,
      parentId,
      org.org_type,
      org.canonical_name,
      org.short_name ?? null,
      org.acronym ?? null,
      org.country_code ?? null,
      org.external_ids_json ? JSON.stringify(org.external_ids_json) : null,
      now, now,
    ),
  );
  stmts.push(externalIdMappingStmt(db, source, org.external_id, 'organization', orgId, now));
  return orgId;
}

async function upsertOffice(
  db: D1Database,
  stmts: D1PreparedStatement[],
  source: string,
  office: CanonicalOffice,
  parentOrgId: string | null,
  now: string,
): Promise<string> {
  const officeId = await deterministicId(source, `office::${office.external_id}`);
  stmts.push(
    db.prepare(`
      INSERT INTO contracting_office
        (office_id, org_id, fpds_office_code, name)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(office_id) DO UPDATE SET
        org_id           = COALESCE(excluded.org_id, contracting_office.org_id),
        fpds_office_code = COALESCE(excluded.fpds_office_code, contracting_office.fpds_office_code),
        name             = excluded.name
    `).bind(
      officeId,
      parentOrgId,
      office.fpds_office_code ?? null,
      office.name,
    ),
  );
  stmts.push(externalIdMappingStmt(db, source, office.external_id, 'contracting_office', officeId, now));
  return officeId;
}

function externalIdMappingStmt(
  db: D1Database,
  source: string,
  externalId: string,
  entityType: string,
  internalId: string,
  now: string,
): D1PreparedStatement {
  return db.prepare(`
    INSERT INTO external_id_mapping
      (source_id, external_id, entity_type, internal_id, first_seen_at, last_seen_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(source_id, external_id, entity_type) DO UPDATE SET
      last_seen_at = excluded.last_seen_at
  `).bind(source, externalId, entityType, internalId, now, now);
}
