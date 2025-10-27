const express = require('express');
const router = express.Router();
const { convertCoordinatesToLocation } = require('../utils/locationUtils');
const { getDashboardStats } = require('../controllers/Dashboard.controller');
const auth = require('../middleware/auth');

// 위도/경도를 지역명으로 변환하는 API
router.post('/convert-location', async (req, res) => {
  try {
    const { latitude, longitude } = req.body;

    // 입력값 검증
    if (!latitude || !longitude) {
      return res.status(400).json({
        success: false,
        message: '위도와 경도가 필요합니다.',
        error: 'Missing latitude or longitude'
      });
    }

    // 좌표 유효성 검증
    if (isNaN(latitude) || isNaN(longitude)) {
      return res.status(400).json({
        success: false,
        message: '유효하지 않은 좌표입니다.',
        error: 'Invalid coordinates'
      });
    }

    if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
      return res.status(400).json({
        success: false,
        message: '좌표 범위가 유효하지 않습니다.',
        error: 'Coordinates out of range'
      });
    }

    // 지역명 변환 실행
    const result = await convertCoordinatesToLocation(latitude, longitude);

    res.status(200).json({
      success: result.success,
      data: result,
      message: result.success ? '지역명 변환이 완료되었습니다.' : '지역명 변환에 실패했습니다.'
    });

  } catch (error) {
    console.error('지역명 변환 API 오류:', error);
    res.status(500).json({
      success: false,
      message: '지역명 변환 중 오류가 발생했습니다.',
      error: error.message
    });
  }
});

// 대시보드 통계 조회 (최적화된 API)
router.get('/dashboard/stats', auth, getDashboardStats);

module.exports = router;
