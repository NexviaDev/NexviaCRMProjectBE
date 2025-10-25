const mongoose = require('mongoose');
const Property = require('./models/Property.model');

// MongoDB 연결
const connectDB = async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/crm_project', {
            useNewUrlParser: true,
            useUnifiedTopology: true,
        });
('MongoDB 연결 성공');
    } catch (error) {
        console.error('MongoDB 연결 실패:', error);
        process.exit(1);
    }
};

// 기존 price, deposit 필드 제거 함수
const removeOldPriceFields = async () => {
    try {
('기존 price, deposit 필드 제거 시작...');
        
        // price 또는 deposit 필드가 있는 매물들 조회
        const properties = await Property.find({
            $or: [
                { price: { $exists: true } },
                { deposit: { $exists: true } }
            ],
            isDeleted: false
        });

(`제거 대상 매물 수: ${properties.length}개`);

        let removedCount = 0;
        let errorCount = 0;

        for (const property of properties) {
            try {
                // price와 deposit 필드 제거
                await Property.findByIdAndUpdate(property._id, {
                    $unset: {
                        price: "",
                        deposit: ""
                    }
                });

(`✅ 필드 제거 완료: ${property.title}`);
                removedCount++;

            } catch (error) {
                console.error(`❌ 필드 제거 실패: ${property.title}`, error.message);
                errorCount++;
            }
        }

('\n=== 필드 제거 완료 ===');
(`성공: ${removedCount}개`);
(`실패: ${errorCount}개`);
(`총 처리: ${removedCount + errorCount}개`);

    } catch (error) {
        console.error('필드 제거 중 오류 발생:', error);
    }
};

// 마이그레이션 실행
const runMigration = async () => {
    await connectDB();
    await removeOldPriceFields();
    
('\n기존 price, deposit 필드 제거가 완료되었습니다.');
    process.exit(0);
};

// 스크립트가 직접 실행된 경우에만 마이그레이션 실행
if (require.main === module) {
    runMigration();
}

module.exports = { removeOldPriceFields };
