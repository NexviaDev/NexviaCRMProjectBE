const mongoose = require('mongoose');
require('dotenv').config();

// MongoDB 연결
const connectDB = async () => {
    try {
        const options = {
            serverSelectionTimeoutMS: 30000, // 30초
            socketTimeoutMS: 45000, // 45초
            bufferMaxEntries: 0,
            bufferCommands: false,
            maxPoolSize: 10,
            minPoolSize: 1
        };
        
        await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/crm_project', options);
('✅ MongoDB 연결 성공');
        
        // 연결 상태 모니터링
        mongoose.connection.on('error', (err) => {
            console.error('❌ MongoDB 연결 오류:', err);
        });
        
        mongoose.connection.on('disconnected', () => {
('⚠️ MongoDB 연결이 끊어졌습니다.');
        });
        
    } catch (error) {
        console.error('❌ MongoDB 연결 실패:', error.message);
        process.exit(1);
    }
};

// User 모델 불러오기
const User = require('./models/user.model');

// 마이그레이션 실행 함수
const migrateUserPositions = async () => {
    try {
('🚀 사용자 직급 필드 마이그레이션을 시작합니다...\n');

        // 1. position 필드가 없는 사용자 찾기
        const usersWithoutPosition = await User.find({
            $or: [
                { position: { $exists: false } },
                { position: null },
                { position: '' }
            ]
        });

(`📊 총 ${usersWithoutPosition.length}명의 사용자에게 직급 필드가 필요합니다.`);

        if (usersWithoutPosition.length === 0) {
('✅ 모든 사용자가 이미 직급 정보를 가지고 있습니다.');
            return;
        }

        // 2. 각 사용자에게 기본 직급 설정
        let successCount = 0;
        let errorCount = 0;

        for (const user of usersWithoutPosition) {
            try {
                // 사용자 정보에 따라 적절한 기본 직급 설정
                let defaultPosition = '사원'; // 기본값

                // 회사명이나 사업자번호가 있는 경우 '대리'로 설정
                if (user.companyName && user.businessNumber) {
                    defaultPosition = '대리';
                }

                // 레벨이 높은 사용자는 더 높은 직급으로 설정
                if (user.level >= 10) {
                    defaultPosition = '부장';
                } else if (user.level >= 5) {
                    defaultPosition = '과장';
                } else if (user.level >= 3) {
                    defaultPosition = '대리';
                }

                // position 필드 추가
                await User.findByIdAndUpdate(user._id, {
                    $set: { position: defaultPosition }
                });

(`✅ ${user.email} (${user.name}) - 직급: ${defaultPosition} 설정 완료`);
                successCount++;

            } catch (error) {
                console.error(`❌ ${user.email} 직급 설정 실패:`, error.message);
                errorCount++;
            }
        }

(`\n🎉 마이그레이션 완료!`);
(`   ✅ 성공: ${successCount}명`);
(`   ❌ 실패: ${errorCount}명`);

        // 3. 직급별 사용자 수 통계 출력
('\n📊 직급별 사용자 수 통계:');
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

        // 4. 전체 사용자 수 확인
        const totalUsers = await User.countDocuments();
(`\n📈 전체 사용자 수: ${totalUsers}명`);

    } catch (error) {
        console.error('❌ 마이그레이션 실행 중 오류 발생:', error.message);
    }
};

// 메인 실행 함수
const main = async () => {
    try {
        await connectDB();
        await migrateUserPositions();
        
('\n🎯 마이그레이션이 완료되었습니다.');
('💡 이제 모든 사용자가 position 필드를 가지고 있습니다.');
        
    } catch (error) {
        console.error('❌ 마이그레이션 실패:', error.message);
    } finally {
        // MongoDB 연결 종료
        await mongoose.connection.close();
('🔌 MongoDB 연결이 종료되었습니다.');
        process.exit(0);
    }
};

// 스크립트 실행
if (require.main === module) {
    main();
}

module.exports = { migrateUserPositions }; 