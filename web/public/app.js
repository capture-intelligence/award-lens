// Dashboard logic — Alpine.js component + fetch helpers.
// Intentionally framework-light: single file, no build step.

const LS_KEY = 'awards.api_base';

function apiBase() {
  return localStorage.getItem(LS_KEY) || window.AWARDS_CONFIG?.API_BASE || '';
}

async function apiGet(path, params = {}) {
  const base = apiBase();
  if (!base) throw new Error('API base not configured');
  const url = new URL(path, base);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  }
  const r = await fetch(url.toString());
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.json();
}

function fmtMoney(v) {
  if (v === null || v === undefined) return '—';
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
  if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
  if (Math.abs(n) >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
  return '$' + n.toFixed(0);
}

function fmtDate(s) {
  if (!s) return '—';
  return String(s).slice(0, 10);
}

function fmtInt(n) {
  if (n === null || n === undefined) return '—';
  return Number(n).toLocaleString();
}

function daysBadge(days) {
  if (days === null || days === undefined) return '';
  const d = Number(days);
  if (d < 0)  return `<span class="badge danger">expired ${Math.abs(d)}d ago</span>`;
  if (d < 90) return `<span class="badge danger">${d}d left</span>`;
  if (d < 365) return `<span class="badge warn">${d}d left</span>`;
  return `<span class="badge ok">${d}d left</span>`;
}

// Alpine component root
function dashboard() {
  return {
    apiBaseInput: apiBase(),
    active: 'overview',
    loading: false,
    error: null,

    // Overview
    overview: null,
    topVendors: [],
    byAgency: [],
    agencyChart: null,

    // Awards
    awardFilters: { q: '', awarding_org: '', vendor: '', min_value: '' },
    awards: [],

    // Expiring
    expiringMonths: 18,
    expiring: [],

    // Vendors
    vendorQuery: '',
    vendors: [],
    vendorDetail: null,
    enrichStatus: null,      // queued/synced message per vendor
    samBudget: null,         // { used, limit, remaining, resetsAt }

    // Exclusions
    exclusionQuery: '',
    exclusionsActiveOnly: true,
    exclusions: [],

    // Opportunities
    oppFilters: { q: '', agency: '', status: 'posted' },
    opportunities: [],
    oppByAgency: [],

    // Data quality / reconciliation
    reconcileSummary: null,
    reconcileRows: [],

    // Schedule
    scheduleSummary: null,
    scheduleRows: [],
    scheduleBudget: null,
    scheduleAutoRefresh: null,
    scheduleAsOf: null,

    // Runs
    runs: [],
    runDetail: null,

    init() {
      this.navigateFromHash();
      window.addEventListener('hashchange', () => this.navigateFromHash());
    },

    navigateFromHash() {
      const h = (location.hash || '#overview').replace('#', '');
      this.go(h);
    },

    go(section) {
      this.active = section;
      location.hash = section;
      this.error = null;
      this.load(section);
    },

    saveApiBase() {
      localStorage.setItem(LS_KEY, this.apiBaseInput.trim());
      this.go(this.active);
    },

    async load(section) {
      this.loading = true;
      this.error = null;
      try {
        switch (section) {
          case 'overview':      await this.loadOverview(); break;
          case 'awards':        await this.loadAwards(); break;
          case 'expiring':      await this.loadExpiring(); break;
          case 'vendors':       await this.loadVendors(); break;
          case 'exclusions':    await this.loadExclusions(); break;
          case 'opportunities': await this.loadOpportunities(); break;
          case 'dataquality':   await this.loadDataQuality(); break;
          case 'schedule':      await this.loadSchedule(); break;
          case 'runs':          await this.loadRuns(); break;
        }
        // Stop auto-refresh whenever we leave the schedule tab
        if (section !== 'schedule' && this.scheduleAutoRefresh) {
          clearInterval(this.scheduleAutoRefresh);
          this.scheduleAutoRefresh = null;
        }
      } catch (e) {
        this.error = e.message || String(e);
        console.error(e);
      } finally {
        this.loading = false;
      }
    },

    async loadOverview() {
      const [overview, top, byAgency] = await Promise.all([
        apiGet('/stats/overview'),
        apiGet('/stats/top-vendors', { limit: 10 }),
        apiGet('/stats/by-agency'),
      ]);
      this.overview = overview;
      this.topVendors = top.results;
      this.byAgency = byAgency.results;
      // Render chart after DOM update
      this.$nextTick(() => this.renderAgencyChart());
    },

    renderAgencyChart() {
      const el = document.getElementById('agencyChart');
      if (!el || !window.Chart) return;
      if (this.agencyChart) this.agencyChart.destroy();
      const top = this.byAgency.slice(0, 10);
      this.agencyChart = new Chart(el, {
        type: 'bar',
        data: {
          labels: top.map((r) => (r.agency || '—').slice(0, 28)),
          datasets: [{
            label: 'Obligated USD',
            data: top.map((r) => r.total_value || 0),
            backgroundColor: 'rgba(96, 165, 250, 0.6)',
            borderColor: 'rgba(96, 165, 250, 1)',
            borderWidth: 1,
          }],
        },
        options: {
          indexAxis: 'y',
          responsive: true,
          plugins: { legend: { display: false } },
          scales: {
            x: {
              ticks: {
                color: '#8ea1c7',
                callback: (v) => fmtMoney(v),
              },
              grid: { color: '#263356' },
            },
            y: { ticks: { color: '#e8eefc' }, grid: { display: false } },
          },
        },
      });
    },

    async loadAwards() {
      const res = await apiGet('/awards', { ...this.awardFilters, limit: 100 });
      this.awards = res.results;
    },

    async loadExpiring() {
      const res = await apiGet(`/awards/expiring/${this.expiringMonths}`);
      this.expiring = res.results;
    },

    async loadVendors() {
      const res = await apiGet('/vendors', { q: this.vendorQuery, limit: 100 });
      this.vendors = res.results;
    },

    async openVendor(id) {
      this.loading = true;
      this.enrichStatus = null;
      try {
        this.vendorDetail = await apiGet(`/vendors/${encodeURIComponent(id)}`);
        this.samBudget = await apiGet('/sam-api/status').catch(() => null);
      } finally {
        this.loading = false;
      }
    },

    async enrichVendor(vendorId, mode) {
      this.enrichStatus = { state: 'pending', msg: 'Enriching…' };
      try {
        const base = apiBase();
        const url = new URL(`/vendors/${encodeURIComponent(vendorId)}/enrich`, base);
        if (mode) url.searchParams.set('mode', mode);
        const r = await fetch(url.toString(), { method: 'POST' });
        const body = await r.json().catch(() => ({}));
        if (!r.ok) {
          this.enrichStatus = { state: 'error', msg: `${r.status}: ${body.error || 'failed'}` };
          return;
        }
        this.enrichStatus = body.queued
          ? { state: 'ok', msg: `Queued enrichment for ${body.uei}. Refresh in ~30s.` }
          : body.found === false
          ? { state: 'warn', msg: 'No SAM record found for that UEI.' }
          : { state: 'ok', msg: `Updated vendor + ${body.classificationsAdded || 0} classifications.` };
        this.samBudget = await apiGet('/sam-api/status').catch(() => null);
        if (body.found !== false) {
          // reload detail to show new classifications
          this.vendorDetail = await apiGet(`/vendors/${encodeURIComponent(vendorId)}`);
        }
      } catch (e) {
        this.enrichStatus = { state: 'error', msg: e.message || String(e) };
      }
    },

    async loadExclusions() {
      const res = await apiGet('/exclusions', {
        q: this.exclusionQuery,
        active: this.exclusionsActiveOnly ? 'true' : 'false',
        limit: 200,
      });
      this.exclusions = res.results;
    },

    async loadOpportunities() {
      const [opps, byAgency] = await Promise.all([
        apiGet('/opportunities', { ...this.oppFilters, limit: 200 }),
        apiGet('/stats/opportunities-by-agency'),
      ]);
      this.opportunities = opps.results;
      this.oppByAgency = byAgency.results;
    },

    async loadDataQuality() {
      const [summary, rows] = await Promise.all([
        apiGet('/reconciliation/summary'),
        apiGet('/reconciliation/latest'),
      ]);
      this.reconcileSummary = summary;
      this.reconcileRows = rows.results;
    },

    async loadSchedule() {
      const data = await apiGet('/schedule/status');
      this.scheduleSummary = data.summary;
      this.scheduleRows = data.schedules;
      this.scheduleBudget = data.sam_budget;
      this.scheduleAsOf = data.summary.as_of;

      // Refresh every 60s while the tab is open
      if (!this.scheduleAutoRefresh) {
        this.scheduleAutoRefresh = setInterval(async () => {
          if (this.active !== 'schedule') return;
          try {
            const d = await apiGet('/schedule/status');
            this.scheduleSummary = d.summary;
            this.scheduleRows = d.schedules;
            this.scheduleBudget = d.sam_budget;
            this.scheduleAsOf = d.summary.as_of;
          } catch (e) { console.warn(e); }
        }, 60_000);
      }
    },

    // Format a relative delta like "in 3h 24m" or "5m ago"
    relTime(iso) {
      if (!iso) return '—';
      const target = new Date(iso).getTime();
      const now = Date.now();
      const diffSec = Math.round((target - now) / 1000);
      const abs = Math.abs(diffSec);
      const future = diffSec > 0;
      let val, unit;
      if (abs < 60)         { val = abs;                 unit = 's'; }
      else if (abs < 3600)  { val = Math.round(abs / 60); unit = 'm'; }
      else if (abs < 86400) {
        const h = Math.floor(abs / 3600);
        const m = Math.round((abs % 3600) / 60);
        return future ? `in ${h}h ${m}m` : `${h}h ${m}m ago`;
      } else {
        val = Math.round(abs / 86400); unit = 'd';
      }
      return future ? `in ${val}${unit}` : `${val}${unit} ago`;
    },

    async loadRuns() {
      const res = await apiGet('/runs');
      this.runs = res.results;
    },

    async openRun(id) {
      this.loading = true;
      try {
        this.runDetail = await apiGet(`/runs/${id}`);
      } finally {
        this.loading = false;
      }
    },

    fmtMoney, fmtDate, fmtInt, daysBadge,
  };
}

// Mapping from health state → CSS badge class
function healthBadgeClass(h) {
  return { healthy: 'ok', running: 'info', stale: 'warn',
           error: 'danger', never_run: 'warn', disabled: 'info' }[h] || 'info';
}
window.healthBadgeClass = healthBadgeClass;

window.dashboard = dashboard;
