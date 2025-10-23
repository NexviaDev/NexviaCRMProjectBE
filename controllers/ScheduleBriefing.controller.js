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

        // 간단한 브리핑 생성 (30초 타임아웃 방지)
        const briefing = await generateQuickBriefing(schedules, user.name);

        res.json({
            success: true,
            data: {
                briefing,
                schedules: schedules.slice(0, 5), // 최대 5개만 전송
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

// 금주 브리핑 생성 함수 (300자 제한, 주관적 TIP 포함)
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
            properties: schedule.relatedProperties?.map(p => p.title).join(', ') || ''
        }));

        // 극도로 간단한 프롬프트
        const prompt = `${userName}님 일정: ${scheduleData.map(s => s.title).join(', ')}. 조언 3가지.`;

        const briefingText = await geminiService.generateText(prompt);
        
        // 응답이 너무 길면 자르기 (단어 단위로 자르기) - 800자 제한
        if (briefingText.length > 800) {
            const truncated = briefingText.substring(0, 797);
            const lastSpace = truncated.lastIndexOf(' ');
            return lastSpace > 750 ? truncated.substring(0, lastSpace) + '...' : truncated + '...';
        }
        return briefingText;
        
    } catch (error) {
        console.error('금주 브리핑 생성 오류:', error);
        return `${userName}님의 이번 주 일정이 ${schedules.length}개 있습니다. 각 일정을 성공적으로 완료하시길 바랍니다.`;
    }
}

// 일일 브리핑 생성 함수 (100자 제한, 주관적 TIP 포함)
async function generateDailyBriefing(schedules, userName, targetDate) {
    try {
        // 일정 데이터를 간단하게 변환 (TIP 생성용)
        const scheduleData = schedules.map(schedule => ({
            title: schedule.title,
            time: schedule.time,
            type: schedule.type,
            location: schedule.location,
            customers: schedule.relatedCustomers?.map(c => c.name).join(', ') || '',
            properties: schedule.relatedProperties?.map(p => p.title).join(', ') || ''
        }));

        // 극도로 간단한 프롬프트
        const prompt = `${userName}님 오늘 일정: ${scheduleData.map(s => s.title).join(', ')}. 조언 2가지.`;

        const briefingText = await geminiService.generateText(prompt);
        
        // 응답이 너무 길면 자르기 (단어 단위로 자르기) - 300자 제한
        if (briefingText.length > 300) {
            const truncated = briefingText.substring(0, 297);
            const lastSpace = truncated.lastIndexOf(' ');
            return lastSpace > 250 ? truncated.substring(0, lastSpace) + '...' : truncated + '...';
        }
        return briefingText;
        
    } catch (error) {
        console.error('일일 브리핑 생성 오류:', error);
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

        // 간단한 일일 브리핑 생성 (100자 제한, 주관적 TIP 포함)
        const briefing = await generateDailyBriefing(schedules, user.name, targetDate);

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
