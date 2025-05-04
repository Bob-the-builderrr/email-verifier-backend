const express = require('express');
const cors = require('cors');
const { SMTPClient } = require('smtp-client');
const dns = require('dns');
const { Pool } = require('pg');

const app = express();
const port = process.env.PORT || 3000;

// PostgreSQL connection (Render DB)
const pool = new Pool({
  user: 'email_verification_db_nvnq_user',
  host: 'dpg-d0bhoo95pdvs73cmehlg-a.oregon-postgres.render.com',
  database: 'email_verification_db_nvnq',
  password: 'FfOsLEvGszsqxcvvu8eV84FK6GRP41kO',
  port: 5432,
  ssl: { rejectUnauthorized: false }
});

app.use(cors());
app.use(express.json());

// Lookup MX records of the domain
function getMXRecords(domain) {
  return new Promise((resolve, reject) => {
    dns.resolveMx(domain, (err, addresses) => {
      if (err) reject('Error resolving MX records');
      else resolve(addresses);
    });
  });
}

// Verify the email using SMTP handshake (except for known blockers like Gmail)
async function verifyEmail(email) {
  const domain = email.split('@')[1].toLowerCase();

  // Known providers that block SMTP verification
  const blockedProviders = ['gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'yahoo.com', 'zoho.com'];

  if (blockedProviders.includes(domain)) {
    return {
      email,
      isValid: null,
      errorMessage: 'Cannot verify: Provider blocks SMTP validation (e.g., Gmail/Outlook)'
    };
  }

  try {
    const mxRecords = await getMXRecords(domain);
    if (!mxRecords.length) return { email, isValid: false, errorMessage: 'No MX records found' };

    const mailServer = mxRecords[0].exchange;
    const client = new SMTPClient({ host: mailServer, port: 25, secure: false });

    await client.connect();
    await client.greet();
    await client.mail({ from: 'test@example.com' });

    try {
      const response = await client.rcpt({ to: email });
      await client.quit();

      if (response.code >= 400) {
        return { email, isValid: false, errorMessage: response.message };
      }

      return { email, isValid: true, errorMessage: 'Valid email address' };
    } catch (err) {
      await client.quit();
      return { email, isValid: false, errorMessage: 'RCPT TO failed: ' + err.message };
    }

  } catch (err) {
    return { email, isValid: false, errorMessage: 'SMTP error: ' + err.message };
  }
}

// Main endpoint to verify email(s)
app.post('/verify-emails', async (req, res) => {
  try {
    const emails = req.body.emails || [];
    if (!emails.length) return res.status(400).json({ error: "No emails provided" });

    const results = await Promise.all(emails.map(verifyEmail));

    for (const r of results) {
      const status =
        r.isValid === true ? 'Valid'
        : r.isValid === false ? 'Invalid'
        : 'Unverifiable';

      await pool.query(
        'INSERT INTO verification_history (email, status, error_message, verified_at) VALUES ($1, $2, $3, NOW()) ON CONFLICT (email) DO UPDATE SET status = $2, error_message = $3, verified_at = NOW()',
        [r.email, status, r.errorMessage]
      );
    }

    res.json(results);
  } catch (err) {
    console.error("Backend Error:", err);
    res.status(500).send("Internal Server Error");
  }
});

// Health check endpoint
app.get('/', (req, res) => {
  res.send('✅ Email Verifier Backend Running');
});

app.listen(port, () => {
  console.log(`✅ Server running on port ${port}`);
});
