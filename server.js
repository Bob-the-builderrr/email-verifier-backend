const express = require('express');
const cors = require('cors');
const { SMTPClient } = require('smtp-client');
const dns = require('dns');
const { Pool } = require('pg');

const app = express();
const port = process.env.PORT || 3000;

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

function getMXRecords(domain) {
  return new Promise((resolve, reject) => {
    dns.resolveMx(domain, (err, addresses) => {
      if (err) reject('Error resolving MX records');
      else resolve(addresses);
    });
  });
}

async function verifyEmail(email) {
  const domain = email.split('@')[1];

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

      return { email, isValid: true, errorMessage: 'Valid email' };
    } catch (err) {
      await client.quit();
      return { email, isValid: false, errorMessage: 'RCPT failed: ' + err.message };
    }

  } catch (err) {
    return { email, isValid: false, errorMessage: 'SMTP error: ' + err.message };
  }
}

app.post('/verify-emails', async (req, res) => {
  try {
    const emails = req.body.emails || [];
    if (!emails.length) return res.status(400).json({ error: "No emails provided" });

    const results = await Promise.all(emails.map(verifyEmail));

    for (const r of results) {
      await pool.query(
        'INSERT INTO verification_history (email, status, error_message, verified_at) VALUES ($1, $2, $3, NOW()) ON CONFLICT (email) DO UPDATE SET status = $2, error_message = $3, verified_at = NOW()',
        [r.email, r.isValid ? 'Valid' : 'Invalid', r.errorMessage]
      );
    }

    res.json(results);
  } catch (err) {
    console.error("Backend Error:", err);
    res.status(500).send("Internal Server Error");
  }
});

app.get('/', (req, res) => {
  res.send('Email Verifier Backend Running ✅');
});

app.listen(port, () => {
  console.log(`✅ Server running on port ${port}`);
});
