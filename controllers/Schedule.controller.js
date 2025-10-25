const Schedule = require('../models/Schedule.model');
const User = require('../models/user.model');
const Customer = require('../models/Customer.model');
const Property = require('../models/Property.model');

// 일정 목록 조회
exports.getSchedules = async (req, res) => {
    try {
        const { type, search, status, priority, startDate, endDate, page, limit, publisher } = req.query;
        const user = req.user;


        let query = {};

        // 모든 사용자는 자신이 등록한 일정만 조회
        query.publisher = user._id;
        
        // 디버깅용 로그 (임시)
        console.log('사용자 ID:', user._id);
        console.log('쿼리:', JSON.stringify(query, null, 2));

        // 타입 필터링
        if (type && type !== 'all') {
            query.type = type;
        }

        // 상태 필터링
        if (status && status !== 'all') {
            query.status = status;
        }

        // 우선순위 필터링
        if (priority && priority !== 'all') {
            query.priority = priority;
        }

        // 날짜 범위 필터링
        if (startDate && endDate) {
            query.date = {
                $gte: new Date(startDate),
                $lte: new Date(endDate)
            };
        } else if (startDate) {
            query.date = { $gte: new Date(startDate) };
        } else if (endDate) {
            query.date = { $lte: new Date(endDate) };
        }

        // 검색 필터링
        if (search) {
            query.$or = [
                { title: { $regex: search, $options: 'i' } },
                { description: { $regex: search, $options: 'i' } },
                { location: { $regex: search, $options: 'i' } }
            ];
        }

        // 특정 사용자의 일정만 조회 (publisher 파라미터가 있는 경우)
        if (publisher) {
            query.publisher = publisher;
        }


        // 페이지네이션 파라미터 처리
        const pageNum = parseInt(page) || 1;
        const limitNum = parseInt(limit) || 30;
        const skip = (pageNum - 1) * limitNum;

        // 총 아이템 수 조회
        const totalItems = await Schedule.countDocuments(query);

        const schedules = await Schedule.find(query)
            .populate('publisher', 'name email businessNumber level phone')
            .populate('relatedCustomers', 'name phone email')
            .populate('relatedProperties', 'title address')
            .populate('relatedContracts', 'contractNumber type status') // 계약 정보 추가
            .sort({ date: 1, time: 1 })
            .skip(skip)
            .limit(limitNum);

        res.json({
            success: true,
            data: schedules,
            total: totalItems,
            page: pageNum,
            limit: limitNum,
            totalPages: Math.ceil(totalItems / limitNum)
        });
    } catch (error) {
        console.error('일정 목록 조회 오류:', error);
        res.status(500).json({
            success: false,
            message: '일정 목록을 불러오는 중 오류가 발생했습니다.'
        });
    }
};

// 일정 상세 조회
exports.getSchedule = async (req, res) => {
    try {
        const { id } = req.params;
        const user = req.user;

        const schedule = await Schedule.findById(id)
            .populate('publisher', 'name email businessNumber level phone')
            .populate('relatedCustomers', 'name phone email')
            .populate('relatedProperties', 'title address')
            .populate('relatedContracts', 'contractNumber type status'); // 계약 정보 추가

        if (!schedule) {
            return res.status(404).json({
                success: false,
                message: '일정을 찾을 수 없습니다.'
            });
        }

        // 권한 확인 - 모든 사용자는 자신이 등록한 일정만 조회
        if (schedule.publisher._id.toString() !== user._id.toString()) {
            return res.status(403).json({
                success: false,
                message: '이 일정에 접근할 권한이 없습니다.'
            });
        }

        res.json({
            success: true,
            data: schedule
        });
    } catch (error) {
        console.error('일정 상세 조회 오류:', error);
        res.status(500).json({
            success: false,
            message: '일정 정보를 불러오는 중 오류가 발생했습니다.'
        });
    }
};

// 일정 등록
exports.createSchedule = async (req, res) => {
    try {
        const user = req.user;
        const scheduleData = {
            ...req.body,
            publisher: user._id,
            byCompanyNumber: user.businessNumber || ''
        };


        // 필수 필드 검증
        if (!scheduleData.title || !scheduleData.type || !scheduleData.date || !scheduleData.time || !scheduleData.location) {
            return res.status(400).json({
                success: false,
                message: '일정 제목, 유형, 날짜, 시간, 장소는 필수 입력 항목입니다.'
            });
        }

        // 날짜 형식 검증
        const scheduleDate = new Date(scheduleData.date);
        if (isNaN(scheduleDate.getTime())) {
            return res.status(400).json({
                success: false,
                message: '올바른 날짜 형식을 입력해주세요.'
            });
        }

        // 시간 형식 검증 (HH:MM)
        const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;
        if (!timeRegex.test(scheduleData.time)) {
            return res.status(400).json({
                success: false,
                message: '올바른 시간 형식을 입력해주세요. (예: 14:30)'
            });
        }

        // 관련 고객들이 있는 경우 존재 여부 확인
        if (scheduleData.relatedCustomers && scheduleData.relatedCustomers.length > 0) {
            for (const customerId of scheduleData.relatedCustomers) {
                const customer = await Customer.findById(customerId);
                if (!customer) {
                    return res.status(400).json({
                        success: false,
                        message: `고객 ID ${customerId}를 찾을 수 없습니다.`
                    });
                }
            }
        }

        // 관련 매물이 있는 경우 존재 여부 확인
        if (scheduleData.relatedProperty) {
            const property = await Property.findById(scheduleData.relatedProperty);
            if (!property) {
                return res.status(400).json({
                    success: false,
                    message: '관련 매물을 찾을 수 없습니다.'
                });
            }
        }

        const schedule = new Schedule(scheduleData);
        await schedule.save();

        // 관련 고객들이 있는 경우, 각 고객의 schedules 배열에 일정 ID 추가
        
        if (scheduleData.relatedCustomers && scheduleData.relatedCustomers.length > 0) {
            
            for (const customerId of scheduleData.relatedCustomers) {
                try {
                    const result = await Customer.findByIdAndUpdate(
                        customerId,
                        {
                            $push: {
                                schedules: {
                                    schedule: schedule._id,
                                    addedAt: new Date()
                                }
                            }
                        }
                    );
                    
                    if (result) {
                    } else {
                    }
                } catch (customerUpdateError) {
                    console.error(`❌ 고객 ${customerId}의 schedules 배열 업데이트 오류:`, customerUpdateError);
                    // 개별 고객 업데이트 실패해도 일정 등록은 성공으로 처리
                }
            }
        } else {
        }

        const populatedSchedule = await Schedule.findById(schedule._id)
            .populate('publisher', 'name email businessNumber level phone')
            .populate('relatedCustomers', 'name phone email')
            .populate('relatedProperties', 'title address');

        res.status(201).json({
            success: true,
            message: '일정이 성공적으로 등록되었습니다.',
            data: populatedSchedule
        });
    } catch (error) {
        console.error('일정 등록 오류:', error);
        res.status(500).json({
            success: false,
            message: '일정 등록 중 오류가 발생했습니다.'
        });
    }
};

// 일정 수정
exports.updateSchedule = async (req, res) => {
    try {
        const { id } = req.params;
        const user = req.user;
        const updateData = req.body;

        const schedule = await Schedule.findById(id)
            .populate('publisher', 'name email businessNumber level phone');

        if (!schedule) {
            return res.status(404).json({
                success: false,
                message: '일정을 찾을 수 없습니다.'
            });
        }

        // 권한 확인 - 모든 사용자는 자신이 등록한 일정만 수정
        if (schedule.publisher._id.toString() !== user._id.toString()) {
            return res.status(403).json({
                success: false,
                message: '본인이 등록한 일정만 수정할 수 있습니다.'
            });
        }

        // 상태가 완료로 변경되는 경우 완료 시간 추가
        if (updateData.status === '완료' && schedule.status !== '완료') {
            updateData.completedAt = new Date();
        }

        // 상태가 취소로 변경되는 경우 취소 사유 확인
        if (updateData.status === '취소' && !updateData.cancelReason) {
            return res.status(400).json({
                success: false,
                message: '취소 상태로 변경할 때는 취소 사유를 입력해주세요.'
            });
        }

        // 관련 고객들이 변경된 경우 처리
        if (updateData.relatedCustomers !== undefined) {
            const oldSchedule = await Schedule.findById(id);
            
            
            
            // 기존 relatedCustomers 배열이 있는 경우 처리
            if (oldSchedule.relatedCustomers && oldSchedule.relatedCustomers.length > 0) {
                for (const customerId of oldSchedule.relatedCustomers) {
                    try {
                        await Customer.findByIdAndUpdate(
                            customerId,
                            {
                                $pull: { schedules: { schedule: id } }
                            }
                        );
                    } catch (error) {
                        console.error(`기존 고객 ${customerId}에서 일정 제거 오류:`, error);
                    }
                }
            }

            // 새 고객들에 일정 추가
            if (updateData.relatedCustomers && updateData.relatedCustomers.length > 0) {
                for (const customerId of updateData.relatedCustomers) {
                    try {
                        await Customer.findByIdAndUpdate(
                            customerId,
                            {
                                $push: {
                                    schedules: {
                                        schedule: id,
                                        addedAt: new Date()
                                    }
                                }
                            }
                        );
                    } catch (error) {
                        console.error(`새 고객 ${customerId}에 일정 추가 오류:`, error);
                    }
                }
            }
        }

        // byCompanyNumber 업데이트 추가
        updateData.byCompanyNumber = user.businessNumber || '';

        const updatedSchedule = await Schedule.findByIdAndUpdate(
            id,
            updateData,
            { new: true }
        ).populate('publisher', 'name email businessNumber level phone')
         .populate('relatedCustomers', 'name phone email')
         .populate('relatedProperties', 'title address');

        res.json({
            success: true,
            message: '일정이 성공적으로 수정되었습니다.',
            data: updatedSchedule
        });
    } catch (error) {
        console.error('일정 수정 오류:', error);
        res.status(500).json({
            success: false,
            message: '일정 수정 중 오류가 발생했습니다.'
        });
    }
};

// 일정 삭제
exports.deleteSchedule = async (req, res) => {
    try {
        const { id } = req.params;
        const user = req.user;

        const schedule = await Schedule.findById(id)
            .populate('publisher', 'name email businessNumber level phone');

        if (!schedule) {
            return res.status(404).json({
                success: false,
                message: '일정을 찾을 수 없습니다.'
            });
        }

        // 권한 확인 - 모든 사용자는 자신이 등록한 일정만 삭제
        if (schedule.publisher._id.toString() !== user._id.toString()) {
            return res.status(403).json({
                success: false,
                message: '이 일정을 삭제할 권한이 없습니다.'
            });
        }


        
        // relatedCustomers 배열이 있는 경우 처리
        if (schedule.relatedCustomers && schedule.relatedCustomers.length > 0) {
            for (const customerId of schedule.relatedCustomers) {
                try {
                    await Customer.findByIdAndUpdate(
                        customerId,
                        {
                            $pull: { schedules: { schedule: id } }
                        }
                    );
                } catch (customerUpdateError) {
                    console.error(`고객 ${customerId}의 schedules 배열 업데이트 오류:`, customerUpdateError);
                    // 개별 고객 업데이트 실패해도 일정 삭제는 성공으로 처리
                }
            }
        }

        // MongoDB에서 완전히 삭제
        await Schedule.findByIdAndDelete(id);

        res.json({
            success: true,
            message: '일정이 성공적으로 삭제되었습니다.'
        });
    } catch (error) {
        console.error('일정 삭제 오류:', error);
        res.status(500).json({
            success: false,
            message: '일정 삭제 중 오류가 발생했습니다.'
        });
    }
};

// 월별 일정 조회 (캘린더용)
exports.getMonthlySchedules = async (req, res) => {
    try {
        const { year, month } = req.params;
        const user = req.user;

        const startDate = new Date(year, month - 1, 1);
        const endDate = new Date(year, month, 0);

        let query = {
            date: {
                $gte: startDate,
                $lte: endDate
            },
            // 모든 사용자는 자신이 등록한 일정만 조회
            publisher: user._id
        };

        const schedules = await Schedule.find(query)
            .populate('publisher', 'name email businessNumber level phone')
            .populate('relatedCustomer', 'name phone email')
            .populate('relatedProperty', 'title address')
            .sort({ date: 1, time: 1 });

        res.json({
            success: true,
            data: schedules
        });
    } catch (error) {
        console.error('월별 일정 조회 오류:', error);
        res.status(500).json({
            success: false,
            message: '월별 일정을 불러오는 중 오류가 발생했습니다.'
        });
    }
}; 