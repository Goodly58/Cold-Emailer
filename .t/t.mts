const { generateCandidates } = await import('./email-finder.ts');
const db = JSON.parse(await import('fs').then(m => m.promises.readFile('/home/user/Cold-Emailer/data/db.json','utf8')));
const picks = ['First Abu Dhabi Bank (FAB)','ADNOC Group','Mubadala','e& (Etisalat Group)','Emirates NBD','G42 / Core42 / Presight'];
console.log('Email generation against seeded domains:\n');
for (const name of picks) {
  const c = db.companies.find((x:any) => x.name === name);
  if (!c?.domain) { console.log(`  ${name}: no domain`); continue; }
  const cands = generateCandidates('Sara Al Mansoori', c.domain, c.emailPattern);
  console.log(`  ${name.padEnd(28)} ${c.domain.padEnd(18)} -> ${cands[0]}`);
}
const withDomain = db.companies.filter((c:any)=>c.domain);
let ok=0;
for (const c of withDomain) { if (generateCandidates('Test User', c.domain, c.emailPattern).length) ok++; }
console.log(`\n${ok}/${withDomain.length} seeded domains produce valid candidates`);
