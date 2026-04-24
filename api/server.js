const express = require('express');
const dotenv = require('dotenv');
const cors = require('cors');

dotenv.config();

const app = express();

// ── Middleware ──────────────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// ── Lazy-load heavy services (catches missing .env early) ───
let googleSheets;
try {
    googleSheets = require('./googleSheets');
    console.log('✅ Google Sheets service loaded');
} catch (e) {
    console.error('❌ Failed to load googleSheets:', e.message);
}

// ── Routes ──────────────────────────────────────────────────

app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.post('/api/save-consultation', async (req, res) => {
    console.log('📥 /api/save-consultation called');
    console.log('   fullName:', req.body?.fullName);
    console.log('   whatsapp:', req.body?.whatsapp);
    console.log('   images count:', req.body?.images?.length || 0);

    if (!googleSheets) {
        return res.status(500).json({ success: false, message: 'Google Sheets service not available. Check server logs.' });
    }

    try {
        const formData = req.body;
        const result = await googleSheets.saveConsultationData(formData);
        console.log('💾 Save result:', result.success ? '✅ Success' : '❌ Failed', result.message || '');

        if (result.success) {
            if (process.env.GALLABOX_API_KEY && formData.whatsapp) {
                try {
                    const axios = require('axios');
                    await axios.post(`${process.env.GALLABOX_BASE_URL}/messages`, {
                        channelId: process.env.GALLABOX_CHANNEL_ID,
                        to: formData.whatsapp,
                        type: 'template',
                        template: {
                            name: 'new_consultation_welcome',
                            language: { code: 'en' }
                        }
                    }, {
                        headers: {
                            'apiKey': process.env.GALLABOX_API_KEY,
                            'apiSecret': process.env.GALLABOX_API_SECRET
                        }
                    });
                    console.log('📱 WhatsApp notification sent');
                } catch (err) {
                    console.error('⚠️  WhatsApp notification failed (non-fatal):', err.response?.data || err.message);
                }
            }

            return res.json({
                success: true,
                message: 'Saved successfully',
                data: result.data,
                leadId: result.leadId,
                completeness: result.completeness
            });
        } else {
            return res.status(500).json({ success: false, message: result.message || 'Save failed' });
        }

    } catch (error) {
        console.error('❌ /api/save-consultation error:', error);
        return res.status(500).json({ success: false, message: error.message || 'Internal server error' });
    }
});

app.post('/api/client-login', async (req, res) => {
    const { phone } = req.body;
    if (!googleSheets) return res.status(500).json({ success: false, message: 'Service unavailable' });

    try {
        const preResult = await googleSheets.checkPreConsultation(phone);
        if (preResult.found) {
            return res.json({
                success: true,
                hasPreConsultation: true,
                isNewClient: false,
                data: preResult.data,
                completeness: preResult.completeness,
                leadId: preResult.leadId
            });
        }

        const leadResult = await googleSheets.checkLeaddatabase(phone);
        if (leadResult.found) {
            return res.json({
                success: true,
                hasPreConsultation: false,
                isNewClient: false,
                isExistingLead: true,
                data: leadResult.data,
                consultationType: leadResult.consultationType,
                leadId: leadResult.leadId
            });
        }

        res.json({ success: true, isNewClient: true });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ success: false, message: 'Server error during login' });
    }
});

// ── Start (local dev only) ───────────────────────────────────
if (require.main === module) {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
        console.log('');
        console.log('🚀 Server running at http://localhost:' + PORT);
        console.log('🔍 Health check: http://localhost:' + PORT + '/api/health');
        console.log('');
    });
}

module.exports = app;
module.exports.default = app;
