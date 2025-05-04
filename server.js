const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// 🔁 PostgreSQL setup using Render credentials
const pool = new Pool({
  user: 'your_render_user',         // Replace
  host: 'your_render_host',         // Replace
  database: 'your_render_db_name',  // Replace
  password: 'your_render_password', // Replace
  port: 5432,
});

// 🧱 Create table if not exists
pool.query(`
  CREATE TABLE IF NOT EXISTS verification_history (
    id SERIAL PRIMARY KEY,
    email TEXT NOT NULL,
    is_valid BOOLEAN,
    error_message TEXT,
    verified_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
`);

app.post('/verify-emails', async (req, res) => {
  const emails = req.body.emails;

  const results = await Promise.all(emails.map(async (email) => {
    let isValid = false;
    let errorMessage = '';

    // Dummy validation logic (replace with SMTP logic later)
    if (email.includes('@')) {
      isValid = true;
      errorMessage = 'Valid email address';
    } else {
      errorMessage = 'Invalid email format';
    }

    // Save to PostgreSQL
    await pool.query(
      `INSERT INTO verification_history (email, is_valid, error_message) VALUES ($1, $2, $3)`,
      [email, isValid, errorMessage]
    );

    return { email, isValid, errorMessage };
  }));

  res.json(results);
});

app.listen(port, () => {
  console.log(`🚀 Backend running at http://localhost:${port}`);
});
