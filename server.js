const express = require('express');
const cors = require('cors');
const { SMTPClient } = require('smtp-client');
const dns = require('dns');
const https = require('https');
const { Pool } = require('pg');

const app = express();
const port = process.env.PORT || 3000;

// PostgreSQL connection config (Render DB)
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

// Get your public IP using ipify
function getPublicIP() {
  return new Promise((resolve, reject) => {
    https.get('https://api.ipify.org?format=json', (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const ip = JSON.parse(data).ip;
          resolve(ip);
        } catch (err) {
          reject('Failed to parse public IP');
        }
      });
    }).on('error', reject);
  });
}

// Lookup MX records
function getMXRecords(domain) {
  return new Promise((resolve, reject) => {
    dns.resolveMx(domain, (err, addresses) => {
      if (err) reject('Error resolving MX records');
      else resolve(addresses);
    });
  });
}

// Core verification logic
async function verifyEmail(email) {
  const domain = email.split('@')[1].toLowerCase();
  const blockedProviders = ['gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'yahoo.com', 'zoho.com'];

  const senderIP = await getPublicIP();

  // Providers like Gmail/Outlook block SMTP probe
  if (blockedProviders.includes(domain)) {
    return {
      email,
      isValid: null,
      errorMessage: 'Cannot verify: Provider blocks SMTP validation (e.g., Gmail/Outlook)',
      ipUsed: senderIP
    };
  }

  try {
    const mxRecords = await getMXRecords(domain);
    if (!mxRecords.length) {
      return { email, isValid: false, errorMessage: 'No MX records found', ipUsed: senderIP };
    }

    const mailServer = mxRecords[0].exchange;
    const client = new SMTPClient({ host: mailServer, port: 25, secure: false });

    await client.connect();
    await client.greet();
    await client.mail({ from: 'test@example.com' });

    try {
      const response = await client.rcpt({ to: email });
      await client.quit();

      if (response.code >= 400) {
        return { email, isValid: false, errorMessage: response.message, ipUsed: senderIP };
      }

      return { email, isValid: true, errorMessage: 'Valid email address', ipUsed: senderIP };
    } catch (err) {
      await client.quit();
      return { email, isValid: false, errorMessage: 'RCPT TO failed: ' + err.message, ipUsed: senderIP };
    }

  } catch (err) {
    return { email, isValid: false, errorMessage: 'SMTP error: ' + err.message, ipUsed: senderIP };
  }
}

// Endpoint to verify emails
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
        `INSERT INTO verification_history (email, status, error_message, verified_at, ip_used)
         VALUES ($1, $2, $3, NOW(), $4)
         ON CONFLICT (email)
         DO UPDATE SET status = $2, error_message = $3, verified_at = NOW(), ip_used = $4`,
        [r.email, status, r.errorMessage, r.ipUsed || null]
      );
    }

    res.json(results);
  } catch (err) {
    console.error("Backend Error:", err);
    res.status(500).send("Internal Server Error");
  }
});

// Health check
app.get('/', (req, res) => {
  res.send('✅ Email Verifier Backend Running');
});

app.listen(port, () => {
  console.log(`✅ Server running on port ${port}`);
});
