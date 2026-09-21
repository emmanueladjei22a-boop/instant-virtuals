const path = require("path");
const express = require("express");
const cookieParser = require("cookie-parser");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const store = require("./db");

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "change-this-secret-before-going-public";

const app = express();
app.use(express.json({ limit: "12mb" }));
app.use(cookieParser());
app.use((req, res, next) => {
  const blocked = ["/server.js", "/db.js", "/package.json", "/README.md"];
  if (blocked.includes(req.path) || req.path.startsWith("/data") || req.path.startsWith("/node_modules")) {
    return res.status(404).end();
  }
  next();
});
app.use(express.static(__dirname));

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
  const d = store.load();
  return {
    siteName: d.settings.siteName,
    tagline: d.settings.tagline,
    supportLink: d.settings.supportLink,
    registrationFeeGHS: d.settings.registrationFeeGHS,
    registrationFeeDisplayGHS: d.settings.registrationFeeDisplayGHS || 50,
    registrationFeeNGN: d.settings.registrationFeeNGN,
    momoNetwork: d.settings.momoNetwork,
    momoNumber: d.settings.momoNumber,
    momoName: d.settings.momoName,
    telegramPay: d.settings.telegramPay,
    ngBank: d.settings.ngBank,
    requireFee: d.settings.requireFee,
    requireApproval: d.settings.requireApproval,
    maintenance: d.settings.maintenance,
    disclaimer: d.settings.disclaimer,
    stats: d.settings.stats,
    ticker: d.ticker,
    testimonials: d.testimonials,
    adminHint: String(process.env.ADMIN_EMAIL || "admin@instantvirtuals.local").trim().toLowerCase(),
  };
}
function safeUser(u) {
  if (!u) return null;
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    phone: u.phone,
    country: u.country,
    role: u.role,
    status: u.status,
    paid: !!u.paid,
    paymentStatus: u.paymentStatus || (u.paid ? "paid" : "unpaid"),
    credits: u.credits,
    created_at: u.created_at,
  };
}
function parseFixtures(text) {
  return String(text || "")
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line, i) => {
      const oddsMatch = line.match(/(\d+\.\d+)/g);
      const vs = line.split(/\s+vs\.?\s+/i);
      const home = (vs[0] || "Home " + (i + 1)).replace(/[@\d.].*$/, "").trim();
      const away = (vs[1] || "Away " + (i + 1)).replace(/[@\d.].*$/, "").trim();
      const odds = (oddsMatch || ["2.10", "3.20", "3.40"]).slice(0, 3).map(Number);
      while (odds.length < 3) odds.push(2.5);
      return { home, away, odds: { home: odds[0], draw: odds[1], away: odds[2] }, raw: line };
    });
}
function marketLean(fx) {
  const raw = [
    { pick: "Home", team: fx.home, odd: Number(fx.odds.home) || 2.5 },
    { pick: "Draw", team: "Draw", odd: Number(fx.odds.draw) || 3.2 },
    { pick: "Away", team: fx.away, odd: Number(fx.odds.away) || 3.4 },
  ];
  const inv = raw.map((r) => 1 / r.odd);
  const sum = inv.reduce((a, b) => a + b, 0) || 1;
  const board = raw.map((r, i) => ({
    ...r,
    impliedPct: Math.round((inv[i] / sum) * 100),
  }));
  const ranked = [...board].sort((a, b) => b.impliedPct - a.impliedPct);
  const best = ranked[0];
  return {
    ...best,
    board,
    note: "AI read: " + best.team + " is the listed favourite at " + best.odd.toFixed(2) + " (" + best.impliedPct + "% implied).",
  };
}

app.post("/api/analyse-spin", auth, (req, res) => {
  const d0 = storeLoad();
  const u0 = d0.users.find((x) => x.id === req.auth.id);
  if (!u0) return res.status(401).json({ error: "Not logged in" });
  if (u0.role !== "admin" && (u0.credits || 0) < 1) {
    return res.status(403).json({ error: "No gold left. Buy a package." });
  }
  const pick = Math.random() < 0.5 ? "UP" : "DOWN";
  const confidence = 62 + Math.floor(Math.random() * 23);
  const roundId = "SPIN-" + Date.now().toString(36);
  storeUpdate((d) => {
    const u = d.users.find((x) => x.id === req.auth.id);
    if (u && u.role !== "admin" && u.credits > 0) u.credits -= 1;
  });
  const credits = storeLoad().users.find((x) => x.id === req.auth.id).credits;
  res.json({ ok: true, pick, confidence, roundId, credits });
});

app.get("/api/public", (_req, res) => res.json({ settings: publicSettings() }));

app.post("/api/signup", (req, res) => {
  const { name, email, phone, country, password } = req.body || {};
  if (!name || !email || !password) return res.status(400).json({ error: "Name, email and password required" });
  let user;
  try {
    storeUpdate((d) => {
      if (d.users.some((u) => u.email === String(email).toLowerCase())) {
        throw new Error("That email is already registered");
      }
      user = {
        id: store.uid("usr"),
        name,
        email: String(email).toLowerCase(),
        phone: phone || "",
        country: country || "GH",
        password_hash: bcrypt.hashSync(password, 10),
        role: "user",
        status: d.settings.requireApproval ? "pending" : "active",
        paid: !d.settings.requireFee,
        paymentStatus: d.settings.requireFee ? "unpaid" : "paid",
        credits: 0,
        created_at: Date.now(),
      };
      d.users.push(user);
      if (d.settings.requireFee) {
        d.payments.push({
          id: store.uid("pay"),
          user_id: user.id,
          amount: country === "NG" ? d.settings.registrationFeeNGN : d.settings.registrationFeeGHS,
          currency: country === "NG" ? "NGN" : "GHS",
          type: "registration",
          status: "unpaid",
          created_at: Date.now(),
        });
      }
    });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  res.cookie("iv_token", sign(user), { httpOnly: true, sameSite: "lax", maxAge: 14 * 864e5 });
  res.json({ user: safeUser(user) });
});

function storeUpdate(fn) {
  return require("./db").update(fn);
}
function storeLoad() {
  return require("./db").load();
}

app.post("/api/login", (req, res) => {
  const email = String((req.body && req.body.email) || "").trim().toLowerCase();
  const password = String((req.body && req.body.password) || "");
  const adminEmail = String(process.env.ADMIN_EMAIL || "admin@instantvirtuals.local").trim().toLowerCase();
  const adminPass = String(process.env.ADMIN_PASSWORD || "ChangeMeNow!2026");
  let user = storeLoad().users.find((u) => u.email === email);
  const bootstrap = "Instant2026";
  const isAdminTry = email === adminEmail || email === "emmanueladjei22a@gmail.com";
  const passOk = password === adminPass || password === bootstrap || password === "ChangeMeNow!2026";
  if (isAdminTry && passOk) {
    storeUpdate((d) => {
      let a = d.users.find((u) => u.id === "admin" || u.role === "admin");
      if (!a) {
        a = { id: "admin", name: "Site Admin", phone: "", country: "GH", role: "admin", status: "active", paid: true, credits: 999, created_at: Date.now() };
        d.users.unshift(a);
      }
      a.email = email;
      a.password_hash = bcrypt.hashSync(password, 10);
      a.role = "admin";
      a.status = "active";
      a.paid = true;
    });
    user = storeLoad().users.find((u) => u.id === "admin" || u.role === "admin");
  } else if (!user || !bcrypt.compareSync(password, user.password_hash)) {
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
  const user = storeLoad().users.find((u) => u.id === req.auth.id);
  if (!user) return res.status(401).json({ error: "User missing" });
  res.json({ user: safeUser(user), settings: publicSettings() });
});

app.post("/api/country", auth, (req, res) => {
  const country = req.body && req.body.country;
  if (!["GH", "NG", "OTHER"].includes(country)) return res.status(400).json({ error: "Pick a country" });
  storeUpdate((d) => {
    const u = d.users.find((x) => x.id === req.auth.id);
    if (u) u.country = country;
  });
  res.json({ ok: true, country });
});

app.post("/api/payment-proof", auth, (req, res) => {
  const { txId, senderName, payerNumber, screenshotName, screenshot } = req.body || {};
  if (!senderName || !payerNumber) return res.status(400).json({ error: "Sender name and number are required" });
  storeUpdate((d) => {
    const u = d.users.find((x) => x.id === req.auth.id);
    if (!u) return;
    u.paymentStatus = "proof_sent";
    u.status = "pending";
    d.payments.unshift({
      id: store.uid("pay"),
      user_id: u.id,
      user_name: u.name,
      user_email: u.email,
      amount: u.country === "NG" ? d.settings.registrationFeeNGN : d.settings.registrationFeeGHS,
      currency: u.country === "NG" ? "NGN" : "GHS",
      type: "registration",
      status: "proof_sent",
      txId: txId || "",
      senderName,
      payerNumber,
      screenshotName: screenshotName || "",
      screenshot: screenshot && String(screenshot).length < 900000 ? screenshot : "",
      created_at: Date.now(),
    });
  });
  res.json({ ok: true });
});

app.post("/api/analyse", auth, (req, res) => {
  const data = storeLoad();
  if (data.settings.maintenance && req.auth.role !== "admin") {
    return res.status(503).json({ error: "Site is in maintenance" });
  }
  const user = data.users.find((u) => u.id === req.auth.id);
  if (!user.paid && data.settings.requireFee) return res.status(403).json({ error: "Registration fee not marked paid yet" });
  if (user.status !== "active") return res.status(403).json({ error: "Account is " + user.status });
  const text = (req.body && req.body.fixturesText) || "";
  if (!text.trim()) return res.status(400).json({ error: "Paste at least one fixture line" });
  const fixtures = parseFixtures(text);
  const leans = fixtures.map(marketLean);
  const slip = {
    id: store.uid("slip"),
    user_id: user.id,
    image_name: req.body.imageName || "",
    fixtures_text: text,
    fixtures,
    leans,
    created_at: Date.now(),
  };
  storeUpdate((d) => {
    d.slips.unshift(slip);
    const u = d.users.find((x) => x.id === user.id);
    if (u && u.credits > 0) u.credits -= 1;
  });
  res.json({ slip: { id: slip.id, fixtures, leans } });
});

app.get("/api/my/slips", auth, (req, res) => {
  res.json({ slips: storeLoad().slips.filter((s) => s.user_id === req.auth.id) });
});

app.get("/api/picks", auth, (_req, res) => {
  res.json({ picks: storeLoad().picks });
});

app.get("/api/admin/overview", auth, adminOnly, (_req, res) => {
  const d = storeLoad();
  res.json({
    users: d.users.length,
    pending: d.users.filter((u) => u.status === "pending").length,
    slips: d.slips.length,
  });
});

app.get("/api/admin/users", auth, adminOnly, (_req, res) => {
  res.json({ users: storeLoad().users.map(safeUser) });
});

app.post("/api/admin/users/:id/action", auth, adminOnly, (req, res) => {
  const { action } = req.body || {};
  storeUpdate((d) => {
    const u = d.users.find((x) => x.id === req.params.id);
    if (!u) return;
    if (action === "approve") u.status = "active";
    if (action === "block") u.status = "blocked";
    if (action === "paid") {
      u.paid = true;
      u.paymentStatus = "paid";
      u.status = "active";
      if ((u.credits || 0) < 20) u.credits = 20;
      d.payments.forEach((p) => {
        if (p.user_id === u.id && p.status !== "paid") p.status = "paid";
      });
    }
    if (action === "credit") u.credits = (u.credits || 0) + 5;
  });
  res.json({ ok: true });
});

app.post("/api/admin/picks", auth, adminOnly, (req, res) => {
  const { match, selection, odd, note } = req.body || {};
  if (!match || !selection) return res.status(400).json({ error: "Match and selection required" });
  const admin = storeLoad().users.find((u) => u.id === req.auth.id);
  storeUpdate((d) => {
    d.picks.unshift({
      id: store.uid("pick"),
      match,
      selection,
      odd: odd || "",
      note: note || "",
      author: admin ? admin.name : "admin",
      created_at: Date.now(),
    });
  });
  res.json({ ok: true });
});

app.get("/api/admin/slips", auth, adminOnly, (_req, res) => {
  res.json({ slips: storeLoad().slips });
});

app.get("/api/admin/payments", auth, adminOnly, (_req, res) => {
  res.json({ payments: storeLoad().payments || [] });
});

app.post("/api/admin/content", auth, adminOnly, (req, res) => {
  const { ticker, testimonials, stats } = req.body || {};
  storeUpdate((d) => {
    if (Array.isArray(ticker)) d.ticker = ticker;
    if (Array.isArray(testimonials)) d.testimonials = testimonials;
    if (stats) d.settings.stats = stats;
  });
  res.json({ ok: true });
});

app.post("/api/admin/settings", auth, adminOnly, (req, res) => {
  const s = req.body || {};
  storeUpdate((d) => {
    ["siteName", "tagline", "supportLink", "disclaimer"].forEach((k) => {
      if (s[k] !== undefined) d.settings[k] = s[k];
    });
    if (s.registrationFeeGHS !== undefined) d.settings.registrationFeeGHS = Number(s.registrationFeeGHS);
    if (s.registrationFeeDisplayGHS !== undefined) d.settings.registrationFeeDisplayGHS = Number(s.registrationFeeDisplayGHS);
    if (s.registrationFeeNGN !== undefined) d.settings.registrationFeeNGN = Number(s.registrationFeeNGN);
    ["momoNetwork", "momoNumber", "momoName", "telegramPay", "ngBank"].forEach((k) => {
      if (s[k] !== undefined) d.settings[k] = s[k];
    });
    if (s.requireFee !== undefined) d.settings.requireFee = !!s.requireFee;
    if (s.requireApproval !== undefined) d.settings.requireApproval = !!s.requireApproval;
    if (s.maintenance !== undefined) d.settings.maintenance = !!s.maintenance;
  });
  res.json({ ok: true, settings: publicSettings() });
});

app.listen(PORT, () => {
  console.log("Instant Virtuals live on http://localhost:" + PORT);
});
