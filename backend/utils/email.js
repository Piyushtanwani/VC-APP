async function sendOTP(email, code, purpose) {
  const subject = purpose === 'registration' ? 'Your Registration OTP' : 'Your Password Reset OTP';
  const text = `Your OTP code is: ${code}. It will expire in 10 minutes.`;

  // Provide a fallback for local testing
  if (!process.env.BREVO_API_KEY) {
    console.log(`[DEV] Pretending to send Email to ${email}: ${text}`);
    return true;
  }

  try {
    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'api-key': process.env.BREVO_API_KEY
      },
      body: JSON.stringify({
        sender: { 
          name: 'ConnectFlow App', 
          // Brevo requires the sender email to be verified in their dashboard!
          email: process.env.EMAIL_USER || 'no-reply@connectflow.com' 
        },
        to: [{ email: email }],
        subject: subject,
        htmlContent: `<p>Your OTP code is: <strong>${code}</strong>. It will expire in 10 minutes.</p>`
      })
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Brevo API Error:', data);
      return false;
    }

    console.log('✅ Email sent successfully via Brevo to', email);
    return true;
  } catch (err) {
    console.error('Email send exception:', err);
    return false;
  }
}

module.exports = { sendOTP };
