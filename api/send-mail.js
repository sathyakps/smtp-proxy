import nodemailer from 'nodemailer';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Only POST requests allowed' });
  }

  const { recipient, subject, message } = req.body;

  if (!recipient || !subject || !message) {
    return res.status(400).json({ error: 'Missing required fields: recipient, subject, message' });
  }

  // 1. Create the transporter pointing to Gmail over port 465
  const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true, // Use SSL
    auth: {
      user: process.env.EMAIL_SMTP_USER,
      pass: process.env.EMAIL_SMTP_PASS, // Your 16-character Gmail App Password
    },
  });

  try {
    // 2. Await the send operation so Vercel doesn't kill the function early
    const info = await transporter.sendMail({
      from: `"Vercel App Test" <${process.env.EMAIL_SMTP_USER}>`,
      to: recipient,
      subject: subject,
      text: message,
    });

    return res.status(200).json({ 
      success: true, 
      messageId: info.messageId 
    });

  } catch (error) {
    console.error('SMTP Error:', error);
    return res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
}