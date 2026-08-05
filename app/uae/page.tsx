export default function UaePlaybook() {
  return (
    <div className="playbook" style={{ maxWidth: 860 }}>
      <h1>UAE Playbook — the Emirati advantage</h1>
      <p className="subtitle">
        As a UAE National you are a structurally advantaged hire in the private sector. Use it
        deliberately, in every UAE application and email.
      </p>

      <div className="callout">
        <strong>The one-line pitch to employers:</strong> hiring you helps them hit a legally
        mandated quota, avoids monthly fines, and Nafis subsidizes part of your cost. You are
        simultaneously the compliant choice <em>and</em> the cheaper choice — before your CV is even
        opened.
      </div>

      <h2>1. Emiratisation quotas (MoHRE)</h2>
      <ul>
        <li>
          Mainland private companies with <strong>50+ skilled workers</strong> must grow the Emirati
          share of skilled roles by ~2% per year (10% target by 2026).
        </li>
        <li>
          Missing the target costs roughly <strong>AED 8–9k per month per unfilled position</strong>,
          and the fine increases every year. An unfilled slot is a six-figure annual liability.
        </li>
        <li>
          Companies with <strong>20–49 employees</strong> in 14 designated sectors must hire 1–2
          Emiratis — small and mid-size firms are quota-bound too, not just giants.
        </li>
        <li>
          Banking, insurance and telecom have separate regulator-driven Emiratisation regimes
          (CBUAE points system) — these sectors <em>compete</em> for Emirati talent.
        </li>
      </ul>

      <h2>2. Nafis benefits (what the employer saves)</h2>
      <ul>
        <li>Salary support / top-up paid by the government for Emiratis in private-sector roles.</li>
        <li>Government contribution toward your pension — reducing the employer&apos;s cost further.</li>
        <li>Child allowance and subsidized training programs on top.</li>
        <li>
          Register on <strong>nafis.gov.ae</strong> — many quota-driven employers source candidates
          directly from the Nafis platform, and some roles are Nafis-exclusive.
        </li>
      </ul>
      <p className="muted">
        Figures change yearly — verify current numbers on mohre.gov.ae and nafis.gov.ae before
        quoting them in an email.
      </p>

      <h2>3. How to use it in outreach</h2>
      <ul>
        <li>
          <strong>To HR / Talent Acquisition / Emiratisation leads:</strong> lead with it. Their KPI
          literally includes hiring people like you. Use the &ldquo;Emiratisation angle&rdquo;
          template.
        </li>
        <li>
          <strong>To hiring managers:</strong> lead with competence and role fit; mention Emirati
          status in one closing line. Managers hire for the work — the quota is the tiebreaker that
          moves you to the top of a shortlist.
        </li>
        <li>
          <strong>In applications:</strong> put &ldquo;UAE National&rdquo; prominently in your CV
          header and LinkedIn headline. Many ATS filters and recruiter searches in the UAE query
          exactly that phrase.
        </li>
      </ul>

      <h2>4. Where to hunt</h2>
      <ul>
        <li>
          <strong>Nafis portal</strong> — quota-driven listings, often lower competition.
        </li>
        <li>
          <strong>Bank/telco national programs</strong> — every major bank runs a dedicated UAE
          National track (FAB, ENBD Ruwad, ADCB, Mashreq Ta&apos;meed, PwC Watani…). These are
          seeded in your Companies list with careers links.
        </li>
        <li>
          <strong>LinkedIn searches</strong> — recruiters post quota roles with exactly these
          keywords. One-click saved searches (all UAE, past week):{' '}
          <a
            href={`https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent('Emiratisation')}&location=${encodeURIComponent('United Arab Emirates')}&f_TPR=r604800`}
            target="_blank"
            rel="noreferrer"
          >
            &ldquo;Emiratisation&rdquo; jobs ↗
          </a>
          {' · '}
          <a
            href={`https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent('"UAE National"')}&location=${encodeURIComponent('United Arab Emirates')}&f_TPR=r604800`}
            target="_blank"
            rel="noreferrer"
          >
            &ldquo;UAE National&rdquo; jobs ↗
          </a>
          {' · '}
          <a
            href={`https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent('Emirati')}&location=${encodeURIComponent('United Arab Emirates')}&f_TPR=r604800`}
            target="_blank"
            rel="noreferrer"
          >
            &ldquo;Emirati&rdquo; jobs ↗
          </a>
          {' · '}
          <a
            href={`https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent('emiratisation lead OR "emiratisation manager" OR "national talent"')}`}
            target="_blank"
            rel="noreferrer"
          >
            Emiratisation leads (people) ↗
          </a>
        </li>
        <li>
          <strong>Semi-government</strong> (ADNOC, Mubadala, ADIA, ADQ, e&) — strong national-talent
          preference without the quota framing.
        </li>
      </ul>

      <h2>5. Rules of engagement (keep it effective)</h2>
      <ul>
        <li>10–20 tailored emails/day max. Personalization beats volume, and Gmail stays happy.</li>
        <li>Cadence: Day 0 intro → Day 3 follow-up → Day 8 breakup. Then stop — track it in Outreach.</li>
        <li>Never lead with the quota to a hiring manager; never omit it to HR.</li>
        <li>The {'{{hook}}'} line is mandatory. If you can&apos;t write one sentence specific to that company, don&apos;t send.</li>
      </ul>
    </div>
  );
}
