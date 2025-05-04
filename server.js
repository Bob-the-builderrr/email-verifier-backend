const express = require('express');
const cors = require('cors');
const { SMTPClient } = require('smtp-client');
const dns = require('dns');
const { Pool } = require('pg');

const app = express();
const port = process.env.PORT || 3000;

// PostgreSQL setup using Render credentials
const pool = new Pool({
  user: 'email_verification_db_nvnq_user',
  host: 'dpg-d0bhoo95pdvs73cmehlg-a.oregon-postgres.render.com',
  database: 'email_verification_db_nvnq',
  password: 'FfOsLEvGszsqxcvvu8eV84FK6GRP41kO',
  port: 5432,
  ssl: {
    rejectUnauthorized: false
  }
});

app.use(cors());
app.use(express.json());

// Helper function to get MX records
function getMXRecords(domain) {
  return new Promise((resolve, reject) => {
    dns.resolveMx(domain, (err, addresses) => {
      if (err) {
        reject('Error resolving MX records');
      } else {
        resolve(addresses);
      }
    });
  });
}

// Verify a single email
async function verifyEmail(email) {
  const domain = email.split('@')[1];

  try {
    const mxRecords = await getMXRecords(domain);
    if (!mxRecords.length) {
      return { email, isValid: false, errorMessage: 'No MX records found' };
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
      } else if (response.code >= 500) {
        return { email, isValid: false, errorMessage: 'Hard bounce: ' + response.message };
      }

      return { email, isValid: true, errorMessage: 'Valid email address' };
    } catch (err) {
      await client.quit();
      return { email, isValid: false, errorMessage: 'RCPT TO failed: ' + err.message };
    }

  } catch (err) {
    return { email, isValid: false, errorMessage: 'SMTP check failed: ' + err.message };
  }
}

// Main POST endpoint
app.post('/verify-emails', async (req, res) => {
  const emails = req.body.emails || [];
  const results = await Promise.all(emails.map(verifyEmail));

  // Log to PostgreSQL
  for (const r of results) {
    await pool.query(
      'INSERT INTO verification_history (email, status, error_message, verified_at) VALUES ($1, $2, $3, NOW()) ON CONFLICT (email) DO UPDATE SET status = $2, error_message = $3, verified_at = NOW()',
      [r.email, r.isValid ? 'Valid' : 'Invalid', r.errorMessage]
    );
  }

  res.json(results);
});

// Health check
app.get('/', (req, res) => {
  res.send('Email Verifier Backend Running ✅');
});

app.listen(port, () => {
  console.log(`✅ Server running on port ${port}`);
});
