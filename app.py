from flask import Flask, request, jsonify, send_file
from flask_cors import CORS
import smtplib
import dns.resolver
import csv
import os

app = Flask(__name__)
CORS(app)

def smtp_check(email):
    domain = email.split('@')[-1]
    try:
        # Get MX record
        mx_records = dns.resolver.resolve(domain, 'MX')
        mx_record = str(mx_records[0].exchange).rstrip('.')

        # SMTP handshake
        server = smtplib.SMTP(timeout=10)
        server.connect(mx_record)
        server.helo("example.com")
        server.mail("test@example.com")
        code, message = server.rcpt(email)
        server.quit()

        if code == 250 or code == 251:
            return True, ""
        else:
            return False, f"SMTP response: {code} {message.decode()}"
    except Exception as e:
        return False, str(e)

@app.route('/verify', methods=['POST'])
def verify_emails():
    data = request.get_json()
    emails = data.get('emails', [])
    results = []

    for email in emails:
        valid, error = smtp_check(email)
        results.append({
            'email': email,
            'status': 'Valid' if valid else 'Invalid',
            'error': '' if valid else error
        })

    return jsonify(results)

@app.route('/upload', methods=['POST'])
def upload_csv():
    file = request.files['file']
    path = os.path.join('uploads', file.filename)
    file.save(path)

    results = []
    with open(path, newline='') as csvfile:
        reader = csv.reader(csvfile)
        for row in reader:
            email = row[0]
            valid, error = smtp_check(email)
            results.append([email, 'Valid' if valid else 'Invalid', '' if valid else error])

    result_path = os.path.join('uploads', 'results.csv')
    with open(result_path, 'w', newline='') as f:
        writer = csv.writer(f)
        writer.writerow(['Email', 'Status', 'Error'])
        writer.writerows(results)

    return send_file(result_path, as_attachment=True)

if __name__ == '__main__':
    app.run(debug=True)
