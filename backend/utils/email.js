const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: process.env.EMAIL_PORT,
  secure: process.env.EMAIL_PORT == 465,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

async function sendOTP(email, code, purpose) {
  const subject = purpose === 'registration' ? 'Your Registration OTP' : 'Your Password Reset OTP';
  const text = `Your OTP code is: ${code}. It will expire in 10 minutes.`;

  // If no email config, log to console for development
  if (!process.env.EMAIL_USER) {
    console.log(`[DEV] Email to ${email}: ${text}`);
    return true;
  }

  try {
    await transporter.sendMail({
      from: `"ConnectFlow" <${process.env.EMAIL_USER}>`,
      to: email,
      subject,
      text,
    });
    return true;
  } catch (err) {
    console.error('Email send error:', err);
    return false;
  }
}

module.exports = { sendOTP };
