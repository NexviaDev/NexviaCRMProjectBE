const mongoose = require('mongoose');
require('dotenv').config();

// MongoDB 연결
const connectDB = async () => {
    try {
        const options = {
            serverSelectionTimeoutMS: 30000,
            socketTimeoutMS: 45000
        };
        
        await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/crm_project', options);
('✅ MongoDB 연결 성공');
    } catch (error) {
        console.error('❌ MongoDB 연결 실패:', error.message);
        process.exit(1);
    }
};

// User 모델 불러오기
const User = require('./models/user.model');

// position 필드 상태 확인
const checkPositions = async () => {
    try {
('🔍 사용자 직급 필드 상태를 확인합니다...\n');

        // 1. 전체 사용자 수
        const totalUsers = await User.countDocuments();
(`📊 전체 사용자 수: ${totalUsers}명`);

        // 2. position 필드가 있는 사용자
        const usersWithPosition = await User.countDocuments({
            position: { $exists: true, $ne: null, $ne: '' }
        });
(`✅ 직급 정보가 있는 사용자: ${usersWithPosition}명`);

        // 3. position 필드가 없는 사용자
        const usersWithoutPosition = await User.countDocuments({
            $or: [
                { position: { $exists: false } },
                { position: null },
                { position: '' }
            ]
        });
(`❌ 직급 정보가 없는 사용자: ${usersWithoutPosition}명`);

        // 4. 직급별 사용자 수
('\n📈 직급별 사용자 수:');
        const positionStats = await User.aggregate([
            {
                $group: {
                    _id: '$position',
                    count: { $sum: 1 }
                }
            },
            {
                $sort: { count: -1 }
            }
        ]);

        positionStats.forEach(stat => {
            const positionName = stat._id || '미설정';
(`   ${positionName}: ${stat.count}명`);
        });

        // 5. 직급이 없는 사용자 상세 정보
        if (usersWithoutPosition > 0) {
('\n⚠️ 직급 정보가 없는 사용자 목록:');
            const usersWithoutPositionList = await User.find({
                $or: [
                    { position: { $exists: false } },
                    { position: null },
                    { position: '' }
                ]
            }).select('email name level companyName');

            usersWithoutPositionList.forEach(user => {
(`   - ${user.email} (${user.name}) - 레벨: ${user.level}, 회사: ${user.companyName || '없음'}`);
            });
        }

        // 6. 요약
('\n🎯 요약:');
        if (usersWithoutPosition === 0) {
('✅ 모든 사용자가 직급 정보를 가지고 있습니다!');
        } else {
(`⚠️ ${usersWithoutPosition}명의 사용자에게 직급 정보가 필요합니다.`);
('💡 마이그레이션을 실행하여 직급 정보를 추가하세요.');
        }

    } catch (error) {
        console.error('❌ 확인 중 오류 발생:', error.message);
    }
};

// 메인 실행
const main = async () => {
    try {
        await connectDB();
        await checkPositions();
    } catch (error) {
        console.error('❌ 스크립트 실행 실패:', error.message);
    } finally {
        await mongoose.connection.close();
('\n🔌 MongoDB 연결이 종료되었습니다.');
        process.exit(0);
    }
};

// 스크립트 실행
if (require.main === module) {
    main();
}

module.exports = { checkPositions }; 