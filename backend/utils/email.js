const { Resend } = require('resend');

// Initialize Resend with your API key
const resend = new Resend(process.env.RESEND_API_KEY);

async function sendOTP(email, code, purpose) {
  const subject = purpose === 'registration' ? 'Your Registration OTP' : 'Your Password Reset OTP';
  const text = `Your OTP code is: ${code}. It will expire in 10 minutes.`;

  // If no API key is provided, just log it out (good for local testing)
  if (!process.env.RESEND_API_KEY) {
    console.log(`[DEV] Pretending to send Email to ${email}: ${text}`);
    return true;
  }

  try {
    // Send email using Resend HTTP API (bypasses Render SMTP port blocking)
    const { data, error } = await resend.emails.send({
      from: 'ConnectFlow <onboarding@resend.dev>', // Resend's default testing address
      to: [email],
      subject: subject,
      html: `<p>Your OTP code is: <strong>${code}</strong>. It will expire in 10 minutes.</p>`,
    });

    if (error) {
      console.error('Resend API Error:', error);
      return false;
    }

    console.log('✅ Email sent successfully via Resend:', data);
    return true;
  } catch (err) {
    console.error('Email send exception:', err);
    return false;
  }
}

module.exports = { sendOTP };
