// ============================================
// HAIR CONSULTATION APP - EXPRESS SERVER
// ============================================

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const otpService          = require('./otp');
const googleSheetsService = require('./googleSheets');
const gallaboxService     = require('./gallabox');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── CORS ──────────────────────────────────────────────────
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

// Handle preflight
app.options('*', cors());

app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '50mb' }));

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 }
});

// ── Health ────────────────────────────────────────────────
app.get('/health', (req, res) => {
    res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// ── Send OTP ──────────────────────────────────────────────
app.post('/api/send-otp', async (req, res) => {
    try {
        const { countryCode, phone } = req.body;

        if (!phone) {
            return res.status(400).json({ status: 'error', message: 'Phone number is required' });
        }

        const result = await otpService.sendOTP(countryCode || '+91', phone);
        res.json(result);

    } catch (error) {
        console.error('Error in /api/send-otp:', error);
        res.status(500).json({ status: 'error', message: 'Internal server error' });
    }
});

// ── Verify OTP ────────────────────────────────────────────
app.post('/api/verify-otp', async (req, res) => {
    try {
        const { countryCode, phone, otp } = req.body;

        if (!phone || !otp) {
            return res.status(400).json({ status: 'error', message: 'Phone number and OTP are required' });
        }

        const result = otpService.verifyOTP(countryCode || '+91', phone, otp);
        res.json(result);

    } catch (error) {
        console.error('Error in /api/verify-otp:', error);
        res.status(500).json({ status: 'error', message: 'Internal server error' });
    }
});

// ── Client Login ──────────────────────────────────────────
app.post('/api/client-login', async (req, res) => {
    try {
        const { phone } = req.body;

        if (!phone) {
            return res.status(400).json({ success: false, message: 'Phone number is required' });
        }

        const preConsultResult = await googleSheetsService.checkPreConsultation(phone);
        if (preConsultResult.found) {
            return res.json({
                success: true, hasPreConsultation: true, isNewClient: false,
                data: preConsultResult.data, completeness: preConsultResult.completeness,
                leadId: preConsultResult.leadId
            });
        }

        const leadResult = await googleSheetsService.checkLeaddatabase(phone);
        if (leadResult.found) {
            return res.json({
                success: true, hasPreConsultation: false, isExistingLead: true, isNewClient: false,
                data: leadResult.data, consultationType: leadResult.consultationType,
                leadId: leadResult.leadId
            });
        }

        return res.json({ success: true, hasPreConsultation: false, isExistingLead: false, isNewClient: true });

    } catch (error) {
        console.error('Error in /api/client-login:', error);
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
});

// ── Save Consultation ─────────────────────────────────────
app.post('/api/save-consultation', async (req, res) => {
    try {
        const formData = req.body;

        if (!formData.phone && !formData.whatsapp) {
            return res.status(400).json({ success: false, message: 'Phone number is required' });
        }

        const result = await googleSheetsService.saveConsultationData(formData);
        res.json(result);

    } catch (error) {
        console.error('Error in /api/save-consultation:', error);
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
});

// ── Gallabox Message Status ───────────────────────────────
app.get('/api/gallabox-status/:messageId', async (req, res) => {
    try {
        const result = await gallaboxService.getMessageStatus(req.params.messageId);
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// ── Video Consultation Response ───────────────────────────
app.post('/api/video-consultation-response', async (req, res) => {
    try {
        const { leadId, phone, clientName, response } = req.body;
        const result = await googleSheetsService.saveVideoConsultationResponse(leadId, phone, clientName, response);
        res.json(result);
    } catch (error) {
        console.error('Error in /api/video-consultation-response:', error);
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
});

// ── Serve index.html for ALL other routes ─────────────────
app.get('*', (req, res) => {
    const indexPath = path.join(__dirname, 'index.html');

    // Check if file exists
    if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
    } else {
        res.status(404).send('index.html not found. Make sure it is in the root directory.');
    }
});

// ── Error handler ─────────────────────────────────────────
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ success: false, message: 'Internal server error' });
});

// ── Start ─────────────────────────────────────────────────
if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`✅ Server running on port ${PORT}`);
        console.log(`🌐 Environment: ${process.env.NODE_ENV || 'development'}`);
        console.log(`📁 Serving index.html from: ${path.join(__dirname, 'index.html')}`);
        console.log(`📊 Google Sheets: ${process.env.GOOGLE_SHEETS_ID ? '✅' : '❌ NOT SET'}`);
        console.log(`📱 Gallabox: ${process.env.GALLABOX_API_KEY ? '✅' : '❌ NOT SET'}`);
    });
}

module.exports = app;

process.on('SIGTERM', () => { console.log('SIGTERM received'); process.exit(0); });
process.on('SIGINT',  () => { console.log('SIGINT received');  process.exit(0); });
