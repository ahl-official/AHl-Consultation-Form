// ============================================
// GOOGLE DRIVE SERVICE
// Handles file uploads to Google Drive
// ============================================

const { google } = require('googleapis');

// Initialize Google Drive API
const auth = new google.auth.GoogleAuth({
    credentials: {
        client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL?.trim(),
        private_key: process.env.GOOGLE_PRIVATE_KEY?.trim()?.replace(/\\n/g, '\n'),
    },
    scopes: ['https://www.googleapis.com/auth/drive.file'],
});

const drive = google.drive({ version: 'v3', auth });
const MAIN_FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID?.trim();

// ============================================
// GET OR CREATE FOLDER
// ============================================
async function getOrCreateFolder(parentFolderId, folderName) {
    try {
        // Search for existing folder
        const response = await drive.files.list({
            q: `name='${folderName}' and '${parentFolderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
            fields: 'files(id, name)',
            spaces: 'drive',
            includeItemsFromAllDrives: true,
            supportsAllDrives: true
        });

        if (response.data.files && response.data.files.length > 0) {
            return response.data.files[0].id;
        }

        // Create new folder
        const fileMetadata = {
            name: folderName,
            mimeType: 'application/vnd.google-apps.folder',
            parents: [parentFolderId]
        };

        const folder = await drive.files.create({
            requestBody: fileMetadata,
            fields: 'id',
            supportsAllDrives: true
        });

        console.log(`Created folder: ${folderName}`);
        return folder.data.id;

    } catch (error) {
        console.error('Error creating folder:', error);
        throw error;
    }
}

// ============================================
// UPLOAD IMAGE TO DRIVE
// ============================================
async function uploadImageToDrive(base64Data, fileName, folderId) {
    try {
        // Remove base64 prefix if present
        const base64Content = base64Data.includes(',')
            ? base64Data.split(',')[1]
            : base64Data;

        // Convert base64 to buffer
        const buffer = Buffer.from(base64Content, 'base64');

        const fileMetadata = {
            name: fileName,
            parents: [folderId]
        };

        const media = {
            mimeType: 'image/jpeg',
            body: require('stream').Readable.from(buffer)
        };

        const file = await drive.files.create({
            requestBody: fileMetadata,
            media: media,
            fields: 'id',
            supportsAllDrives: true
        });

        // Make file publicly accessible
        await drive.permissions.create({
            fileId: file.data.id,
            requestBody: {
                role: 'reader',
                type: 'anyone'
            },
            supportsAllDrives: true
        });

        // Return direct image URL
        const fileId = file.data.id;
        const directUrl = `https://lh3.googleusercontent.com/d/${fileId}=s2000`;

        console.log(`Uploaded: ${fileName} → ${directUrl}`);
        return directUrl;

    } catch (error) {
        console.error('Error uploading image:', error);
        throw error;
    }
}

// ============================================
// UPLOAD MULTIPLE IMAGES
// ============================================
async function uploadImages(images, clientName, leadId) {
    try {
        // Clean client name for folder
        const cleanName = clientName.replace(/[^a-zA-Z0-9 ]/g, '');
        const folderName = `${cleanName} - ${leadId}`;

        // Get or create client folder
        const clientFolderId = await getOrCreateFolder(MAIN_FOLDER_ID, folderName);

        const photoUrls = {
            'Top View': '',
            'Front View': '',
            'Left Side': '',
            'Right Side': '',
            'Back View': '',
            'Other 1': '',
            'Other 2': '',
            'Other 3': ''
        };

        let otherCount = 1;

        for (const img of images) {
            if (!img.data) continue;

            try {
                const viewType = img.viewType || '';
                const fileName = `${cleanName}_${viewType || 'Photo' + (images.indexOf(img) + 1)}.jpg`;

                const url = await uploadImageToDrive(img.data, fileName, clientFolderId);

                // Map to correct photo URL
                if (viewType === 'Top View') {
                    photoUrls['Top View'] = url;
                } else if (viewType === 'Front View') {
                    photoUrls['Front View'] = url;
                } else if (viewType === 'Left Side') {
                    photoUrls['Left Side'] = url;
                } else if (viewType === 'Right Side') {
                    photoUrls['Right Side'] = url;
                } else if (viewType === 'Back View') {
                    photoUrls['Back View'] = url;
                } else {
                    if (otherCount <= 3) {
                        photoUrls['Other ' + otherCount] = url;
                        otherCount++;
                    }
                }

            } catch (imgError) {
                console.error(`Failed to upload ${img.viewType}:`, imgError);
            }
        }

        return photoUrls;

    } catch (error) {
        console.error('Error uploading images:', error);
        return {
            'Top View': '',
            'Front View': '',
            'Left Side': '',
            'Right Side': '',
            'Back View': '',
            'Other 1': '',
            'Other 2': '',
            'Other 3': ''
        };
    }
}

// ============================================
// EXPORTS
// ============================================
module.exports = {
    uploadImages,
    getOrCreateFolder,
    uploadImageToDrive
};
