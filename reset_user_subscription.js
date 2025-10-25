// 사용자 구독 상태 리셋 스크립트
const mongoose = require('mongoose');
require('dotenv').config();

const userSchema = new mongoose.Schema({
  name: String,
  email: String,
  freeTrialUsed: { type: Boolean, default: false },
  freeTrialStartDate: Date,
  freeTrialEndDate: Date,
  isPremium: { type: Boolean, default: false },
  subscriptionStatus: { type: String, default: 'inactive' }
}, { timestamps: true });

const User = mongoose.model('User', userSchema);

const resetUserSubscription = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI_PROD);

    const userId = '68e0d36623149add2d00b293'; // 현재 사용자 ID
    const user = await User.findById(userId);
    
    if (!user) {
      return;
    }

      name: user.name,
      email: user.email,
      freeTrialUsed: user.freeTrialUsed,
      isPremium: user.isPremium,
      subscriptionStatus: user.subscriptionStatus
    });

    // 구독 상태 리셋
    user.freeTrialUsed = false;
    user.freeTrialStartDate = undefined;
    user.freeTrialEndDate = undefined;
    user.isPremium = false;
    user.subscriptionStatus = 'inactive';
    user.subscriptionStartDate = undefined;
    user.subscriptionEndDate = undefined;

    await user.save();


  } catch (error) {
    console.error('❌ 리셋 실패:', error);
  } finally {
    await mongoose.disconnect();
  }
};

resetUserSubscription();
