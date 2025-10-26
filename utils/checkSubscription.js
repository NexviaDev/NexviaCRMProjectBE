const Subscription = require('../models/Subscription.model');
const SubscriptionHistory = require('../models/SubscriptionHistory.model');

// 구독 데이터 분석 및 진단
async function analyzeSubscription(subscriptionId) {
  try {
    console.log('\n🔍 구독 데이터 분석 시작...\n');
    
    // 구독 정보 조회
    const subscription = await Subscription.findById(subscriptionId);
    
    if (!subscription) {
      console.log('❌ 구독을 찾을 수 없습니다.');
      return;
    }
    
    const now = new Date();
    const nextBilling = new Date(subscription.nextBillingDate);
    const start = new Date(subscription.startDate);
    
    // 날짜 정보 출력
    console.log('📅 날짜 정보:');
    console.log(`  시작일: ${start.toLocaleString('ko-KR')}`);
    console.log(`  현재: ${now.toLocaleString('ko-KR')}`);
    console.log(`  다음 결제일: ${nextBilling.toLocaleString('ko-KR')}`);
    
    // 차이 계산
    const daysUntilBilling = Math.ceil((nextBilling - now) / (1000 * 60 * 60 * 24));
    const daysSinceStart = Math.ceil((now - start) / (1000 * 60 * 60 * 24));
    
    console.log(`\n⏰ 시간 차이:`);
    console.log(`  시작 후 경과: ${daysSinceStart}일`);
    console.log(`  결제까지 남은 시간: ${daysUntilBilling}일`);
    
    // 결제 상태 확인
    if (nextBilling <= now) {
      console.log('\n⚠️  결제 예정일이 지났습니다!');
      console.log('   자동 결제가 실행되어야 하는 구독입니다.');
    } else {
      console.log(`\n✅ 정상: 결제까지 ${daysUntilBilling}일 남았습니다.`);
    }
    
    // 결제 히스토리 확인
    const history = await SubscriptionHistory.find({
      subscriptionId: subscription._id
    }).sort({ createdAt: -1 }).limit(5);
    
    console.log(`\n📜 최근 히스토리 (${history.length}건):`);
    history.forEach((h, idx) => {
      console.log(`  ${idx + 1}. ${h.action} - ${h.description} (${new Date(h.createdAt).toLocaleString('ko-KR')})`);
    });
    
    // 빌링키 상태
    console.log(`\n🔑 빌링키: ${subscription.billingKey ? '✅ 설정됨' : '❌ 없음'}`);
    console.log(`   재시도 횟수: ${subscription.retryCount || 0}`);
    
    // 결제 예정이 지난 경우 로그
    if (nextBilling <= now) {
      console.log('\n⚠️  다음 결제까지의 일수 계산이 잘못되었을 수 있습니다.');
      const shouldBeNextMonth = new Date(start);
      shouldBeNextMonth.setMonth(shouldBeNextMonth.getMonth() + 1);
      console.log(`  예상: ${shouldBeNextMonth.toLocaleString('ko-KR')}`);
    }
    
    console.log('\n✅ 분석 완료\n');
    
  } catch (error) {
    console.error('❌ 분석 중 오류:', error);
  }
}

// 실제 데이터 확인
const testDate = () => {
  console.log('\n🧪 날짜 계산 테스트\n');
  
  // 사용자의 데이터에서
  const startDate = new Date(1761478664676);
  const nextBilling = new Date(1764157064676);
  
  console.log('시작일:', startDate.toLocaleString('ko-KR'));
  console.log('다음 결제일:', nextBilling.toLocaleString('ko-KR'));
  
  const diff = nextBilling - startDate;
  const daysDiff = diff / (1000 * 60 * 60 * 24);
  
  console.log(`차이: ${daysDiff}일`);
  
  // 올바른 계산
  const correctNext = new Date(startDate);
  correctNext.setMonth(correctNext.getMonth() + 1);
  console.log('예상 다음 결제일:', correctNext.toLocaleString('ko-KR'));
  
  console.log('\n');
};

module.exports = { analyzeSubscription, testDate };

