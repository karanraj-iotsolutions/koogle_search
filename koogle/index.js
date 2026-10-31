import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import multer from 'multer';
import bcrypt from 'bcryptjs';
import nodemailer from 'nodemailer';
import { v4 as uuidv4 } from 'uuid';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, PutCommand, GetCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;
const REGION = process.env.AWS_REGION || 'ap-south-1';
const TABLE_NAME = process.env.DYNAMODB_TABLE_NAME || 'koogle_documents';
const USERS_TABLE_NAME = process.env.DYNAMODB_USERS_TABLE_NAME || 'koogle_users';
const BUCKET_NAME = process.env.S3_BUCKET_NAME || 'koogle_doc';

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
}));
app.options('*', cors());
app.use(express.json());

// Memory storage for multer to stream file buffer directly to S3
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB file limit
});

// Configure AWS credentials (falls back to EC2 IAM Role if keys are omitted)
const awsConfig = { region: REGION };
if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
  awsConfig.credentials = {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  };
}

const s3 = new S3Client(awsConfig);
const ddbClient = new DynamoDBClient(awsConfig);
const ddb = DynamoDBDocumentClient.from(ddbClient);

// Configure Gmail SMTP for sending OTP emails
const SMTP_EMAIL = process.env.SMTP_EMAIL || 'support.kooglesearch@gmail.com';
const SMTP_PASS = (process.env.SMTP_PASS || 'vneccxkgyyddnpxk').replace(/\s+/g, '');

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: SMTP_EMAIL,
    pass: SMTP_PASS,
  },
});

// In-memory OTP storage: email -> { otp, expiresAt, username }
const otpStore = new Map();

// ----------------------------------------------------
// Health check
// ----------------------------------------------------
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'koogle-drive-backend', time: new Date() });
});

// ----------------------------------------------------
// 1. LOGIN API (DynamoDB `koogle_users` with auto-Super Admin)
// ----------------------------------------------------
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    const cleanUsername = username.trim();

    // Check if any users exist in koogle_users
    const allUsers = await ddb.send(
      new ScanCommand({
        TableName: USERS_TABLE_NAME,
        Limit: 1,
      })
    );
    const count = allUsers.Count || (allUsers.Items ? allUsers.Items.length : 0);

    // If table has no users yet, the first login is automatically registered as Super Admin!
    if (count === 0) {
      // Hash password with bcrypt before saving to DynamoDB
      const hashedPassword = await bcrypt.hash(password, 10);

      const superAdminUser = {
        username: cleanUsername,
        email: 'support.kooglesearch@gmail.com',
        password: hashedPassword,
        role: 'super_admin',
        access: ['upload', 'edit', 'delete', 'download', 'share'],
        createdAt: new Date().toISOString(),
      };

      await ddb.send(
        new PutCommand({
          TableName: USERS_TABLE_NAME,
          Item: superAdminUser,
        })
      );

      console.log(`Initialized first Super Admin user with bcrypt hash: ${cleanUsername}`);
      return res.json({
        success: true,
        user: superAdminUser.username,
        role: 'super_admin',
        access: superAdminUser.access,
        email: superAdminUser.email,
        message: 'Super Admin account initialized successfully!',
      });
    }

    // Lookup user in DynamoDB
    const userResult = await ddb.send(
      new GetCommand({
        TableName: USERS_TABLE_NAME,
        Key: { username: cleanUsername },
      })
    );

    const userRecord = userResult.Item;
    if (!userRecord) {
      return res.status(401).json({ error: 'User not found' });
    }

    // Compare entered password with bcrypt hash stored in DynamoDB
    const isPasswordValid = await bcrypt.compare(password, userRecord.password);
    if (!isPasswordValid) {
      return res.status(401).json({ error: 'Incorrect password' });
    }

    const userAccess = userRecord.role === 'super_admin'
      ? ['upload', 'edit', 'delete', 'download', 'share']
      : (userRecord.access || []);

    return res.json({
      success: true,
      user: userRecord.username,
      role: userRecord.role || 'user',
      access: userAccess,
      email: userRecord.email || '',
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Authentication failed', details: err.message });
  }
});

// ----------------------------------------------------
// USER MANAGEMENT API (Super Admin / Admin)
// ----------------------------------------------------
app.get('/api/users', async (req, res) => {
  try {
    const data = await ddb.send(new ScanCommand({ TableName: USERS_TABLE_NAME }));
    const users = (data.Items || []).map((u) => ({
      username: u.username,
      email: u.email || '',
      role: u.role || 'user',
      access:
        u.role === 'super_admin'
          ? ['upload', 'edit', 'delete', 'download', 'share']
          : u.access || [],
      createdAt: u.createdAt || '',
    }));
    users.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    res.json(users);
  } catch (err) {
    console.error('Fetch users error:', err);
    res.status(500).json({ error: 'Failed to fetch users', details: err.message });
  }
});

app.post('/api/users', async (req, res) => {
  try {
    const { email, username, password, role, access } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    const cleanUsername = username.trim();

    // Check if user already exists
    const existing = await ddb.send(
      new GetCommand({
        TableName: USERS_TABLE_NAME,
        Key: { username: cleanUsername },
      })
    );

    if (existing.Item) {
      return res.status(400).json({ error: 'Username already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = {
      username: cleanUsername,
      email: email ? email.trim() : '',
      password: hashedPassword,
      role: role || 'admin',
      access: Array.isArray(access) ? access : [],
      createdAt: new Date().toISOString(),
    };

    await ddb.send(
      new PutCommand({
        TableName: USERS_TABLE_NAME,
        Item: newUser,
      })
    );

    res.status(201).json({
      username: newUser.username,
      email: newUser.email,
      role: newUser.role,
      access: newUser.access,
      createdAt: newUser.createdAt,
    });
  } catch (err) {
    console.error('Create user error:', err);
    res.status(500).json({ error: 'Failed to create user', details: err.message });
  }
});

app.put('/api/users/:username', async (req, res) => {
  try {
    const { username } = req.params;
    const { email, password, role, access } = req.body;

    const existing = await ddb.send(
      new GetCommand({
        TableName: USERS_TABLE_NAME,
        Key: { username },
      })
    );

    if (!existing.Item) {
      return res.status(404).json({ error: 'User not found' });
    }

    const updatedUser = {
      ...existing.Item,
      email: email !== undefined ? email.trim() : existing.Item.email,
      role: existing.Item.role === 'super_admin' ? 'super_admin' : (role || existing.Item.role),
      access:
        existing.Item.role === 'super_admin'
          ? ['upload', 'edit', 'delete', 'download', 'share']
          : (Array.isArray(access) ? access : existing.Item.access),
      updatedAt: new Date().toISOString(),
    };

    // If new password is provided, hash with bcrypt
    if (password && password.trim().length > 0) {
      if (password.trim().length < 6) {
        return res.status(400).json({ error: 'Password must be at least 6 characters' });
      }
      updatedUser.password = await bcrypt.hash(password.trim(), 10);
    }

    await ddb.send(
      new PutCommand({
        TableName: USERS_TABLE_NAME,
        Item: updatedUser,
      })
    );

    res.json({
      success: true,
      username: updatedUser.username,
      email: updatedUser.email,
      role: updatedUser.role,
      access: updatedUser.access,
      message: 'User updated successfully',
    });
  } catch (err) {
    console.error('Update user error:', err);
    res.status(500).json({ error: 'Failed to update user', details: err.message });
  }
});

app.delete('/api/users/:username', async (req, res) => {
  try {
    const { username } = req.params;
    const user = await ddb.send(
      new GetCommand({
        TableName: USERS_TABLE_NAME,
        Key: { username },
      })
    );

    if (!user.Item) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (user.Item.role === 'super_admin') {
      return res.status(403).json({ error: 'Cannot delete Super Admin account' });
    }

    await ddb.send(
      new DeleteCommand({
        TableName: USERS_TABLE_NAME,
        Key: { username },
      })
    );

    res.json({ success: true, message: `User ${username} deleted successfully` });
  } catch (err) {
    console.error('Delete user error:', err);
    res.status(500).json({ error: 'Failed to delete user', details: err.message });
  }
});

// ----------------------------------------------------
// EDIT DOCUMENT (Metadata update)
// ----------------------------------------------------
app.put('/api/documents/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { date, issuer, circularNo, subject, remarks } = req.body;

    const existing = await ddb.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: { id },
      })
    );

    if (!existing.Item) {
      return res.status(404).json({ error: 'Document not found' });
    }

    const updated = {
      ...existing.Item,
      date: date || existing.Item.date,
      issuer: issuer || existing.Item.issuer,
      circularNo: circularNo || existing.Item.circularNo,
      subject: subject || existing.Item.subject,
      remarks: remarks !== undefined ? remarks : existing.Item.remarks,
      updatedAt: new Date().toISOString(),
    };

    await ddb.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: updated,
      })
    );

    res.json(updated);
  } catch (err) {
    console.error('Update document error:', err);
    res.status(500).json({ error: 'Failed to update document', details: err.message });
  }
});

// ----------------------------------------------------
// 2. GET ALL DOCUMENTS (DynamoDB)
// ----------------------------------------------------
app.get('/api/documents', async (req, res) => {
  try {
    const data = await ddb.send(new ScanCommand({ TableName: TABLE_NAME }));
    const items = data.Items || [];
    // Sort descending by date
    items.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
    res.json(items);
  } catch (err) {
    console.error('DynamoDB Scan Error:', err);
    res.status(500).json({ error: 'Failed to retrieve documents from DynamoDB', details: err.message });
  }
});

// ----------------------------------------------------
// 3. UPLOAD DOCUMENT (S3 + DynamoDB)
// ----------------------------------------------------
app.post('/api/documents/upload', upload.single('file'), async (req, res) => {
  try {
    const { date, issuer, circularNo, subject, remarks } = req.body;
    const file = req.file;

    const id = uuidv4();
    let s3Key = null;
    let fileName = 'No File Attached';

    // Upload attachment to S3 if present
    if (file) {
      fileName = file.originalname;
      const cleanFileName = fileName.replace(/\s+/g, '_');
      s3Key = `uploads/${Date.now()}_${cleanFileName}`;

      const uploadMime = (file.mimetype && file.mimetype !== 'application/octet-stream')
        ? file.mimetype
        : getMimeType(fileName);

      await s3.send(
        new PutObjectCommand({
          Bucket: BUCKET_NAME,
          Key: s3Key,
          Body: file.buffer,
          ContentType: uploadMime,
        })
      );
    }

    // Save metadata record into DynamoDB
    const documentRecord = {
      id,
      date: date || new Date().toISOString().split('T')[0],
      issuer: issuer || 'General',
      circularNo: circularNo || 'N/A',
      subject: subject || 'Untitled',
      remarks: remarks || '-',
      fileName,
      s3Key,
      uploadedAt: new Date().toISOString(),
    };

    await ddb.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: documentRecord,
      })
    );

    res.status(201).json(documentRecord);
  } catch (err) {
    console.error('Upload Error:', err);
    res.status(500).json({ error: 'Upload failed', details: err.message });
  }
});

// Helper function to resolve MIME type from filename/extension
function getMimeType(filename) {
  if (!filename) return 'application/pdf';
  const ext = filename.split('.').pop().toLowerCase();
  switch (ext) {
    case 'pdf':
      return 'application/pdf';
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'gif':
      return 'image/gif';
    case 'webp':
      return 'image/webp';
    case 'svg':
      return 'image/svg+xml';
    case 'txt':
    case 'log':
      return 'text/plain; charset=utf-8';
    case 'html':
    case 'htm':
      return 'text/html; charset=utf-8';
    case 'csv':
      return 'text/csv; charset=utf-8';
    case 'json':
      return 'application/json; charset=utf-8';
    case 'doc':
      return 'application/msword';
    case 'docx':
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    case 'xls':
      return 'application/vnd.ms-excel';
    case 'xlsx':
      return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    case 'ppt':
      return 'application/vnd.ms-powerpoint';
    case 'pptx':
      return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
    default:
      return 'application/octet-stream';
  }
}

// ----------------------------------------------------
// 4. PRE-SIGNED S3 URL FOR VIEW OR DOWNLOAD
// ----------------------------------------------------
app.get('/api/documents/url', async (req, res) => {
  try {
    const { s3Key, action } = req.query;
    if (!s3Key) {
      return res.status(400).json({ error: 's3Key query parameter is required' });
    }

    const mime = getMimeType(s3Key);
    const commandParams = {
      Bucket: BUCKET_NAME,
      Key: s3Key,
    };

    if (action === 'download') {
      commandParams.ResponseContentDisposition = 'attachment';
    } else {
      commandParams.ResponseContentDisposition = 'inline';
      if (mime !== 'application/octet-stream') {
        commandParams.ResponseContentType = mime;
      }
    }

    const command = new GetObjectCommand(commandParams);
    const preSignedUrl = await getSignedUrl(s3, command, { expiresIn: 3600 });
    res.json({ url: preSignedUrl, mimeType: mime });
  } catch (err) {
    console.error('Pre-signed URL Error:', err);
    res.status(500).json({ error: 'Could not generate URL', details: err.message });
  }
});

// ----------------------------------------------------
// DIRECT STREAM / VIEW DOCUMENT (PDF, Images, Word, Text)
// ----------------------------------------------------
app.get('/api/documents/view', async (req, res) => {
  try {
    const { s3Key, download } = req.query;
    if (!s3Key) {
      return res.status(400).json({ error: 's3Key query parameter is required' });
    }

    const mime = getMimeType(s3Key);
    const fileName = s3Key.split('/').pop().replace(/^\d+_/, '') || 'document';

    const s3Response = await s3.send(
      new GetObjectCommand({
        Bucket: BUCKET_NAME,
        Key: s3Key,
      })
    );

    const disposition = download === 'true'
      ? `attachment; filename="${encodeURIComponent(fileName)}"`
      : `inline; filename="${encodeURIComponent(fileName)}"`;

    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Disposition', disposition);

    s3Response.Body.pipe(res);
  } catch (err) {
    console.error('Document view stream error:', err);
    res.status(500).json({ error: 'Failed to stream document', details: err.message });
  }
});

// ----------------------------------------------------
// 5. DELETE DOCUMENT (DynamoDB + S3)
// ----------------------------------------------------
app.delete('/api/documents/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { s3Key } = req.query;

    if (s3Key && s3Key !== 'null') {
      try {
        await s3.send(
          new DeleteObjectCommand({
            Bucket: BUCKET_NAME,
            Key: s3Key,
          })
        );
      } catch (s3Err) {
        console.warn('S3 file delete warning:', s3Err.message);
      }
    }

    await ddb.send(
      new DeleteCommand({
        TableName: TABLE_NAME,
        Key: { id },
      })
    );

    res.json({ success: true, message: 'Document deleted successfully' });
  } catch (err) {
    console.error('Delete Error:', err);
    res.status(500).json({ error: 'Failed to delete document', details: err.message });
  }
});

// ----------------------------------------------------
// FORGOT PASSWORD / OTP API
// ----------------------------------------------------

// 1. Send OTP to User Email
app.post('/api/forgot-password/send-otp', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email || !email.trim()) {
      return res.status(400).json({ error: 'Email address is required' });
    }

    const cleanEmail = email.trim().toLowerCase();

    // Find user in DynamoDB by email or username
    const allUsers = await ddb.send(new ScanCommand({ TableName: USERS_TABLE_NAME }));
    let userMatch = (allUsers.Items || []).find(
      (u) =>
        (u.email && u.email.toLowerCase() === cleanEmail) ||
        u.username.toLowerCase() === cleanEmail
    );

    // If matching by email failed, but it's support.kooglesearch@gmail.com, find super_admin
    if (!userMatch && (cleanEmail === 'support.kooglesearch@gmail.com' || cleanEmail.includes('support.koogle'))) {
      userMatch = (allUsers.Items || []).find((u) => u.role === 'super_admin') || (allUsers.Items || [])[0];
    }

    if (!userMatch) {
      return res.status(404).json({ error: 'No account found with this email or username' });
    }

    const recipientEmail = (cleanEmail.includes('@') && cleanEmail.includes('.')) ? cleanEmail : (userMatch.email || 'support.kooglesearch@gmail.com');

    // Generate 6-digit numeric OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes

    otpStore.set(cleanEmail, {
      otp,
      expiresAt,
      username: userMatch.username,
    });

    // Send email via Gmail SMTP
    const mailOptions = {
      from: `"Koogle Support" <${SMTP_EMAIL}>`,
      to: recipientEmail,
      subject: 'Koogle Drive - Password Reset OTP Code',
      html: `
        <div style="font-family: Calibri, sans-serif; font-size: 12pt; color: #18181b; padding: 24px; max-width: 500px; border: 1px solid #e5e7eb; border-radius: 8px;">
          <h2 style="color: #18181b; margin-bottom: 8px; font-weight: normal;">Password Reset Request</h2>
          <p style="color: #555555; margin-bottom: 16px;">Hello <strong>${userMatch.username}</strong>,</p>
          <p style="color: #555555; margin-bottom: 20px;">Use the following One-Time Password (OTP) to reset your account password. This code is valid for <strong>10 minutes</strong>.</p>
          <div style="background-color: #f4f4f5; padding: 14px 20px; font-size: 24pt; font-weight: bold; letter-spacing: 6px; text-align: center; border-radius: 6px; color: #18181b; margin-bottom: 20px;">
            ${otp}
          </div>
          <p style="color: #71717a; font-size: 10pt;">If you did not request a password reset, please ignore this email.</p>
          <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;" />
          <p style="color: #9ca3af; font-size: 9.5pt;">Koogle Search Document Vault • Support Team</p>
        </div>
      `,
    };

    await transporter.sendMail(mailOptions);
    console.log(`Password reset OTP sent to: ${recipientEmail}`);

    res.json({
      success: true,
      message: `OTP sent successfully to ${recipientEmail}`,
    });
  } catch (err) {
    console.error('Send OTP Error:', err);
    res.status(500).json({
      error: 'Failed to send OTP email',
      details: err.message,
    });
  }
});

// 2. Verify OTP
app.post('/api/forgot-password/verify-otp', (req, res) => {
  const { email, otp } = req.body;
  if (!email || !otp) {
    return res.status(400).json({ error: 'Email and OTP are required' });
  }

  const cleanEmail = email.trim().toLowerCase();
  const entry = otpStore.get(cleanEmail);

  if (!entry) {
    return res.status(400).json({ error: 'OTP expired or not requested. Please request a new OTP.' });
  }

  if (Date.now() > entry.expiresAt) {
    otpStore.delete(cleanEmail);
    return res.status(400).json({ error: 'OTP has expired. Please request a new OTP.' });
  }

  if (entry.otp !== otp.trim()) {
    return res.status(400).json({ error: 'Invalid OTP code. Please check and try again.' });
  }

  res.json({
    success: true,
    message: 'OTP verified successfully.',
    username: entry.username,
  });
});

// 3. Reset Password
app.post('/api/forgot-password/reset', async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body;
    if (!email || !otp || !newPassword) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const cleanEmail = email.trim().toLowerCase();
    const entry = otpStore.get(cleanEmail);

    if (!entry || entry.otp !== otp.trim()) {
      return res.status(400).json({ error: 'OTP verification failed or expired.' });
    }

    // Encrypt new password with bcrypt
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Fetch existing user to keep role & metadata intact
    const userRes = await ddb.send(
      new GetCommand({
        TableName: USERS_TABLE_NAME,
        Key: { username: entry.username },
      })
    );

    if (!userRes.Item) {
      return res.status(404).json({ error: 'User not found in database' });
    }

    const updatedUser = {
      ...userRes.Item,
      password: hashedPassword,
      updatedAt: new Date().toISOString(),
    };

    await ddb.send(
      new PutCommand({
        TableName: USERS_TABLE_NAME,
        Item: updatedUser,
      })
    );

    // Remove OTP from memory
    otpStore.delete(cleanEmail);
    console.log(`Password reset completed for user: ${entry.username}`);

    res.json({
      success: true,
      message: 'Password reset successfully! You can now log in with your new password.',
    });
  } catch (err) {
    console.error('Password reset error:', err);
    res.status(500).json({ error: 'Failed to reset password', details: err.message });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Backend server running on port ${PORT}`);
  console.log(`Region: ${REGION} | DynamoDB Table: ${TABLE_NAME} | S3 Bucket: ${BUCKET_NAME}`);
});

