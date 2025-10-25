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

// 매물 가격 마이그레이션 함수
const migratePropertyPrices = async () => {
    try {
('매물 가격 마이그레이션 시작...');
        
        // prices 필드가 없거나 비어있는 매물들 조회
        const properties = await Property.find({
            $or: [
                { prices: { $exists: false } },
                { prices: null },
                { 'prices.매매가격': { $exists: false } }
            ],
            isDeleted: false
        });

(`마이그레이션 대상 매물 수: ${properties.length}개`);

        let migratedCount = 0;
        let errorCount = 0;

        for (const property of properties) {
            try {
                // 기존 price와 deposit 값 가져오기
                const existingPrice = property.price || 0;
                const existingDeposit = property.deposit || 0;
                const propertyTypes = property.type || [];

                // prices 객체 생성
                const prices = {
                    매매가격: null,
                    월세가격: null,
                    월세보증금: null,
                    전세가격: null
                };

                // 매물 유형에 따라 가격 할당
                if (propertyTypes.includes('매매')) {
                    prices.매매가격 = existingPrice;
                }
                
                if (propertyTypes.includes('월세')) {
                    prices.월세가격 = existingPrice;
                    prices.월세보증금 = existingDeposit;
                }
                
                if (propertyTypes.includes('전세')) {
                    prices.전세가격 = existingPrice;
                }

                // 실거주인 경우 모든 가격을 null로 설정
                if (propertyTypes.includes('실거주')) {
                    prices.매매가격 = null;
                    prices.월세가격 = null;
                    prices.월세보증금 = null;
                    prices.전세가격 = null;
                }

                // 매물 업데이트
                await Property.findByIdAndUpdate(property._id, {
                    $set: { prices: prices }
                });

(`✅ 마이그레이션 완료: ${property.title} (${propertyTypes.join(', ')})`);
                migratedCount++;

            } catch (error) {
                console.error(`❌ 마이그레이션 실패: ${property.title}`, error.message);
                errorCount++;
            }
        }

('\n=== 마이그레이션 완료 ===');
(`성공: ${migratedCount}개`);
(`실패: ${errorCount}개`);
(`총 처리: ${migratedCount + errorCount}개`);

    } catch (error) {
        console.error('마이그레이션 중 오류 발생:', error);
    }
};

// 마이그레이션 실행
const runMigration = async () => {
    await connectDB();
    await migratePropertyPrices();
    
('\n마이그레이션이 완료되었습니다.');
    process.exit(0);
};

// 스크립트가 직접 실행된 경우에만 마이그레이션 실행
if (require.main === module) {
    runMigration();
}

module.exports = { migratePropertyPrices };
