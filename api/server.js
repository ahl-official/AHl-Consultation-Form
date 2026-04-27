require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const bodyParser = require('body-parser');
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');

const app  = express();
const PORT = process.env.PORT || 3000;

// Read index.html once at startup — works in Vercel serverless
const INDEX_PATH = path.join(__dirname, 'index.html');
let indexHtml = null;
try {
    indexHtml = fs.readFileSync(INDEX_PATH, 'utf8');
    console.log('index.html loaded OK');
} catch(e) {
    console.error('WARN: index.html not found at', INDEX_PATH);
}

// Lazy-load services
let otpService, sheetsService, gallaboxService;
try { otpService      = require('./otp');          } catch(e) { console.error('otp:',      e.message); }
try { sheetsService   = require('./googleSheets'); } catch(e) { console.error('sheets:',   e.message); }
try { gallaboxService = require('./gallabox');     } catch(e) { console.error('gallabox:', e.message); }

app.use(cors({ origin: '*', methods: ['GET','POST','PUT','DELETE','OPTIONS'], allowedHeaders: ['Content-Type','Authorization'] }));
app.options('*', cors());
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '50mb' }));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// Health
app.get('/health', (req, res) => res.json({
    status: 'OK',
    htmlLoaded: !!indexHtml,
    dirname: __dirname,
    sheets: !!process.env.GOOGLE_SHEETS_ID,
    gallabox: !!process.env.GALLABOX_API_KEY
}));

// Send OTP
app.post('/api/send-otp', async (req, res) => {
    try {
        if (!otpService) return res.status(503).json({ status: 'error', message: 'OTP service unavailable' });
        const { countryCode, phone } = req.body;
        if (!phone) return res.status(400).json({ status: 'error', message: 'Phone required' });
        res.json(await otpService.sendOTP(countryCode || '+91', phone));
    } catch(e) { res.status(500).json({ status: 'error', message: e.message }); }
});

// Verify OTP
app.post('/api/verify-otp', async (req, res) => {
    try {
        if (!otpService) return res.status(503).json({ status: 'error', message: 'OTP service unavailable' });
        const { countryCode, phone, otp } = req.body;
        if (!phone || !otp) return res.status(400).json({ status: 'error', message: 'Phone and OTP required' });
        res.json(otpService.verifyOTP(countryCode || '+91', phone, otp));
    } catch(e) { res.status(500).json({ status: 'error', message: e.message }); }
});

// Client Login
app.post('/api/client-login', async (req, res) => {
    try {
        if (!sheetsService) return res.status(503).json({ success: false, message: 'Sheets service unavailable' });
        const { phone } = req.body;
        if (!phone) return res.status(400).json({ success: false, message: 'Phone required' });

        const pre = await sheetsService.checkPreConsultation(phone);
        if (pre.found) return res.json({ success: true, hasPreConsultation: true, isNewClient: false, data: pre.data, completeness: pre.completeness, leadId: pre.leadId });

        const lead = await sheetsService.checkLeaddatabase(phone);
        if (lead.found) return res.json({ success: true, hasPreConsultation: false, isExistingLead: true, isNewClient: false, data: lead.data, consultationType: lead.consultationType, leadId: lead.leadId });

        res.json({ success: true, hasPreConsultation: false, isExistingLead: false, isNewClient: true });
    } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

// Save Consultation
app.post('/api/save-consultation', async (req, res) => {
    try {
        if (!sheetsService) return res.status(503).json({ success: false, message: 'Sheets service unavailable' });
        const formData = req.body;
        if (!formData.phone && !formData.whatsapp) return res.status(400).json({ success: false, message: 'Phone required' });
        res.json(await sheetsService.saveConsultationData(formData));
    } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

// Video Consultation Response
app.post('/api/video-consultation-response', async (req, res) => {
    try {
        if (!sheetsService) return res.status(503).json({ success: false, message: 'Sheets service unavailable' });
        const { leadId, phone, clientName, response } = req.body;
        res.json(await sheetsService.saveVideoConsultationResponse(leadId, phone, clientName, response));
    } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

// Gallabox status
app.get('/api/gallabox-status/:messageId', async (req, res) => {
    try {
        if (!gallaboxService) return res.status(503).json({ success: false, message: 'Gallabox unavailable' });
        res.json(await gallaboxService.getMessageStatus(req.params.messageId));
    } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

// Serve index.html for everything else
app.get('*', (req, res) => {
    if (indexHtml) {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        return res.send(indexHtml);
    }
    res.status(500).send('<h2>index.html missing from build</h2><p>__dirname: ' + __dirname + '</p>');
});

app.use((err, req, res, next) => res.status(500).json({ success: false, message: 'Server error' }));

if (require.main === module) {
    app.listen(PORT, () => {
        console.log('Server on port', PORT);
        console.log('index.html:', indexHtml ? 'LOADED' : 'MISSING');
    });
}

module.exports = app;
process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT',  () => process.exit(0));
