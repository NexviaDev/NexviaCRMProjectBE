// Deprecation 경고 억제
process.removeAllListeners('warning');

const express = require('express');
const app = express();
const PORT = process.env.PORT || 5000;

// 기본 미들웨어
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 가장 기본적인 라우트 (가장 먼저 정의)
app.get('/', (req, res) => {
    res.json({
        status: 'success',
        message: 'Nexvia CRM Backend API Server',
        version: '1.0.0',
        timestamp: new Date().toISOString(),
        server: 'running'
    });
});

// 헬스 체크
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        uptime: process.uptime(),
        timestamp: new Date().toISOString()
    });
});

// 서버 시작
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`🌐 URL: http://localhost:${PORT}`);
    console.log(`✅ Basic routes registered`);
});

module.exports = app;