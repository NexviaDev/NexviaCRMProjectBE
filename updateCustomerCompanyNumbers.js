const mongoose = require('mongoose');
const Customer = require('./models/Customer.model');
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

// 고객의 byCompanyNumber 업데이트
const updateCustomerCompanyNumbers = async () => {
    try {
('고객의 사업자 번호 업데이트 시작...');
        
        // 모든 고객 조회 (publisher 정보 포함)
        const customers = await Customer.find({ isDeleted: false })
            .populate('publisher', 'businessNumber');
        
(`총 ${customers.length}개의 고객을 처리합니다.`);
        
        let updatedCount = 0;
        let errorCount = 0;
        
        for (const customer of customers) {
            try {
                if (customer.publisher && customer.publisher.businessNumber) {
                    // byCompanyNumber가 없거나 다른 경우 업데이트
                    if (!customer.byCompanyNumber || customer.byCompanyNumber !== customer.publisher.businessNumber) {
                        await Customer.findByIdAndUpdate(customer._id, {
                            byCompanyNumber: customer.publisher.businessNumber
                        });
                        updatedCount++;
(`고객 "${customer.name}" 업데이트 완료: ${customer.publisher.businessNumber}`);
                    } else {
(`고객 "${customer.name}" 이미 최신 상태: ${customer.byCompanyNumber}`);
                    }
                } else {
(`고객 "${customer.name}" - publisher 정보 없음`);
                    errorCount++;
                }
            } catch (error) {
                console.error(`고객 "${customer.name}" 업데이트 실패:`, error.message);
                errorCount++;
            }
        }
        
(`\n업데이트 완료:`);
(`- 성공: ${updatedCount}개`);
(`- 실패: ${errorCount}개`);
(`- 총 처리: ${customers.length}개`);
        
    } catch (error) {
        console.error('고객 사업자 번호 업데이트 중 오류:', error);
    }
};

// 스크립트 실행
const runMigration = async () => {
    await connectDB();
    await updateCustomerCompanyNumbers();
    await mongoose.connection.close();
('마이그레이션 완료');
};

// 직접 실행 시에만 마이그레이션 실행
if (require.main === module) {
    runMigration();
}

module.exports = { updateCustomerCompanyNumbers };
