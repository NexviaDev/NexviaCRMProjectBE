// 현재 사용자 구독 상태 수정 스크립트
const mongoose = require('mongoose');
require('dotenv').config();

const userSchema = new mongoose.Schema({
  _id: mongoose.Schema.Types.ObjectId,
  name: String,
  email: String,
  freeTrialUsed: { type: Boolean, default: false },
  freeTrialStartDate: Date,
  freeTrialEndDate: Date,
  isPremium: { type: Boolean, default: false },
  subscriptionStatus: { type: String, default: 'inactive' }
}, { timestamps: true });

const subscriptionSchema = new mongoose.Schema({
  _id: mongoose.Schema.Types.ObjectId,
  customerId: String,
  planId: String,
  planName: String,
  price: Number,
  status: String
}, { timestamps: true });

const subscriptionHistorySchema = new mongoose.Schema({
  _id: mongoose.Schema.Types.ObjectId,
  userId: mongoose.Schema.Types.ObjectId,
  subscriptionId: mongoose.Schema.Types.ObjectId,
  action: String,
  description: String,
  amount: Number,
  metadata: mongoose.Schema.Types.Mixed
}, { timestamps: true });

const User = mongoose.model('User', userSchema);
const Subscription = mongoose.model('Subscription', subscriptionSchema);
const SubscriptionHistory = mongoose.model('SubscriptionHistory', subscriptionHistorySchema);

const fixCurrentUserSubscription = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI_PROD);
('DB 연결 성공');

    const userId = '68e0d3c823149add2d00b366'; // 현재 결제한 사용자 ID
    
    // 1. 사용자 정보 확인
    const user = await User.findById(userId);
('🔍 현재 사용자:', user ? { name: user.name, email: user.email, freeTrialUsed: user.freeTrialUsed } : '없음');
    
    if (!user) {
('❌ 사용자를 찾을 수 없습니다.');
      return;
    }

    // 2. 첫 구독자로 인식하여 무료 체험 정보 설정
    user.freeTrialUsed = true;
    user.freeTrialStartDate = new Date();
    user.freeTrialEndDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await user.save();
('✅ 사용자 무료 체험 정보 설정 완료');

    // 3. 구독 정보 수정 (price를 0원으로)
    const subscriptionId = '68e0dc971a540b9609122285';
    const subscription = await Subscription.findById(subscriptionId);
    
    if (subscription) {
('🔍 기존 구독 정보:', { 
        customerId: subscription.customerId, 
        planName: subscription.planName, 
        price: subscription.price 
      });
      
      subscription.price = 0;
      subscription.metadata = {
        ...subscription.metadata,
        isFirstSubscription: true,
        originalPrice: 80000,
        freeTrialApplied: true,
        fixedByScript: true
      };
      
      await subscription.save();
('✅ 구독 가격이 0원으로 수정되었습니다.');
    }

    // 4. 히스토리 정보 수정 (amount를 0원으로)
    const historyId = '68e0dc991a540b9609122291';
    const history = await SubscriptionHistory.findById(historyId);
    
    if (history) {
('🔍 기존 히스토리 정보:', { 
        description: history.description, 
        amount: history.amount 
      });
      
      history.amount = 0;
      history.description = '첫 구독자 무료 혜택이 적용되었습니다! (프리미엄 구독) - 실제 결제: 0원 (원래 금액: 80,000원)';
      history.metadata = {
        ...history.metadata,
        fixedByScript: true,
        actualAmountPaid: 0
      };
      
      await history.save();
('✅ 히스토리 정보가 수정되었습니다.');
    }

('🎉 첫 구독자 무료 혜택 수정 완료!');

  } catch (error) {
    console.error('❌ 수정 실패:', error);
  } finally {
    await mongoose.disconnect();
('DB 연결 종료');
  }
};

fixCurrentUserSubscription();
