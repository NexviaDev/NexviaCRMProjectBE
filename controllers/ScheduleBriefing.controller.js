const Schedule = require('../models/Schedule.model');
const Customer = require('../models/Customer.model');
const Property = require('../models/Property.model');
const BriefingLog = require('../models/BriefingLog.model');
const geminiService = require('../services/geminiService');

// 금주 업무리스트 브리핑 생성
exports.generateWeeklyBriefing = async (req, res) => {
    try {
        const user = req.user;
        const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
        
        // 오늘 이미 생성했는지 확인
        const existingLog = await BriefingLog.findOne({
            userId: user._id,
            type: 'weekly',
            generatedDate: today
        });

        // 이미 생성했다면 저장된 데이터 반환
        if (existingLog) {
            return res.json({
                success: true,
                data: existingLog.briefingData,
                isFromCache: true
            });
        }
        
        // 이번 주 시작일과 종료일 계산
        const todayDate = new Date();
        const startOfWeek = new Date(todayDate);
        startOfWeek.setDate(todayDate.getDate() - todayDate.getDay()); // 일요일
        startOfWeek.setHours(0, 0, 0, 0);
        
        const endOfWeek = new Date(startOfWeek);
        endOfWeek.setDate(startOfWeek.getDate() + 6); // 토요일
        endOfWeek.setHours(23, 59, 59, 999);


        // 이번 주 일정 조회
        let query = {
            date: {
                $gte: startOfWeek,
                $lte: endOfWeek
            }
        };

        // 사용자 권한에 따른 필터링 - 레벨과 관계없이 본인 일정만 가져옴
        if (user.level < 5) {
            query.publisher = user._id;
        } else {
            // 레벨이 높아도 본인의 일정만 조회
            query.publisher = user._id;
            query.byCompanyNumber = user.businessNumber;
        }

        console.log('🔍 금주 브리핑 사용자 필터:', {
            userId: user._id.toString(),
            userName: user.name,
            userLevel: user.level,
            businessNumber: user.businessNumber,
            queryCondition: query
        });

        const schedules = await Schedule.find(query)
            .populate('publisher', 'name email businessNumber level phone')
            .populate('relatedCustomers', 'name phone email')
            .populate('relatedProperties', 'title address')
            .populate('relatedContracts', 'contractNumber type status')
            .sort({ date: 1, time: 1 });

        console.log(`📅 가져온 일정 수: ${schedules.length}개`);
        if (schedules.length > 0) {
            console.log('📋 일정 예시:', {
                첫일정제목: schedules[0].title,
                작성자: schedules[0].publisher?.name,
                작성자ID: schedules[0].publisher?._id?.toString()
            });
        }

        if (schedules.length === 0) {
            return res.json({
                success: true,
                data: {
                    briefing: "이번 주에는 등록된 일정이 없습니다. 새로운 일정을 추가하거나 다른 주의 일정을 확인해보세요.",
                    schedules: [],
                    analysis: "일정이 없어 분석할 데이터가 부족합니다."
                }
            });
        }

        // 간단한 브리핑 생성 (30초 타임아웃 방지)
        const briefing = await generateQuickBriefing(schedules, user.name);

        const briefingData = {
            briefing,
            schedules: schedules.slice(0, 5), // 최대 5개만 전송
            weekRange: {
                start: startOfWeek,
                end: endOfWeek
            }
        };

        // 생성된 브리핑을 데이터베이스에 저장 (하루에 한 번만 생성)
        await BriefingLog.create({
            userId: user._id,
            type: 'weekly',
            generatedDate: today,
            briefingData: briefingData
        });

        res.json({
            success: true,
            data: briefingData,
            isFromCache: false
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: '브리핑 생성 중 오류가 발생했습니다.',
            error: error.message
        });
    }
};

// 금주 브리핑 생성 함수 (백그라운드 처리)
async function generateQuickBriefing(schedules, userName) {
    try {
        // 일정 데이터를 상세하게 변환 (TIP 생성용)
        const scheduleData = schedules.map(schedule => ({
            title: schedule.title,
            date: schedule.date?.toISOString().split('T')[0],
            time: schedule.time,
            type: schedule.type,
            location: schedule.location,
            publisher: schedule.publisher?.name || '미정',
            description: schedule.description || '',
            priority: schedule.priority || '보통',
            status: schedule.status || '예정',
            customers: schedule.relatedCustomers?.map(c => c.name).join(', ') || '',
            properties: schedule.relatedProperties?.map(p => p.title).join(', ') || '',
            contracts: schedule.relatedContracts?.map(c => c.title).join(', ') || '',
            companyNumber: schedule.byCompanyNumber || '',
            cancelReason: schedule.cancelReason || '',
            isDeleted: schedule.isDeleted || false,
            createdAt: schedule.createdAt?.toISOString().split('T')[0] || '',
            updatedAt: schedule.updatedAt?.toISOString().split('T')[0] || ''
        }));

        // 모든 DB 정보를 포함한 상세 프롬프트
        const scheduleDetails = scheduleData.map(s => 
            `제목: ${s.title}, 날짜: ${s.date}, 시간: ${s.time}, 장소: ${s.location}, 유형: ${s.type}, 설명: ${s.description}, 우선순위: ${s.priority}, 상태: ${s.status}, 담당자: ${s.publisher}, 고객: ${s.customers}, 매물: ${s.properties}, 계약: ${s.contracts}, 사업자번호: ${s.companyNumber}, 취소사유: ${s.cancelReason}, 삭제여부: ${s.isDeleted}, 생성일: ${s.createdAt}, 수정일: ${s.updatedAt}`
        ).join(' | ');
        
        const prompt = `${userName}님의 이번 주 업무 일정 완전한 정보: ${scheduleDetails}. 이 모든 정보를 바탕으로 일정들을 성공적으로 수행하기 위한 실무 조언을 상세히 해주세요.`;

        // 백그라운드에서 처리하여 타임아웃 방지 (즉시 응답)
        return new Promise((resolve) => {
            // 즉시 응답을 위해 setTimeout 없이 바로 처리
            setImmediate(async () => {
                try {
                    const briefingText = await geminiService.generateText(prompt);
                    resolve(briefingText);
                } catch (error) {
                    resolve(`${userName}님의 이번 주 일정이 ${schedules.length}개 있습니다. 각 일정을 성공적으로 완료하시길 바랍니다.`);
                }
            });
        });
        
    } catch (error) {
        return `${userName}님의 이번 주 일정이 ${schedules.length}개 있습니다. 각 일정을 성공적으로 완료하시길 바랍니다.`;
    }
}

// 일일 브리핑 생성 함수 (백그라운드 처리)
async function generateDailyBriefing(schedules, userName, targetDate) {
    try {
        // 일정 데이터를 간단하게 변환 (TIP 생성용)
        const scheduleData = schedules.map(schedule => ({
            title: schedule.title,
            time: schedule.time,
            type: schedule.type,
            location: schedule.location,
            publisher: schedule.publisher?.name || '미정',
            description: schedule.description || '',
            priority: schedule.priority || '보통',
            status: schedule.status || '예정',
            customers: schedule.relatedCustomers?.map(c => c.name).join(', ') || '',
            properties: schedule.relatedProperties?.map(p => p.title).join(', ') || '',
            contracts: schedule.relatedContracts?.map(c => c.title).join(', ') || '',
            companyNumber: schedule.byCompanyNumber || '',
            cancelReason: schedule.cancelReason || '',
            isDeleted: schedule.isDeleted || false,
            createdAt: schedule.createdAt?.toISOString().split('T')[0] || '',
            updatedAt: schedule.updatedAt?.toISOString().split('T')[0] || ''
        }));

        // 모든 DB 정보를 포함한 상세 프롬프트
        const scheduleDetails = scheduleData.map(s => 
            `제목: ${s.title}, 시간: ${s.time}, 장소: ${s.location}, 유형: ${s.type}, 설명: ${s.description}, 우선순위: ${s.priority}, 상태: ${s.status}, 담당자: ${s.publisher}, 고객: ${s.customers}, 매물: ${s.properties}, 계약: ${s.contracts}, 사업자번호: ${s.companyNumber}, 취소사유: ${s.cancelReason}, 삭제여부: ${s.isDeleted}, 생성일: ${s.createdAt}, 수정일: ${s.updatedAt}`
        ).join(' | ');
        
        const prompt = `${userName}님의 오늘 업무 일정 완전한 정보: ${scheduleDetails}. 이 모든 정보를 바탕으로 일정들을 성공적으로 수행하기 위한 실무 조언을 상세히 해주세요.`;

        // 백그라운드에서 처리하여 타임아웃 방지 (즉시 응답)
        return new Promise((resolve) => {
            // 즉시 응답을 위해 setTimeout 없이 바로 처리
            setImmediate(async () => {
                try {
                    const briefingText = await geminiService.generateText(prompt);
                    resolve(briefingText);
                } catch (error) {
                    resolve(`${userName}님의 오늘 일정이 ${schedules.length}개 있습니다. 성공적인 하루 되세요!`);
                }
            });
        });
        
    } catch (error) {
        return `${userName}님의 오늘 일정이 ${schedules.length}개 있습니다. 성공적인 하루 되세요!`;
    }
}

// 특정 일정에 대한 만남 메시지 추천
exports.generateMeetingMessage = async (req, res) => {
    try {
        const { scheduleId } = req.params;
        const user = req.user;

        // 일정 조회
        const schedule = await Schedule.findById(scheduleId)
            .populate('publisher', 'name email businessNumber level phone')
            .populate('relatedCustomers', 'name phone email')
            .populate('relatedProperties', 'title address')
            .populate('relatedContracts', 'contractNumber type status');

        if (!schedule) {
            return res.status(404).json({
                success: false,
                message: '일정을 찾을 수 없습니다.'
            });
        }

        // 권한 확인
        if (user.level < 5) {
            if (schedule.publisher._id.toString() !== user._id.toString()) {
                return res.status(403).json({
                    success: false,
                    message: '이 일정에 접근할 권한이 없습니다.'
                });
            }
        } else {
            if (schedule.byCompanyNumber !== user.businessNumber) {
                return res.status(403).json({
                    success: false,
                    message: '이 일정에 접근할 권한이 없습니다.'
                });
            }
        }

        // 관련 고객이 있는 경우 첫 번째 고객 정보 사용
        const customer = schedule.relatedCustomers && schedule.relatedCustomers.length > 0 
            ? schedule.relatedCustomers[0] 
            : null;

        if (!customer) {
            return res.status(400).json({
                success: false,
                message: '이 일정에는 관련 고객 정보가 없습니다.'
            });
        }

        // GEMINI API를 사용하여 메시지 추천 생성
        const messageRecommendation = await geminiService.generateMeetingMessage(schedule, customer);

        res.json({
            success: true,
            data: {
                schedule,
                customer,
                messageRecommendation
            }
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: '메시지 추천 생성 중 오류가 발생했습니다.',
            error: error.message
        });
    }
};

// 일정 분석 및 조언 생성
exports.generateScheduleAnalysis = async (req, res) => {
    try {
        const user = req.user;
        const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
        
        // 오늘 이미 생성했는지 확인
        const existingLog = await BriefingLog.findOne({
            userId: user._id,
            type: 'analysis',
            generatedDate: today
        });

        // 이미 생성했다면 저장된 데이터 반환
        if (existingLog) {
            return res.json({
                success: true,
                data: existingLog.briefingData,
                isFromCache: true
            });
        }

        const { startDate, endDate } = req.query;

        let query = {};

        // 날짜 범위 설정
        if (startDate && endDate) {
            query.date = {
                $gte: new Date(startDate),
                $lte: new Date(endDate)
            };
        } else {
            // 기본적으로 이번 달 일정 조회
            const today = new Date();
            const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
            const endOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);
            
            query.date = {
                $gte: startOfMonth,
                $lte: endOfMonth
            };
        }

        // 사용자 권한에 따른 필터링
        if (user.level < 5) {
            query.publisher = user._id;
        } else {
            query.byCompanyNumber = user.businessNumber;
        }

        const schedules = await Schedule.find(query)
            .populate('publisher', 'name email businessNumber level phone')
            .populate('relatedCustomers', 'name phone email')
            .populate('relatedProperties', 'title address')
            .populate('relatedContracts', 'contractNumber type status')
            .sort({ date: 1, time: 1 });

        if (schedules.length === 0) {
            return res.json({
                success: true,
                data: {
                    analysis: "분석할 일정이 없습니다. 새로운 일정을 추가해보세요.",
                    schedules: []
                }
            });
        }

        // GEMINI API를 사용하여 분석 생성
        const analysis = await geminiService.generateScheduleAnalysis(schedules);

        const analysisData = {
            analysis,
            schedules,
            period: {
                start: query.date.$gte,
                end: query.date.$lte
            }
        };

        // 생성된 분석을 데이터베이스에 저장 (하루에 한 번만 생성)
        await BriefingLog.create({
            userId: user._id,
            type: 'analysis',
            generatedDate: today,
            briefingData: analysisData
        });

        res.json({
            success: true,
            data: analysisData,
            isFromCache: false
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: '일정 분석 생성 중 오류가 발생했습니다.',
            error: error.message
        });
    }
};

// 오늘의 일정 브리핑 생성
exports.generateDailyBriefing = async (req, res) => {
    try {
        const user = req.user;
        const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
        
        // 오늘 이미 생성했는지 확인
        const existingLog = await BriefingLog.findOne({
            userId: user._id,
            type: 'daily',
            generatedDate: today
        });

        // 이미 생성했다면 저장된 데이터 반환
        if (existingLog) {
            return res.json({
                success: true,
                data: existingLog.briefingData,
                isFromCache: true
            });
        }

        const { date } = req.query;

        // 날짜 설정 (기본값: 오늘)
        const targetDate = date ? new Date(date) : new Date();
        const startOfDay = new Date(targetDate);
        startOfDay.setHours(0, 0, 0, 0);
        
        const endOfDay = new Date(targetDate);
        endOfDay.setHours(23, 59, 59, 999);


        // 해당 날짜의 일정 조회
        let query = {
            date: {
                $gte: startOfDay,
                $lte: endOfDay
            }
        };

        // 사용자 권한에 따른 필터링 - 레벨과 관계없이 본인 일정만 가져옴
        if (user.level < 5) {
            query.publisher = user._id;
        } else {
            // 레벨이 높아도 본인의 일정만 조회
            query.publisher = user._id;
            query.byCompanyNumber = user.businessNumber;
        }

        console.log('🔍 일일 브리핑 사용자 필터:', {
            userId: user._id.toString(),
            userName: user.name,
            userLevel: user.level,
            businessNumber: user.businessNumber,
            queryCondition: query,
            targetDate: targetDate.toISOString().split('T')[0]
        });

        const schedules = await Schedule.find(query)
            .populate('publisher', 'name email businessNumber level phone')
            .populate('relatedCustomers', 'name phone email')
            .populate('relatedProperties', 'title address')
            .populate('relatedContracts', 'contractNumber type status')
            .sort({ time: 1 });

        console.log(`📅 가져온 일정 수: ${schedules.length}개`);
        if (schedules.length > 0) {
            console.log('📋 일정 예시:', {
                첫일정제목: schedules[0].title,
                작성자: schedules[0].publisher?.name,
                작성자ID: schedules[0].publisher?._id?.toString()
            });
        }


        if (schedules.length === 0) {
            return res.json({
                success: true,
                data: {
                    briefing: `${targetDate.toLocaleDateString('ko-KR')}에는 등록된 일정이 없습니다.`,
                    schedules: [],
                    date: targetDate
                }
            });
        }

        // 간단한 일일 브리핑 생성 (100자 제한, 주관적 TIP 포함)
        const briefing = await generateDailyBriefing(schedules, user.name, targetDate);

        const briefingData = {
            briefing,
            schedules,
            date: targetDate
        };

        // 생성된 브리핑을 데이터베이스에 저장 (하루에 한 번만 생성)
        await BriefingLog.create({
            userId: user._id,
            type: 'daily',
            generatedDate: today,
            briefingData: briefingData
        });

        res.json({
            success: true,
            data: briefingData,
            isFromCache: false
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: '일일 브리핑 생성 중 오류가 발생했습니다.',
            error: error.message
        });
    }
};
