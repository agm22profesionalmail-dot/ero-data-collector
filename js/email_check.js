const DOH = [
  (name, type) => `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=${type}`,
  (name, type) => `https://dns.google/resolve?name=${encodeURIComponent(name)}&type=${type}`
];
async function dohQuery(name, type) {
  for (const url of DOH) {
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 4e3);
      const r = await fetch(url(name, type), { headers: { accept: "application/dns-json" }, signal: ctl.signal });
      clearTimeout(timer);
      if (!r.ok)
        continue;
      const j = await r.json();
      if (j.Status === 3)
        return { nx: true, answers: [] };
      if (j.Status !== 0)
        continue;
      return { nx: false, answers: (j.Answer || []).filter((a) => a.type === { MX: 15, A: 1, AAAA: 28 }[type]) };
    } catch {
    }
  }
  return null;
}
export async function checkEmailDomain(email) {
  const domain = String(email || "").split("@").pop().trim().toLowerCase().replace(/\.$/, "");
  if (!domain)
    return "dead";
  const mx = await dohQuery(domain, "MX");
  if (!mx)
    return "unknown";
  if (mx.nx)
    return "dead";
  if (mx.answers.length) {
    const nullMx = mx.answers.every((a2) => /^\s*0\s+\.?\s*$/.test(a2.data || ""));
    return nullMx ? "dead" : "ok";
  }
  const a = await dohQuery(domain, "A");
  if (a?.answers.length)
    return "ok";
  const aaaa = await dohQuery(domain, "AAAA");
  if (aaaa?.answers.length)
    return "ok";
  return a || aaaa ? "dead" : "unknown";
}
const COMMON = [
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "msn.com",
  "yahoo.com",
  "yahoo.es",
  "yahoo.co.jp",
  "ymail.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
  "gmx.com",
  "gmx.de",
  "mail.com",
  "qq.com",
  "163.com",
  "naver.com",
  "hotmail.es",
  "outlook.es",
  "hotmail.co.uk",
  "yandex.com"
];
const TLD_FIX = { con: "com", cmo: "com", ocm: "com", comm: "com", om: "com", cm: "com", vom: "com", xom: "com", cpm: "com", nte: "net", ent: "net" };
function distance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++)
    d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1])
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}
export function suggestEmail(email) {
  const at = String(email || "").lastIndexOf("@");
  if (at < 1)
    return null;
  const local = email.slice(0, at);
  const domain = email.slice(at + 1).trim().toLowerCase();
  if (COMMON.includes(domain))
    return null;
  const dot = domain.lastIndexOf(".");
  if (dot > 0 && TLD_FIX[domain.slice(dot + 1)]) {
    const fixed = domain.slice(0, dot + 1) + TLD_FIX[domain.slice(dot + 1)];
    if (COMMON.includes(fixed))
      return `${local}@${fixed}`;
  }
  let best = null, bestD = 3;
  for (const c of COMMON) {
    const dd = distance(domain, c);
    if (dd < bestD) {
      best = c;
      bestD = dd;
    }
  }
  if (best && (bestD === 1 || bestD === 2 && best.length >= 8))
    return `${local}@${best}`;
  return null;
}
