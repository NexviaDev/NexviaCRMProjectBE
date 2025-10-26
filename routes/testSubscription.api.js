const express = require('express');
const router = express.Router();
const subscriptionScheduler = require('../schedulers/subscriptionScheduler');
const Subscription = require('../models/Subscription.model');
const SubscriptionHistory = require('../models/SubscriptionHistory.model');

// 🧪 테스트용: 즉시 정기결제 실행
router.post('/test-payment', async (req, res) => {
  try {
    console.log('🧪 테스트 정기결제 실행 중...');
    
    // 활성 구독 조회
    const activeSubscriptions = await Subscription.find({ 
      status: 'active',
      autoRenew: true
    });
    
    console.log(`✅ 활성 구독 ${activeSubscriptions.length}개 발견`);
    
    // 즉시 결제 실행
    await subscriptionScheduler.processMonthlySubscriptions();
    
    res.json({
      success: true,
      message: '테스트 정기결제가 실행되었습니다.',
      activeSubscriptions: activeSubscriptions.length
    });
  } catch (error) {
    console.error('❌ 테스트 결제 오류:', error);
    res.status(500).json({
      success: false,
      message: '테스트 결제 실행 중 오류가 발생했습니다.',
      error: error.message
    });
  }
});

// 구독 상태 조회
router.get('/subscriptions', async (req, res) => {
  try {
    const subscriptions = await Subscription.find({ 
      status: 'active',
      autoRenew: true
    }).sort({ nextBillingDate: 1 });
    
    res.json({
      success: true,
      data: subscriptions.map(sub => ({
        customerId: sub.customerId,
        planName: sub.planName,
        price: sub.price,
        nextBillingDate: sub.nextBillingDate,
        lastPaymentDate: sub.lastPaymentDate,
        retryCount: sub.retryCount
      }))
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: '구독 정보 조회 실패',
      error: error.message
    });
  }
});

// 결제 히스토리 조회
router.get('/history', async (req, res) => {
  try {
    const { limit = 20 } = req.query;
    
    const history = await SubscriptionHistory.find()
      .sort({ createdAt: -1 })
      .limit(parseInt(limit));
    
    res.json({
      success: true,
      data: history
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: '히스토리 조회 실패',
      error: error.message
    });
  }
});

// 다음 결제 예정 구독 조회
router.get('/upcoming', async (req, res) => {
  try {
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    const upcomingSubscriptions = await Subscription.find({
      status: 'active',
      autoRenew: true,
      nextBillingDate: {
        $gte: today,
        $lte: tomorrow
      }
    });
    
    res.json({
      success: true,
      data: upcomingSubscriptions.map(sub => ({
        customerId: sub.customerId,
        planName: sub.planName,
        price: sub.price,
        nextBillingDate: sub.nextBillingDate,
        hoursUntilBilling: Math.round((sub.nextBillingDate - today) / (1000 * 60 * 60))
      })),
      count: upcomingSubscriptions.length
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: '다음 결제 예정 조회 실패',
      error: error.message
    });
  }
});

module.exports = router;

