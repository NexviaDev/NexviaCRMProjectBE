const Schedule = require('../models/Schedule.model');
const Customer = require('../models/Customer.model');
const Property = require('../models/Property.model');
const geminiService = require('../services/geminiService');

// 금주 업무리스트 브리핑 생성
exports.generateWeeklyBriefing = async (req, res) => {
    try {
        const user = req.user;
        
        // 이번 주 시작일과 종료일 계산
        const today = new Date();
        const startOfWeek = new Date(today);
        startOfWeek.setDate(today.getDate() - today.getDay()); // 일요일
        startOfWeek.setHours(0, 0, 0, 0);
        
        const endOfWeek = new Date(startOfWeek);
        endOfWeek.setDate(startOfWeek.getDate() + 6); // 토요일
        endOfWeek.setHours(23, 59, 59, 999);

        console.log('=== 금주 브리핑 생성 ===');
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
            return res.json({
                success: true,
                data: {
                    briefing: "이번 주에는 등록된 일정이 없습니다. 새로운 일정을 추가하거나 다른 주의 일정을 확인해보세요.",
                    schedules: [],
                    analysis: "일정이 없어 분석할 데이터가 부족합니다."
                }
            });
        }

        // GEMINI API를 사용하여 브리핑 생성
        const briefing = await geminiService.generateWeeklyBriefing(schedules, user.name);
        
        // 일정 분석도 함께 생성
        const analysis = await geminiService.generateScheduleAnalysis(schedules);

        res.json({
            success: true,
            data: {
                briefing,
                analysis,
                schedules,
                weekRange: {
                    start: startOfWeek,
                    end: endOfWeek
                }
            }
        });

    } catch (error) {
        console.error('금주 브리핑 생성 오류:', error);
        res.status(500).json({
            success: false,
            message: '브리핑 생성 중 오류가 발생했습니다.',
            error: error.message
        });
    }
};

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
당신은 부동산 전문가이자 개인 코치입니다. 사용자 "${user.name}"의 ${targetDate.toLocaleDateString('ko-KR')} 일정을 분석하여 간결하고 실용적인 오늘의 업무 브리핑을 작성해주세요 (최대 800자).

📋 오늘의 일정 상세 데이터:
${JSON.stringify(detailedSchedules, null, 2)}

🎯 다음 형식으로 간결한 일일 브리핑을 작성해주세요:

## 🌅 ${user.name}님의 ${targetDate.toLocaleDateString('ko-KR')} 맞춤 업무 브리핑

### 🔍 오늘의 핵심 일정
- 각 일정의 중요도와 비즈니스 임팩트
- 고객별 특성과 니즈 파악

### 💡 성공 전략
- ${user.name}님만을 위한 특별한 접근법
- 고객별 맞춤 대화 포인트
- 매물별 마케팅 전략

### 🎯 실전 조언
- 구체적인 실행 방안
- 거래 성사율을 높이는 팁
- 주의사항과 리스크 관리

### 📈 오늘의 목표
- 예상 성과와 달성 방안
- 내일을 위한 준비사항

각 조언은 구체적이고 실행 가능해야 하며, ${user.name}님의 개인적 상황을 고려한 맞춤형 내용이어야 합니다.
한국어로 친근하면서도 전문적인 톤으로 작성해주세요.
`;

        const briefing = await geminiService.generateText(prompt, {
            temperature: 0.8,
            maxOutputTokens: 800  // 오늘 브리핑을 800자로 제한
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
