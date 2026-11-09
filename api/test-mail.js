import nodemailer from 'nodemailer';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  return res.status(200).json({ 
    status: 'Ready',
    userConfigured: !!process.env.EMAIL_SMTP_USER,
    passConfigured: !!process.env.EMAIL_SMTP_PASS 
  });
}