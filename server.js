const express = require('express');
const cors = require('cors');
const { SMTPClient } = require('smtp-client');
const dns = require('dns');
const { Pool } = require('pg');

const app = express();
const port = 3000;

// PostgreSQL setup
const pool = new Pool({
  user: 'postgres',                  // Default username for pgAdmin
  host: 'localhost',                // Local machine (you're not using cloud DB)
  database: 'postgres',             // You only have 1 DB — it's named "postgres"
  password: 'St0n3fl0w3r@1994',     // ✅ This is your password
  port: 5432                        // Default PostgreSQL port
});


// Middleware
app.use(cors());
app.use(express.json());

// MX record lookup
function getMXRecords(domain) {
  return new Promise((resolve, reject) => {
    dns.resolveMx(domain, (err, addresses) => {
      if (err) reject('Error resolving MX records');
      else resolve(addresses);
    });
  });
}

// Main email verifier
async function verifyEmail(email) {
  const domain = email.split('@')[1];

  try {
    const mxRecords = await getMXRecords(domain);
    if (mxRecords.length === 0) {
      return { email, isValid: false, errorMessage: 'No MX records found.' };
    }

    const mailServer = mxRecords[0].exchange;
    const client = new SMTPClient({ host: mailServer, port: 25, secure: false });

    await client.connect();
    await client.greet();
    await client.mail({ from: 'test@example.com' });

    try {
      const response = await client.rcpt({ to: email });
      await client.quit();

      if (response.code >= 400 && response.code < 500) {
        return { email, isValid: false, errorMessage: 'Soft bounce: ' + response.message };
      }
      if (response.code >= 500 && response.code < 600) {
        return { email, isValid: false, errorMessage: 'Hard bounce: ' + response.message };
      }

      return { email, isValid: true, errorMessage: 'Valid email address.' };
    } catch (err) {
      return { email, isValid: false, errorMessage: 'RCPT failed: ' + err.message };
    }

  } catch (err) {
    return { email, isValid: false, errorMessage: 'SMTP Error: ' + err.message };
  }
}

// Route to handle verification requests
app.post('/verify-emails', async (req, res) => {
  const emails = req.body.emails;
  console.log("➡️ Received request to verify:", emails);

  const results = await Promise.all(emails.map(verifyEmail));
  console.log("✅ Verification results:", results);

  for (const r of results) {
    try {
      await pool.query(
        'INSERT INTO verification_history (email, is_valid, error_message) VALUES ($1, $2, $3)',
        [r.email, r.isValid, r.errorMessage]
      );
      console.log("📥 Inserted into DB:", r.email);
    } catch (err) {
      console.error("❌ DB Insert Error for", r.email, "=>", err.message);
    }
  }

  res.json(results);
});

app.listen(port, () => {
  console.log(`🚀 Backend running at http://localhost:${port}`);
});
