const mongoose = require('mongoose');
const Property = require('./models/Property.model');
const User = require('./models/user.model');

// MongoDB 연결
const connectDB = async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URI_PROD, {
            useNewUrlParser: true,
            useUnifiedTopology: true,
        });
('MongoDB 연결 성공');
    } catch (error) {
        console.error('MongoDB 연결 실패:', error);
        process.exit(1);
    }
};

// 매물의 byCompanyNumber 업데이트
const updatePropertyCompanyNumbers = async () => {
    try {
('매물의 사업자 번호 업데이트 시작...');
        
        // 모든 매물 조회 (publisher 정보 포함)
        const properties = await Property.find({ isDeleted: false })
            .populate('publisher', 'businessNumber');
        
(`총 ${properties.length}개의 매물을 처리합니다.`);
        
        let updatedCount = 0;
        let errorCount = 0;
        
        for (const property of properties) {
            try {
                if (property.publisher && property.publisher.businessNumber) {
                    // byCompanyNumber가 없거나 다른 경우 업데이트
                    if (!property.byCompanyNumber || property.byCompanyNumber !== property.publisher.businessNumber) {
                        await Property.findByIdAndUpdate(property._id, {
                            byCompanyNumber: property.publisher.businessNumber
                        });
                        updatedCount++;
(`매물 "${property.title}" 업데이트 완료: ${property.publisher.businessNumber}`);
                    } else {
(`매물 "${property.title}" 이미 최신 상태: ${property.byCompanyNumber}`);
                    }
                } else {
(`매물 "${property.title}" - publisher 정보 없음`);
                    errorCount++;
                }
            } catch (error) {
                console.error(`매물 "${property.title}" 업데이트 실패:`, error.message);
                errorCount++;
            }
        }
        
(`\n업데이트 완료:`);
(`- 성공: ${updatedCount}개`);
(`- 실패: ${errorCount}개`);
(`- 총 처리: ${properties.length}개`);
        
    } catch (error) {
        console.error('매물 사업자 번호 업데이트 중 오류:', error);
    }
};

// 스크립트 실행
const runMigration = async () => {
    await connectDB();
    await updatePropertyCompanyNumbers();
    await mongoose.connection.close();
('마이그레이션 완료');
};

// 직접 실행 시에만 마이그레이션 실행
if (require.main === module) {
    runMigration();
}

module.exports = { updatePropertyCompanyNumbers };
