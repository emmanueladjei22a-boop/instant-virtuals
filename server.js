const path = require("path");
const express = require("express");
const cookieParser = require("cookie-parser");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const multer = require("multer");
const { db, uid, getSetting, setSetting } = require("./db");

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "change-this-secret-before-going-public";
const upload = multer({ dest: path.join(__dirname, "data", "uploads") });

const app = express();
app.use(express.json({ limit: "2mb" }));
app.use(cookieParser());
app.use((req, res, next) => {
  const blocked = ["/server.js", "/db.js", "/package.json", "/package-lock.json"];
  if (blocked.includes(req.path) || req.path.startsWith("/data") || req.path.startsWith("/node_modules")) {
    return res.status(404).end();
  }
  next();
});
app.use(express.static(__dirname));
app.use(express.static(path.join(__dirname, "public")));

function sign(user) {
  return jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: "14d" });
}
function auth(req, res, next) {
  const token = req.cookies.iv_token;
  if (!token) return res.status(401).json({ error: "Not logged in" });
  try {
    req.auth = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: "Session expired" });
  }
}
function adminOnly(req, res, next) {
  if (!req.auth || req.auth.role !== "admin") return res.status(403).json({ error: "Admin only" });
  next();
}
function publicSettings() {
  return {
    siteName: getSetting("siteName"),
    tagline: getSetting("tagline"),
    supportLink: getSetting("supportLink"),
    registrationFeeGHS: getSetting("registrationFeeGHS"),
    registrationFeeNGN: getSetting("registrationFeeNGN"),
    requireFee: getSetting("requireFee"),
    requireApproval: getSetting("requireApproval"),
    maintenance: getSetting("maintenance"),
    disclaimer: getSetting("disclaimer"),
    stats: getSetting("stats"),
    ticker: db.prepare("SELECT text FROM ticker").all().map((r) => r.text),
    testimonials: db.prepare("SELECT name, city, text FROM testimonials").all(),
  };
}
function safeUser(u) {
  if (!u) return null;
  return {
    id: u.id, name: u.name, email: u.email, phone: u.phone, country: u.country,
    role: u.role, status: u.status, paid: !!u.paid, credits: u.credits, created_at: u.created_at,
  };
}
function parseFixtures(text) {
  return String(text || "").split(/\n+/).map((l) => l.trim()).filter(Boolean).map((line, i) => {
    const oddsMatch = line.match(/(\d+\.\d+)/g);
    const vs = line.split(/\s+vs\.?\s+/i);
    const home = (vs[0] || "Home " + (i + 1)).replace(/[@\d.].*$/, "").trim();
    const away = ((vs[1] || "Away " + (i + 1))).replace(/[@\d.].*$/, "").trim();
    const odds = (oddsMatch || ["2.10", "3.20", "3.40"]).slice(0, 3).map(Number);
    while (odds.length < 3) odds.push(2.5);
    return { home, away, odds: { home: odds[0], draw: odds[1], away: odds[2] }, raw: line };
  });
}
function marketLean(fx) {
  const entries = [
    { pick: "Home", team: fx.home, odd: fx.odds.home },
    { pick: "Draw", team: "Draw", odd: fx.odds.draw },
    { pick: "Away", team: fx.away, odd: fx.odds.away },
  ].sort((a, b) => a.odd - b.odd);
  const best = entries[0];
  return { ...best, impliedPct: Math.round((1 / best.odd) * 100), note: "Lowest listed odd = market favourite. Not a predicted RNG outcome." };
}

app.get("/api/public", (_req, res) => {
  res.json({ settings: publicSettings() });
});

app.post("/api/signup", (req, res) => {
  const { name, email, phone, country, password } = req.body || {};
  if (!name || !email || !password) return res.status(400).json({ error: "Name, email and password required" });
  const exists = db.prepare("SELECT id FROM users WHERE email = ?").get(String(email).toLowerCase());
  if (exists) return res.status(400).json({ error: "That email is already registered" });
  const requireFee = getSetting("requireFee");
  const requireApproval = getSetting("requireApproval");
  const id = uid("usr");
  db.prepare(`INSERT INTO users(id,name,email,phone,country,password_hash,role,status,paid,credits,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(
    id, name, String(email).toLowerCase(), phone || "", country || "GH",
    bcrypt.hashSync(password, 10), "user",
    requireApproval ? "pending" : "active", requireFee ? 0 : 1, 0, Date.now()
  );
  if (requireFee) {
    db.prepare("INSERT INTO payments(id,user_id,amount,currency,type,status,created_at) VALUES(?,?,?,?,?,?,?)")
      .run(uid("pay"), id, country === "NG" ? getSetting("registrationFeeNGN") : getSetting("registrationFeeGHS"),
        country === "NG" ? "NGN" : "GHS", "registration", "unpaid", Date.now());
  }
  const user = db.prepare("SELECT * FROM users WHERE id=?").get(id);
  res.cookie("iv_token", sign(user), { httpOnly: true, sameSite: "lax", maxAge: 14 * 864e5 });
  res.json({ user: safeUser(user) });
});

app.post("/api/login", (req, res) => {
  const { email, password } = req.body || {};
  const user = db.prepare("SELECT * FROM users WHERE email=?").get(String(email || "").toLowerCase());
  if (!user || !bcrypt.compareSync(password || "", user.password_hash)) {
    return res.status(400).json({ error: "Wrong email or password" });
  }
  res.cookie("iv_token", sign(user), { httpOnly: true, sameSite: "lax", maxAge: 14 * 864e5 });
  res.json({ user: safeUser(user) });
});

app.post("/api/logout", (_req, res) => {
  res.clearCookie("iv_token");
  res.json({ ok: true });
});

app.get("/api/me", auth, (req, res) => {
  const user = db.prepare("SELECT * FROM users WHERE id=?").get(req.auth.id);
  if (!user) return res.status(401).json({ error: "User missing" });
  res.json({ user: safeUser(user), settings: publicSettings() });
});

app.post("/api/analyse", auth, (req, res) => {
  if (getSetting("maintenance") && req.auth.role !== "admin") {
    return res.status(503).json({ error: "Site is in maintenance" });
  }
  const user = db.prepare("SELECT * FROM users WHERE id=?").get(req.auth.id);
  if (!user.paid && getSetting("requireFee")) return res.status(403).json({ error: "Registration fee not marked paid yet" });
  if (user.status !== "active") return res.status(403).json({ error: "Account is " + user.status });
  const text = (req.body && req.body.fixturesText) || "";
  if (!text.trim()) return res.status(400).json({ error: "Paste at least one fixture line" });
  const fixtures = parseFixtures(text);
  const leans = fixtures.map(marketLean);
  const id = uid("slip");
  db.prepare("INSERT INTO slips(id,user_id,image_name,fixtures_text,fixtures_json,leans_json,created_at) VALUES(?,?,?,?,?,?,?)")
    .run(id, user.id, req.body.imageName || "", text, JSON.stringify(fixtures), JSON.stringify(leans), Date.now());
  if (user.credits > 0) db.prepare("UPDATE users SET credits = credits - 1 WHERE id=?").run(user.id);
  res.json({ slip: { id, fixtures, leans } });
});

app.get("/api/my/slips", auth, (req, res) => {
  const rows = db.prepare("SELECT * FROM slips WHERE user_id=? ORDER BY created_at DESC").all(req.auth.id);
  res.json({ slips: rows.map((s) => ({ ...s, fixtures: JSON.parse(s.fixtures_json), leans: JSON.parse(s.leans_json) })) });
});

app.get("/api/picks", auth, (_req, res) => {
  res.json({ picks: db.prepare("SELECT * FROM picks ORDER BY created_at DESC").all() });
});

app.get("/api/admin/overview", auth, adminOnly, (_req, res) => {
  res.json({
    users: db.prepare("SELECT COUNT(*) AS n FROM users").get().n,
    pending: db.prepare("SELECT COUNT(*) AS n FROM users WHERE status='pending'").get().n,
    slips: db.prepare("SELECT COUNT(*) AS n FROM slips").get().n,
  });
});

app.get("/api/admin/users", auth, adminOnly, (_req, res) => {
  const users = db.prepare("SELECT * FROM users ORDER BY created_at DESC").all().map(safeUser);
  res.json({ users });
});

app.post("/api/admin/users/:id/action", auth, adminOnly, (req, res) => {
  const { action } = req.body || {};
  const id = req.params.id;
  if (id === "admin" && action === "block") return res.status(400).json({ error: "Do not block the seed admin this way" });
  if (action === "approve") db.prepare("UPDATE users SET status='active' WHERE id=?").run(id);
  else if (action === "block") db.prepare("UPDATE users SET status='blocked' WHERE id=?").run(id);
  else if (action === "paid") {
    db.prepare("UPDATE users SET paid=1 WHERE id=?").run(id);
    db.prepare("UPDATE payments SET status='paid' WHERE user_id=? AND status='unpaid'").run(id);
  } else if (action === "credit") db.prepare("UPDATE users SET credits = credits + 5 WHERE id=?").run(id);
  else return res.status(400).json({ error: "Unknown action" });
  res.json({ ok: true });
});

app.post("/api/admin/picks", auth, adminOnly, (req, res) => {
  const { match, selection, odd, note } = req.body || {};
  if (!match || !selection) return res.status(400).json({ error: "Match and selection required" });
  const admin = db.prepare("SELECT name FROM users WHERE id=?").get(req.auth.id);
  db.prepare("INSERT INTO picks(id,match,selection,odd,note,author,created_at) VALUES(?,?,?,?,?,?,?)")
    .run(uid("pick"), match, selection, odd || "", note || "", admin.name, Date.now());
  res.json({ ok: true });
});

app.get("/api/admin/slips", auth, adminOnly, (_req, res) => {
  const rows = db.prepare(`SELECT s.*, u.name AS user_name, u.email AS user_email
    FROM slips s LEFT JOIN users u ON u.id = s.user_id ORDER BY s.created_at DESC`).all();
  res.json({
    slips: rows.map((s) => ({
      ...s,
      fixtures: JSON.parse(s.fixtures_json || "[]"),
      leans: JSON.parse(s.leans_json || "[]"),
    })),
  });
});

app.post("/api/admin/content", auth, adminOnly, (req, res) => {
  const { ticker, testimonials, stats } = req.body || {};
  if (Array.isArray(ticker)) {
    db.prepare("DELETE FROM ticker").run();
    const ins = db.prepare("INSERT INTO ticker(text) VALUES(?)");
    ticker.filter(Boolean).forEach((t) => ins.run(String(t)));
  }
  if (Array.isArray(testimonials)) {
    db.prepare("DELETE FROM testimonials").run();
    const ins = db.prepare("INSERT INTO testimonials(id,name,city,text) VALUES(?,?,?,?)");
    testimonials.forEach((t) => ins.run(uid("rev"), t.name || "", t.city || "", t.text || ""));
  }
  if (stats) setSetting("stats", stats);
  res.json({ ok: true });
});

app.post("/api/admin/settings", auth, adminOnly, (req, res) => {
  const s = req.body || {};
  ["siteName", "tagline", "supportLink", "disclaimer"].forEach((k) => {
    if (s[k] !== undefined) setSetting(k, s[k]);
  });
  ["registrationFeeGHS", "registrationFeeNGN"].forEach((k) => {
    if (s[k] !== undefined) setSetting(k, Number(s[k]));
  });
  ["requireFee", "requireApproval", "maintenance"].forEach((k) => {
    if (s[k] !== undefined) setSetting(k, !!s[k]);
  });
  res.json({ ok: true, settings: publicSettings() });
});

app.post("/api/upload", auth, upload.single("file"), (req, res) => {
  res.json({ filename: req.file ? req.file.originalname : "" });
});

app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api")) return next();
  const file = req.path === "/" ? "index.html" : req.path.replace(/^\//, "");
  const abs = path.join(__dirname, "public", file.endsWith(".html") ? file : file);
  res.sendFile(abs, (err) => {
    if (err) res.sendFile(path.join(__dirname, "public", "index.html"));
  });
});

app.listen(PORT, () => {
  console.log("Instant Virtuals live on http://localhost:" + PORT);
});
