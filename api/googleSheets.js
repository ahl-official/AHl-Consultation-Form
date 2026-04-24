// ============================================
// GOOGLE SHEETS SERVICE
// ============================================

const { google } = require('googleapis');
const googleDriveService = require('./googleDrive');

const auth = new google.auth.GoogleAuth({
    credentials: {
        client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL?.trim(),
        private_key: process.env.GOOGLE_PRIVATE_KEY?.trim()?.replace(/\\n/g, '\n'),
    },
    scopes: [
        'https://www.googleapis.com/auth/spreadsheets',
        'https://www.googleapis.com/auth/drive.file'
    ],
});

const sheets = google.sheets({ version: 'v4', auth });
const SPREADSHEET_ID = process.env.GOOGLE_SHEETS_ID?.trim();

async function getSheetData(sheetName) {
    try {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `${sheetName}!A:BZ`,
        });
        return response.data.values || [];
    } catch (error) {
        console.error(`Error getting sheet data for ${sheetName}:`, error);
        return [];
    }
}

async function createPreConsultationSheet() {
    try {
        await sheets.spreadsheets.batchUpdate({
            spreadsheetId: SPREADSHEET_ID,
            requestBody: {
                requests: [{ addSheet: { properties: { title: 'PreConsultation', gridProperties: { frozenRowCount: 1 } } } }]
            }
        });

        const headers = [
            "Timestamp","Lead ID","Full Name","Mobile No","City","Town","Date of Birth",
            "Source","Consultation Type","Existing Wearer","Wearing Duration",
            "Current Patch Satisfaction","Improvements Needed","Current Provider",
            "Current Cost","Hair Fall Since","Done Hair Transplant Before",
            "Considering Hair Patch Since","Rides Bike Often","Interested In",
            "System Type","Density","Budget Range","Timeline","Session Notes",
            "Natural Hair Density","Preferred Attachment Method",
            "Photo Top View","Photo Front View","Photo Left Side","Photo Right Side",
            "Photo Back View","Photo Other 1","Photo Other 2","Photo Other 3",
            "Completed By","Last Updated","Video Consultation","Consultation Source"
        ];

        await sheets.spreadsheets.values.update({
            spreadsheetId: SPREADSHEET_ID,
            range: 'PreConsultation!A1',
            valueInputOption: 'USER_ENTERED',
            requestBody: { values: [headers] }
        });

        const ss = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
        const sheet = ss.data.sheets.find(s => s.properties.title === 'PreConsultation');
        const sheetId = sheet.properties.sheetId;

        await sheets.spreadsheets.batchUpdate({
            spreadsheetId: SPREADSHEET_ID,
            requestBody: {
                requests: [{
                    repeatCell: {
                        range: { sheetId, startRowIndex: 0, endRowIndex: 1 },
                        cell: {
                            userEnteredFormat: {
                                backgroundColor: { red: 0.3, green: 0.69, blue: 0.31 },
                                textFormat: { foregroundColor: { red: 1, green: 1, blue: 1 }, bold: true }
                            }
                        },
                        fields: 'userEnteredFormat(backgroundColor,textFormat)'
                    }
                }]
            }
        });

        console.log('✅ Created PreConsultation sheet with headers');
        return true;
    } catch (error) {
        console.error('Error creating PreConsultation sheet:', error);
        throw error;
    }
}

function getColLetter(n) {
    let s = "";
    while (n >= 0) { s = String.fromCharCode(n % 26 + 65) + s; n = Math.floor(n / 26) - 1; }
    return s;
}

async function updateCell(sheetName, rowIndex, colIndex, value) {
    try {
        const range = `${sheetName}!${getColLetter(colIndex)}${rowIndex}`;
        await sheets.spreadsheets.values.update({
            spreadsheetId: SPREADSHEET_ID,
            range,
            valueInputOption: 'USER_ENTERED',
            requestBody: { values: [[value]] },
        });
        return true;
    } catch (error) {
        console.error(`Error updating cell in ${sheetName}:`, error);
        return false;
    }
}

async function ensureColumnsExist(sheetName, currentHeaders, requiredColumns) {
    try {
        const missingColumns = requiredColumns.filter(col => !currentHeaders.includes(col));
        if (missingColumns.length === 0) return currentHeaders;

        console.log(`Adding missing columns to ${sheetName}:`, missingColumns);
        const startLetter = getColLetter(currentHeaders.length);

        await sheets.spreadsheets.values.update({
            spreadsheetId: SPREADSHEET_ID,
            range: `${sheetName}!${startLetter}1`,
            valueInputOption: 'USER_ENTERED',
            requestBody: { values: [missingColumns] }
        });

        return [...currentHeaders, ...missingColumns];
    } catch (error) {
        console.error('Error ensuring columns exist:', error);
        return currentHeaders;
    }
}

async function appendRow(sheetName, values) {
    try {
        await sheets.spreadsheets.values.append({
            spreadsheetId: SPREADSHEET_ID,
            range: `${sheetName}!A:BZ`,
            valueInputOption: 'USER_ENTERED',
            requestBody: { values: [values] },
        });
        return true;
    } catch (error) {
        console.error(`Error appending row to ${sheetName}:`, error);
        return false;
    }
}

async function updateRow(sheetName, rowIndex, values) {
    try {
        await sheets.spreadsheets.values.update({
            spreadsheetId: SPREADSHEET_ID,
            range: `${sheetName}!A${rowIndex}:BZ${rowIndex}`,
            valueInputOption: 'USER_ENTERED',
            requestBody: { values: [values] },
        });
        return true;
    } catch (error) {
        console.error(`Error updating row in ${sheetName}:`, error);
        return false;
    }
}

function cleanPhone(phone) { return String(phone || '').replace(/\D/g, ''); }

function matchPhones(p1, p2) {
    const cp1 = cleanPhone(p1), cp2 = cleanPhone(p2);
    if (!cp1 || !cp2) return false;
    if (cp1 === cp2) return true;
    if (cp1.length >= 10 && cp2.length >= 10) return cp1.slice(-10) === cp2.slice(-10);
    return false;
}

function extractData(headers, row, fieldMap) {
    const data = {};
    for (const [key, colName] of Object.entries(fieldMap)) {
        const index = headers.indexOf(colName);
        if (index !== -1) data[key] = row[index] || '';
    }
    return data;
}

async function triggerAppsScriptProcessing(phone) {
    try {
        const webhookUrl = process.env.APPS_SCRIPT_WEBHOOK_URL;
        if (!webhookUrl) { console.log('⚠️ APPS_SCRIPT_WEBHOOK_URL not set — skipping PDF trigger'); return; }

        const normalizedPhone = String(phone || '').replace(/\D/g, '');
        if (!normalizedPhone) { console.log('⚠️ No phone number for webhook trigger'); return; }

        const url = `${webhookUrl}?action=processNewRow&phone=${encodeURIComponent(normalizedPhone)}`;
        console.log('🔔 Triggering Apps Script for phone:', normalizedPhone);
        const response = await fetch(url);
        console.log('✅ Apps Script response:', await response.text());
    } catch (error) {
        console.error('⚠️ Apps Script webhook error (non-fatal):', error.message);
    }
}

async function checkPreConsultation(phone) {
    try {
        const data = await getSheetData('PreConsultation');
        if (!data || data.length < 2) return { found: false };

        const headers = data[0];
        const phoneColIndex = headers.indexOf('Mobile No');
        const leadIdIndex = headers.indexOf('Lead ID');
        if (phoneColIndex === -1) return { found: false };

        for (let i = 1; i < data.length; i++) {
            if (matchPhones(data[i][phoneColIndex], phone)) {
                const clientData = extractClientData(headers, data[i]);
                const completeness = calculateProfileCompleteness(clientData);
                const leadId = leadIdIndex >= 0 ? String(data[i][leadIdIndex] || '') : '';
                return { found: true, data: clientData, completeness, leadId };
            }
        }
        return { found: false };
    } catch (error) {
        console.error('Error checking PreConsultation:', error);
        return { found: false };
    }
}

async function checkLeaddatabase(phone) {
    try {
        const data = await getSheetData('Leaddatabase');
        if (!data || data.length < 2) return { found: false };

        const headers = data[0];
        const phoneColIndex = headers.indexOf('Mobile No');
        const leadIdIndex = headers.indexOf('Lead ID');
        const consultationTypeIndex = headers.indexOf('Consultation Type');
        if (phoneColIndex === -1) return { found: false };

        for (let i = 1; i < data.length; i++) {
            if (matchPhones(data[i][phoneColIndex], phone)) {
                const leadData = extractLeadData(headers, data[i]);
                const consultationType = consultationTypeIndex >= 0 ? String(data[i][consultationTypeIndex] || '') : '';
                const leadId = leadIdIndex >= 0 ? String(data[i][leadIdIndex] || '') : '';
                return { found: true, data: leadData, consultationType, leadId };
            }
        }
        return { found: false };
    } catch (error) {
        console.error('Error checking Leaddatabase:', error);
        return { found: false };
    }
}

function extractClientData(headers, row) {
    return extractData(headers, row, {
        fullName: 'Full Name', whatsapp: 'Mobile No', city: 'City', town: 'Town',
        dob: 'Date of Birth', source: 'Source', consultationType: 'Consultation Type',
        existingWearer: 'Existing Wearer', wearingDuration: 'Wearing Duration',
        patchHappy: 'Current Patch Satisfaction', improvementsNeeded: 'Improvements Needed',
        currentProvider: 'Current Provider', currentCost: 'Current Cost',
        hairFallSince: 'Hair Fall Since', transplant: 'Done Hair Transplant Before',
        considering: 'Considering Hair Patch Since', bike: 'Rides Bike Often',
        interested: 'Interested In', systemType: 'System Type', density: 'Density',
        timeline: 'Timeline', budget: 'Budget Range', notes: 'Session Notes',
        naturalDensity: 'Natural Hair Density', attachment: 'Preferred Attachment Method',
        photoTopView: 'Photo Top View', photoFrontView: 'Photo Front View',
        photoLeftSide: 'Photo Left Side', photoRightSide: 'Photo Right Side',
        photoBackView: 'Photo Back View', photoOther1: 'Photo Other 1',
        photoOther2: 'Photo Other 2', photoOther3: 'Photo Other 3',
        lastUpdated: 'Last Updated'
    });
}

function extractLeadData(headers, row) {
    return extractData(headers, row, {
        fullName: 'Full Name', whatsapp: 'Mobile No', city: 'City', town: 'Town',
        dob: 'Date of Birth', source: 'Source', consultationType: 'Consultation Type'
    });
}

function calculateProfileCompleteness(data) {
    const requiredFields = ['fullName', 'whatsapp', 'city', 'existingWearer', 'interested', 'timeline', 'budget'];
    const optionalFields = ['town', 'dob', 'source', 'consultationType', 'systemType', 'density', 'bike', 'notes'];
    const conditionalFields = (data.existingWearer === 'Yes') ? ['wearingDuration', 'patchHappy'] : ['hairFallSince', 'considering'];
    const allFields = [...requiredFields, ...optionalFields, ...conditionalFields];
    let filledCount = 0, missingRequired = [];

    requiredFields.forEach(f => { if (data[f] && data[f] !== '') filledCount++; else missingRequired.push(f); });
    optionalFields.forEach(f => { if (data[f] && data[f] !== '') filledCount++; });
    conditionalFields.forEach(f => { if (data[f] && data[f] !== '') filledCount++; });

    const percentage = Math.round((filledCount / allFields.length) * 100);
    return { percentage, isComplete: percentage === 100, missingRequired, filledCount, totalCount: allFields.length };
}

async function saveConsultationData(formData) {
    try {
        let data = await getSheetData('PreConsultation');

        if (!data || data.length === 0) {
            console.log('PreConsultation sheet not found or empty, creating...');
            await createPreConsultationSheet();
            data = await getSheetData('PreConsultation');
            if (!data || data.length === 0) throw new Error('Failed to create or read PreConsultation sheet');
        }

        let headers = data[0];
        headers = await ensureColumnsExist('PreConsultation', headers, [
            "Photo Top View","Photo Front View","Photo Left Side","Photo Right Side",
            "Photo Back View","Photo Other 1","Photo Other 2","Photo Other 3",
            "Consultation Type","Video Consultation","Consultation Source"
        ]);

        const phoneColIndex = headers.indexOf('Mobile No');
        if (phoneColIndex === -1) throw new Error('Mobile No column not found');

        let rowIndex = -1, existingRow = null;
        for (let i = 1; i < data.length; i++) {
            if (matchPhones(data[i][phoneColIndex], formData.phone || formData.whatsapp)) {
                rowIndex = i + 1; existingRow = data[i]; break;
            }
        }

        const timestamp = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }).replace(',', '');
        const leadId = rowIndex !== -1
            ? data[rowIndex - 1][headers.indexOf('Lead ID')] || `AH${Date.now().toString().slice(-8)}`
            : `AH${Date.now().toString().slice(-8)}`;

        let photoUrls = { 'Top View':'','Front View':'','Left Side':'','Right Side':'','Back View':'','Other 1':'','Other 2':'','Other 3':'' };
        if (formData.images && formData.images.length > 0) {
            photoUrls = await googleDriveService.uploadImages(formData.images, formData.fullName || leadId, leadId);
        }

        const rowData = prepareRowData(headers, formData, timestamp, leadId, photoUrls, existingRow);

        if (rowIndex !== -1) {
            await updateRow('PreConsultation', rowIndex, rowData);
        } else {
            await appendRow('PreConsultation', rowData);
        }

        const phoneForWebhook = formData.whatsapp || formData.phone || '';
        if (phoneForWebhook) {
            await new Promise(resolve => setTimeout(resolve, 1500));
            await triggerAppsScriptProcessing(phoneForWebhook);
        }

        const returnData = {
            ...formData,
            photoTopView: photoUrls['Top View'], photoFrontView: photoUrls['Front View'],
            photoLeftSide: photoUrls['Left Side'], photoRightSide: photoUrls['Right Side'],
            photoBackView: photoUrls['Back View'], photoOther1: photoUrls['Other 1'],
            photoOther2: photoUrls['Other 2'], photoOther3: photoUrls['Other 3']
        };

        return { success: true, message: 'Profile saved successfully', leadId, completeness: calculateProfileCompleteness(returnData), imageCount: formData.images?.length || 0, data: returnData };

    } catch (error) {
        console.error('Error in saveConsultationData:', error);
        return { success: false, message: 'Error: ' + error.message };
    }
}

function prepareRowData(headers, formData, timestamp, leadId, photoUrls, existingRow = null) {
    const rowData = [];
    headers.forEach((header, index) => {
        switch (header) {
            case 'Timestamp':                    rowData.push(timestamp); break;
            case 'Lead ID':                      rowData.push(leadId); break;
            case 'Full Name':                    rowData.push(formData.fullName || ''); break;
            case 'Mobile No':                    rowData.push(formData.whatsapp || formData.phone || ''); break;
            case 'City':                         rowData.push(formData.city || ''); break;
            case 'Town':                         rowData.push(formData.town || ''); break;
            case 'Date of Birth':                rowData.push(formData.dob || ''); break;
            case 'Source':                       rowData.push(formData.source || ''); break;
            case 'Consultation Type':
                rowData.push((existingRow && existingRow[index]) ? existingRow[index] : (formData.consultationType || ''));
                break;
            case 'Existing Wearer':              rowData.push(formData.existingWearer || ''); break;
            case 'Wearing Duration':             rowData.push(formData.wearingDuration || ''); break;
            case 'Current Patch Satisfaction':   rowData.push(formData.patchHappy || ''); break;
            case 'Improvements Needed':          rowData.push(formData.improvementsNeeded || ''); break;
            case 'Current Provider':             rowData.push(formData.currentProvider || ''); break;
            case 'Current Cost':                 rowData.push(formData.currentCost || ''); break;
            case 'Hair Fall Since':              rowData.push(formData.hairFallSince || ''); break;
            case 'Done Hair Transplant Before':  rowData.push(formData.transplant || ''); break;
            case 'Considering Hair Patch Since': rowData.push(formData.considering || ''); break;
            case 'Rides Bike Often':             rowData.push(formData.bike || ''); break;
            case 'Interested In':                rowData.push(formData.interested || ''); break;
            case 'System Type':                  rowData.push(formData.systemType || ''); break;
            case 'Density':                      rowData.push(formData.density || ''); break;
            case 'Budget Range':                 rowData.push(formData.budget || ''); break;
            case 'Timeline':                     rowData.push(formData.timeline || ''); break;
            case 'Session Notes':                rowData.push(formData.notes || ''); break;
            case 'Natural Hair Density':         rowData.push(formData.naturalDensity || ''); break;
            case 'Preferred Attachment Method':  rowData.push(formData.attachment || ''); break;
            case 'Photo Top View':               rowData.push(photoUrls['Top View'] || ''); break;
            case 'Photo Front View':             rowData.push(photoUrls['Front View'] || ''); break;
            case 'Photo Left Side':              rowData.push(photoUrls['Left Side'] || ''); break;
            case 'Photo Right Side':             rowData.push(photoUrls['Right Side'] || ''); break;
            case 'Photo Back View':              rowData.push(photoUrls['Back View'] || ''); break;
            case 'Photo Other 1':                rowData.push(photoUrls['Other 1'] || ''); break;
            case 'Photo Other 2':                rowData.push(photoUrls['Other 2'] || ''); break;
            case 'Photo Other 3':                rowData.push(photoUrls['Other 3'] || ''); break;
            case 'Completed By':                 rowData.push(formData.completedBy || 'Client Self-Service'); break;
            case 'Last Updated':                 rowData.push(timestamp); break;
            case 'Consultation Source':          rowData.push(formData.consultationSource || ''); break;
            default:
                rowData.push((existingRow && existingRow[index] !== undefined) ? existingRow[index] : '');
        }
    });
    return rowData;
}

async function createVideoConsultationResponsesSheet() {
    try {
        await sheets.spreadsheets.batchUpdate({
            spreadsheetId: SPREADSHEET_ID,
            requestBody: { requests: [{ addSheet: { properties: { title: 'VideoConsultationResponses', gridProperties: { frozenRowCount: 1 } } } }] }
        });

        await sheets.spreadsheets.values.update({
            spreadsheetId: SPREADSHEET_ID,
            range: 'VideoConsultationResponses!A1',
            valueInputOption: 'USER_ENTERED',
            requestBody: { values: [["Timestamp","Lead ID","Phone","Client Name","Response","Date"]] }
        });

        const ss = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
        const sheetId = ss.data.sheets.find(s => s.properties.title === 'VideoConsultationResponses').properties.sheetId;

        await sheets.spreadsheets.batchUpdate({
            spreadsheetId: SPREADSHEET_ID,
            requestBody: {
                requests: [{ repeatCell: { range: { sheetId, startRowIndex: 0, endRowIndex: 1 }, cell: { userEnteredFormat: { backgroundColor: { red: 0.3, green: 0.69, blue: 0.31 }, textFormat: { foregroundColor: { red: 1, green: 1, blue: 1 }, bold: true } } }, fields: 'userEnteredFormat(backgroundColor,textFormat)' } }]
            }
        });

        console.log('✅ Created VideoConsultationResponses sheet');
        return true;
    } catch (error) {
        console.error('Error creating VideoConsultationResponses sheet:', error);
        throw error;
    }
}

async function saveVideoConsultationResponse(leadId, phone, clientName, response) {
    try {
        const dateObj = new Date();
        const timestamp = dateObj.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }).replace(',', '');
        const dateStr = dateObj.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' });
        const rowData = [timestamp, leadId || '', phone || '', clientName || '', response || 'Not Interested', dateStr];

        try {
            await appendRow('VideoConsultationResponses', rowData);
        } catch (error) {
            console.log('VideoConsultationResponses sheet missing, creating...');
            await createVideoConsultationResponsesSheet();
            await appendRow('VideoConsultationResponses', rowData);
        }

        let data = await getSheetData('PreConsultation');
        if (!data || data.length === 0) return { success: false, message: 'PreConsultation sheet not found' };

        let headers = data[0];
        headers = await ensureColumnsExist('PreConsultation', headers, ['Video Consultation']);

        const leadIdIndex = headers.indexOf('Lead ID');
        const videoColIndex = headers.indexOf('Video Consultation');
        if (videoColIndex === -1) throw new Error('Failed to ensure Video Consultation column');

        for (let i = 1; i < data.length; i++) {
            if (String(data[i][leadIdIndex]) === String(leadId)) {
                await updateCell('PreConsultation', i + 1, videoColIndex, response);
                break;
            }
        }

        return { success: true, message: 'Response saved successfully' };
    } catch (error) {
        console.error('Error saving video consultation response:', error);
        return { success: false, message: 'Error: ' + error.message };
    }
}

module.exports = { checkPreConsultation, checkLeaddatabase, saveConsultationData, saveVideoConsultationResponse };
