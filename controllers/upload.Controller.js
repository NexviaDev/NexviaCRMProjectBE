const { google } = require('googleapis');
const fs = require('fs');
const File = require('../models/upload.model');  // 파일 스키마 불러오기

const fileController = {};

// Google Drive에 파일 업로드 함수
fileController.uploadFile = async (req, res) => {
    const file = req.file;
    
    if (!file) {
        return res.status(400).json({ error: '파일이 업로드되지 않았습니다.' });
    }

    try {
        const webViewLink = await uploadToGoogleDrive(file.path, file.originalname);
        
        // 업로드한 파일 정보를 데이터베이스에 저장
        const newFile = new File({
            fileName: file.originalname,
            fileId: fileId,  // Google Drive에서 반환된 파일 ID
            webViewLink: webViewLink,  // Google Drive에서 반환된 파일 링크
        });

        await newFile.save();

        return res.json({ link: webViewLink });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
};

// Google Drive에 파일을 업로드하는 비동기 함수
const uploadToGoogleDrive = async (filePath, fileName) => {
    const auth = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        process.env.GOOGLE_REDIRECT_URI
    );
    
    auth.setCredentials({
        refresh_token: process.env.REFRESH_TOKEN,
    });

    const drive = google.drive({ version: 'v3', auth });

    const fileMetadata = {
        name: fileName,
    };
    const media = {
        mimeType: 'image/jpeg',  // 필요한 경우 파일 유형을 동적으로 설정 가능
        body: fs.createReadStream(filePath),
    };

    try {
        const file = await drive.files.create({
            resource: fileMetadata,
            media: media,
            fields: 'id',
        });

        const fileId = file.data.id;

        await drive.permissions.create({
            fileId: fileId,
            requestBody: {
                role: 'reader',
                type: 'anyone',
            },
        });

        const result = await drive.files.get({
            fileId: fileId,
            fields: 'webViewLink',
        });

        return result.data.webViewLink;
    } catch (error) {
        console.error('Google Drive 파일 업로드 실패:', error.message);
        throw new Error('파일 업로드에 실패했습니다.');
    }
};

// 파일 삭제 로직 추가 (필요한 경우)
fileController.deleteFile = async (req, res) => {
    try {
        const fileId = req.params.fileId;

        // Google Drive에서 파일 삭제
        const drive = google.drive({ version: 'v3', auth });
        await drive.files.delete({ fileId });

        // 데이터베이스에서 파일 정보 삭제
        await File.findByIdAndDelete(fileId);

        res.status(200).json({ status: 'success', message: '파일이 성공적으로 삭제되었습니다.' });
    } catch (error) {
        console.error('파일 삭제 실패:', error.message);
        res.status(500).json({ error: '파일 삭제에 실패했습니다.' });
    }
};

module.exports = fileController;
