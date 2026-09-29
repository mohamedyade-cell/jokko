const express = require('express');

const router = express.Router();

// Retire les caractères interdits en XML 1.0 et protège la fin de section CDATA.
function cdata(value) {
  const clean = String(value ?? '').replace(/[^\x09\x0A\x0D\x20-퟿-�]/g, '');
  return `<![CDATA[${clean.replace(/]]>/g, ']]]]><![CDATA[>')}]]>`;
}

function toHtml(text) {
  const esc = String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return esc
    .split(/\n{2,}/)
    .map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`)
    .join('');
}

function rfc822(sqliteDate) {
  return new Date(String(sqliteDate).replace(' ', 'T') + 'Z').toUTCString();
}

function feedJobs(db, column) {
  return db
    .prepare(
      `SELECT j.*, c.name AS company_name FROM jobs j JOIN companies c ON c.id = j.company_id
       WHERE j.status = 'open' AND j.${column} = 1 ORDER BY j.created_at DESC, j.id DESC`,
    )
    .all();
}

const INDEED_JOBTYPE = { CDI: 'fulltime', CDD: 'contract', Stage: 'internship', Alternance: 'internship', Freelance: 'contract', 'Temps partiel': 'parttime' };
const LINKEDIN_JOBTYPE = { CDI: 'FULL_TIME', CDD: 'TEMPORARY', Stage: 'INTERNSHIP', Alternance: 'INTERNSHIP', Freelance: 'CONTRACT', 'Temps partiel': 'PART_TIME' };

function salaryText(job, currency) {
  if (job.salary_min && job.salary_max) return `${job.salary_min} - ${job.salary_max} ${currency} par mois`;
  if (job.salary_min) return `${job.salary_min} ${currency} par mois`;
  if (job.salary_max) return `${job.salary_max} ${currency} par mois`;
  return '';
}

// Flux XML au format « Indeed XML Feed » : à déclarer dans l'espace employeur Indeed.
router.get('/feeds/indeed.xml', (req, res) => {
  const { baseUrl } = req.app.locals.config;
  const country = process.env.JOB_COUNTRY || 'SN';
  const currency = process.env.JOB_CURRENCY || 'XOF';
  const jobs = feedJobs(req.app.locals.db, 'publish_indeed');
  const items = jobs.map(
    (j) => `  <job>
    <title>${cdata(j.title)}</title>
    <date>${cdata(rfc822(j.created_at))}</date>
    <referencenumber>${cdata(`jokko-${j.id}`)}</referencenumber>
    <requisitionid>${cdata(j.id)}</requisitionid>
    <url>${cdata(`${baseUrl}/jobs/${j.id}?utm_source=indeed`)}</url>
    <company>${cdata(j.company_name)}</company>
    <city>${cdata(j.location)}</city>
    <country>${cdata(country)}</country>
    <description>${cdata(toHtml(j.description))}</description>
    <salary>${cdata(salaryText(j, currency))}</salary>
    <jobtype>${cdata(INDEED_JOBTYPE[j.contract_type] || 'fulltime')}</jobtype>
    <remotetype>${cdata(j.remote ? 'Fully remote' : '')}</remotetype>
  </job>`,
  );
  res.type('application/xml').send(`<?xml version="1.0" encoding="utf-8"?>
<source>
  <publisher>Jokko</publisher>
  <publisherurl>${cdata(baseUrl)}</publisherurl>
  <lastBuildDate>${cdata(new Date().toUTCString())}</lastBuildDate>
${items.join('\n')}
</source>
`);
});

// Flux XML au format « LinkedIn Job Wrapping / XML Feed ».
router.get('/feeds/linkedin.xml', (req, res) => {
  const { baseUrl } = req.app.locals.config;
  const country = process.env.JOB_COUNTRY || 'SN';
  const currency = process.env.JOB_CURRENCY || 'XOF';
  const jobs = feedJobs(req.app.locals.db, 'publish_linkedin');
  const items = jobs.map((j) => {
    const salary =
      j.salary_min || j.salary_max
        ? `
    <salaries>
      <salary>
        <highEnd><amount>${cdata(j.salary_max || j.salary_min)}</amount><currencyCode>${cdata(currency)}</currencyCode></highEnd>
        <lowEnd><amount>${cdata(j.salary_min || j.salary_max)}</amount><currencyCode>${cdata(currency)}</currencyCode></lowEnd>
        <period>${cdata('MONTHLY')}</period>
        <type>${cdata('BASE_SALARY')}</type>
      </salary>
    </salaries>`
        : '';
    return `  <job>
    <partnerJobId>${cdata(`jokko-${j.id}`)}</partnerJobId>
    <company>${cdata(j.company_name)}</company>
    <title>${cdata(j.title)}</title>
    <description>${cdata(toHtml(j.description))}</description>
    <applyUrl>${cdata(`${baseUrl}/jobs/${j.id}?utm_source=linkedin`)}</applyUrl>
    <location>${cdata(j.location)}</location>
    <city>${cdata(j.location)}</city>
    <country>${cdata(country)}</country>
    <listDate>${cdata(j.created_at.slice(0, 10))}</listDate>
    <jobtype>${cdata(LINKEDIN_JOBTYPE[j.contract_type] || 'FULL_TIME')}</jobtype>
    <workplaceTypes>${cdata(j.remote ? 'Remote' : 'On-site')}</workplaceTypes>${salary}
  </job>`;
  });
  res.type('application/xml').send(`<?xml version="1.0" encoding="utf-8"?>
<source>
  <lastBuildDate>${cdata(new Date().toUTCString())}</lastBuildDate>
  <publisherUrl>${cdata(baseUrl)}</publisherUrl>
  <publisher>Jokko</publisher>
  <expectedJobCount>${jobs.length}</expectedJobCount>
${items.join('\n')}
</source>
`);
});

module.exports = router;
module.exports.cdata = cdata;
