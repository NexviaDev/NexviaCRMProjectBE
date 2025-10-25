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
    console.error('히스토리 기록 실패:', error);
  }
};

class SubscriptionController {
  // 무료 체험 시작
  async startFreeTrial(req, res) {
    try {
      const userId = req.user._id;
      const user = await User.findById(userId);

      if (!user) {
        return res.status(404).json({
          success: false,
          message: '사용자를 찾을 수 없습니다.'
        });
      }

      // 이미 무료 체험을 사용했거나 활성 구독이 있는지 확인
      if (user.freeTrialUsed || user.subscriptionStatus === 'active') {
        return res.status(400).json({
          success: false,
          message: user.freeTrialUsed ? '이미 무료 체험을 사용하셨습니다.' : '이미 활성 구독이 있습니다.'
        });
      }

      // 무료 체험 시작
      const trialStarted = user.startFreeTrial();
      
      if (!trialStarted) {
        return res.status(400).json({
          success: false,
          message: '무료 체험을 시작할 수 없습니다.'
        });
      }

      await user.save();

      // 무료 체험용 Subscription 생성 (히스토리 기록을 위해 먼저 생성)
      const freeTrialSubscription = new Subscription({
        customerId: user._id.toString(),
        planId: 'premium_trial',
        planName: '프리미엄 무료 체험',
        price: 0,
        status: 'active',
        startDate: user.freeTrialStartDate,
        nextBillingDate: user.freeTrialEndDate,
        billingCycle: 'monthly',
        customerEmail: user.email,
        customerName: user.name,
        company: user.companyName,
        autoRenew: true,
        metadata: {
          isTrialSubscription: true,
          trialEndDate: user.freeTrialEndDate
        }
      });

      await freeTrialSubscription.save();

      // Subscription 히스토리 기록
      await logSubscriptionHistory({
        userId: user._id,
        subscriptionId: freeTrialSubscription._id,
        action: 'free_trial_started',
        description: '프리미엄 무료 체험이 시작되었습니다.',
        amount: 0,
        status: 'success',
        metadata: {
          trialEndDate: user.freeTrialEndDate,
          isTrialSubscription: true
        }
      });


      return res.status(200).json({
        success: true,
        message: '첫 구독자 특별 무료 체험이 성공적으로 시작되었습니다!',
        data: {
          trialEndDate: user.freeTrialEndDate,
          subscriptionStatus: user.subscriptionStatus
        }
      });

    } catch (error) {
      console.error('무료 체험 시작 오류:', error);
      return res.status(500).json({
        success: false,
        message: '서버 오류가 발생했습니다.',
        error: error.message
      });
    }
  }

  // 구독 생성
  async createSubscription(req, res) {
    try {
      const {
        customerId,
        planId,
        planName,
        price,
        customerEmail,
        customerName,
        company,
        billingCycle = 'monthly'
      } = req.body;

      // 기존 활성 구독이 있는지 확인
      const existingActiveSubscription = await Subscription.findOne({
        customerId,
        status: 'active'
      });

      if (existingActiveSubscription) {
        return res.status(400).json({
          success: false,
          message: '이미 활성 구독이 존재합니다.'
        });
      }

      // 기존 취소된 구독이 있는지 확인
      const existingCancelledSubscription = await Subscription.findOne({
        customerId,
        status: 'cancelled'
      });

      if (existingCancelledSubscription) {
        // 취소된 구독을 활성화
        existingCancelledSubscription.status = 'active';
        existingCancelledSubscription.cancelledAt = null;
        existingCancelledSubscription.planId = planId;
        existingCancelledSubscription.planName = planName;
        existingCancelledSubscription.price = price;
        existingCancelledSubscription.customerEmail = customerEmail;
        existingCancelledSubscription.customerName = customerName;
        existingCancelledSubscription.company = company;
        existingCancelledSubscription.billingCycle = billingCycle;
        
        // 다음 결제일 계산 (월간 결제로 고정)
        const nextBillingDate = new Date();
        nextBillingDate.setMonth(nextBillingDate.getMonth() + 1);
        existingCancelledSubscription.nextBillingDate = nextBillingDate;
        
        await existingCancelledSubscription.save();

        // 사용자 정보 업데이트
        const user = await User.findById(customerId);
        if (user) {
          user.isPremium = true;
          user.subscriptionStatus = 'active';
          user.billingCycle = billingCycle;
          user.subscriptionStartDate = existingCancelledSubscription.startDate;
          user.subscriptionEndDate = existingCancelledSubscription.nextBillingDate;
          await user.save();
        }

        // 히스토리 기록
        await logSubscriptionHistory({
          userId: customerId,
          subscriptionId: existingCancelledSubscription._id,
          action: 'subscription_reactivated',
          description: `${planName} 구독이 재활성화되었습니다.`,
          amount: price,
          status: 'success',
          metadata: {
            planId,
            planName,
            billingCycle
          }
        });

        return res.status(200).json({
          success: true,
          data: existingCancelledSubscription,
          message: '구독이 재활성화되었습니다.'
        });
      }

      // 다음 결제일 계산 (월간 결제로 고정)
      const nextBillingDate = new Date();
      nextBillingDate.setMonth(nextBillingDate.getMonth() + 1);

      const subscription = new Subscription({
        customerId,
        planId,
        planName,
        price,
        customerEmail,
        customerName,
        company,
        billingCycle,
        nextBillingDate
      });

      await subscription.save();

      // 사용자 정보 업데이트 및 첫 구독자 할인 적용
      const user = await User.findById(customerId);
      if (user) {
        const isFirstTimeSubscriber = !user.freeTrialUsed;
        
        user.isPremium = true;
        user.subscriptionStatus = 'active';
        user.billingCycle = billingCycle;
        user.subscriptionStartDate = subscription.startDate;
        user.subscriptionEndDate = subscription.nextBillingDate;
        
        // 첫 구독자인 경우 첫 달 무료 혜택 적용
        if (isFirstTimeSubscriber) {
          user.freeTrialUsed = true;
          user.freeTrialStartDate = new Date();
          const trialEndDate = new Date();
          trialEndDate.setMonth(trialEndDate.getMonth() + 1);
          user.freeTrialEndDate = trialEndDate;
          
          // 첫 달은 무료로 설정하고 다음 달 결제일로 설정
          subscription.price = 0; // 첫 달은 무료
          subscription.metadata = {
            ...subscription.metadata,
            isFirstSubscription: true,
            trialEndDate
          };
          await subscription.save();
        }
        
        await user.save();
      }

      // 히스토리 기록
      const isFirstTimeSubscriber = user && !user.freeTrialUsed;
      await logSubscriptionHistory({
        userId: customerId,
        subscriptionId: subscription._id,
        action: isFirstTimeSubscriber ? 'free_trial_started' : 'subscription_created',
        description: isFirstTimeSubscriber 
          ? `${planName} 구독이 생성되었습니다. (첫 구독자 특별 혜택: 첫 달 무료!)` 
          : `${planName} 구독이 생성되었습니다.`,
        amount: isFirstTimeSubscriber ? 0 : price,
        status: 'success',
        metadata: {
          planId,
          company,
          customerEmail,
          billingCycle,
          isFirstSubscription: isFirstTimeSubscriber
        }
      });

      res.status(201).json({
        success: true,
        data: subscription,
        message: isFirstTimeSubscriber 
          ? '🎉 첫 구독자 특별 혜택으로 구독이 시작되었습니다! 첫 달은 무료입니다.'
          : '구독이 성공적으로 생성되었습니다.'
      });
    } catch (error) {
      console.error('구독 생성 오류:', error);
      res.status(500).json({
        success: false,
        message: '구독 생성에 실패했습니다.',
        error: error.message
      });
    }
  }

  // 구독 조회
  async getSubscription(req, res) {
    try {
      const { customerId } = req.params;

      const subscription = await Subscription.findOne({ customerId });

      if (!subscription) {
        return res.status(404).json({
          success: false,
          message: '구독을 찾을 수 없습니다.'
        });
      }

      res.status(200).json({
        success: true,
        data: subscription
      });
    } catch (error) {
      console.error('구독 조회 오류:', error);
      res.status(500).json({
        success: false,
        message: '구독 조회에 실패했습니다.',
        error: error.message
      });
    }
  }

  // 구독 목록 조회
  async getSubscriptions(req, res) {
    try {
      const { page = 1, limit = 10, status } = req.query;
      
      const filter = {};
      if (status) {
        filter.status = status;
      }

      const subscriptions = await Subscription.find(filter)
        .sort({ createdAt: -1 })
        .limit(limit * 1)
        .skip((page - 1) * limit);

      const total = await Subscription.countDocuments(filter);

      res.status(200).json({
        success: true,
        data: subscriptions,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(total / limit),
          totalItems: total,
          itemsPerPage: parseInt(limit)
        }
      });
    } catch (error) {
      console.error('구독 목록 조회 오류:', error);
      res.status(500).json({
        success: false,
        message: '구독 목록 조회에 실패했습니다.',
        error: error.message
      });
    }
  }

  // 구독 업데이트
  async updateSubscription(req, res) {
    try {
      const { subscriptionId } = req.params;
      const updateData = req.body;

      const subscription = await Subscription.findByIdAndUpdate(
        subscriptionId,
        updateData,
        { new: true, runValidators: true }
      );

      if (!subscription) {
        return res.status(404).json({
          success: false,
          message: '구독을 찾을 수 없습니다.'
        });
      }

      res.status(200).json({
        success: true,
        data: subscription,
        message: '구독이 성공적으로 업데이트되었습니다.'
      });
    } catch (error) {
      console.error('구독 업데이트 오류:', error);
      res.status(500).json({
        success: false,
        message: '구독 업데이트에 실패했습니다.',
        error: error.message
      });
    }
  }

  // 구독 취소
  async cancelSubscription(req, res) {
    try {
      const { customerId } = req.body;

      if (!customerId) {
        return res.status(400).json({
          success: false,
          message: '고객 ID가 필요합니다.'
        });
      }

      // 구독 정보 조회
      const subscription = await Subscription.findOne({ customerId });
      if (!subscription) {
        return res.status(404).json({
          success: false,
          message: '구독을 찾을 수 없습니다.'
        });
      }

      // 구독 상태를 취소로 변경
      subscription.status = 'cancelled';
      subscription.cancelledAt = new Date();
      await subscription.save();

      // 사용자 정보 업데이트
      const user = await User.findById(customerId);
      if (user) {
        user.subscriptionStatus = 'cancelled';
        await user.save();
      }

      // 히스토리 기록
      await logSubscriptionHistory({
        userId: customerId,
        subscriptionId: subscription._id,
        action: 'subscription_cancelled',
        description: '구독이 취소되었습니다.',
        amount: subscription.price,
        status: 'success',
        metadata: {
          planId: subscription.planId,
          planName: subscription.planName,
          billingCycle: subscription.billingCycle
        }
      });

      res.status(200).json({
        success: true,
        data: subscription,
        message: '구독이 성공적으로 취소되었습니다.'
      });
    } catch (error) {
      console.error('구독 취소 오류:', error);
      res.status(500).json({
        success: false,
        message: '구독 취소에 실패했습니다.',
        error: error.message
      });
    }
  }

  // 구독 일시정지
  async suspendSubscription(req, res) {
    try {
      const { subscriptionId } = req.params;

      const subscription = await Subscription.findById(subscriptionId);

      if (!subscription) {
        return res.status(404).json({
          success: false,
          message: '구독을 찾을 수 없습니다.'
        });
      }

      await subscription.suspend();

      res.status(200).json({
        success: true,
        data: subscription,
        message: '구독이 일시정지되었습니다.'
      });
    } catch (error) {
      console.error('구독 일시정지 오류:', error);
      res.status(500).json({
        success: false,
        message: '구독 일시정지에 실패했습니다.',
        error: error.message
      });
    }
  }

  // 구독 재개
  async resumeSubscription(req, res) {
    try {
      const { subscriptionId } = req.params;

      const subscription = await Subscription.findById(subscriptionId);

      if (!subscription) {
        return res.status(404).json({
          success: false,
          message: '구독을 찾을 수 없습니다.'
        });
      }

      if (subscription.status !== 'suspended') {
        return res.status(400).json({
          success: false,
          message: '일시정지된 구독만 재개할 수 있습니다.'
        });
      }

      subscription.status = 'active';
      await subscription.save();

      res.status(200).json({
        success: true,
        data: subscription,
        message: '구독이 재개되었습니다.'
      });
    } catch (error) {
      console.error('구독 재개 오류:', error);
      res.status(500).json({
        success: false,
        message: '구독 재개에 실패했습니다.',
        error: error.message
      });
    }
  }

  // 구독 취소철회 (다음달 결제일 내에서만 가능)
  async reactivateSubscription(req, res) {
    try {
      const { customerId } = req.body;

      if (!customerId) {
        return res.status(400).json({
          success: false,
          message: '고객 ID가 필요합니다.'
        });
      }

      // 사용자 정보 조회
      const user = await User.findById(customerId);
      if (!user) {
        return res.status(404).json({
          success: false,
          message: '사용자를 찾을 수 없습니다.'
        });
      }

      // 구독 정보 조회
      const subscription = await Subscription.findOne({ customerId });
      if (!subscription) {
        return res.status(404).json({
          success: false,
          message: '구독 정보를 찾을 수 없습니다.'
        });
      }

      // 취소된 구독인지 확인
      if (subscription.status !== 'cancelled') {
        return res.status(400).json({
          success: false,
          message: '취소된 구독만 철회할 수 있습니다.'
        });
      }

      // 다음 결제일이 지났는지 확인
      const now = new Date();
      const nextBillingDate = new Date(subscription.nextBillingDate);
      
      if (now > nextBillingDate) {
        return res.status(400).json({
          success: false,
          message: '다음 결제일이 지나서 취소철회가 불가능합니다.'
        });
      }

      // 구독 상태를 활성으로 변경
      subscription.status = 'active';
      subscription.cancelledAt = null; // 취소일 제거
      await subscription.save();

      // 사용자 정보 업데이트
      user.subscriptionStatus = 'active';
      user.isPremium = true;
      await user.save();

      // 히스토리 기록
      await logSubscriptionHistory({
        userId: customerId,
        subscriptionId: subscription._id,
        action: 'subscription_reactivated',
        description: '구독 취소가 철회되었습니다.',
        amount: subscription.price,
        status: 'success',
        metadata: {
          planId: subscription.planId,
          planName: subscription.planName,
          billingCycle: subscription.billingCycle
        }
      });

      res.status(200).json({
        success: true,
        data: subscription,
        message: '구독 취소가 성공적으로 철회되었습니다.'
      });
    } catch (error) {
      console.error('구독 취소철회 오류:', error);
      res.status(500).json({
        success: false,
        message: '구독 취소철회에 실패했습니다.',
        error: error.message
      });
    }
  }

  // 빌링키 발급
  async issueBillingKey(req, res) {
    try {
      const { customerKey, authKey, billingCycle = 'monthly' } = req.body;
      

      // 토스페이먼츠 API 호출하여 빌링키 발급
      const response = await axios.post('https://api.tosspayments.com/v1/billing/authorizations/issue', {
        customerKey,
        authKey
      }, {
        headers: {
          'Authorization': createAuthHeader(),
          'Content-Type': 'application/json'
        }
      });

      if (response.status !== 200) {
        const result = response.data;
        return res.status(response.status).json({
          success: false,
          message: result.message || '빌링키 발급에 실패했습니다.',
          code: result.code
        });
      }

      const result = response.data;

      // 사용자 정보 먼저 조회 (구독 생성과 업데이트에 모두 사용)
      const user = await User.findById(customerKey);
      
      // 구독 정보에 빌링키 저장
      let subscription = await Subscription.findOne({ customerId: customerKey });
      
      // 구독 정보가 없으면 자동 생성
      if (!subscription) {
        
        // 다음 결제일 계산 (월간 결제로 고정)
        const nextBillingDate = new Date();
        nextBillingDate.setMonth(nextBillingDate.getMonth() + 1);
        
        subscription = new Subscription({
          customerId: customerKey,
          planId: 'enterprise',
          planName: '프리미엄 구독',
          price: 80000,
          customerEmail: user ? user.email : 'unknown@example.com',
          customerName: user ? user.name : '사용자',
          status: 'active',
          startDate: new Date(),
          billingCycle: billingCycle,
          nextBillingDate: nextBillingDate,
          autoRenew: true,
          paymentMethod: 'card'
        });
        
        await subscription.save();
      }
      
      // 빌링키 저장
      subscription.billingKey = result.billingKey;
      await subscription.save();

      // 사용자 정보 업데이트
      if (user) {
        user.isPremium = true;
        user.subscriptionStatus = 'active';
        user.billingCycle = billingCycle;
        user.subscriptionStartDate = subscription.startDate;
        user.subscriptionEndDate = subscription.nextBillingDate;
        await user.save();
      }

      res.status(200).json({
        success: true,
        data: result,
        message: '빌링키가 성공적으로 발급되었습니다.'
      });
    } catch (error) {
      console.error('❌ [issueBillingKey] 빌링키 발급 오류:', error);
      console.error('❌ 에러 상세:', {
        message: error.message,
        response: error.response?.data,
        status: error.response?.status
      });
      
      res.status(500).json({
        success: false,
        message: '빌링키 발급에 실패했습니다.',
        error: error.message,
        details: error.response?.data || null
      });
    }
  }

  // 정기결제 실행
  async confirmBilling(req, res) {
    try {
      
      const { customerKey, amount, orderId, orderName, customerEmail, customerName } = req.body;
      

      // 사용자 정보 조회하여 첫 구독자인지 확인
      const user = await User.findById(customerKey);
      
      if (!user) {
        return res.status(404).json({
          success: false,
          message: '사용자를 찾을 수 없습니다.'
        });
      }

      const isFirstTimeSubscriber = !user.freeTrialUsed;

      // 구독 정보 조회

      let subscription = await Subscription.findOne({ 
        customerId: customerKey,
        status: { $ne: 'cancelled' }
      });

      let finalSubscription = subscription;
      let actualPaymentAmount = amount; // 기본값 설정
      
      // 구독 정보가 없으면 자동 생성
      if (!subscription) {
        
        // 첫 구독자인 경우 첫 달 무료로 설정 (토스페이먼츠 테스트 환경에서는 최소 100원)
        const finalAmount = isFirstTimeSubscriber ? 100 : amount;
        actualPaymentAmount = isFirstTimeSubscriber ? 100 : amount; // 실제 결제 금액 계산
        
        const newSubscription = new Subscription({
          customerId: customerKey,
          planId: 'enterprise',
          planName: '프리미엄 구독',
          price: finalAmount,
          customerEmail: customerEmail,
          customerName: customerName,
          status: 'active',
          startDate: new Date(),
          nextBillingDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30일 후
          autoRenew: true,
          paymentMethod: 'card',
          metadata: isFirstTimeSubscriber ? {
            isFirstSubscription: true,
            originalPrice: amount,
            freeTrialApplied: true
          } : {}
        });
        
        await newSubscription.save();
        finalSubscription = newSubscription;
        
        // 사용자 무료 체험 정보 업데이트
        if (isFirstTimeSubscriber) {
          user.freeTrialUsed = true;
          user.freeTrialStartDate = new Date();
          user.freeTrialEndDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
          user.isPremium = true;
          user.subscriptionStatus = 'active';
          await user.save();
        }
      } else {
        // 기존 구독이 있는 경우에도 첫 구독자인지 확인하여 실제 결제 금액 조정
        // 토스페이먼츠 테스트 환경에서는 최소 결제 금액(100원) 필요
        actualPaymentAmount = isFirstTimeSubscriber ? 100 : finalSubscription.price;
      }

      if (!finalSubscription.billingKey) {
        return res.status(400).json({
          success: false,
          message: '빌링키가 발급되지 않았습니다. 먼저 빌링키를 발급해주세요.'
        });
      }

      // 토스페이먼츠 API 호출하여 정기결제 실행
      
      // 토스페이먼츠에서 실제로 결제할 금액 전달
      const response = await axios.post(`https://api.tosspayments.com/v1/billing/${finalSubscription.billingKey}`, {
        customerKey,
        amount: actualPaymentAmount, // 실제 결제 금액 (첫 구독자는 0원)
        orderId,
        orderName,
        customerEmail,
        customerName
      }, {
        headers: {
          'Authorization': createAuthHeader(),
          'Content-Type': 'application/json'
        }
      });

      const result = response.data;

      if (response.status !== 200) {
        return res.status(response.status).json({
          success: false,
          message: result.message || '정기결제에 실패했습니다.',
          code: result.code
        });
      }

      // 결제 성공 시 구독 정보 업데이트  
      
      // 다음 결제일을 올바르게 계산 (현재 날짜 기준 1개월 후)
      const now = new Date();
      const nextBilling = new Date(now);
      nextBilling.setMonth(nextBilling.getMonth() + 1);
      finalSubscription.nextBillingDate = nextBilling;
      
      await finalSubscription.save();

      // 결제 성공 시 사용자 정보 업데이트 (isPremium, subscriptionStatus)
      try {
        
        // customerKey가 실제 사용자 ID인지 확인
        let userId = customerKey;
        
        // customerKey가 실제 사용자 ID가 아닌 경우, 이메일로 사용자 찾기
        if (!userId.match(/^[0-9a-fA-F]{24}$/)) {
          const userByEmail = await User.findOne({ email: customerEmail });
          if (userByEmail) {
            userId = userByEmail._id;
          } else {
          }
        }
        
        if (userId && userId.match(/^[0-9a-fA-F]{24}$/)) {
          const user = await User.findById(userId);
          if (user) {
            
            // 구독 정보 업데이트
            user.isPremium = true;
            user.subscriptionStatus = 'active';
            user.subscriptionStartDate = new Date();
            
            // 정기구독이므로 subscriptionEndDate는 설정하지 않음 (무제한 갱신)
            // 다음 결제 예정일만 설정 (1개월 후)
            const nextPaymentDate = new Date();
            nextPaymentDate.setMonth(nextPaymentDate.getMonth() + 1);
            user.nextPaymentDate = nextPaymentDate;
            
            user.lastPaymentDate = new Date();
            
            await user.save();

            // 결제 성공 히스토리 기록
            const historyDescription = isFirstTimeSubscriber 
              ? `첫 구독자 혜택이 적용되었습니다! (${finalSubscription.planName}) - 실제 결제: ${actualPaymentAmount}원 (정상 가격: ${amount}원)`
              : `정기결제가 성공적으로 실행되었습니다. (${finalSubscription.planName})`;

            await logSubscriptionHistory({
              userId: user._id,
              subscriptionId: finalSubscription._id,
              action: 'payment_success',
              description: historyDescription,
              amount: actualPaymentAmount, // 실제 결제 금액 사용
              status: 'success',
              paymentKey: result.paymentKey || null,
              orderId: result.orderId || null,
              metadata: {
                planId: finalSubscription.planId,
                planName: finalSubscription.planName,
                billingCycle: finalSubscription.billingCycle,
                isFirstSubscription: isFirstTimeSubscriber,
                originalAmount: isFirstTimeSubscriber ? amount : null
              }
            });
          } else {
            console.error('❌ 사용자를 찾을 수 없음:', userId);
          }
        } else {
        }
      } catch (userUpdateError) {
        console.error('❌ 사용자 정보 업데이트 실패:', userUpdateError);
        // 사용자 업데이트 실패 시에도 상세 정보 로깅
        console.error('❌ 상세 오류:', {
          message: userUpdateError.message,
          stack: userUpdateError.stack
        });
      }

      res.status(200).json({
        success: true,
        data: result,
        message: '정기결제가 성공적으로 실행되었습니다.'
      });
    } catch (error) {
      console.error('정기결제 실행 오류:', error);
      console.error('정기결제 오류 상세:', {
        message: error.message,
        code: error.response?.data?.code,
        status: error.response?.status,
        data: error.response?.data
      });
      
      // 결제 실패 히스토리 기록
      try {
        // 구독 정보를 다시 조회하여 히스토리 기록
        const subscriptionForHistory = await Subscription.findOne({ 
          customerId: customerKey,
          status: { $ne: 'cancelled' }
        });
        
        if (subscriptionForHistory) {
          await logSubscriptionHistory({
            userId: customerKey,
            subscriptionId: subscriptionForHistory._id,
            action: 'payment_failed',
            description: `정기결제 실행에 실패했습니다: ${error.message}`,
            amount: actualPaymentAmount || amount,
            status: 'failed',
            errorMessage: error.message,
            metadata: {
              planId: subscriptionForHistory.planId,
              planName: subscriptionForHistory.planName,
              error: error.message,
              isFirstTimeSubscriber: isFirstTimeSubscriber
            }
          });
        }
      } catch (historyError) {
        console.error('히스토리 기록 실패:', historyError);
      }
      
      res.status(500).json({
        success: false,
        message: '정기결제 실행에 실패했습니다.',
        error: error.message
      });
    }
  }

  // 결제 승인
  async confirmPayment(req, res) {
    try {
      const { paymentKey, orderId, amount } = req.body;

      // 토스페이먼츠 API 호출하여 결제 승인
      const response = await axios.post('https://api.tosspayments.com/v1/payments/confirm', {
        paymentKey,
        orderId,
        amount
      }, {
        headers: {
          'Authorization': createAuthHeader(),
          'Content-Type': 'application/json'
        }
      });

      const result = response.data;

      if (response.status !== 200) {
        // 결제 승인 실패 히스토리 기록
        try {
          const orderParts = orderId.split('_');
          if (orderParts.length >= 2) {
            const userId = orderParts[0];
            const planId = orderParts[1];
            
            await logSubscriptionHistory({
              userId: userId,
              subscriptionId: null, // 아직 구독이 생성되지 않음
              action: 'payment_failed',
              description: `결제 승인에 실패했습니다: ${result.message || '알 수 없는 오류'}`,
              amount: amount,
              status: 'failed',
              paymentKey: paymentKey,
              orderId: orderId,
              errorMessage: result.message || '알 수 없는 오류',
              metadata: {
                planId: planId,
                responseStatus: response.status,
                result: result
              }
            });
          }
        } catch (historyError) {
          console.error('히스토리 기록 실패:', historyError);
        }
        
        return res.status(response.status).json({
          success: false,
          message: result.message || '결제 승인에 실패했습니다.',
          code: result.code
        });
      }

      // 결제 성공 시 사용자 정보 업데이트
      try {
        // orderId에서 사용자 정보 추출 (orderId 형식: userId_planId_timestamp)
        const orderParts = orderId.split('_');
        if (orderParts.length >= 2) {
          const userId = orderParts[0];
          const planId = orderParts[1];
          
          
          // 사용자 정보 조회 및 업데이트
          const user = await User.findById(userId);
          if (user) {
            
            // 구독 정보 업데이트
            user.isPremium = true;
            user.subscriptionPlan = planId;
            user.subscriptionStartDate = new Date();
            
            // 정기구독이므로 subscriptionEndDate는 설정하지 않음 (무제한 갱신)
            // 다음 결제 예정일만 설정 (1개월 후)
            const nextPaymentDate = new Date();
            nextPaymentDate.setMonth(nextPaymentDate.getMonth() + 1);
            user.nextPaymentDate = nextPaymentDate;
            
            user.subscriptionStatus = 'active';
            user.lastPaymentDate = new Date();
            
            await user.save();

            // 결제 승인 성공 히스토리 기록
            await logSubscriptionHistory({
              userId: user._id,
              subscriptionId: null, // 아직 구독 모델이 생성되지 않음
              action: 'payment_success',
              description: `결제가 성공적으로 승인되었습니다. (${planId})`,
              amount: amount,
              status: 'success',
              paymentKey: paymentKey,
              orderId: orderId,
              metadata: {
                planId: planId,
                subscriptionStartDate: user.subscriptionStartDate,
                nextPaymentDate: user.nextPaymentDate
              }
            });
          } else {
            console.error('❌ 사용자를 찾을 수 없음:', userId);
          }
        } else {
          console.error('❌ 잘못된 orderId 형식:', orderId);
        }
      } catch (userUpdateError) {
        console.error('❌ 사용자 정보 업데이트 실패:', userUpdateError);
        // 사용자 업데이트 실패 시에도 상세 정보 로깅
        console.error('❌ 상세 오류:', {
          message: userUpdateError.message,
          stack: userUpdateError.stack
        });
      }

      res.status(200).json({
        success: true,
        data: result,
        message: '결제가 성공적으로 승인되었습니다.'
      });
    } catch (error) {
      console.error('결제 승인 오류:', error);
      
      // 결제 승인 전체 실패 히스토리 기록
      try {
        const orderParts = orderId.split('_');
        if (orderParts.length >= 2) {
          const userId = orderParts[0];
          const planId = orderParts[1];
          
          await logSubscriptionHistory({
            userId: userId,
            subscriptionId: null,
            action: 'payment_failed',
            description: `결제 승인 처리 중 오류가 발생했습니다: ${error.message}`,
            amount: amount,
            status: 'failed',
            paymentKey: paymentKey,
            orderId: orderId,
            errorMessage: error.message,
            metadata: {
              planId: planId,
              error: error.message,
              stack: error.stack
            }
          });
        }
      } catch (historyError) {
        console.error('히스토리 기록 실패:', historyError);
      }
      
      res.status(500).json({
        success: false,
        message: '결제 승인에 실패했습니다.',
        error: error.message
      });
    }
  }
}

module.exports = new SubscriptionController(); 