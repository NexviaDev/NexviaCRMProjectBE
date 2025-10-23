const Schedule = require('../models/Schedule.model');
const Customer = require('../models/Customer.model');
const Property = require('../models/Property.model');
const geminiService = require('../services/geminiService');

// 금주 업무리스트 브리핑 생성
exports.generateWeeklyBriefing = async (req, res) => {
    try {
        const user = req.user;
        
        // 즉시 응답을 보내고 백그라운드에서 처리 (Heroku 타임아웃 방지)
        res.json({
            success: true,
            message: "브리핑 생성이 시작되었습니다.",
            data: {
                status: "processing",
                message: "AI가 브리핑을 생성하고 있습니다... 잠시 후 새로고침해주세요."
            }
        });

        // 백그라운드에서 브리핑 생성 처리
        setTimeout(async () => {
            try {
                await generateWeeklyBriefingBackground(user);
            } catch (error) {
                console.error('백그라운드 브리핑 생성 오류:', error);
            }
        }, 100);

    } catch (error) {
        console.error('금주 브리핑 생성 오류:', error);
        res.status(500).json({
            success: false,
            message: '브리핑 생성 중 오류가 발생했습니다.'
        });
    }
};

// 백그라운드에서 실행되는 브리핑 생성 함수
async function generateWeeklyBriefingBackground(user) {
    try {
        // 이번 주 시작일과 종료일 계산
        const today = new Date();
        const startOfWeek = new Date(today);
        startOfWeek.setDate(today.getDate() - today.getDay()); // 일요일
        startOfWeek.setHours(0, 0, 0, 0);
        
        const endOfWeek = new Date(startOfWeek);
        endOfWeek.setDate(startOfWeek.getDate() + 6); // 토요일
        endOfWeek.setHours(23, 59, 59, 999);

        console.log('=== 금주 브리핑 생성 (백그라운드) ===');
        console.log('사용자:', user.name);
        console.log('조회 기간:', startOfWeek.toISOString(), '~', endOfWeek.toISOString());

        // 이번 주 일정 조회
        let query = {
            date: {
                $gte: startOfWeek,
                $lte: endOfWeek
            }
        };

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

        console.log('조회된 일정 수:', schedules.length);

        if (schedules.length === 0) {
            console.log('이번 주 일정이 없습니다.');
            return;
        }

        // GEMINI API를 사용하여 브리핑 생성
        const briefing = await geminiService.generateWeeklyBriefing(schedules, user.name);
        
        // 일정 분석도 함께 생성
        const analysis = await geminiService.generateScheduleAnalysis(schedules);

        console.log('브리핑 생성 완료:', briefing.substring(0, 100) + '...');
        
    } catch (error) {
        console.error('백그라운드 브리핑 생성 오류:', error);
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
        console.error('만남 메시지 추천 생성 오류:', error);
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

        res.json({
            success: true,
            data: {
                analysis,
                schedules,
                period: {
                    start: query.date.$gte,
                    end: query.date.$lte
                }
            }
        });

    } catch (error) {
        console.error('일정 분석 생성 오류:', error);
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
        const { date } = req.query;

        // 날짜 설정 (기본값: 오늘)
        const targetDate = date ? new Date(date) : new Date();
        const startOfDay = new Date(targetDate);
        startOfDay.setHours(0, 0, 0, 0);
        
        const endOfDay = new Date(targetDate);
        endOfDay.setHours(23, 59, 59, 999);

        console.log('=== 일일 브리핑 생성 ===');
        console.log('사용자:', user.name);
        console.log('조회 날짜:', targetDate.toISOString());

        // 해당 날짜의 일정 조회
        let query = {
            date: {
                $gte: startOfDay,
                $lte: endOfDay
            }
        };

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
            .sort({ time: 1 });

        console.log('조회된 일정 수:', schedules.length);

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

        // 일일 브리핑용 프롬프트 - 더 개인적이고 구체적으로
        const detailedSchedules = schedules.map(s => ({
            title: s.title,
            date: s.date,
            time: s.time,
            type: s.type,
            priority: s.priority,
            status: s.status,
            description: s.description,
            location: s.location,
            publisher: s.publisher?.name,
            customers: s.relatedCustomers?.map(c => ({
                name: c.name,
                phone: c.phone,
                email: c.email
            })),
            properties: s.relatedProperties?.map(p => ({
                title: p.title,
                address: p.address
            })),
            contracts: s.relatedContracts?.map(c => ({
                contractNumber: c.contractNumber,
                type: c.type,
                status: c.status
            }))
        }));

        const prompt = `
당신은 부동산 CRM의 전략 코치입니다. ${user.name}님의 오늘 일정을 바탕으로 "언제, 어디서, 누구를" 만나는지 시간순으로 자연스럽게 정리하고, 형식에 얽매이지 말고 Gemini 스스로의 판단으로 가장 효과적인 접근 전략을 제안하세요. 지나치게 목차화하지 말고 흐름 있는 서술형 요약과 실전 조언을 섞어 주세요. (전체 길이: 600자 이내)

시간순 일정 요약 데이터(JSON):
${JSON.stringify(detailedSchedules, null, 2)}

요청 사항:
- 시간 흐름을 따라 핵심 일정과 만남의 맥락을 간결히 묘사
- 각 만남에서 유효한 첫 한마디, 질문 1개, 피해야 할 말 한 가지
- 고객/파트너 유형에 따른 주관적 판단 기반의 접근 전략(톤, 자료, 심리 포인트)
- 매물/계약이 얽힌 경우, 다음 행동 한 줄로 제시

주의:
- 불필요한 형식화/표는 피하고, 자연스러운 문단 구성
- 과도한 일반론 대신, 데이터에 기반한 구체적 조언 중심
- 전체 분량은 600자 이내를 지키기
`;

        const briefing = await geminiService.generateText(prompt, {
            temperature: 0.8
            // 토큰 제한 제거 - 무제한 생성
        });

        res.json({
            success: true,
            data: {
                briefing,
                schedules,
                date: targetDate
            }
        });

    } catch (error) {
        console.error('일일 브리핑 생성 오류:', error);
        res.status(500).json({
            success: false,
            message: '일일 브리핑 생성 중 오류가 발생했습니다.',
            error: error.message
        });
    }
};
