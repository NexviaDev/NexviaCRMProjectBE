const Customer = require('../models/Customer.model');
const User = require('../models/user.model');
const Property = require('../models/Property.model');
const Schedule = require('../models/Schedule.model');
const SMS = require('../models/SMS.model');
const { logCustomerActivity } = require('../utils/activityLogger');

// 고객 목록 조회
exports.getCustomers = async (req, res) => {
    try {
        const { type, search, status, tabType } = req.query;
        const user = req.user;

        let query = {};

        // 사용자 권한에 따른 필터링
        if (user.level >= 11) {
            // 레벨 11 이상: 모든 고객 조회 가능
        } else if (user.businessNumber) {
            // 사업자번호가 있는 경우: 같은 사업자번호의 고객만 조회
            query.byCompanyNumber = user.businessNumber;
        } else {
            // 그 외: 자신이 등록한 고객만 조회
            query.publisher = user._id;
        }

        // 타입 필터링 (기존 호환성을 위해 유지)
        if (type && type !== 'all') {
            if (type === '매수자') {
                query.categories = '매수';
            } else if (type === '매도자') {
                query.categories = '매도';
            }
        }

        // 탭별 필터링 (매수자/매도자/일반)
        if (tabType) {
     
            // 데이터베이스의 모든 고객 분류 확인 (임시)
            if (tabType === '일반') {
                const allCategories = await Customer.distinct('categories');
            }

            if (tabType === '매수자') {
                query.categories = '매수';
            } else if (tabType === '매도자') {
                query.categories = '매도';
            } else if (tabType === '일반') {
                // 일반 탭: 모든 고객 표시 (필터링 없음)
                // query를 설정하지 않음 (기본적으로 모든 고객 조회)
            }

        }

        // 상태 필터링
        if (status && status !== 'all') {
            query.status = status;
        }

        // 검색 필터링
        if (search) {
            query.$or = [
                { name: { $regex: search, $options: 'i' } },
                { phone: { $regex: search, $options: 'i' } },
                { email: { $regex: search, $options: 'i' } }
            ];
        }



        // 페이지네이션 파라미터 처리
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 30;
        const skip = (page - 1) * limit;

        // 총 아이템 수 조회
        const totalItems = await Customer.countDocuments(query);


        const customers = await Customer.find(query)
            .populate('publisher', 'name email businessNumber level')
            .populate('properties.property', 'title address type')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit);

        res.json({
            success: true,
            data: customers,
            total: totalItems,
            page: page,
            limit: limit,
            totalPages: Math.ceil(totalItems / limit)
        });
    } catch (error) {
        console.error('고객 목록 조회 오류:', error);
        res.status(500).json({
            success: false,
            message: '고객 목록을 불러오는 중 오류가 발생했습니다.'
        });
    }
};

// 고객의 일정 목록 조회
exports.getCustomerSchedules = async (req, res) => {
    try {
        const { id } = req.params;
        const user = req.user;

        // 고객 정보 조회
        const customer = await Customer.findById(id);
        if (!customer) {
            return res.status(404).json({
                success: false,
                message: '고객을 찾을 수 없습니다.'
            });
        }

        // 권한 확인
        if (user.level < 11) {
            // Level 11 미만은 자신이 등록한 고객의 일정만 조회 가능
            if (customer.publisher.toString() !== user._id.toString()) {
                // 같은 사업자번호를 가진 사용자가 등록한 고객인지 확인
                const customerPublisher = await User.findById(customer.publisher);
                if (!customerPublisher || customerPublisher.businessNumber !== user.businessNumber) {
                    return res.status(403).json({
                        success: false,
                        message: '이 고객의 일정에 접근할 권한이 없습니다.'
                    });
                }
            }
        }

        // 고객과 관련된 일정 조회
        const schedules = await Schedule.find({
            relatedCustomers: customer._id,
            isDeleted: false
        })
        .populate('publisher', 'name email businessNumber')
        .populate('relatedCustomers', 'name phone email')
        .populate('relatedProperties', 'title address')
        .populate('relatedContracts', 'contractNumber type status')
        .sort({ date: -1, createdAt: -1 })
        .distinct('_id'); // 중복 제거를 위해 _id로 distinct

        // distinct로 얻은 _id 배열을 사용하여 전체 일정 정보 조회
        const uniqueSchedules = await Schedule.find({
            _id: { $in: schedules }
        })
        .populate('publisher', 'name email businessNumber')
        .populate('relatedCustomers', 'name phone email')
        .populate('relatedProperties', 'title address')
        .populate('relatedContracts', 'contractNumber type status')
        .sort({ date: -1, createdAt: -1 });

        res.json({
            success: true,
            data: uniqueSchedules
        });
    } catch (error) {
        console.error('고객 일정 조회 오류:', error);
        res.status(500).json({
            success: false,
            message: '고객 일정을 불러오는 중 오류가 발생했습니다.'
        });
    }
};

// 고객 검색 (일정 등록용)
exports.searchCustomers = async (req, res) => {
    try {
        const { q } = req.query; // 검색어
        const user = req.user;
        const limit = 20; // 검색 결과 제한

        if (!q || q.trim().length === 0) {
            return res.json({
                success: true,
                data: [],
                message: '검색어를 입력해주세요.'
            });
        }

        let query = {};

        // 사용자 권한에 따른 필터링
        if (user.level >= 11) {
            // 레벨 11 이상: 모든 고객 검색 가능
        } else if (user.businessNumber) {
            // 사업자번호가 있는 경우: 같은 사업자번호의 고객만 검색
            const usersWithSameBusiness = await User.find({ businessNumber: user.businessNumber }).select('_id');
            query.publisher = { $in: usersWithSameBusiness };
        } else {
            // 그 외: 자신이 등록한 고객만 검색
            query.publisher = user._id;
        }

        // 검색어로 고객명, 전화번호, 이메일 검색
        const searchRegex = new RegExp(q.trim(), 'i');
        query.$or = [
            { name: searchRegex },
            { phone: searchRegex },
            { email: searchRegex }
        ];

        const customers = await Customer.find(query)
            .select('_id name phone email')
            .limit(limit)
            .sort({ name: 1 });

        res.json({
            success: true,
            data: customers,
            total: customers.length
        });
    } catch (error) {
        console.error('고객 검색 오류:', error);
        res.status(500).json({
            success: false,
            message: '고객 검색 중 오류가 발생했습니다.'
        });
    }
};

// 고객 상세 조회
exports.getCustomer = async (req, res) => {
    try {
        const { id } = req.params;
        const user = req.user;

        const customer = await Customer.findById(id)
            .populate('publisher', 'name email businessNumber level')
            .populate('properties.property', 'title address type price deposit');

        if (!customer) {
            return res.status(404).json({
                success: false,
                message: '고객을 찾을 수 없습니다.'
            });
        }

        // 권한 확인
        if (user.level >= 11) {
            // 레벨 11 이상: 모든 고객 조회 가능
        } else if (user.businessNumber &&
            customer.publisher.businessNumber === user.businessNumber) {
            // 레벨 3 이상이고 같은 사업자번호
        } else if (customer.publisher._id.toString() === user._id.toString()) {
            // 자신이 등록한 고객
        } else {
            return res.status(403).json({
                success: false,
                message: '이 고객 정보에 접근할 권한이 없습니다.'
            });
        }

        res.json({
            success: true,
            data: customer
        });
    } catch (error) {
        console.error('고객 상세 조회 오류:', error);
        res.status(500).json({
            success: false,
            message: '고객 정보를 불러오는 중 오류가 발생했습니다.'
        });
    }
};

// 고객 등록
exports.createCustomer = async (req, res) => {
    try {
        const user = req.user;

        // 금액 필드를 숫자로 변환하는 함수
        const convertToNumber = (value) => {
            if (!value || value === '') return null;
            // 콤마 제거 후 숫자로 변환
            const cleanValue = value.toString().replace(/,/g, '');
            const numValue = parseFloat(cleanValue);
            return isNaN(numValue) ? null : numValue;
        };

        const customerData = {
            ...req.body,
            publisher: user._id,
            byCompanyNumber: user.businessNumber || '',
            lastContact: req.body.lastContact || new Date(),
            // 금액 필드들을 숫자로 변환
            budget: convertToNumber(req.body.budget)
        };

        // buyPriceRanges 처리
        if (req.body.buyPriceRanges) {
            const processedBuyPriceRanges = {};

            // 매매 가격대 처리
            if (req.body.buyPriceRanges.매매) {
                processedBuyPriceRanges.매매 = {
                    min: convertToNumber(req.body.buyPriceRanges.매매.min),
                    max: convertToNumber(req.body.buyPriceRanges.매매.max)
                };
            }

            // 월세 가격대 처리
            if (req.body.buyPriceRanges.월세) {
                processedBuyPriceRanges.월세 = {
                    monthlyRent: {
                        min: convertToNumber(req.body.buyPriceRanges.월세.monthlyRent?.min),
                        max: convertToNumber(req.body.buyPriceRanges.월세.monthlyRent?.max)
                    },
                    deposit: {
                        min: convertToNumber(req.body.buyPriceRanges.월세.deposit?.min),
                        max: convertToNumber(req.body.buyPriceRanges.월세.deposit?.max)
                    }
                };
            }

            // 전세 가격대 처리
            if (req.body.buyPriceRanges.전세) {
                processedBuyPriceRanges.전세 = {
                    min: convertToNumber(req.body.buyPriceRanges.전세.min),
                    max: convertToNumber(req.body.buyPriceRanges.전세.max)
                };
            }

            customerData.buyPriceRanges = processedBuyPriceRanges;
        }

        // properties 배열은 매물 소유자 변경 시에만 처리하므로 여기서는 제거
        customerData.properties = [];

        // 필수 필드 검증
        if (!customerData.name || !customerData.categories || customerData.categories.length === 0) {
            return res.status(400).json({
                success: false,
                message: '고객명과 고객 분류는 필수 입력 항목입니다.'
            });
        }

        // 연락처 중 하나는 필수
        if (!customerData.phone && !customerData.email) {
            return res.status(400).json({
                success: false,
                message: '전화번호 또는 이메일 중 하나는 필수 입력 항목입니다.'
            });
        }



        // 중복 검증: 조건에 따른 검사
        const duplicateQuery = {
            phone: customerData.phone
        };

        // 같은 사업자번호의 사용자들 찾기
        const usersWithSameBusiness = await User.find({ businessNumber: user.businessNumber }).select('_id');
        duplicateQuery.publisher = { $in: usersWithSameBusiness };

        // 매수자와 매도자 모두 중복 검사 없음 (이름이 다르면 등록 가능)
        // if (customerData.phone) {
        //     let existingCustomer = await Customer.findOne(duplicateQuery);
        //     if (existingCustomer) {
        //         return res.status(400).json({
        //             success: false,
        //             message: '동일한 전화번호를 가진 고객이 이미 등록되어 있습니다.',
        //             existingCustomer: { ... }
        //         });
        //     }
        // }



        const customer = new Customer(customerData);
        await customer.save();

        const populatedCustomer = await Customer.findById(customer._id)
            .populate('publisher', 'name email businessNumber level')
            .populate('properties.property', 'title address type');

        // 매물 소유자 변경은 프론트엔드에서 별도로 처리하므로 여기서는 제거

        // 활동기록 로깅
        await logCustomerActivity(
            '고객 등록',
            `${customerData.name} 고객이 등록되었습니다.`,
            user._id,
            user.name || user.email,
            customer._id,
            customerData.name,
            {
                type: customerData.type,
                phone: customerData.phone,
                email: customerData.email,
                address: customerData.address
            },
            req
        );

        res.status(201).json({
            success: true,
            message: '고객이 성공적으로 등록되었습니다.',
            data: populatedCustomer
        });
    } catch (error) {
        console.error('고객 등록 오류:', error);
        res.status(500).json({
            success: false,
            message: '고객 등록 중 오류가 발생했습니다.'
        });
    }
};

// 고객 수정
exports.updateCustomer = async (req, res) => {
    try {
        const { id } = req.params;
        const user = req.user;
        const updateData = req.body;

        // 사용자 정보 가져오기
        const currentUser = await User.findById(user._id);
        if (!currentUser) {
            return res.status(404).json({
                success: false,
                message: '사용자를 찾을 수 없습니다.'
            });
        }



        const customer = await Customer.findById(id)
            .populate('publisher', 'name email businessNumber level')
            .populate('properties.property', 'title address type');

        if (!customer) {
            return res.status(404).json({
                success: false,
                message: '고객을 찾을 수 없습니다.'
            });
        }

        // 권한 확인
        if (user.level >= 11) {
            // 레벨 11 이상: 모든 고객 수정 가능
        } else if (user.businessNumber &&
            customer.publisher.businessNumber === user.businessNumber) {
            // 레벨 3 이상이고 같은 사업자번호
        } else if (customer.publisher._id.toString() === user._id.toString()) {
            // 자신이 등록한 고객
        } else {
            return res.status(403).json({
                success: false,
                message: '이 고객 정보를 수정할 권한이 없습니다.'
            });
        }

        // 비활성화된 고객은 수정 불가 (레벨 11 이상 제외)
        if (customer.status === '비활성' && user.level < 11) {
            return res.status(403).json({
                success: false,
                message: '비활성화된 고객은 수정할 수 없습니다. 관리자에게 문의하세요.'
            });
        }

        // 금액 필드를 숫자로 변환하는 함수
        const convertToNumber = (value) => {
            if (!value || value === '') return null;
            const cleanValue = value.toString().replace(/,/g, '');
            const numValue = parseFloat(cleanValue);
            return isNaN(numValue) ? null : numValue;
        };

        // budget 필드 처리
        if (req.body.budget) {
            updateData.budget = convertToNumber(req.body.budget);
        }

        // buyPriceRanges 처리
        if (req.body.buyPriceRanges) {
            const processedBuyPriceRanges = {};

            // 매매 가격대 처리
            if (req.body.buyPriceRanges.매매) {
                processedBuyPriceRanges.매매 = {
                    min: convertToNumber(req.body.buyPriceRanges.매매.min),
                    max: convertToNumber(req.body.buyPriceRanges.매매.max)
                };
            }

            // 월세 가격대 처리
            if (req.body.buyPriceRanges.월세) {
                processedBuyPriceRanges.월세 = {
                    monthlyRent: {
                        min: convertToNumber(req.body.buyPriceRanges.월세.monthlyRent?.min),
                        max: convertToNumber(req.body.buyPriceRanges.월세.monthlyRent?.max)
                    },
                    deposit: {
                        min: convertToNumber(req.body.buyPriceRanges.월세.deposit?.min),
                        max: convertToNumber(req.body.buyPriceRanges.월세.deposit?.max)
                    }
                };
            }

            // 전세 가격대 처리
            if (req.body.buyPriceRanges.전세) {
                processedBuyPriceRanges.전세 = {
                    min: convertToNumber(req.body.buyPriceRanges.전세.min),
                    max: convertToNumber(req.body.buyPriceRanges.전세.max)
                };
            }

            updateData.buyPriceRanges = processedBuyPriceRanges;
        }

        // properties 배열은 매물 소유자 변경 시에만 처리하므로 여기서는 제거
        delete updateData.properties;

        // 매물 변경 감지 및 히스토리 기록
        const oldProperties = customer.properties || [];
        const newProperties = updateData.properties || [];

        // 제거된 매물들 처리
        for (const oldProp of oldProperties) {
            const stillExists = newProperties.find(newProp =>
                newProp.property.toString() === oldProp.property.toString()
            );

            if (!stillExists) {
                // 매물에서 고객 연결 해제
                const property = await Property.findById(oldProp.property);
                if (property && property.customer && property.customer.toString() === customer._id.toString()) {
                    property.customer = null;
                    property.customerHistory.push({
                        customer: customer._id,
                        customerName: customer.name,
                        customerPhone: customer.phone,
                        changeDate: new Date(),
                        changeType: '해제',
                        changedBy: user._id
                    });
                    await property.save();
                }
            }
        }

        // 새로 추가된 매물들 처리
        for (const newProp of newProperties) {
            const wasExists = oldProperties.find(oldProp =>
                oldProp.property.toString() === newProp.property.toString()
            );

            if (!wasExists) {
                const property = await Property.findById(newProp.property);
                if (property) {
                    // 기존 고객이 있었다면 히스토리에 해제 기록 추가하고 고객을 비활성화
                    if (property.customer) {
                        const existingCustomer = await Customer.findById(property.customer);
                        if (existingCustomer) {
                            await Customer.findByIdAndUpdate(property.customer, {
                                status: '비활성'
                            });

                            property.customerHistory.push({
                                customer: property.customer,
                                customerName: existingCustomer.name,
                                customerPhone: existingCustomer.phone,
                                changeDate: new Date(),
                                changeType: '해제',
                                changedBy: user._id
                            });
                        }
                    }

                    // 새로운 고객 연결 및 히스토리 기록
                    property.customer = customer._id;
                    property.customerHistory.push({
                        customer: customer._id,
                        customerName: customer.name,
                        customerPhone: customer.phone,
                        changeDate: new Date(),
                        changeType: '연결',
                        changedBy: user._id
                    });

                    await property.save();
                }
            }
        }

        // byCompanyNumber 업데이트
        updateData.byCompanyNumber = currentUser.businessNumber || '';

        const updatedCustomer = await Customer.findByIdAndUpdate(
            id,
            updateData,
            { new: true }
        ).populate('publisher', 'name email businessNumber level')
            .populate('properties.property', 'title address type');

        // 활동기록 로깅
        await logCustomerActivity(
            '고객 정보 수정',
            `${updatedCustomer.name} 고객 정보가 수정되었습니다.`,
            user._id,
            user.name || user.email,
            updatedCustomer._id,
            updatedCustomer.name,
            {
                updatedFields: Object.keys(updateData),
                type: updatedCustomer.type,
                phone: updatedCustomer.phone,
                email: updatedCustomer.email
            },
            req
        );

        res.json({
            success: true,
            message: '고객 정보가 성공적으로 수정되었습니다.',
            data: updatedCustomer
        });
    } catch (error) {
        console.error('고객 수정 오류:', error);
        res.status(500).json({
            success: false,
            message: '고객 정보 수정 중 오류가 발생했습니다.'
        });
    }
};

// 고객 삭제 (완전 삭제)
exports.deleteCustomer = async (req, res) => {
    try {
        const { id } = req.params;
        const user = req.user;

        const customer = await Customer.findById(id)
            .populate('publisher', 'name email businessNumber level');

        if (!customer) {
            return res.status(404).json({
                success: false,
                message: '고객을 찾을 수 없습니다.'
            });
        }

        // 권한 확인
        if (user.level >= 11) {
            // 레벨 11 이상: 모든 고객 삭제 가능
        } else if (user.businessNumber &&
            customer.publisher.businessNumber === user.businessNumber) {
            // 레벨 3 이상이고 같은 사업자번호
        } else if (customer.publisher._id.toString() === user._id.toString()) {
            // 자신이 등록한 고객
        } else {
            return res.status(403).json({
                success: false,
                message: '이 고객을 삭제할 권한이 없습니다.'
            });
        }

        // 매물에서 고객 연결 해제
        if (customer.properties && customer.properties.length > 0) {
            for (const prop of customer.properties) {
                const property = await Property.findById(prop.property);
                if (property && property.customer && property.customer.toString() === customer._id.toString()) {
                    property.customer = null;
                    property.customerHistory.push({
                        customer: customer._id,
                        customerName: customer.name,
                        customerPhone: customer.phone,
                        changeDate: new Date(),
                        changeType: '해제',
                        changedBy: user._id
                    });
                    await property.save();
                }
            }
        }

        // 활동기록 로깅 (삭제 전에 로깅)
        await logCustomerActivity(
            '고객 삭제',
            `${customer.name} 고객이 삭제되었습니다.`,
            user._id,
            user.name || user.email,
            customer._id,
            customer.name,
            {
                type: customer.type,
                phone: customer.phone,
                email: customer.email,
                reason: '사용자 요청에 의한 삭제'
            },
            req
        );

        // MongoDB에서 완전히 삭제
        await Customer.findByIdAndDelete(id);

        res.json({
            success: true,
            message: '고객이 성공적으로 삭제되었습니다.'
        });
    } catch (error) {
        console.error('고객 삭제 오류:', error);
        res.status(500).json({
            success: false,
            message: '고객 삭제 중 오류가 발생했습니다.'
        });
    }
};

// 고객 중복 검색
exports.checkDuplicateCustomer = async (req, res) => {
    try {
        const { name, phone, email } = req.query;
        const user = req.user;

        if (!name || (!phone && !email)) {
            return res.status(400).json({
                success: false,
                message: '고객명과 연락처(전화번호 또는 이메일)는 필수입니다.'
            });
        }

        // 같은 사업자번호의 사용자들 찾기
        const usersWithSameBusiness = await User.find({ businessNumber: user.businessNumber }).select('_id');

        // 중복 검색 쿼리 구성
        // 이름이 같고, 같은 사업자번호의 사용자가 등록한 고객 중에서
        // 전화번호나 이메일이 일치하는 고객을 찾기
        const duplicateQuery = {
            name: name,
            publisher: { $in: usersWithSameBusiness }
        };

        // 전화번호나 이메일 중 하나라도 일치하는지 확인
        const contactConditions = [];
        if (phone) contactConditions.push({ phone: phone });
        if (email) contactConditions.push({ email: email });

        if (contactConditions.length > 0) {
            duplicateQuery.$or = contactConditions;
        }

        const existingCustomer = await Customer.findOne(duplicateQuery)
            .populate('publisher', 'name email businessNumber level')
            .populate('properties.property', 'title address type');

        if (existingCustomer) {
            return res.json({
                success: true,
                isDuplicate: true,
                message: '동일한 정보의 고객이 이미 등록되어 있습니다.',
                existingCustomer: {
                    _id: existingCustomer._id,
                    name: existingCustomer.name,
                    phone: existingCustomer.phone,
                    email: existingCustomer.email,
                    categories: existingCustomer.categories,
                    status: existingCustomer.status,
                    publisher: existingCustomer.publisher,
                    properties: existingCustomer.properties,
                    updatedAt: existingCustomer.updatedAt
                }
            });
        }

        res.json({
            success: true,
            isDuplicate: false,
            message: '중복되는 고객이 없습니다.'
        });

    } catch (error) {
        console.error('고객 중복 검색 오류:', error);
        res.status(500).json({
            success: false,
            message: '고객 중복 검색 중 오류가 발생했습니다.'
        });
    }
};

// CSV 일괄 등록 함수 추가
exports.bulkCreateFromCSV = async (req, res) => {
    try {
        const { customers } = req.body;

        if (!customers || !Array.isArray(customers) || customers.length === 0) {
            return res.status(400).json({
                success: false,
                message: '고객 데이터가 올바르지 않습니다.'
            });
        }

        const results = {
            success: [],
            failed: [],
            total: customers.length
        };

        for (const customerData of customers) {
            try {
                // 필수 필드 검증
                if (!customerData.name || !customerData.phone) {
                    results.failed.push({
                        data: customerData,
                        error: '이름과 전화번호는 필수입니다.'
                    });
                    continue;
                }

                // 중복 검사 - 같은 사업자번호의 사용자들이 등록한 고객 중 전화번호가 같은 경우
                const user = req.user;
                const cleanPhone = customerData.phone.replace(/[-\s\(\)\.]/g, '');

                if (cleanPhone) {
                    // 같은 사업자번호의 사용자들이 등록한 고객 중 전화번호가 같은 경우 중복으로 처리
                    let duplicateQuery = {
                        phone: cleanPhone,
                        isDeleted: false
                    };

                    // 같은 사업자번호의 사용자들만 중복 검사
                    if (user.businessNumber) {
                        const usersWithSameBusiness = await User.find({ businessNumber: user.businessNumber }).select('_id');
                        duplicateQuery.publisher = { $in: usersWithSameBusiness };
                    } else {
                        duplicateQuery.publisher = user._id;
                    }

                    // 이메일이 있는 경우 이메일도 함께 검사
                    if (customerData.email && customerData.email.trim()) {
                        duplicateQuery.$or = [
                            { phone: cleanPhone },
                            { email: customerData.email }
                        ];
                    }

                    const existingCustomer = await Customer.findOne(duplicateQuery);

                    if (existingCustomer) {
                        // 중복 유형에 따른 구체적인 에러 메시지
                        let errorMessage = '이미 등록된 고객입니다.';

                        if (existingCustomer.phone === cleanPhone) {
                            errorMessage = '동일한 연락처가 이미 존재합니다.';
                        } else if (customerData.email && existingCustomer.email === customerData.email) {
                            errorMessage = '동일한 이메일이 이미 존재합니다.';
                        }

                        results.failed.push({
                            data: customerData,
                            error: errorMessage
                        });
                        continue;
                    }
                }

                // 고객 데이터 생성
                const newCustomer = new Customer({
                    name: customerData.name,
                    categories: customerData.categories && customerData.categories.length > 0 ? customerData.categories : ['매도'],
                    buyTypes: customerData.buyTypes || [],
                    buyPriceRanges: customerData.buyPriceRanges || {
                        매매: { min: null, max: null },
                        월세: { monthlyRent: { min: null, max: null }, deposit: { min: null, max: null } },
                        전세: { min: null, max: null }
                    },
                    phone: cleanPhone,
                    email: customerData.email || '',
                    businessNumber: customerData.businessNumber || '',
                    address: customerData.address || '',
                    budget: customerData.budget || null,
                    preferredArea: customerData.preferredArea || '',
                    properties: [],
                    status: '활성',
                    lastContact: customerData.lastContact || new Date(),
                    notes: customerData.notes || '',
                    publisher: req.user._id,
                    byCompanyNumber: req.user.businessNumber || '',
                    isDeleted: false,
                    propertyHistory: []
                });

                const savedCustomer = await newCustomer.save();
                results.success.push(savedCustomer);

            } catch (error) {
                console.error('고객 등록 실패:', error);
                console.error('실패한 고객 데이터:', customerData);
                console.error('오류 상세:', error.stack);
                results.failed.push({
                    data: customerData,
                    error: error.message
                });
            }
        }

        // 활동기록 로깅 (CSV 일괄등록)
        await logCustomerActivity(
            'CSV 일괄등록',
            `CSV 파일을 통해 ${results.success.length}명의 고객이 일괄등록되었습니다.`,
            req.user._id,
            req.user.name || req.user.email,
            null, // 관련 엔티티 ID (일괄등록이므로 null)
            `CSV 일괄등록 (${results.success.length}명)`,
            {
                totalCount: results.total,
                successCount: results.success.length,
                failedCount: results.failed.length,
                successCustomers: results.success.map(customer => ({
                    id: customer._id,
                    name: customer.name,
                    type: customer.type
                })),
                failedCustomers: results.failed.map(failed => ({
                    name: failed.data.name,
                    error: failed.error
                }))
            },
            req
        );

        res.status(200).json({
            success: true,
            message: `총 ${results.total}명 중 ${results.success.length}명 등록 성공, ${results.failed.length}명 실패`,
            data: results
        });

    } catch (error) {
        console.error('CSV 일괄 등록 오류:', error);
        res.status(500).json({
            success: false,
            message: 'CSV 일괄 등록 중 오류가 발생했습니다.',
            error: error.message
        });
    }
};

// 고객 일괄 삭제
exports.bulkDeleteCustomers = async (req, res) => {
    try {

        const { customerIds } = req.body;
        const user = req.user;

        // 기본 검증
        if (!customerIds || !Array.isArray(customerIds) || customerIds.length === 0) {
            return res.status(400).json({
                success: false,
                message: '삭제할 고객을 선택해주세요.'
            });
        }


        // 삭제 권한 확인을 위한 쿼리 구성 (isDeleted 조건 제거)
        let deleteQuery = {
            _id: { $in: customerIds }
        };


        // 사용자 권한에 따른 삭제 권한 확인
        if (user.level < 11) {
            if (user.businessNumber) {
                // 사업자번호가 있는 경우: 같은 사업자번호의 고객만 삭제 가능
                const usersWithSameBusiness = await User.find({ businessNumber: user.businessNumber }).select('_id');
                deleteQuery.publisher = { $in: usersWithSameBusiness };
            } else {
                // 그 외: 자신이 등록한 고객만 삭제 가능
                deleteQuery.publisher = user._id;
            }
        } else {
        }


        // 삭제 가능한 고객들 조회
        const customersToDelete = await Customer.find(deleteQuery);
        
        // 삭제될 고객들의 상세 정보 저장 (로깅용)
        const deletedCustomersInfo = customersToDelete.map(customer => ({
            id: customer._id,
            name: customer.name,
            phone: customer.phone,
            type: customer.type || '일반'
        }));
        
        // 디버깅: 모든 고객 조회 (삭제 상태 포함)
        const allCustomers = await Customer.find({ _id: { $in: customerIds } });
        
        if (customersToDelete.length === 0) {
            return res.status(400).json({
                success: false,
                message: '삭제할 수 있는 고객이 없습니다. 권한을 확인해주세요.'
            });
        }

        // 실제 삭제할 고객 ID들
        const deletableCustomerIds = customersToDelete.map(customer => customer._id);

        // 배치 크기 설정 (한 번에 처리할 고객 수)
        const batchSize = 50;
        const batches = [];
        for (let i = 0; i < deletableCustomerIds.length; i += batchSize) {
            batches.push(deletableCustomerIds.slice(i, i + batchSize));
        }

        let totalCustomersUpdated = 0;
        let totalSchedulesDeleted = 0;
        let totalSMSDeleted = 0;
        let totalPropertiesUpdated = 0;

        // 배치별로 처리
        for (let i = 0; i < batches.length; i++) {
            const batch = batches[i];

            try {
                // 1. 고객들을 실제로 삭제 (MongoDB에서 완전 제거)
                const customerDeleteResult = await Customer.deleteMany(
                    { _id: { $in: batch } }
                );

                // 2. 관련 일정 삭제
                const scheduleDeleteResult = await Schedule.deleteMany(
                    { customer: { $in: batch } }
                );

                // 3. 관련 SMS 이력 삭제
                const smsDeleteResult = await SMS.deleteMany(
                    { recipient: { $in: batch } }
                );

                // 4. 매물에서 고객 정보 제거
                const propertyUpdateResult = await Property.updateMany(
                    { 'interestedCustomers.customer': { $in: batch } },
                    { 
                        $pull: { 
                            interestedCustomers: { 
                                customer: { $in: batch } 
                            } 
                        }
                    }
                );

                totalCustomersUpdated += customerDeleteResult.deletedCount;
                totalSchedulesDeleted += scheduleDeleteResult.deletedCount;
                totalSMSDeleted += smsDeleteResult.deletedCount;
                totalPropertiesUpdated += propertyUpdateResult.modifiedCount;
            } catch (error) {
                // 개별 배치 실패 시에도 계속 진행
            }
        }

        // 활동기록 로깅 (일괄 삭제)
        await logCustomerActivity(
            '고객 일괄삭제',
            `${totalCustomersUpdated}명의 고객이 일괄삭제되었습니다.`,
            user._id,
            user.name || user.email,
            null, // 관련 엔티티 ID (일괄삭제이므로 null)
            `일괄삭제 (${totalCustomersUpdated}명)`,
            {
                requestedCount: customerIds.length,
                deletedCount: totalCustomersUpdated,
                skippedCount: customerIds.length - totalCustomersUpdated,
                deletedSchedules: totalSchedulesDeleted,
                deletedSMS: totalSMSDeleted,
                updatedProperties: totalPropertiesUpdated,
                deletedCustomers: deletedCustomersInfo.slice(0, 100) // 최대 100명까지만 상세 정보 저장
            },
            req
        );

        res.json({
            success: true,
            message: `${totalCustomersUpdated}명의 고객이 MongoDB에서 완전히 삭제되었습니다.`,
            data: {
                deletedCount: totalCustomersUpdated,
                requestedCount: customerIds.length,
                skippedCount: customerIds.length - totalCustomersUpdated,
                details: {
                    customers: totalCustomersUpdated,
                    schedules: totalSchedulesDeleted,
                    sms: totalSMSDeleted,
                    properties: totalPropertiesUpdated
                }
            }
        });

    } catch (error) {
        console.error('❌ 고객 일괄 삭제 오류:', error);
        console.error('❌ 오류 스택:', error.stack);
        res.status(500).json({
            success: false,
            message: '고객 일괄 삭제 중 오류가 발생했습니다.',
            error: error.message
        });
    }
};

// 모든 함수가 이미 exports로 정의되어 있으므로 추가 export 불필요 