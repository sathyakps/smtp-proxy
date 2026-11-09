import nodemailer from 'nodemailer';
import crypto from 'crypto';

// Simple email validation regex
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function parseAndValidateEmails(input) {
  if (!input) return [];
  const list = Array.isArray(input) 
    ? input 
    : String(input).split(',').map(e => e.trim());
  
  const cleaned = list.map(e => String(e).trim()).filter(Boolean);
  for (const email of cleaned) {
    if (!EMAIL_REGEX.test(email)) {
      return null; // Signals invalid email format
    }
  }
  return cleaned;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // 1. Check Request Size Cap (e.g., max 100KB)
  const contentLength = parseInt(req.headers['content-length'] || '0', 10);
  if (contentLength > 100 * 1024) {
    return res.status(413).json({ error: 'Payload too large' });
  }

  // 2. Authentication: Require Bearer token, fail closed if key is missing
  const serverApiKey = process.env.EMAIL_API_KEY;
  const authHeader = req.headers['authorization'];

  if (!serverApiKey || !authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const clientToken = authHeader.split(' ')[1];
  let isAuthorized = false;
  try {
    if (clientToken.length === serverApiKey.length) {
      isAuthorized = crypto.timingSafeEqual(
        Buffer.from(clientToken), 
        Buffer.from(serverApiKey)
      );
    }
  } catch (err) {
    isAuthorized = false;
  }

  if (!isAuthorized) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // 3. Extract and Validate Fields
  const { recipient, subject, message, html, cc, bcc, replyTo, senderName } = req.body || {};

  if (!subject || typeof subject !== 'string' || !subject.trim()) {
    return res.status(400).json({ error: 'Invalid or missing subject' });
  }

  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'Invalid or missing message body' });
  }

  const toList = parseAndValidateEmails(recipient);
  const ccList = parseAndValidateEmails(cc);
  const bccList = parseAndValidateEmails(bcc);

  if (!toList || toList.length === 0 || ccList === null || bccList === null) {
    return res.status(400).json({ error: 'Malformed or invalid email addresses in recipient, cc, or bcc' });
  }

  // Cap recipient count (e.g. max 50 total recipients)
  const totalRecipientsCount = toList.length + ccList.length + bccList.length;
  if (totalRecipientsCount > 50) {
    return res.status(400).json({ error: 'Recipient count exceeds maximum limit of 50' });
  }

  let validatedReplyTo = undefined;
  if (replyTo) {
    if (typeof replyTo !== 'string' || !EMAIL_REGEX.test(replyTo.trim())) {
      return res.status(400).json({ error: 'Invalid replyTo address' });
    }
    validatedReplyTo = replyTo.trim();
  }

  // 4. Configure Sender Address (Enforce server-controlled sender)
  const fromEmail = process.env.EMAIL_FROM_ADDRESS || process.env.GMAIL_USER;
  const displayName = typeof senderName === 'string' && senderName.trim() ? senderName.trim() : 'Vercel App';

  const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_PASS,
    },
  });

  try {
    const mailOptions = {
      from: `"${displayName}" <${fromEmail}>`,
      to: toList.join(', '),
      subject: subject.trim(),
      text: message,
    };

    if (html && typeof html === 'string') {
      mailOptions.html = html;
    }
    if (ccList.length > 0) {
      mailOptions.cc = ccList.join(', ');
    }
    if (bccList.length > 0) {
      mailOptions.bcc = bccList.join(', ');
    }
    if (validatedReplyTo) {
      mailOptions.replyTo = validatedReplyTo;
    }

    const info = await transporter.sendMail(mailOptions);

    // 5. Success Response (Do not log message bodies or secrets)
    return res.status(200).json({
      ok: true,
      messageId: info.messageId,
    });

  } catch (error) {
    // Return generic 502 for provider failures, avoiding internal error leaks
    return res.status(502).json({
      ok: false,
      error: 'Failed to deliver email through provider',
    });
  }
}