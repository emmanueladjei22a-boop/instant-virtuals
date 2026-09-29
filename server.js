const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve files from the root of your GitHub repo
app.use(express.static(__dirname));

// Health check
app.get("/health", (req, res) => {
  res.json({ status: "OK" });
});

// Homepage
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// Admin page
app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "admin.html"));
});

// Success page
app.get("/success", (req, res) => {
  res.sendFile(path.join(__dirname, "success.html"));
});

// Packages
app.get("/api/packages", (req, res) => {
  res.json({
    MTN: [
      { data: "1GB", price: 4.15 },
      { data: "2GB", price: 9.13 },
      { data: "3GB", price: 13.70 },
      { data: "4GB", price: 18.26 },
      { data: "5GB", price: 22.83 },
      { data: "6GB", price: 25.08 },
      { data: "8GB", price: 36.30 },
      { data: "10GB", price: 43.44 },
      { data: "15GB", price: 65.34 },
      { data: "20GB", price: 85.25 },
      { data: "25GB", price: 108.90 },
      { data: "30GB", price: 130.90 },
      { data: "40GB", price: 157.00 },
      { data: "50GB", price: 185.00 }
    ],

    Telecel: [
      { data: "10GB", price: 41 },
      { data: "15GB", price: 57 },
      { data: "20GB", price: 76 },
      { data: "30GB", price: 114 },
      { data: "40GB", price: 152 },
      { data: "50GB", price: 190 }
    ],

    AirtelTigo: [
      { data: "1GB", price: 3.70 },
      { data: "2GB", price: 7.40 },
      { data: "5GB", price: 18.50 },
      { data: "10GB", price: 36.50 },
      { data: "20GB", price: 73 },
      { data: "30GB", price: 109.50 },
      { data: "50GB", price: 182.50 }
    ]
  });
});

// Test checkout route
app.post("/api/checkout", (req, res) => {
  const { phone, network, data, amount } = req.body;

  if (!phone || !network || !data || !amount) {
    return res.status(400).json({
      error: "Missing required information"
    });
  }

  res.json({
    success: true,
    message: "Order received",
    phone,
    network,
    data,
    amount
  });
});

// Start server
app.listen(PORT, "0.0.0.0", () => {
  console.log(`DataHub GH running on port ${PORT}`);
});
