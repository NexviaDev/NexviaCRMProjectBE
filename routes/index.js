const express = require('express');
const router = express.Router();
const userApi = require('./user.api');
const taskApi = require('./task.api');
const paymentsRoutes = require('./PaymentList.api')
const nodemailerRoutes = require('./Nodemailer.api');
const upload = require('./upload.api.js')
const historyRoutes = require('./History.api');
const PropertyRoutes = require('./Property.api')
const CustomerRoutes = require('./Customer.api')
const ContractRoutes = require('./Contract.api')
const ScheduleRoutes = require('./Schedule.api')
const socialAuthRoutes = require('./socialAuth.api')
const subscriptionRoutes = require('./Subscription.api')
const subscriptionHistoryRoutes = require('./SubscriptionHistory.api')
const notificationRoutes = require('./Notification.api')
const smsRoutes = require('./SMS.api')
const activityLogRoutes = require('./ActivityLog.api')
const companyRoutes = require('./Company.api')
const utilsRoutes = require('./utils.api')
const scheduleBriefingRoutes = require('./ScheduleBriefing.api')
const newsRoutes = require('./News.api')
const testSubscriptionRoutes = require('./testSubscription.api')

router.use('/users', userApi);
router.use('/user', userApi);
router.use('/tasks', taskApi);
router.use('/payments', paymentsRoutes);
router.use('/nodemailer', nodemailerRoutes);
router.use('/history', historyRoutes);
router.use('/upload', upload);
router.use('/properties', PropertyRoutes); // 새 경로 추가
router.use('/customers', CustomerRoutes); // 새 경로 추가
router.use('/contracts', ContractRoutes); // 새 경로 추가
router.use('/schedules', ScheduleRoutes); // 새 경로 추가
router.use('/auth', socialAuthRoutes); // 소셜 인증 API 추가
router.use('/subscription', subscriptionRoutes); // 구독 API 추가
// 무료 체험 시작 API를 루트 경로에 직접 추가
router.post('/free-trial/start', require('../middleware/auth'), require('../controllers/Subscription.controller').startFreeTrial);
router.use('/subscription-history', subscriptionHistoryRoutes); // 구독 히스토리 API 추가
router.use('/notifications', notificationRoutes); // 공지사항 API 추가
router.use('/sms', smsRoutes); // SMS API 추가
router.use('/activity-logs', activityLogRoutes); // 활동기록 API 추가
router.use('/company', companyRoutes); // 회사 API 추가
router.use('/utils', utilsRoutes); // 유틸리티 API 추가
router.use('/schedule-briefing', scheduleBriefingRoutes); // 스케줄 브리핑 API 추가
router.use('/news', newsRoutes); // 뉴스 API 추가
router.use('/test-subscription', testSubscriptionRoutes); // 테스트 구독 API 추가
router.use('/uploads', express.static('uploads'));

module.exports = router;
