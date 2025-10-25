const cron = require('node-cron');
const Subscription = require('../models/Subscription.model');
const User = require('../models/user.model');
const SubscriptionHistory = require('../models/SubscriptionHistory.model');
const axios = require('axios');
const { createAuthHeader } = require('../config/tossPayments');

// 히스토리 기록 헬퍼 함수
const logSubscriptionHistory = async (data) => {
  try {
    const history = new SubscriptionHistory(data);
    await history.save();
  } catch (error) {
    console.error('❌ [Scheduler] 히스토리 기록 실패:', error);
  }
};

class SubscriptionScheduler {
  constructor() {
    this.isRunning = false;
  }

  // 스케줄러 시작
  start() {
    // 매월 1일 자정에 실행 (0 0 1 * *)
    cron.schedule('0 0 1 * *', async () => {
      await this.processMonthlySubscriptions();
    }, {
      scheduled: true,
      timezone: "Asia/Seoul"
    });

    // 매일 오전 9시에 결제 실패한 구독 재시도 (0 9 * * *)
    cron.schedule('0 9 * * *', async () => {
      await this.processFailedPaymentRetries();
    }, {
      scheduled: true,
      timezone: "Asia/Seoul"
    });

    // 매일 자정에 무료 체험 종료 처리 (0 0 * * *)
    cron.schedule('0 0 * * *', async () => {
      await this.processExpiredFreeTrials();
    }, {
      scheduled: true,
      timezone: "Asia/Seoul"
    });

    // 🧪 테스트용: 1분마다 정기결제 실행 (개발/테스트 환경에서만 사용)
    if (process.env.NODE_ENV === 'development') {
      cron.schedule('*/1 * * * *', async () => {
        await this.processMonthlySubscriptions();
      }, {
        scheduled: true,
        timezone: "Asia/Seoul"
      });
    }
  }

  // 🧪 테스트용: 활성 구독 체크 (실제 결제 없음)
  async checkActiveSubscriptions() {
    try {
      const activeSubscriptions = await Subscription.find({ 
        status: 'active',
        autoRenew: true
      });


      
      if (activeSubscriptions.length > 0) {
        activeSubscriptions.forEach(sub => {
          
        });
      }
    } catch (error) {
      console.error('❌ [테스트] 활성 구독 체크 오류:', error);
    }
  }

  // 🧪 테스트용: 즉시 정기결제 실행 (수동 테스트용)
  async testMonthlySubscriptions() {

    await this.processMonthlySubscriptions();
  }

  // 🧪 테스트용: 즉시 재시도 실행 (수동 테스트용)
  async testFailedPaymentRetries() {
    await this.processFailedPaymentRetries();
  }

  // 매월 정기결제 처리
  async processMonthlySubscriptions() {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;
    
    try {
      // 활성 상태인 구독들 조회
      const activeSubscriptions = await Subscription.find({ 
        status: 'active',
        autoRenew: true,
        nextBillingDate: { $lte: new Date() } // 결제 예정일이 지난 구독
      });

      for (const subscription of activeSubscriptions) {
        try {
          await this.processSubscriptionPayment(subscription);
        } catch (error) {
          console.error(`❌ 구독 ${subscription._id} 정기결제 실패:`, error.message);
          await this.handlePaymentFailure(subscription, error);
        }
      }

      // 유예 기간 만료된 구독들 처리
      await this.processExpiredGracePeriods();


    } catch (error) {
      console.error('❌ 정기결제 처리 중 오류 발생:', error);
    } finally {
      this.isRunning = false;
    }
  }

  // 개별 구독 결제 처리
  async processSubscriptionPayment(subscription) {
    try {
      // 빌링키가 있는지 확인
      if (!subscription.billingKey) {
        throw new Error('빌링키가 없습니다.');
      }

      // 결제 요청 데이터 준비
      const paymentData = {
        customerKey: subscription.customerId,
        amount: subscription.price,
        orderId: `${subscription.customerId}_${subscription.planId}_${Date.now()}`,
        orderName: `${subscription.planName} 정기구독`,
        customerEmail: subscription.customerEmail,
        customerName: subscription.customerName
      };

      // 토스페이먼츠 API 호출
      const response = await axios.post(
        `https://api.tosspayments.com/v1/billing/${subscription.billingKey}`,
        paymentData,
        {
          headers: {
            'Authorization': createAuthHeader(),
            'Content-Type': 'application/json'
          }
        }
      );

      if (response.status === 200) {
        await this.handlePaymentSuccess(subscription, response.data);
      } else {
        throw new Error(`결제 실패: ${response.status}`);
      }

    } catch (error) {
      console.error('❌ 결제 처리 오류:', error.message);
      throw error;
    }
  }

  // 결제 성공 처리
  async handlePaymentSuccess(subscription, paymentResult) {
    try {
      // 구독 정보 업데이트
      subscription.lastPaymentDate = new Date();
      
      // 다음 결제일 계산 (윤년 문제 해결)
      const nextDate = new Date(); // 현재 결제 시간 기준
      
      // 월간 결제의 경우 윤년 문제를 고려한 안전한 계산
      const currentYear = nextDate.getFullYear();
      const currentMonth = nextDate.getMonth();
      const currentDay = nextDate.getDate();
      
      // 다음 달의 같은 날짜 계산
      let nextYear = currentYear;
      let nextMonth = currentMonth + 1;
      
      // 12월을 넘어가면 다음 해 1월로
      if (nextMonth > 11) {
        nextMonth = 0;
        nextYear += 1;
      }
      
      // 다음 달의 마지막 날짜 확인
      const daysInNextMonth = new Date(nextYear, nextMonth + 1, 0).getDate();
      
      // 현재 날짜가 다음 달에 존재하지 않으면 마지막 날로 조정
      let targetDay = Math.min(currentDay, daysInNextMonth);
      
      // 특별 케이스: 2월 29일 → 다음 해 2월 28일 (윤년이 아닌 경우)
      if (currentMonth === 1 && currentDay === 29) { // 2월 29일
        const isNextYearLeap = (nextYear % 4 === 0 && nextYear % 100 !== 0) || (nextYear % 400 === 0);
        if (!isNextYearLeap) {
          targetDay = 28; // 다음 해가 윤년이 아니면 28일로
        }
      }
      
      nextDate.setFullYear(nextYear, nextMonth, targetDay);
      subscription.nextBillingDate = nextDate;
      subscription.paymentHistory = subscription.paymentHistory || [];
      subscription.paymentHistory.push({
        paymentKey: paymentResult.paymentKey,
        amount: paymentResult.totalAmount,
        date: new Date(),
        status: 'success'
      });

      await subscription.save();

      // 사용자 정보 업데이트
      const user = await User.findById(subscription.customerId);
      if (user) {
        user.isPremium = true;
        user.subscriptionStatus = 'active';
        user.lastPaymentDate = new Date();
        user.nextPaymentDate = subscription.nextBillingDate;
        await user.save();
        
        // 히스토리 기록
        await logSubscriptionHistory({
          userId: user._id,
          subscriptionId: subscription._id,
          action: 'payment_success',
          description: `자동 결제가 성공적으로 실행되었습니다. (${subscription.planName})`,
          amount: paymentResult.totalAmount,
          currency: 'KRW',
          paymentKey: paymentResult.paymentKey || null,
          orderId: paymentResult.orderId || null,
          status: 'success',
          metadata: {
            planId: subscription.planId,
            planName: subscription.planName,
            billingCycle: subscription.billingCycle,
            source: 'scheduler'
          }
        });
        
      }

    } catch (error) {
      console.error('❌ 결제 성공 처리 중 오류:', error);
    }
  }

  // 결제 실패 처리
  async handlePaymentFailure(subscription, error) {
    try {
      // 재시도 횟수 증가
      subscription.retryCount = (subscription.retryCount || 0) + 1;
      subscription.lastPaymentAttempt = new Date();
      subscription.paymentHistory = subscription.paymentHistory || [];
      subscription.paymentHistory.push({
        error: error.message,
        date: new Date(),
        status: 'failed',
        retryCount: subscription.retryCount
      });

      // 최대 재시도 횟수 초과 시 구독 일시정지
      if (subscription.retryCount >= 3) {
        subscription.status = 'suspended';
        subscription.suspendedAt = new Date();
        subscription.status = 'suspended';
        subscription.suspendedAt = new Date();
      }

      await subscription.save();

      // 사용자 정보 조회 및 히스토리 기록
      const user = await User.findById(subscription.customerId);
      if (user) {
        await logSubscriptionHistory({
          userId: user._id,
          subscriptionId: subscription._id,
          action: 'payment_failed',
          description: `자동 결제가 실패했습니다. (재시도 ${subscription.retryCount}/3)`,
          amount: subscription.price,
          currency: 'KRW',
          status: 'failed',
          errorMessage: error.message,
          metadata: {
            planId: subscription.planId,
            planName: subscription.planName,
            billingCycle: subscription.billingCycle,
            retryCount: subscription.retryCount,
            source: 'scheduler'
          }
        });
        
        // 최대 재시도 횟수 초과 시 구독 일시정지 히스토리도 기록
        if (subscription.retryCount >= 3) {
          await logSubscriptionHistory({
            userId: user._id,
            subscriptionId: subscription._id,
            action: 'subscription_suspended',
            description: '최대 재시도 횟수 초과로 구독이 일시정지되었습니다.',
            status: 'failed',
            metadata: {
              planId: subscription.planId,
              planName: subscription.planName,
              retryCount: subscription.retryCount,
              source: 'scheduler'
            }
          });
        }
        
      }

      // 사용자에게 알림 (실제 구현에서는 이메일, SMS 등)

    } catch (updateError) {
      console.error('❌ 결제 실패 처리 중 오류:', updateError);
    }
  }

  // 결제 실패한 구독 재시도 처리
  async processFailedPaymentRetries() {
    try {
      // 일시정지된 구독 중 재시도 가능한 것들 조회
      const suspendedSubscriptions = await Subscription.find({
        status: 'suspended',
        retryCount: { $lt: 3 },
        lastPaymentAttempt: { 
          $lte: new Date(Date.now() - 24 * 60 * 60 * 1000) // 24시간 전
        }
      });

      for (const subscription of suspendedSubscriptions) {
        try {
          await this.processSubscriptionPayment(subscription);
        } catch (error) {
          console.error(`❌ 구독 ${subscription._id} 재시도 실패:`, error.message);
        }
      }

    } catch (error) {
      console.error('❌ 재시도 처리 중 오류:', error);
    }
  }

  // 다음 결제일 계산
  calculateNextBillingDate(billingCycle = 'monthly') {
    const nextDate = new Date();
    
    // 월간 결제로 고정
    nextDate.setMonth(nextDate.getMonth() + 1);
    
    return nextDate;
  }

  // 유예 기간 만료된 구독들 처리
  async processExpiredGracePeriods() {
    try {
      const now = new Date();
      
      // 유예 기간이 만료된 취소된 구독들 조회
      const expiredSubscriptions = await Subscription.find({
        status: 'cancelled',
        gracePeriodEndDate: { $lte: now }
      });


      for (const subscription of expiredSubscriptions) {
        try {
          // 사용자 정보 업데이트 - 프리미엄 상태 해제
          const user = await User.findById(subscription.customerId);
          if (user) {
            user.isPremium = false;
            user.subscriptionStatus = 'expired';
            user.subscriptionEndDate = subscription.gracePeriodEndDate;
            await user.save();
            
          }

          // 구독 상태를 만료로 변경
          subscription.status = 'expired';
          await subscription.save();
          
        } catch (error) {
          console.error(`❌ 구독 ${subscription._id} 만료 처리 실패:`, error.message);
        }
      }

    } catch (error) {
      console.error('❌ 유예 기간 만료 처리 중 오류 발생:', error);
    }
  }

  // 무료 체험 종료 처리
  async processExpiredFreeTrials() {
    try {
      
      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      
      // 무료 체험이 오늘 종료되는 사용자 조회
      const expiredTrialUsers = await User.find({
        freeTrialUsed: true,
        freeTrialEndDate: {
          $gte: today,
          $lt: new Date(today.getTime() + 24 * 60 * 60 * 1000) // 다음날 자정까지
        },
        subscriptionStatus: 'active'
      });


      for (const user of expiredTrialUsers) {
        try {

          // 사용자 상태를 무료 회원으로 변경
          user.subscriptionStatus = 'inactive';
          user.isPremium = false;
          
          await user.save();

          // 무료 체험용 Subscription 상태 변경
          const trialSubscription = await Subscription.findOne({
            customerId: user._id.toString(),
            planId: 'premium_trial'
          });

          if (trialSubscription) {
            trialSubscription.status = 'cancelled';
            trialSubscription.endDate = now;
            await trialSubscription.save();
          }

        } catch (userError) {
          console.error(`❌ 무료 체험 종료 처리 실패: ${user.name}`, userError);
        }
      }

    } catch (error) {
      console.error('❌ 무료 체험 종료 처리 중 오류 발생:', error);
    }
  }

  // 스케줄러 중지
  stop() {
    cron.getTasks().forEach(task => task.stop());
    this.isRunning = false;
  }
}

module.exports = new SubscriptionScheduler(); 