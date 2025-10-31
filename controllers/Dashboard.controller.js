const Property = require('../models/Property.model');
const Customer = require('../models/Customer.model');
const Contract = require('../models/Contract.model');
const Schedule = require('../models/Schedule.model');

// 홈 대시보드 통계 조회 (최적화된 버전)
const getDashboardStats = async (req, res) => {
    try {
        const user = req.user;

        // 현재 날짜 설정
        const today = new Date().toISOString().split('T')[0];
        const currentMonth = new Date().getMonth() + 1;
        const currentYear = new Date().getFullYear();
        const startOfMonth = new Date(currentYear, currentMonth - 1, 1);

        // 사업자번호 필터링 조건 설정
        // 통계는 본인이 속한 사업자번호와 동일한 데이터만 계산 (level >= 11 전체 관리자는 제외)
        let propertyQuery = { isDeleted: false };
        let customerQuery = { isDeleted: false };
        let contractQuery = {};
        let scheduleQuery = { isDeleted: false, date: { $gte: today }, status: '예정' };

        if (user.level >= 11) {
            // 레벨 11 이상(전체 관리자): 모든 데이터 조회 가능 (필터링 없음)
        } else if (user.businessNumber) {
            // 같은 사업자번호만 조회 (본인이 속한 회사의 데이터만)
            propertyQuery.byCompanyNumber = user.businessNumber;
            customerQuery.byCompanyNumber = user.businessNumber;
            contractQuery.byCompanyNumber = user.businessNumber;
            scheduleQuery.byCompanyNumber = user.businessNumber;
        } else {
            // 사업자번호가 없으면 본인이 등록한 데이터만
            propertyQuery.publisher = user._id;
            customerQuery.publisher = user._id;
            contractQuery.publisher = user._id;
            scheduleQuery.publisher = user._id;
        }

        // 병렬로 모든 통계를 한번에 조회
        const [
            totalProperties,
            activeBuyers,
            activeSellers,
            pendingContracts,
            completedContracts,
            upcomingAppointments,
            allContracts
        ] = await Promise.all([
            // 1. 총 매물 수 (같은 사업자번호만)
            Property.countDocuments(propertyQuery),
            
            // 2. 활성 매수자 수 (같은 사업자번호만, categories 배열에 '매수' 포함된 고객)
            Customer.countDocuments({ ...customerQuery, categories: { $in: ['매수'] }, status: '활성' }),
            
            // 3. 활성 매도자 수 (같은 사업자번호만, categories 배열에 '매도' 포함된 고객)
            Customer.countDocuments({ ...customerQuery, categories: { $in: ['매도'] }, status: '활성' }),
            
            // 4. 진행 중인 계약 수 (같은 사업자번호만)
            Contract.countDocuments({ ...contractQuery, status: '진행중' }),
            
            // 5. 완료된 계약 수 (같은 사업자번호만)
            Contract.countDocuments({ ...contractQuery, status: '완료' }),
            
            // 6. 예정 일정 수 (오늘 이후, 같은 사업자번호만)
            Schedule.countDocuments(scheduleQuery),
            
            // 7. 월 매출 계산을 위한 계약 데이터 (같은 사업자번호만)
            Contract.find({ ...contractQuery, status: '완료' })
                .select('contractDate commission')
                .lean()
        ]);

        // 활성 고객 수 합계
        const activeCustomers = activeBuyers + activeSellers;

        // 월 매출 계산 (이번 달 완료된 계약들의 수수료 합계)
        const monthlyRevenue = allContracts.reduce((sum, contract) => {
            if (!contract.contractDate) return sum;
            
            try {
                const contractDate = new Date(contract.contractDate);
                const contractMonth = contractDate.getMonth() + 1;
                const contractYear = contractDate.getFullYear();
                
                if (contractMonth === currentMonth && contractYear === currentYear) {
                    return sum + (contract.commission || 0);
                }
            } catch (error) {
                // 날짜 파싱 오류 무시
            }
            return sum;
        }, 0);

        res.json({
            success: true,
            data: {
                totalProperties,
                activeCustomers,
                pendingContracts,
                completedDeals: completedContracts,
                monthlyRevenue: monthlyRevenue > 0 ? monthlyRevenue.toLocaleString() + '원' : '0원',
                upcomingAppointments
            }
        });

    } catch (error) {
        console.error('대시보드 통계 조회 오류:', error);
        res.status(500).json({
            success: false,
            message: '통계 데이터를 불러오는데 실패했습니다.',
            error: error.message
        });
    }
};

module.exports = {
    getDashboardStats
};

