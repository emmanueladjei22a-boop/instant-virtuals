const express = require("express");
const path = require("path");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const { Pool } = require("pg");

const app = express();
const PORT = process.env.PORT || 10000;
const SESSION_SECRET = process.env.SESSION_SECRET || "CHANGE_THIS_IN_RENDER";

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_URL.includes("localhost")
        ? false
        : { rejectUnauthorized: false }
    })
  : null;

const PACKAGES = [
  { id: "mtn-1", network: "MTN", validity: "90-Day Validity", gb: 1, price: 4.15 },
  { id: "mtn-2", network: "MTN", validity: "90-Day Validity", gb: 2, price: 9.13 },
  { id: "mtn-3", network: "MTN", validity: "90-Day Validity", gb: 3, price: 13.70 },
  { id: "mtn-4", network: "MTN", validity: "90-Day Validity", gb: 4, price: 18.26 },
  { id: "mtn-5", network: "MTN", validity: "90-Day Validity", gb: 5, price: 22.83 },
  { id: "mtn-6", network: "MTN", validity: "90-Day Validity", gb: 6, price: 25.08 },
  { id: "mtn-8", network: "MTN", validity: "90-Day Validity", gb: 8, price: 36.30 },
  { id: "mtn-10", network: "MTN", validity: "90-Day Validity", gb: 10, price: 43.44 },
  { id: "mtn-15", network: "MTN", validity: "90-Day Validity", gb: 15, price: 65.34 },
  { id: "mtn-20", network: "MTN", validity: "90-Day Validity", gb: 20, price: 85.25 },
  { id: "mtn-25", network: "MTN", validity: "90-Day Validity", gb: 25, price: 108.90 },
  { id: "mtn-30", network: "MTN", validity: "90-Day Validity", gb: 30, price: 130.90 },
  { id: "mtn-40", network: "MTN", validity: "90-Day Validity", gb: 40, price: 157.00 },
  { id: "mtn-50", network: "MTN", validity: "90-Day Validity", gb: 50, price: 185.00 },

  { id: "telecel-10", network: "Telecel", validity: "Non-Expiry", gb: 10, price: 41.00 },
  { id: "telecel-15", network: "Telecel", validity: "Non-Expiry", gb: 15, price: 57.00 },
  { id: "telecel-20", network: "Telecel", validity: "Non-Expiry", gb: 20, price: 76.00 },
  { id: "telecel-30", network: "Telecel", validity: "Non-Expiry", gb: 30, price: 114.00 },
  { id: "telecel-40", network: "Telecel", validity: "Non-Expiry", gb: 40, price: 152.00 },
  { id: "telecel-50", network: "Telecel", validity: "Non-Expiry", gb: 50, price: 190.00 },

  { id: "airteltigo-1", network: "AirtelTigo", validity: "60-Day Validity", gb: 1, price: 3.70 },
  { id: "airteltigo-2", network: "AirtelTigo", validity: "60-Day Validity", gb: 2, price: 7.40 },
  { id: "airteltigo-5", network: "AirtelTigo", validity: "60-Day Validity", gb: 5, price: 18.50 },
  { id: "airteltigo-10", network: "AirtelTigo", validity: "60-Day Validity", gb: 10, price: 36.50 },
  { id: "airteltigo-20", network: "AirtelTigo", validity: "60-Day Validity", gb: 20, price: 73.00 },
  { id: "airteltigo-30", network: "AirtelTigo", validity: "60-Day Validity", gb: 30, price: 109.50 },
  { id: "airteltigo-50", network: "AirtelTigo", validity: "60-Day Validity", gb: 50, price: 182.50 }
];

function makeToken(user) {
  const payload = Buffer.from(JSON.stringify({
    id: user.id,
    email: user.email,
    exp: Date.now() + 1000 * 60 * 60 * 24 * 30
  })).toString("base64url");

  const sig = crypto.createHmac("sha256", SESSION_SECRET)
    .update(payload)
    .digest("base64url");

  return `${payload}.${sig}`;
}

function readToken(token) {
  try {
    if (!token) return null;
    const [payload, sig] = token.split(".");
    if (!payload || !sig) return null;

    const expected = crypto.createHmac("sha256", SESSION_SECRET)
      .update(payload)
      .digest("base64url");

    if (sig.length !== expected.length ||
        !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
      return null;
    }

    const data = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (!data.exp || Date.now() > data.exp) return null;
    return data;
  } catch {
    return null;
  }
}

function authUser(req) {
  return readToken(req.headers.authorization?.replace(/^Bearer\s+/i, ""));
}

async function initDb() {
  if (!pool) {
    console.warn("DATABASE_URL is not set. Accounts cannot be persisted.");
    return;
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      phone TEXT,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS orders (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
      reference TEXT UNIQUE NOT NULL,
      network TEXT NOT NULL,
      package_id TEXT NOT NULL,
      gb NUMERIC NOT NULL,
      amount NUMERIC(12,2) NOT NULL,
      phone TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

app.get("/api/packages", (req, res) => {
  res.json({ packages: PACKAGES });
});

app.get("/api/me", async (req, res) => {
  const tokenUser = authUser(req);
  if (!tokenUser || !pool) return res.json({ loggedIn: false });

  const result = await pool.query(
    "SELECT id, name, email, phone, created_at FROM users WHERE id = $1",
    [tokenUser.id]
  );

  if (!result.rows[0]) return res.json({ loggedIn: false });

  res.json({ loggedIn: true, user: result.rows[0] });
});

app.post("/api/auth/signup", async (req, res) => {
  try {
    if (!pool) return res.status(503).json({ error: "Database is not connected yet." });

    const name = String(req.body.name || "").trim();
    const email = String(req.body.email || "").trim().toLowerCase();
    const phone = String(req.body.phone || "").trim();
    const password = String(req.body.password || "");

    if (name.length < 2) return res.status(400).json({ error: "Enter your full name." });
    if (!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: "Enter a valid email." });
    if (password.length < 6) return res.status(400).json({ error: "Password must be at least 6 characters." });

    const exists = await pool.query("SELECT id FROM users WHERE email = $1", [email]);
    if (exists.rows[0]) return res.status(409).json({ error: "An account with that email already exists. Log in instead." });

    const hash = await bcrypt.hash(password, 12);
    const result = await pool.query(
      "INSERT INTO users (name,email,phone,password_hash) VALUES ($1,$2,$3,$4) RETURNING id,name,email,phone,created_at",
      [name, email, phone || null, hash]
    );

    const user = result.rows[0];
    res.json({ ok: true, token: makeToken(user), user });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not create account." });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    if (!pool) return res.status(503).json({ error: "Database is not connected yet." });

    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");

    const result = await pool.query(
      "SELECT id,name,email,phone,password_hash,created_at FROM users WHERE email = $1",
      [email]
    );

    const user = result.rows[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: "Email or password is incorrect." });
    }

    delete user.password_hash;
    res.json({ ok: true, token: makeToken(user), user });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not log in." });
  }
});

app.get("/api/orders", async (req, res) => {
  try {
    const user = authUser(req);
    if (!user || !pool) return res.status(401).json({ error: "Please log in." });

    const result = await pool.query(
      "SELECT reference,network,gb,amount,phone,status,created_at FROM orders WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50",
      [user.id]
    );

    res.json({ orders: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not load orders." });
  }
});

/*
  Checkout placeholder:
  This validates the package and creates an order record.
  Payment and automatic delivery should be connected after the Paystack
  secret and your data-provider API credentials are placed in Render.
*/
app.post("/api/checkout", async (req, res) => {
  try {
    const { packageId, phone } = req.body;
    const pkg = PACKAGES.find(p => p.id === packageId);

    if (!pkg) return res.status(400).json({ error: "Invalid data package." });
    if (!/^\d{10}$/.test(String(phone || ""))) {
      return res.status(400).json({ error: "Enter a valid 10-digit Ghana phone number." });
    }

    const user = authUser(req);
    const reference = "DH-" + crypto.randomBytes(6).toString("hex").toUpperCase();

    if (pool) {
      await pool.query(
        `INSERT INTO orders (user_id,reference,network,package_id,gb,amount,phone,status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'pending')`,
        [user?.id || null, reference, pkg.network, pkg.id, pkg.gb, pkg.price, phone]
      );
    }

    res.json({
      ok: true,
      reference,
      message: "Order created. Payment integration still needs to be connected."
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not create order." });
  }
});

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "admin.html"));
});

app.get("/success", (req, res) => {
  res.sendFile(path.join(__dirname, "success.html"));
});

app.use(express.static(__dirname));

initDb()
  .then(() => {
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`DataHub GH running on ${PORT}`);
    });
  })
  .catch(err => {
    console.error("Database startup error:", err);
    process.exit(1);
  });
